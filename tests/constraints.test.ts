import { describe, expect, it } from 'vitest';
import { Fund, purchase } from './helpers.js';
import {
  assessPurchase,
  maxAffordableLandedCost,
  CONSTRAINT_CODES,
  type ConstraintCode,
  type PurchaseCandidate,
} from '@/core/capital/constraints.js';
import { estimateFromComps, estimateFromOperator } from '@/core/velocity.js';

function candidate(overrides: Partial<PurchaseCandidate> = {}): PurchaseCandidate {
  return {
    category: 'DISNEY_PINS',
    landedCostCents: 1_000,
    expectedDaysToSale: 7,
    modeledDownsideCents: 400,
    expectedNetProfitCents: 1_200,
    expectedRoiBps: 12_000,
    ...overrides,
  };
}

const failed = (a: { failures: readonly { code: ConstraintCode }[] }): ConstraintCode[] =>
  a.failures.map((f) => f.code);

describe('a good bootstrap opportunity passes every gate', () => {
  it('passes on a $75 fund', () => {
    const fund = Fund.withBankroll(7_500);
    const assessment = assessPurchase(fund.state, candidate());
    expect(failed(assessment)).toEqual([]);
    expect(assessment.passed).toBe(true);
  });
});

describe('each rejection code fires', () => {
  const fund = () => Fund.withBankroll(7_500);

  it('HOLD_TOO_LONG above 21 days in BOOTSTRAP', () => {
    const a = assessPurchase(fund().state, candidate({ expectedDaysToSale: 22 }));
    expect(failed(a)).toContain('HOLD_TOO_LONG');
  });

  it('LONG_HOLD_ALLOCATION_EXCEEDED for anything over 14 days in BOOTSTRAP', () => {
    // 15 days is inside the 21-day ceiling but is a "long hold", and BOOTSTRAP
    // allows exactly zero long-hold capital.
    const a = assessPurchase(fund().state, candidate({ expectedDaysToSale: 15 }));
    expect(failed(a)).toContain('LONG_HOLD_ALLOCATION_EXCEEDED');
    expect(failed(a)).not.toContain('HOLD_TOO_LONG');
  });

  it('MAX_PER_ITEM_EXCEEDED above 40% of NAV', () => {
    const a = assessPurchase(fund().state, candidate({ landedCostCents: 3_001 }));
    expect(failed(a)).toContain('MAX_PER_ITEM_EXCEEDED');
  });

  it('INSUFFICIENT_DEPLOYABLE_CAPITAL when the cash is already committed', () => {
    const f = fund()
      .do(purchase({ itemId: 'a', purchasePriceCents: 2_500, category: 'LEGO' }))
      .do(purchase({ itemId: 'b', purchasePriceCents: 2_500, category: 'FUNKO' }));
    const a = assessPurchase(f.state, candidate({ landedCostCents: 2_000, category: 'GAMING' }));
    expect(failed(a)).toContain('INSUFFICIENT_DEPLOYABLE_CAPITAL');
  });

  it('RESERVE_FLOOR_BREACH when the purchase would eat the liquid floor', () => {
    const f = fund().do(purchase({ itemId: 'a', purchasePriceCents: 2_900, category: 'LEGO' }));
    const a = assessPurchase(f.state, candidate({ landedCostCents: 2_900, category: 'FUNKO' }));
    // $75 NAV, floor $7.50; $29 + $29 leaves $17 — fine. Push it harder:
    const f2 = f.do(purchase({ itemId: 'b', purchasePriceCents: 2_900, category: 'FUNKO' }));
    const a2 = assessPurchase(f2.state, candidate({ landedCostCents: 1_500, category: 'GAMING' }));
    expect(a.failures.length + a2.failures.length).toBeGreaterThan(0);
    expect(failed(a2)).toContain('RESERVE_FLOOR_BREACH');
  });

  it('MAX_DEPLOYED_EXCEEDED above 85% of NAV', () => {
    const f = fund()
      .do(purchase({ itemId: 'a', purchasePriceCents: 3_000, category: 'LEGO' }))
      .do(purchase({ itemId: 'b', purchasePriceCents: 3_000, category: 'FUNKO' }));
    const a = assessPurchase(f.state, candidate({ landedCostCents: 500, category: 'GAMING' }));
    expect(failed(a)).toContain('MAX_DEPLOYED_EXCEEDED');
  });

  it('CATEGORY_CONCENTRATION above 60% of NAV in one category', () => {
    const f = fund()
      .do(purchase({ itemId: 'a', purchasePriceCents: 2_500, category: 'DISNEY_PINS' }))
      .do(purchase({ itemId: 'b', purchasePriceCents: 2_000, category: 'DISNEY_PINS' }));
    const a = assessPurchase(f.state, candidate({ landedCostCents: 500, category: 'DISNEY_PINS' }));
    expect(failed(a)).toContain('CATEGORY_CONCENTRATION');
  });

  it('DOWNSIDE_TOO_LARGE above 15% of NAV', () => {
    const a = assessPurchase(fund().state, candidate({ modeledDownsideCents: 1_200 }));
    expect(failed(a)).toContain('DOWNSIDE_TOO_LARGE');
  });

  it('PROFIT_BELOW_MIN under $8', () => {
    const a = assessPurchase(fund().state, candidate({ expectedNetProfitCents: 799 }));
    expect(failed(a)).toContain('PROFIT_BELOW_MIN');
  });

  it('ROI_BELOW_MIN under 35%', () => {
    const a = assessPurchase(fund().state, candidate({ expectedRoiBps: 3_499 }));
    expect(failed(a)).toContain('ROI_BELOW_MIN');
  });

  it('CONFIDENCE_TOO_LOW under 45%', () => {
    const a = assessPurchase(fund().state, candidate({ confidenceBps: 4_499 }));
    expect(failed(a)).toContain('CONFIDENCE_TOO_LOW');
  });

  it('SELL_THROUGH_TOO_LOW under 65%', () => {
    const a = assessPurchase(fund().state, candidate({ sellThroughBps: 6_499 }));
    expect(failed(a)).toContain('SELL_THROUGH_TOO_LOW');
  });

  it('abstains on sell-through when there are no comps to compute it from', () => {
    // An operator estimate has no ratio. The gate must not fail an unknown.
    const a = assessPurchase(fund().state, candidate());
    expect(a.results.map((r) => r.code)).not.toContain('SELL_THROUGH_TOO_LOW');
  });

  it('BUY_SCORE_TOO_LOW under 65', () => {
    const a = assessPurchase(fund().state, candidate({ buyScore: 64 }));
    expect(failed(a)).toContain('BUY_SCORE_TOO_LOW');
  });

  it('RISK_SCORE_TOO_HIGH above 55', () => {
    const a = assessPurchase(fund().state, candidate({ riskScore: 56 }));
    expect(failed(a)).toContain('RISK_SCORE_TOO_HIGH');
  });

  it('covers every declared code', () => {
    // A code that no test can trigger is a code that will never be trusted.
    const triggered = new Set<ConstraintCode>();
    const f = fund();
    for (const c of [
      candidate({ expectedDaysToSale: 22 }),
      candidate({ expectedDaysToSale: 15 }),
      candidate({ landedCostCents: 9_000 }),
      candidate({ modeledDownsideCents: 9_000 }),
      candidate({ expectedNetProfitCents: 0 }),
      candidate({ expectedRoiBps: 0 }),
      candidate({ confidenceBps: 0, buyScore: 0, riskScore: 100, sellThroughBps: 0 }),
    ]) {
      for (const code of failed(assessPurchase(f.state, c))) triggered.add(code);
    }
    const f2 = f
      .do(purchase({ itemId: 'a', purchasePriceCents: 3_000, category: 'DISNEY_PINS' }))
      .do(purchase({ itemId: 'b', purchasePriceCents: 3_000, category: 'DISNEY_PINS' }));
    for (const code of failed(
      assessPurchase(f2.state, candidate({ landedCostCents: 1_400, category: 'DISNEY_PINS' })),
    )) {
      triggered.add(code);
    }
    expect([...triggered].sort()).toEqual([...CONSTRAINT_CODES].sort());
  });
});

