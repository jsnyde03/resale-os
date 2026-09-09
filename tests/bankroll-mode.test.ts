import { describe, expect, it } from 'vitest';
import { Fund, T0, purchase, sale } from './helpers.js';
import { resolveBankrollMode } from '@/core/capital/metrics.js';
import {
  DEFAULT_POLICY,
  DEFAULT_TAX,
  assertValidPolicy,
  PolicyError,
} from '@/core/capital/policy.js';

describe('mode thresholds', () => {
  it('is BOOTSTRAP below $500 and GROWTH at or above it', () => {
    expect(resolveBankrollMode(49_999, 'BOOTSTRAP', DEFAULT_POLICY)).toBe('BOOTSTRAP');
    expect(resolveBankrollMode(50_000, 'BOOTSTRAP', DEFAULT_POLICY)).toBe('GROWTH');
  });

  it('holds its mode inside the hysteresis band', () => {
    // Between $450 and $500 the mode is whatever it already was.
    expect(resolveBankrollMode(47_000, 'GROWTH', DEFAULT_POLICY)).toBe('GROWTH');
    expect(resolveBankrollMode(47_000, 'BOOTSTRAP', DEFAULT_POLICY)).toBe('BOOTSTRAP');
  });

  it('demotes only below $450, so a fund cannot oscillate at the boundary', () => {
    expect(resolveBankrollMode(45_000, 'GROWTH', DEFAULT_POLICY)).toBe('GROWTH');
    expect(resolveBankrollMode(44_999, 'GROWTH', DEFAULT_POLICY)).toBe('BOOTSTRAP');
  });
});

describe('mode transitions in a live fund', () => {
  it('promotes when NAV crosses $500 and applies the growth policy immediately', () => {
    const fund = Fund.withBankroll(48_000);
    expect(fund.metrics().mode).toBe('BOOTSTRAP');
    expect(fund.metrics().modePolicy.maxHoldDays).toBe(21);

    fund
      .do(purchase({ itemId: 'i1', purchasePriceCents: 10_000 }))
      .do(sale({ itemId: 'i1', grossProceedsCents: 14_000 }));

    const m = fund.metrics();
    expect(m.navCents).toBeGreaterThanOrEqual(50_000);
    expect(m.mode).toBe('GROWTH');
    expect(m.modePolicy.maxHoldDays).toBe(60);
    expect(m.modePolicy.maxLongHoldBps).toBe(3_000);
  });

  it('stays in GROWTH through a loss that keeps NAV inside the band', () => {
    const fund = Fund.withBankroll(52_000)
      .do(purchase({ itemId: 'i1', purchasePriceCents: 5_000 }))
      .do(sale({ itemId: 'i1', grossProceedsCents: 1_500 })); // -$35

    const m = fund.metrics();
    expect(m.navCents).toBeLessThan(50_000);
    expect(m.navCents).toBeGreaterThanOrEqual(45_000);
    expect(m.mode).toBe('GROWTH'); // hysteresis
  });

  it('demotes when NAV falls below $450', () => {
    const fund = Fund.withBankroll(52_000)
      .do(purchase({ itemId: 'i1', purchasePriceCents: 10_000 }))
      .do(sale({ itemId: 'i1', grossProceedsCents: 1_000 })); // -$90

    expect(fund.metrics().navCents).toBeLessThan(45_000);
    expect(fund.metrics().mode).toBe('BOOTSTRAP');
  });

  it('does not demote just because capital is deployed — NAV, not cash, drives mode', () => {
    const fund = Fund.withBankroll(60_000).do(
      purchase({ itemId: 'i1', purchasePriceCents: 40_000, expectedDaysToSale: 5 }),
    );
    expect(fund.metrics().unencumberedCashCents).toBe(20_000);
    expect(fund.metrics().navCents).toBe(60_000);
    expect(fund.metrics().mode).toBe('GROWTH');
  });
});

