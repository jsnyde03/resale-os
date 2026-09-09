/**
 * `quotePurchase` — the arithmetic between "here is what they want for it" and
 * "here is what the capital rules say".
 *
 * ⛔ It was extracted from `cli buy`, where it was inline, because the phone's
 * buy screen has to reach the same verdict from the same numbers. The CLI's
 * own tests exercise it end to end but only assert WHICH gate refused, so they
 * would sit green through a wrong fee, a wrong downside or a wrong multiple.
 * These assert the figures.
 *
 * Every expectation below is derived by hand from the published fee model —
 * eBay at 13.25% + $0.40, $5.00 postage, $0.35 packaging — rather than copied
 * from what the code printed. A number taken from output only asserts that the
 * code still does what it does.
 */

import { describe, expect, it } from 'vitest';
import { quotePurchase, assessQuote, landedCostOf } from '@/core/capital/quote.js';
import { Fund } from './helpers.js';

describe('landed cost is every cent it took to own the thing', () => {
  it('sums price, inbound shipping, sales tax and travel', () => {
    expect(
      landedCostOf({
        category: 'TOYS',
        purchasePriceCents: 1_200,
        inboundShippingCents: 300,
        salesTaxCents: 72,
        acquisitionTravelCents: 150,
      }),
    ).toBe(1_722);
  });

  it('treats the missing pieces as zero, not as unknown', () => {
    expect(landedCostOf({ category: 'TOYS', purchasePriceCents: 1_200 })).toBe(1_200);
  });
});

describe('the quote', () => {
  const base = { category: 'TOYS', purchasePriceCents: 1_000 } as const;

  it('assumes a 3x flip when no expected gross is given, and says it assumed', () => {
    const q = quotePurchase(base);
    expect(q.expectedGrossCents).toBe(3_000);
    expect(q.grossWasAssumed).toBe(true);
  });

  it('takes the expected gross when given, and says it did not assume', () => {
    const q = quotePurchase({ ...base, expectedGrossCents: 5_000 });
    expect(q.expectedGrossCents).toBe(5_000);
    expect(q.grossWasAssumed).toBe(false);
  });

  it('nets a $30.00 sale the way eBay actually charges', () => {
    const q = quotePurchase(base);
    // 13.25% of $30.00 = $3.975 -> 398c, plus 40c per order.
    expect(q.estimate.marketplaceFeeCents).toBe(438);
    expect(q.estimate.postageCents).toBe(500);
    expect(q.estimate.packagingCents).toBe(35);
    // 3000 - 438 - 500 - 35
    expect(q.estimate.netCents).toBe(2_027);
    // net - landed
    expect(q.expectedProfitCents).toBe(1_027);
    // 1027 / 1000
    expect(q.expectedRoiBps).toBe(10_270);
  });

  it('lets the operator override the postage when they know the parcel', () => {
    const q = quotePurchase({ ...base, estPostageCents: 100 });
    expect(q.estimate.postageCents).toBe(100);
    expect(q.estimate.netCents).toBe(2_427);
  });

  it('prices a local cash sale with no platform and no postage', () => {
    const q = quotePurchase({ ...base, marketplace: 'LOCAL' });
    expect(q.estimate.marketplaceFeeCents).toBe(0);
    expect(q.estimate.postageCents).toBe(0);
    expect(q.estimate.netCents).toBe(3_000);
    expect(q.expectedProfitCents).toBe(2_000);
  });

  // ⚠️ The downside is what a liquidation would leave, not a prediction. A
  // fire sale at 40% of gross still pays the same fees and the same postage,
  // which is exactly why a cheap item's downside is close to its whole cost.
  it('models the downside as a fire sale that still pays the fees', () => {
    const q = quotePurchase(base);
    // 40% of $30.00 = $12.00. Fee 13.25% = 159c + 40c. Net 1200-199-500-35=466.
    // Landed 1000 - 466 = 534.
    expect(q.modeledDownsideCents).toBe(534);
  });

  it('never reports a negative downside, because you cannot lose less than nothing', () => {
    const q = quotePurchase({ ...base, marketplace: 'LOCAL', expectedGrossCents: 100_000 });
    expect(q.modeledDownsideCents).toBe(0);
  });
});

describe('velocity, and what it is honest about', () => {
  it('derives days and a sell-through ratio from comps', () => {
    const q = quotePurchase({
      category: 'TOYS',
      purchasePriceCents: 1_000,
      soldLast90Days: 50,
      activeListings: 50,
    });
    expect(q.velocity.source).toBe('COMPS');
    expect(q.velocity.sellThroughBps).toBe(5_000);
    expect(q.candidate.sellThroughBps).toBe(5_000);
  });

  // ⛔ The gate reads `sellThroughBps` and a zero would fail it. An operator
  // guess has no ratio to report, so the field is ABSENT and the gate abstains
  // rather than refusing an unknown.
  it('omits sell-through entirely for an operator estimate', () => {
    const q = quotePurchase({
      category: 'TOYS',
      purchasePriceCents: 1_000,
      operatorDaysEstimate: 10,
    });
    expect(q.velocity.source).toBe('OPERATOR_ESTIMATE');
    expect(q.candidate.sellThroughBps).toBeUndefined();
    expect('sellThroughBps' in q.candidate).toBe(false);
    expect(q.candidate.expectedDaysToSale).toBe(10);
  });

  it('defaults to a 7-day guess when told nothing at all', () => {
    expect(quotePurchase({ category: 'TOYS', purchasePriceCents: 1_000 }).velocity
      .expectedDaysToSale).toBe(7);
  });
});

describe('the quote meets the capital rules', () => {
  // ⚠️ $500 of NAV puts the fund in GROWTH, whose floor is a $15 profit — so a
  // $10 item at a 3x flip nets $10.27 and is REFUSED. The gates are relative to
  // the bankroll, and a candidate is never good or bad on its own.
  it('passes a purchase the bankroll can afford', () => {
    const fund = Fund.withBankroll(50_000);
    const { quote, assessment } = assessQuote(fund.state, {
      category: 'TOYS',
      purchasePriceCents: 1_000,
      expectedGrossCents: 4_000,
      soldLast90Days: 90,
      activeListings: 10,
    });
    // 4000 - (530 + 40) - 500 - 35 = 2895 net, less 1000 landed.
    expect(quote.expectedProfitCents).toBe(1_895);
    expect(assessment.failures.map((f) => f.code)).toEqual([]);
    expect(assessment.passed).toBe(true);
  });

  // The gate that D4's override exists for, reached through the shared path.
  it('refuses one the bankroll cannot, and names the gate', () => {
    const fund = Fund.withBankroll(5_000);
    const { assessment } = assessQuote(fund.state, {
      category: 'TOYS',
      purchasePriceCents: 4_000,
      soldLast90Days: 60,
      activeListings: 20,
    });
    expect(assessment.passed).toBe(false);
    expect(assessment.failures.map((f) => f.code)).toContain('MAX_PER_ITEM_EXCEEDED');
  });
});