describe('the hold time comes from comps, and the gates read it', () => {
  it('rejects an item whose comps imply a slow sale', () => {
    // 6 sold against 20 listed is a 315-day queue. Nothing else needs to know
    // that is bad; the derived hold says so.
    const v = estimateFromComps(6, 20);
    const a = assessPurchase(
      Fund.withBankroll(7_500).state,
      candidate({
        expectedDaysToSale: v.expectedDaysToSale,
        sellThroughBps: v.sellThroughBps,
        confidenceBps: v.confidenceBps,
      }),
    );
    expect(failed(a)).toContain('HOLD_TOO_LONG');
    expect(failed(a)).toContain('SELL_THROUGH_TOO_LOW');
  });

  it('accepts one whose comps imply a fast sale', () => {
    const v = estimateFromComps(60, 4);
    expect(v.expectedDaysToSale).toBeLessThanOrEqual(10);
    const a = assessPurchase(
      Fund.withBankroll(7_500).state,
      candidate({
        expectedDaysToSale: v.expectedDaysToSale,
        sellThroughBps: v.sellThroughBps,
        confidenceBps: v.confidenceBps,
      }),
    );
    expect(failed(a)).toEqual([]);
  });

  it('a hand-typed hold cannot clear the gate on its own', () => {
    // Claiming a 3-day sale with no evidence fails on confidence, which is the
    // whole point of capping an operator estimate below every mode floor.
    const v = estimateFromOperator(3);
    const a = assessPurchase(
      Fund.withBankroll(7_500).state,
      candidate({ expectedDaysToSale: v.expectedDaysToSale, confidenceBps: v.confidenceBps }),
    );
    expect(failed(a)).toContain('CONFIDENCE_TOO_LOW');
  });
});

