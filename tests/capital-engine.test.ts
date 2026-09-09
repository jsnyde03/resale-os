import { describe, expect, it } from 'vitest';
import { Fund, T0, purchase, sale } from './helpers.js';
import { splitProfit, EngineError } from '@/core/capital/engine.js';
import { InvariantViolation } from '@/core/ledger/invariants.js';
import { presentedBalance } from '@/core/capital/metrics.js';
import { DEFAULT_POLICY } from '@/core/capital/policy.js';
import { ACCOUNTS } from '@/core/ledger/accounts.js';
import { initialFundState } from '@/core/capital/state.js';

const identity = (fund: Fund): number =>
  ACCOUNTS.reduce((acc, a) => acc + fund.state.balances[a], 0);

describe('starting bankroll', () => {
  it('funds LIQUID and contributed capital, and nothing else', () => {
    const fund = Fund.withBankroll(7_500);
    const m = fund.metrics();
    expect(m.liquidCents).toBe(7_500);
    expect(m.contributedCapitalCents).toBe(7_500);
    expect(m.navCents).toBe(7_500);
    expect(m.inventoryAtCostCents).toBe(0);
    expect(m.retainedEarningsCents).toBe(0);
    expect(identity(fund)).toBe(0);
  });

  it('starts in BOOTSTRAP at $75', () => {
    expect(Fund.withBankroll(7_500).metrics().mode).toBe('BOOTSTRAP');
  });

  it('reserves nothing at $0', () => {
    const m = new Fund().metrics();
    expect(m.navCents).toBe(0);
    expect(m.deployableCapitalCents).toBe(0);
  });
});

describe('purchases and partial capital deployment', () => {
  it('capitalises landed cost, not just the sticker price', () => {
    const fund = Fund.withBankroll(7_500).do(
      purchase({
        itemId: 'i1',
        purchasePriceCents: 1_000,
        inboundShippingCents: 300,
        salesTaxCents: 80,
        acquisitionTravelCents: 120,
      }),
    );

    expect(fund.item('i1').landedCostCents).toBe(1_500);
    expect(fund.item('i1').bookValueCents).toBe(1_500);
    expect(fund.metrics().inventoryAtCostCents).toBe(1_500);
    expect(fund.metrics().liquidCents).toBe(6_000);
    // NAV is unchanged: capital moved from cash to goods, it did not vanish.
    expect(fund.metrics().navCents).toBe(7_500);
  });

  it('leaves the rest of the bankroll deployable', () => {
    const fund = Fund.withBankroll(7_500).do(purchase({ itemId: 'i1', purchasePriceCents: 1_000 }));
    const m = fund.metrics();
    expect(m.capitalDeployedCents).toBe(1_000);
    // min(unencumbered 6500 - floor 750, maxDeployed 6375 - 1000)
    expect(m.deployableCapitalCents).toBe(5_375);
  });

  it('refuses to spend money the fund does not have', () => {
    const fund = Fund.withBankroll(1_000);
    expect(() => fund.do(purchase({ itemId: 'i1', purchasePriceCents: 5_000 }))).toThrow(
      InvariantViolation,
    );
    // and the state is untouched
    expect(fund.metrics().liquidCents).toBe(1_000);
    expect(fund.state.items.i1).toBeUndefined();
  });

  it('rejects a duplicate item id', () => {
    const fund = Fund.withBankroll(7_500).do(purchase({ itemId: 'i1' }));
    expect(() => fund.do(purchase({ itemId: 'i1' }))).toThrow(EngineError);
  });
});

