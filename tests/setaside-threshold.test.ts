import { describe, expect, it } from 'vitest';
import { Fund, T0, purchase, sale } from './helpers.js';
import { DEFAULT_POLICY, assertValidPolicy, PolicyError } from '@/core/capital/policy.js';

/**
 * Below $100 of NAV the fund sets nothing aside: no owner cut, no operating
 * reserve, everything after tax compounds. Owner decision, 2026-09-08 —
 * "not set aside profit when the bankroll is below 100".
 */
describe('below the threshold, nothing is set aside', () => {
  // An employed owner at the live $50 bankroll: income tax IS owed on the
  // profit, which is what makes "tax still accrues" a testable claim.
  const fund = Fund.employed(5_000)
    .do(purchase({ itemId: 'i1', purchasePriceCents: 1_500 }))
    .do(sale({ itemId: 'i1', grossProceedsCents: 3_000, marketplaceFeeCents: 400 }));

  const alloc = fund.last().allocation!;

  it('makes a real profit', () => {
    expect(alloc.profitCents).toBe(1_100); // net 2600 - book 1500
  });

  it('pays the owner nothing and reserves nothing for operations', () => {
    expect(alloc.ownerCents).toBe(0);
    expect(alloc.operatingReserveCents).toBe(0);
    expect(alloc.setAsideSuppressed).toBe(true);
  });

  it('still accrues the tax reserve, because tax is an obligation', () => {
    // $11.00 of profit, under the $400 SE floor, so this is income tax alone.
    expect(alloc.taxCents).toBe(106);
    expect(alloc.tax.selfEmploymentCents).toBe(0);
    expect(alloc.tax.federalIncomeCents).toBe(106);
    expect(fund.metrics().taxReserveCents).toBe(106);
  });

  it('compounds the entire after-tax remainder back into the fund', () => {
    expect(alloc.reinvestedCents).toBe(alloc.profitCents - alloc.taxCents);
    expect(fund.metrics().ownerPayableCents).toBe(0);
    expect(fund.metrics().operatingReserveCents).toBe(0);
  });

  it('leaves every cent of it deployable rather than earmarked', () => {
    const m = fund.metrics();
    expect(m.navCents).toBe(5_000 + 1_100 - 106);
    expect(m.unencumberedCashCents).toBe(m.navCents); // nothing in inventory
  });

  it('reports the NAV the decision was made against', () => {
    expect(alloc.navAtAllocationCents).toBe(5_000 + 1_100);
  });
});

describe('the flip that crosses $100 is the first one to pay out', () => {
  it('sets aside when NAV after the sale reaches the threshold', () => {
    // $88 fund + $13 profit = $101 -> over the line.
    const fund = Fund.withBankroll(8_800)
      .do(purchase({ itemId: 'i1', purchasePriceCents: 1_000 }))
      .do(sale({ itemId: 'i1', grossProceedsCents: 2_300 }));

    const alloc = fund.last().allocation!;
    expect(alloc.profitCents).toBe(1_300);
    expect(alloc.navAtAllocationCents).toBe(10_100);
    expect(alloc.setAsideSuppressed).toBe(false);
    expect(alloc.ownerCents).toBeGreaterThan(0);
  });

  it('still suppresses one cent below it', () => {
    // $88 fund + $11.99 profit = $99.99 -> under the line.
    const fund = Fund.withBankroll(8_800)
      .do(purchase({ itemId: 'i1', purchasePriceCents: 1_000 }))
      .do(sale({ itemId: 'i1', grossProceedsCents: 2_199 }));

    const alloc = fund.last().allocation!;
    expect(alloc.navAtAllocationCents).toBe(9_999);
    expect(alloc.setAsideSuppressed).toBe(true);
    expect(alloc.ownerCents).toBe(0);
  });
});

describe('the warm-up compounds faster than paying out would', () => {
  it('grows the fund more over four flips than the same flips would with a split', () => {
    const run = (setAsideMinNavCents: number): number => {
      const policy = {
        ...DEFAULT_POLICY,
        allocation: { ...DEFAULT_POLICY.allocation, setAsideMinNavCents },
      };
      const fund = new Fund(policy).do({
        type: 'CONTRIBUTION',
        amountCents: 5_000,
        occurredAt: T0,
      });
      for (let i = 0; i < 4; i += 1) {
        fund
          .do(purchase({ itemId: `i${i}`, purchasePriceCents: 1_500 }))
          .do(sale({ itemId: `i${i}`, grossProceedsCents: 3_000, marketplaceFeeCents: 400 }));
      }
      return fund.metrics().navCents;
    };

    const warmUp = run(10_000); // suppressed below $100
    const alwaysSplit = run(0); // pay out from the first cent
    expect(warmUp).toBeGreaterThan(alwaysSplit);
    // The whole point: the difference is the money that stayed in the fund.
    expect(warmUp - alwaysSplit).toBeGreaterThan(0);
  });

  it('and the owner starts being paid once it clears the line', () => {
    const fund = new Fund(DEFAULT_POLICY).do({
      type: 'CONTRIBUTION',
      amountCents: 5_000,
      occurredAt: T0,
    });
    let firstPayingFlip = -1;
    for (let i = 0; i < 8; i += 1) {
      fund
        .do(purchase({ itemId: `i${i}`, purchasePriceCents: 1_500 }))
        .do(sale({ itemId: `i${i}`, grossProceedsCents: 3_000, marketplaceFeeCents: 400 }));
      if (firstPayingFlip === -1 && fund.last().allocation!.ownerCents > 0) firstPayingFlip = i;
    }
    // It happens, and it happens early. The warm-up is a warm-up.
    expect(firstPayingFlip).toBeGreaterThanOrEqual(0);
    expect(fund.metrics().ownerPayableCents).toBeGreaterThan(0);
  });
});

describe('the threshold cannot become a permanent retention phase', () => {
  it('is rejected when it reaches the GROWTH threshold', () => {
    expect(() =>
      assertValidPolicy({
        ...DEFAULT_POLICY,
        allocation: { ...DEFAULT_POLICY.allocation, setAsideMinNavCents: 50_000 },
      }),
    ).toThrow(/cannot become a phase/);
  });

  it('rejects a negative threshold', () => {
    expect(() =>
      assertValidPolicy({
        ...DEFAULT_POLICY,
        allocation: { ...DEFAULT_POLICY.allocation, setAsideMinNavCents: -1 },
      }),
    ).toThrow(PolicyError);
  });

  it('accepts 0, which means pay out from the very first cent', () => {
    expect(() =>
      assertValidPolicy({
        ...DEFAULT_POLICY,
        allocation: { ...DEFAULT_POLICY.allocation, setAsideMinNavCents: 0 },
      }),
    ).not.toThrow();
  });

  it('ships at $100', () => {
    expect(DEFAULT_POLICY.allocation.setAsideMinNavCents).toBe(10_000);
  });
});

describe('a loss below the threshold behaves the same as above it', () => {
  it('takes the loss out of NAV and sets nothing aside either way', () => {
    const fund = Fund.withBankroll(5_000)
      .do(purchase({ itemId: 'i1', purchasePriceCents: 2_000 }))
      .do(sale({ itemId: 'i1', grossProceedsCents: 1_000 }));

    const alloc = fund.last().allocation!;
    expect(alloc.profitCents).toBe(-1_000);
    expect(alloc.setAsideSuppressed).toBe(false); // there was nothing to suppress
    expect(alloc.taxCents).toBe(0);
    expect(fund.metrics().navCents).toBe(4_000);
  });
});