describe('capital safety cannot be bought off', () => {
  it('a $1,000 expected profit does not rescue an unaffordable item', () => {
    const fund = Fund.withBankroll(7_500);
    const a = assessPurchase(
      fund.state,
      candidate({
        landedCostCents: 6_000,
        expectedNetProfitCents: 100_000,
        expectedRoiBps: 100_000,
        buyScore: 100,
        riskScore: 0,
        confidenceBps: 10_000,
      }),
    );
    expect(a.passed).toBe(false);
    expect(failed(a)).toContain('MAX_PER_ITEM_EXCEEDED');
  });

  it('profit is not an input to any capital gate', () => {
    const fund = Fund.withBankroll(7_500);
    const low = assessPurchase(fund.state, candidate({ landedCostCents: 5_000, expectedNetProfitCents: 900 }));
    const high = assessPurchase(fund.state, candidate({ landedCostCents: 5_000, expectedNetProfitCents: 900_00 }));
    const capitalCodes = (a: typeof low) =>
      failed(a).filter((c) => c !== 'PROFIT_BELOW_MIN' && c !== 'ROI_BELOW_MIN');
    expect(capitalCodes(low)).toEqual(capitalCodes(high));
  });

  it('reports every failure at once rather than stopping at the first', () => {
    const fund = Fund.withBankroll(7_500);
    const a = assessPurchase(
      fund.state,
      candidate({
        landedCostCents: 7_000,
        expectedDaysToSale: 45,
        modeledDownsideCents: 5_000,
        expectedNetProfitCents: 100,
        expectedRoiBps: 100,
      }),
    );
    expect(a.failures.length).toBeGreaterThanOrEqual(5);
  });
});

describe('maxAffordableLandedCost', () => {
  it('is the per-item cap on a fresh $75 fund', () => {
    expect(maxAffordableLandedCost(Fund.withBankroll(7_500).state, 'DISNEY_PINS')).toBe(3_000);
  });

  it('is still the per-item cap while that is the binding constraint', () => {
    // $30 committed out of $75: deployable is $33.75, so the $30 per-item cap
    // is what binds, not the cash.
    const fund = Fund.withBankroll(7_500).do(
      purchase({ itemId: 'a', purchasePriceCents: 3_000, category: 'LEGO' }),
    );
    expect(maxAffordableLandedCost(fund.state, 'FUNKO')).toBe(3_000);
  });

  it('falls below the per-item cap once cash is the binding constraint', () => {
    const fund = Fund.withBankroll(7_500)
      .do(purchase({ itemId: 'a', purchasePriceCents: 3_000, category: 'LEGO' }))
      .do(purchase({ itemId: 'b', purchasePriceCents: 2_500, category: 'GAMING' }));

    const max = maxAffordableLandedCost(fund.state, 'FUNKO');
    expect(max).toBeLessThan(3_000);

    // The number it reports is exactly the boundary: one cent more fails.
    const a = assessPurchase(fund.state, candidate({ landedCostCents: max, category: 'FUNKO' }));
    expect(failed(a)).toEqual([]);

    const b = assessPurchase(fund.state, candidate({ landedCostCents: max + 1, category: 'FUNKO' }));
    expect(b.failures.length).toBeGreaterThan(0);
  });

  it('respects category headroom', () => {
    const fund = Fund.withBankroll(7_500).do(
      purchase({ itemId: 'a', purchasePriceCents: 2_500, category: 'DISNEY_PINS' }),
    );
    expect(maxAffordableLandedCost(fund.state, 'DISNEY_PINS')).toBe(
      4_500 - 2_500, // 60% of $75 = $45 cap, $25 already used
    );
  });
});

describe('growth mode relaxes the right things and not others', () => {
  it('permits a 30-day hold at $600 that would be rejected at $75', () => {
    const small = Fund.withBankroll(7_500);
    const large = Fund.withBankroll(60_000);
    const c = candidate({
      expectedDaysToSale: 30,
      landedCostCents: 5_000,
      expectedNetProfitCents: 2_000,
      expectedRoiBps: 4_000,
      modeledDownsideCents: 500,
    });
    expect(failed(assessPurchase(small.state, c))).toContain('HOLD_TOO_LONG');
    expect(failed(assessPurchase(large.state, c))).toEqual([]);
  });

  it('still caps long-hold capital at 30% of NAV in GROWTH', () => {
    const fund = Fund.withBankroll(60_000).do(
      purchase({ itemId: 'a', purchasePriceCents: 17_000, expectedDaysToSale: 40, category: 'LEGO' }),
    );
    const a = assessPurchase(
      fund.state,
      candidate({
        expectedDaysToSale: 40,
        landedCostCents: 3_000,
        expectedNetProfitCents: 2_000,
        expectedRoiBps: 4_000,
        modeledDownsideCents: 300,
        category: 'FUNKO',
      }),
    );
    expect(failed(a)).toContain('LONG_HOLD_ALLOCATION_EXCEEDED');
  });
});