describe('a profitable sale', () => {
  // Above the $100 set-aside threshold, so the full split runs.
  const fund = Fund.withBankroll(15_000)
    .do(purchase({ itemId: 'i1', purchasePriceCents: 1_000 }))
    .do(
      sale({
        itemId: 'i1',
        grossProceedsCents: 3_000,
        marketplaceFeeCents: 400,
        paymentFeeCents: 100,
        outboundShippingCents: 500,
        packagingCents: 0,
        daysToSale: 6,
      }),
    );

  // net = 3000 - 1000 fees/shipping = 2000; profit = 2000 - 1000 = 1000
  const alloc = fund.last().allocation!;

  it('returns principal to the fund before anything is called profit', () => {
    expect(fund.metrics().inventoryAtCostCents).toBe(0);
    expect(alloc.profitCents).toBe(1_000);
  });

  it('reserves the tax this sale actually adds, then splits the remainder', () => {
    // $10 of profit with no other income leaves the year under the $400
    // self-employment floor, so no tax is owed and none is reserved.
    expect(alloc.taxCents).toBe(0);
    expect(alloc.tax.belowSelfEmploymentThreshold).toBe(true);
    expect(alloc.ownerCents).toBe(200); // 20% of 1000
    expect(alloc.operatingReserveCents).toBe(100); // 10% of 1000
    expect(alloc.reinvestedCents).toBe(700); // 70% of 1000
    expect(
      alloc.taxCents + alloc.ownerCents + alloc.operatingReserveCents + alloc.reinvestedCents,
    ).toBe(alloc.profitCents);
  });

  it('lands those amounts in the right accounts', () => {
    const m = fund.metrics();
    expect(m.taxReserveCents).toBe(0); // under the $400 SE floor for the year
    expect(m.operatingReserveCents).toBe(100);
    expect(m.ownerPayableCents).toBe(200);
    expect(m.liquidCents).toBe(15_000 - 1_000 + 2_000);
    expect(m.navCents).toBe(15_000 + 1_000 - 100 - 200);
  });

  it('keeps the identity at zero', () => {
    expect(identity(fund)).toBe(0);
  });

  it('records the actual days to sale for later calibration', () => {
    expect(fund.item('i1').daysToSale).toBe(6);
    expect(fund.item('i1').state).toBe('SOLD');
  });
});

describe('break-even and losing sales', () => {
  it('allocates nothing at break-even', () => {
    const fund = Fund.withBankroll(7_500)
      .do(purchase({ itemId: 'i1', purchasePriceCents: 1_000 }))
      .do(sale({ itemId: 'i1', grossProceedsCents: 1_000 }));

    const alloc = fund.last().allocation!;
    expect(alloc.profitCents).toBe(0);
    expect(alloc.taxCents).toBe(0);
    expect(alloc.ownerCents).toBe(0);
    const m = fund.metrics();
    expect(m.taxReserveCents).toBe(0);
    expect(m.ownerPayableCents).toBe(0);
    expect(m.navCents).toBe(7_500);
  });

  it('takes a loss out of NAV and pays the owner nothing', () => {
    const fund = Fund.withBankroll(7_500)
      .do(purchase({ itemId: 'i1', purchasePriceCents: 2_000 }))
      .do(sale({ itemId: 'i1', grossProceedsCents: 1_400, marketplaceFeeCents: 200 }));

    const alloc = fund.last().allocation!;
    expect(alloc.profitCents).toBe(-800); // net 1200 - book 2000
    expect(alloc.ownerCents).toBe(0);
    expect(alloc.taxCents).toBe(0);

    const m = fund.metrics();
    expect(m.navCents).toBe(6_700);
    expect(m.retainedEarningsCents).toBe(-800);
    expect(m.ownerPayableCents).toBe(0);
    expect(identity(fund)).toBe(0);
  });

  it('never lets a loss create a negative reserve', () => {
    const fund = Fund.withBankroll(7_500)
      .do(purchase({ itemId: 'i1', purchasePriceCents: 2_000 }))
      .do(sale({ itemId: 'i1', grossProceedsCents: 100 }));
    expect(fund.metrics().taxReserveCents).toBe(0);
    expect(fund.metrics().operatingReserveCents).toBe(0);
  });
});