describe('bootstrap capital sizing at a real starting bankroll', () => {
  it('caps a single item at $30 on a $75 fund', () => {
    const m = Fund.withBankroll(7_500).metrics();
    expect(m.maxCapitalPerItemCents).toBe(3_000);
    expect(m.minLiquidFloorCents).toBe(750);
    expect(m.maxDeployedCents).toBe(6_375);
    expect(m.deployableCapitalCents).toBe(6_375);
  });

  it('allows no long-hold capital at all in BOOTSTRAP', () => {
    expect(Fund.withBankroll(7_500).metrics().maxLongHoldCents).toBe(0);
  });
});

describe('policy validation', () => {
  it('rejects an after-tax split that does not sum to 100%', () => {
    expect(() =>
      assertValidPolicy({
        ...DEFAULT_POLICY,
        allocation: { ...DEFAULT_POLICY.allocation, reinvestBps: 6_000 },
      }),
    ).toThrow(PolicyError);
  });

  it('refuses to let the owner be cut out entirely', () => {
    expect(() =>
      assertValidPolicy({
        ...DEFAULT_POLICY,
        allocation: {
          tax: DEFAULT_TAX,
          setAsideMinNavCents: 10_000,
          ownerBps: 0,
          operatingReserveBps: 1_000,
          reinvestBps: 9_000,
        },
      }),
    ).toThrow(/ownerBps/);
  });

  it('requires a real hysteresis band', () => {
    expect(() =>
      assertValidPolicy({
        ...DEFAULT_POLICY,
        thresholds: { promoteAtCents: 50_000, demoteAtCents: 50_000 },
      }),
    ).toThrow(PolicyError);
  });

  it('requires ideal <= penaltyHard <= maxHold', () => {
    expect(() =>
      assertValidPolicy({
        ...DEFAULT_POLICY,
        modes: {
          ...DEFAULT_POLICY.modes,
          BOOTSTRAP: { ...DEFAULT_POLICY.modes.BOOTSTRAP, maxHoldDays: 5 },
        },
      }),
    ).toThrow(PolicyError);
  });

  it('rejects a stored policy that is missing any field the code requires', () => {
    // The bug this prevents: a policy older than a new field yielded `undefined`,
    // which flowed into a gate's limit as NaN and printed "vs a NaN% minimum".
    // It failed closed by luck. Validation is now driven off the default object,
    // so adding a field to ModePolicy makes it required here automatically.
    const stale = JSON.parse(JSON.stringify(DEFAULT_POLICY)) as typeof DEFAULT_POLICY;
    delete (stale.modes.BOOTSTRAP as unknown as Record<string, unknown>).minSellThroughBps;
    expect(() => assertValidPolicy(stale)).toThrow(/minSellThroughBps is missing/);
  });

  it('names every field it requires, not a hand-written subset', () => {
    // Dropping ANY numeric field must fail, whichever one a future edit adds.
    for (const key of Object.keys(DEFAULT_POLICY.modes.BOOTSTRAP)) {
      const stale = JSON.parse(JSON.stringify(DEFAULT_POLICY)) as typeof DEFAULT_POLICY;
      delete (stale.modes.BOOTSTRAP as unknown as Record<string, unknown>)[key];
      expect(() => assertValidPolicy(stale), `dropping ${key} should fail`).toThrow(PolicyError);
    }
  });

  it('accepts the shipped defaults', () => {
    expect(() => assertValidPolicy(DEFAULT_POLICY)).not.toThrow();
  });
});

describe('the income-tax component follows the tax profile', () => {
  const sell = (fund: Fund) =>
    fund
      .do(purchase({ itemId: 'i1', purchasePriceCents: 1_000 }))
      .do(sale({ itemId: 'i1', grossProceedsCents: 3_000 }));

  it('reserves nothing at all when the year is under the $400 SE floor', () => {
    // $20 of profit, no other income: no SE tax is owed and no profile is set.
    const alloc = sell(new Fund(DEFAULT_POLICY).do({
      type: 'CONTRIBUTION',
      amountCents: 15_000,
      occurredAt: T0,
    })).last().allocation!;
    expect(alloc.profitCents).toBe(2_000);
    expect(alloc.taxCents).toBe(0);
    expect(alloc.tax.belowSelfEmploymentThreshold).toBe(true);
    expect(alloc.tax.incomeTaxEstimated).toBe(false);
  });
});