describe('the owner is paid from the first profitable transaction', () => {
  it('pays out on a $2 profit', () => {
    const fund = Fund.withBankroll(15_000)
      .do(purchase({ itemId: 'i1', purchasePriceCents: 500 }))
      .do(sale({ itemId: 'i1', grossProceedsCents: 700 }));

    const alloc = fund.last().allocation!;
    expect(alloc.profitCents).toBe(200);
    expect(alloc.ownerCents).toBeGreaterThan(0);
    expect(fund.metrics().ownerPayableCents).toBe(alloc.ownerCents);
  });

  it('pays the owner even on a 3-cent profit — no rounding to zero', () => {
    const fund = Fund.withBankroll(15_000)
      .do(purchase({ itemId: 'i1', purchasePriceCents: 500 }))
      .do(sale({ itemId: 'i1', grossProceedsCents: 503 }));
    const alloc = fund.last().allocation!;
    expect(alloc.profitCents).toBe(3);
    // SE tax on 3c rounds to 0c, so all 3c split 20/10/70 and the owner takes
    // the largest remainder. The point is that SOMETHING reaches the owner.
    expect(alloc.taxCents + alloc.ownerCents + alloc.operatingReserveCents + alloc.reinvestedCents)
      .toBe(3);
    expect(alloc.ownerCents).toBeGreaterThan(0);
  });

  it('splits exactly for every profit from 1c to $50', () => {
    const state = initialFundState(DEFAULT_POLICY);
    for (let profit = 1; profit <= 5_000; profit += 1) {
      const a = splitProfit(profit, state);
      expect(a.taxCents + a.ownerCents + a.operatingReserveCents + a.reinvestedCents).toBe(profit);
      expect(a.taxCents).toBeGreaterThanOrEqual(0);
      expect(a.ownerCents).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('owner payouts', () => {
  const profitable = () =>
    Fund.withBankroll(15_000)
      .do(purchase({ itemId: 'i1', purchasePriceCents: 1_000 }))
      .do(sale({ itemId: 'i1', grossProceedsCents: 3_000 }));

  it('moves cash out and clears the payable', () => {
    const fund = profitable();
    const owed = fund.metrics().ownerPayableCents;
    const cashBefore = fund.metrics().liquidCents;

    fund.do({ type: 'OWNER_PAYOUT', amountCents: owed, occurredAt: T0 });

    expect(fund.metrics().ownerPayableCents).toBe(0);
    expect(fund.metrics().liquidCents).toBe(cashBefore - owed);
    expect(identity(fund)).toBe(0);
  });

  it('refuses to pay out more than is owed', () => {
    const fund = profitable();
    const owed = fund.metrics().ownerPayableCents;
    expect(() =>
      fund.do({ type: 'OWNER_PAYOUT', amountCents: owed + 1, occurredAt: T0 }),
    ).toThrow(EngineError);
  });

  it('does not change NAV — the money was already earmarked', () => {
    const fund = profitable();
    const navBefore = fund.metrics().navCents;
    fund.do({ type: 'OWNER_PAYOUT', amountCents: 100, occurredAt: T0 });
    expect(fund.metrics().navCents).toBe(navBefore);
  });
});

describe('business expenses', () => {
  it('reduces cash and equity but not the reserves', () => {
    const fund = Fund.withBankroll(7_500).do({
      type: 'BUSINESS_EXPENSE',
      amountCents: 1_200,
      category: 'SUPPLIES',
      occurredAt: T0,
    });
    const m = fund.metrics();
    expect(m.liquidCents).toBe(6_300);
    expect(m.retainedEarningsCents).toBe(-1_200);
    expect(m.navCents).toBe(6_300);
    expect(m.operatingReserveCents).toBe(0);
  });

  it('releases the operating-reserve earmark when funded from it', () => {
    const fund = Fund.withBankroll(15_000)
      .do(purchase({ itemId: 'i1', purchasePriceCents: 1_000 }))
      .do(sale({ itemId: 'i1', grossProceedsCents: 3_000 })); // ops reserve 150

    const reserveBefore = fund.metrics().operatingReserveCents;
    expect(reserveBefore).toBeGreaterThan(0);

    fund.do({
      type: 'BUSINESS_EXPENSE',
      amountCents: 100,
      category: 'PACKAGING',
      fundedFromOperatingReserve: true,
      occurredAt: T0,
    });

    expect(fund.metrics().operatingReserveCents).toBe(reserveBefore - 100);
    expect(identity(fund)).toBe(0);
  });

  it('releases only what the reserve actually holds', () => {
    const fund = Fund.withBankroll(7_500).do({
      type: 'BUSINESS_EXPENSE',
      amountCents: 500,
      category: 'SUPPLIES',
      fundedFromOperatingReserve: true,
      occurredAt: T0,
    });
    expect(fund.metrics().operatingReserveCents).toBe(0);
    expect(identity(fund)).toBe(0);
  });
});

describe('tax reserve and payment', () => {
  it('pays tax out of the reserve, never out of thin air', () => {
    // An employed owner, so income tax is estimated and a reserve exists.
    const fund = Fund.employed(15_000)
      .do(purchase({ itemId: 'i1', purchasePriceCents: 1_000 }))
      .do(sale({ itemId: 'i1', grossProceedsCents: 3_000 }));

    const reserve = fund.metrics().taxReserveCents;
    expect(reserve).toBeGreaterThan(0);

    expect(() =>
      fund.do({ type: 'TAX_PAYMENT', amountCents: reserve + 1, occurredAt: T0 }),
    ).toThrow(EngineError);

    fund.do({ type: 'TAX_PAYMENT', amountCents: reserve, occurredAt: T0 });
    expect(fund.metrics().taxReserveCents).toBe(0);
    expect(identity(fund)).toBe(0);
  });
});

describe('charge-offs', () => {
  const chargedOff = () =>
    Fund.withBankroll(7_500)
      .do(purchase({ itemId: 'i1', purchasePriceCents: 2_000 }))
      .do({ type: 'CHARGE_OFF', itemId: 'i1', reason: 'STALE', keepListingLive: true, occurredAt: T0 });

  it('does NOT return capital to the fund', () => {
    const fund = chargedOff();
    const m = fund.metrics();
    expect(m.inventoryAtCostCents).toBe(0);
    expect(m.liquidCents).toBe(5_500); // unchanged by the charge-off itself
    expect(m.navCents).toBe(5_500); // the fund really is $20 poorer
    expect(fund.item('i1').bookValueCents).toBe(0);
    expect(fund.item('i1').state).toBe('CHARGED_OFF');
  });

  it('can leave the listing live, which is what makes recovery possible', () => {
    expect(chargedOff().item('i1').listingLive).toBe(true);
  });

  it('treats PERSONAL_KEEP as a reason, with its own item state', () => {
    const fund = Fund.withBankroll(7_500)
      .do(purchase({ itemId: 'i1', purchasePriceCents: 2_000 }))
      .do({ type: 'CHARGE_OFF', itemId: 'i1', reason: 'PERSONAL_KEEP', occurredAt: T0 });
    expect(fund.item('i1').state).toBe('PERSONAL_KEEP');
    expect(fund.item('i1').chargeOffReason).toBe('PERSONAL_KEEP');
    expect(fund.metrics().navCents).toBe(5_500);
  });

  it('removes the item from active working capital', () => {
    const fund = chargedOff();
    expect(fund.metrics().activeItemCount).toBe(0);
    expect(fund.metrics().categoryExposureCents.DISNEY_PINS ?? 0).toBe(0);
  });

  it('refuses to charge off twice', () => {
    const fund = chargedOff();
    expect(() =>
      fund.do({ type: 'CHARGE_OFF', itemId: 'i1', reason: 'LOST', occurredAt: T0 }),
    ).toThrow(EngineError);
  });
});

describe('passive recovery', () => {
  it('books the whole net as profit, because there is no principal left', () => {
    const fund = Fund.employed(15_000)
      .do(purchase({ itemId: 'i1', purchasePriceCents: 2_000 }))
      .do({ type: 'CHARGE_OFF', itemId: 'i1', reason: 'STALE', keepListingLive: true, occurredAt: T0 })
      .do({
        type: 'PASSIVE_RECOVERY',
        itemId: 'i1',
        grossProceedsCents: 1_500,
        marketplaceFeeCents: 200,
        occurredAt: T0,
      });

    const alloc = fund.last().allocation!;
    expect(alloc.profitCents).toBe(1_300);
    // A recovery is profit, and is taxed like it.
    expect(alloc.taxCents).toBeGreaterThan(0);
    expect(alloc.ownerCents).toBeGreaterThan(0);

    const m = fund.metrics();
    expect(m.liquidCents).toBe(13_000 + 1_300);
    expect(m.inventoryAtCostCents).toBe(0);
    expect(fund.item('i1').state).toBe('PASSIVE_RECOVERY');
    expect(identity(fund)).toBe(0);
  });

  it('is the only way a charged-off item can sell', () => {
    const fund = Fund.withBankroll(7_500)
      .do(purchase({ itemId: 'i1', purchasePriceCents: 2_000 }))
      .do({ type: 'CHARGE_OFF', itemId: 'i1', reason: 'STALE', occurredAt: T0 });
    expect(() => fund.do(sale({ itemId: 'i1' }))).toThrow(EngineError);
  });

  it('refuses to recover an item that still holds capital', () => {
    const fund = Fund.withBankroll(7_500).do(purchase({ itemId: 'i1' }));
    expect(() =>
      fund.do({ type: 'PASSIVE_RECOVERY', itemId: 'i1', grossProceedsCents: 500, occurredAt: T0 }),
    ).toThrow(EngineError);
  });

  it('a full charge-off then recovery nets to the real economic result', () => {
    // Bought for $20, recovered $15 gross with $2 of fees => $7 worse off.
    const fund = Fund.withBankroll(7_500)
      .do(purchase({ itemId: 'i1', purchasePriceCents: 2_000 }))
      .do({ type: 'CHARGE_OFF', itemId: 'i1', reason: 'STALE', occurredAt: T0 })
      .do({
        type: 'PASSIVE_RECOVERY',
        itemId: 'i1',
        grossProceedsCents: 1_500,
        marketplaceFeeCents: 200,
        occurredAt: T0,
      });
    expect(fund.item('i1').realizedProfitCents).toBe(-2_000 + 1_300);
  });
});

describe('inventory lifecycle states', () => {
  it('moves through markdown and capital recovery without moving money', () => {
    const fund = Fund.withBankroll(7_500).do(purchase({ itemId: 'i1', purchasePriceCents: 1_000 }));
    const navBefore = fund.metrics().navCents;

    fund.do({ type: 'SET_ITEM_STATE', itemId: 'i1', state: 'MARKDOWN', occurredAt: T0 });
    expect(fund.item('i1').state).toBe('MARKDOWN');
    expect(fund.metrics().navCents).toBe(navBefore);
    expect(fund.metrics().inventoryAtCostCents).toBe(1_000);

    fund.do({ type: 'SET_ITEM_STATE', itemId: 'i1', state: 'CAPITAL_RECOVERY', occurredAt: T0 });
    expect(fund.metrics().capitalDeployedCents).toBe(1_000);
  });

  it('still sells normally from MARKDOWN', () => {
    const fund = Fund.withBankroll(7_500)
      .do(purchase({ itemId: 'i1', purchasePriceCents: 1_000 }))
      .do({ type: 'SET_ITEM_STATE', itemId: 'i1', state: 'MARKDOWN', occurredAt: T0 })
      .do(sale({ itemId: 'i1', grossProceedsCents: 1_200 }));
    expect(fund.item('i1').state).toBe('SOLD');
    expect(fund.last().allocation!.profitCents).toBe(200);
  });
});

describe('adjustments', () => {
  it('corrects a balance against retained earnings, with a reason', () => {
    const fund = Fund.withBankroll(7_500).do({
      type: 'ADJUSTMENT',
      account: 'LIQUID',
      amountCents: -25,
      reason: 'bank reconciliation: unrecorded fee',
      occurredAt: T0,
    });
    expect(fund.metrics().liquidCents).toBe(7_475);
    expect(fund.metrics().retainedEarningsCents).toBe(-25);
    expect(identity(fund)).toBe(0);
  });

  it('requires a reason', () => {
    const fund = Fund.withBankroll(7_500);
    expect(() =>
      fund.do({ type: 'ADJUSTMENT', account: 'LIQUID', amountCents: -25, reason: '  ', occurredAt: T0 }),
    ).toThrow(EngineError);
  });
});

describe('correcting a mistake leaves both the error and the fix visible', () => {
  it('reverses a wrongly-recorded expense without editing anything', () => {
    // The append-only discipline in practice: two smoke-test expenses landed on
    // a real ledger during this project, and this is exactly how they were undone.
    const fund = Fund.withBankroll(5_000)
      .do({ type: 'BUSINESS_EXPENSE', amountCents: 100, category: 'SUPPLIES', occurredAt: T0 })
      .do({ type: 'BUSINESS_EXPENSE', amountCents: 50, category: 'SUPPLIES', occurredAt: T0 });

    expect(fund.metrics().navCents).toBe(4_850);

    fund.do({
      type: 'ADJUSTMENT',
      account: 'LIQUID',
      amountCents: 150,
      reason: 'reverse smoke-test expenses: not business activity',
      occurredAt: T0,
    });

    expect(fund.metrics().navCents).toBe(5_000);
    expect(fund.metrics().retainedEarningsCents).toBe(0);
    expect(identity(fund)).toBe(0);

    // Nothing was removed: the record still shows what happened and what fixed it.
    expect(fund.state.eventCount).toBe(4);
    const last = fund.last().event;
    expect(last.type).toBe('ADJUSTMENT');
    expect(last.postings.some((p) => p.memo?.includes('smoke-test'))).toBe(true);
  });

  it('will not let an adjustment be made without saying why', () => {
    const fund = Fund.withBankroll(5_000);
    expect(() =>
      fund.do({
        type: 'ADJUSTMENT',
        account: 'LIQUID',
        amountCents: -100,
        reason: '',
        occurredAt: T0,
      }),
    ).toThrow(EngineError);
  });
});

describe('invariants hold across a long mixed history', () => {
  it('never breaks the identity, and every posting set balances', () => {
    const fund = Fund.withBankroll(7_500);
    for (let i = 0; i < 25; i += 1) {
      const id = `i${i}`;
      fund.do(purchase({ itemId: id, purchasePriceCents: 900 + (i % 5) * 37 }));
      if (i % 5 === 4) {
        fund.do({ type: 'CHARGE_OFF', itemId: id, reason: 'STALE', occurredAt: T0 });
      } else {
        fund.do(sale({ itemId: id, grossProceedsCents: 1_700 + i * 11, marketplaceFeeCents: 130 }));
      }
      expect(identity(fund)).toBe(0);
      for (const account of ACCOUNTS) {
        if (account === 'RETAINED_EARNINGS' || account === 'CONTRIBUTED_CAPITAL') continue;
        expect(presentedBalance(fund.state.balances, account)).toBeGreaterThanOrEqual(0);
      }
    }
    expect(fund.state.eventCount).toBeGreaterThan(40);
  });
});
