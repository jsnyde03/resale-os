import { describe, expect, it } from 'vitest';
import { Fund, purchase } from './helpers.js';
import { parseOpportunity, deriveEconomics } from '@/domain/opportunity.js';
import { evaluateOpportunity } from '@/scoring/evaluate.js';
import { scoreBuy, speedSubScore, profitSubScore } from '@/scoring/buy-score.js';
import { scoreRisk, RISK_WEIGHTS } from '@/scoring/risk-score.js';
import { scoreConfidence, compConfidence } from '@/scoring/confidence.js';
import { maxRecommendedPrice } from '@/scoring/max-price.js';
import { EBAY_FEES } from '@/core/fees.js';
import { DEFAULT_POLICY } from '@/core/capital/policy.js';

const BOOTSTRAP = DEFAULT_POLICY.modes.BOOTSTRAP;

/** A good, fast, well-evidenced flip at the live $50 bankroll. */
function goodOpportunity(overrides: Record<string, unknown> = {}) {
  return parseOpportunity({
    opportunityId: 'o1',
    name: 'retro cartridge',
    category: 'GAMES',
    askingPriceCents: 1_500,
    expectedGrossCents: 3_900,
    soldLast90Days: 60,
    activeListings: 4,
    compPricesCents: [3_800, 3_900, 4_000, 3_850, 3_950, 3_900],
    compMedianAgeDays: 20,
    ...overrides,
  });
}

describe('the requirement the caps exist for', () => {
  it('a 30-day hold cannot score 91 in BOOTSTRAP, however good the economics', () => {
    // Everything else maxed out: huge profit, huge ROI, perfect comps, no hassle.
    const breakdown = scoreBuy(
      {
        sellThroughBps: 10_000,
        soldLast90Days: 1_000,
        expectedDaysToSale: 30,
        expectedNetProfitCents: 1_000_000,
        expectedRoiBps: 10_000_000,
        compConfidenceBps: 10_000,
        confidenceBps: 10_000,
        hassleBps: 0,
      },
      BOOTSTRAP,
    );
    expect(breakdown.score).toBeLessThan(91);
  });

  it('and the cap is what stops a slow item PASSING, which the weights do not', () => {
    // Measured, and it corrected a claim in the spec. With speed at zero the
    // weighted maximum is 80 — already under 91, so the weights alone satisfy
    // the literal requirement. But 80 clears the 65 minimum, so weights alone
    // would RECOMMEND a 30-day hold in Bootstrap. The cap is what prevents that.
    const breakdown = scoreBuy(
      {
        sellThroughBps: 10_000,
        soldLast90Days: 1_000,
        expectedDaysToSale: 30,
        expectedNetProfitCents: 1_000_000,
        expectedRoiBps: 10_000_000,
        compConfidenceBps: 10_000,
        confidenceBps: 10_000,
        hassleBps: 0,
      },
      BOOTSTRAP,
    );
    expect(breakdown.rawScore).toBe(80);
    expect(breakdown.rawScore).toBeGreaterThan(BOOTSTRAP.minBuyScore); // would pass
    expect(breakdown.score).toBe(30);
    expect(breakdown.score).toBeLessThan(BOOTSTRAP.minBuyScore); // does not
    expect(breakdown.boundBy).toBe('VELOCITY');
  });

  it('is impossible at every hold from 22 to 60 days', () => {
    for (let days = 22; days <= 60; days += 1) {
      const b = scoreBuy(
        {
          sellThroughBps: 10_000,
          soldLast90Days: 1_000,
          expectedDaysToSale: days,
          expectedNetProfitCents: 1_000_000,
          expectedRoiBps: 10_000_000,
          compConfidenceBps: 10_000,
          confidenceBps: 10_000,
          hassleBps: 0,
        },
        BOOTSTRAP,
      );
      expect(b.score).toBeLessThan(91);
    }
  });

  it('a 90+ score requires high confidence, not just speed', () => {
    const fastButUnsure = scoreBuy(
      {
        sellThroughBps: 10_000,
        soldLast90Days: 1_000,
        expectedDaysToSale: 2,
        expectedNetProfitCents: 1_000_000,
        expectedRoiBps: 10_000_000,
        compConfidenceBps: 10_000,
        confidenceBps: 5_000, // half-confident
        hassleBps: 0,
      },
      BOOTSTRAP,
    );
    expect(fastButUnsure.score).toBeLessThan(90);
    expect(fastButUnsure.boundBy).toBe('CONFIDENCE');
  });

  it('and 90+ is reachable when it is genuinely fast and well-evidenced', () => {
    const b = scoreBuy(
      {
        sellThroughBps: 9_500,
        soldLast90Days: 200,
        expectedDaysToSale: 3,
        expectedNetProfitCents: 10_000,
        expectedRoiBps: 20_000,
        compConfidenceBps: 9_500,
        confidenceBps: 9_500,
        hassleBps: 500,
      },
      BOOTSTRAP,
    );
    expect(b.score).toBeGreaterThanOrEqual(90);
  });
});

describe('sub-scores behave', () => {
  it('speed is flat to the ideal, 0.35 at the hard mark, 0 past the ceiling', () => {
    expect(speedSubScore(1, BOOTSTRAP)).toBe(1);
    expect(speedSubScore(10, BOOTSTRAP)).toBe(1);
    expect(speedSubScore(14, BOOTSTRAP)).toBeCloseTo(0.35, 5);
    expect(speedSubScore(21, BOOTSTRAP)).toBeCloseTo(0, 5);
    expect(speedSubScore(400, BOOTSTRAP)).toBe(0);
  });

  it('speed never increases with a longer hold', () => {
    let previous = 2;
    for (let d = 1; d <= 80; d += 1) {
      const s = speedSubScore(d, BOOTSTRAP);
      expect(s).toBeLessThanOrEqual(previous);
      previous = s;
    }
  });

  it('profit saturates at three times the target rather than cliffing', () => {
    expect(profitSubScore(0, BOOTSTRAP)).toBe(0);
    expect(profitSubScore(BOOTSTRAP.profitTargetCents * 3, BOOTSTRAP)).toBeCloseTo(1, 5);
    expect(profitSubScore(BOOTSTRAP.profitTargetCents * 30, BOOTSTRAP)).toBe(1);
    // Monotonic in between.
    expect(profitSubScore(1_000, BOOTSTRAP)).toBeLessThan(profitSubScore(2_000, BOOTSTRAP));
  });
});

describe('confidence is data quality, not optimism', () => {
  it('rewards more comps, tighter agreement and more recent sales', () => {
    const thin = compConfidence({ pricesCents: [3_000], medianAgeDays: 80 });
    const rich = compConfidence({
      pricesCents: [3_000, 3_050, 2_980, 3_010, 3_030, 2_990, 3_020, 3_005],
      medianAgeDays: 10,
    });
    expect(rich.confidenceBps).toBeGreaterThan(thin.confidenceBps);
  });

  it('punishes scattered comps even when there are many', () => {
    const tight = compConfidence({
      pricesCents: [3_000, 3_050, 2_980, 3_010, 3_030, 2_990, 3_020, 3_005],
      medianAgeDays: 10,
    });
    const scattered = compConfidence({
      pricesCents: [1_000, 6_000, 2_000, 5_500, 1_500, 5_000, 2_500, 4_800],
      medianAgeDays: 10,
    });
    expect(scattered.confidenceBps).toBeLessThan(tight.confidenceBps);
  });

  it('falls back to a pessimistic default with no comps at all', () => {
    const none = compConfidence(null);
    expect(none.confidenceBps).toBe(3_000);
  });

  it('blends the four signals by weight', () => {
    const c = scoreConfidence({
      comps: { pricesCents: [100, 100, 100, 100, 100, 100, 100, 100], medianAgeDays: 0 },
      demandConfidenceBps: 10_000,
      conditionConfidenceBps: 10_000,
      sourceConfidenceBps: 10_000,
    });
    expect(c.confidenceBps).toBe(10_000);
  });
});

describe('risk is a separate concept from buy score', () => {
  it('weights sum to exactly 100', () => {
    expect(Object.values(RISK_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('rises with the share of the fund at stake', () => {
    const base = {
      navCents: 5_000,
      modeledDownsideCents: 200,
      compConfidenceBps: 8_000,
      compCoefficientOfVariation: 0.05,
      expectedDaysToSale: 8,
      expectedDaysP90: 18,
      categoryExposureAfterCents: 500,
      maxCategoryExposureCents: 3_000,
    };
    const small = scoreRisk({ ...base, landedCostCents: 500 });
    const large = scoreRisk({ ...base, landedCostCents: 2_400 });
    expect(large.score).toBeGreaterThan(small.score);
  });

  it('can be high on an item with excellent economics', () => {
    // The whole reason the two scores are kept apart.
    const risky = scoreRisk({
      landedCostCents: 2_400,
      navCents: 5_000,
      modeledDownsideCents: 1_200,
      compConfidenceBps: 1_000,
      compCoefficientOfVariation: 0.6,
      expectedDaysToSale: 8,
      expectedDaysP90: 40,
      categoryExposureAfterCents: 3_000,
      maxCategoryExposureCents: 3_000,
      counterfeitBps: 9_000,
    });
    expect(risky.score).toBeGreaterThan(60);
    expect(risky.topDrivers.length).toBe(3);
  });

  it('names its top drivers, so the reason is explainable', () => {
    const r = scoreRisk({
      landedCostCents: 2_400,
      navCents: 5_000,
      modeledDownsideCents: 1_200,
      compConfidenceBps: 9_000,
      compCoefficientOfVariation: 0.02,
      expectedDaysToSale: 8,
      expectedDaysP90: 10,
      categoryExposureAfterCents: 100,
      maxCategoryExposureCents: 3_000,
    });
    expect(r.topDrivers).toContain('capitalConsumed');
  });
});

describe('max recommended price is the inverse of the gates', () => {
  it('names a price at which the item exactly clears the profit floor', () => {
    const p = maxRecommendedPrice(
      {
        expectedGrossCents: 3_900,
        otherLandedCents: 0,
        maxCapitalPerItemCents: 100_000,
        deployableCapitalCents: 100_000,
        categoryHeadroomCents: 100_000,
      },
      BOOTSTRAP,
      EBAY_FEES,
    );
    // net 2808, min profit 800 -> pay at most 2008
    expect(p.netProceedsCents).toBe(2_808);
    expect(p.byProfitCents).toBe(2_008);
  });

  it('round-trips: paying the named price clears every floor it was derived from', () => {
    for (const gross of [2_000, 3_900, 8_000, 25_000]) {
      const p = maxRecommendedPrice(
        {
          expectedGrossCents: gross,
          otherLandedCents: 0,
          maxCapitalPerItemCents: 100_000,
          deployableCapitalCents: 100_000,
          categoryHeadroomCents: 100_000,
        },
        BOOTSTRAP,
        EBAY_FEES,
      );
      if (p.maxPriceCents === 0) continue;
      const profit = p.netProceedsCents - p.maxPriceCents;
      expect(profit).toBeGreaterThanOrEqual(BOOTSTRAP.minExpectedProfitCents);
      const roi = Math.round((profit / p.maxPriceCents) * 10_000);
      expect(roi).toBeGreaterThanOrEqual(BOOTSTRAP.minExpectedRoiBps);
    }
  });

  it('says which limit is binding', () => {
    const capitalBound = maxRecommendedPrice(
      {
        expectedGrossCents: 39_000,
        otherLandedCents: 0,
        maxCapitalPerItemCents: 2_000,
        deployableCapitalCents: 100_000,
        categoryHeadroomCents: 100_000,
      },
      BOOTSTRAP,
      EBAY_FEES,
    );
    expect(capitalBound.boundBy).toBe('PER_ITEM');
    expect(capitalBound.maxPriceCents).toBe(2_000);
  });
});

describe('evaluateOpportunity, end to end', () => {
  it('recommends a good fast flip and names a max price', () => {
    const fund = Fund.withBankroll(5_000);
    const e = evaluateOpportunity(goodOpportunity(), fund.state);

    expect(e.economics.netProceedsCents).toBe(2_808);
    expect(e.economics.expectedProfitCents).toBe(1_308);
    expect(e.economics.velocity.expectedDaysToSale).toBe(8);
    expect(e.result.recommendation).toBe('BUY');
    expect(e.price.maxPriceCents).toBeGreaterThan(0);
    expect(e.result.reasons[0]).toMatch(/Buy at up to/);
    expect(e.policyVersion).toBe(DEFAULT_POLICY.version);
  });

  it('rejects on the capital rule and says which one', () => {
    const fund = Fund.withBankroll(5_000);
    const e = evaluateOpportunity(
      goodOpportunity({ askingPriceCents: 4_000, expectedGrossCents: 12_000 }),
      fund.state,
    );
    expect(e.result.recommendation).toBe('REJECT');
    expect(e.result.reasons.join(' ')).toMatch(/MAX_PER_ITEM_EXCEEDED/);
  });

  it('rejects a slow item on the hold, whatever the margin', () => {
    const fund = Fund.withBankroll(5_000);
    const e = evaluateOpportunity(
      goodOpportunity({ soldLast90Days: 6, activeListings: 20 }),
      fund.state,
    );
    expect(e.result.recommendation).toBe('REJECT');
    expect(e.result.reasons.join(' ')).toMatch(/HOLD_TOO_LONG/);
    expect(e.buy.boundBy).toBe('VELOCITY');
  });

  it('a bare operator estimate cannot reach BUY', () => {
    const fund = Fund.withBankroll(5_000);
    const e = evaluateOpportunity(
      parseOpportunity({
        opportunityId: 'o2',
        name: 'a hunch',
        category: 'GAMES',
        askingPriceCents: 1_500,
        expectedGrossCents: 3_900,
        operatorDaysEstimate: 3,
      }),
      fund.state,
    );
    expect(e.result.recommendation).not.toBe('BUY');
    expect(e.result.reasons.join(' ')).toMatch(/CONFIDENCE_TOO_LOW/);

    // ⛔ **The sell-through gate ABSTAINS rather than failing an unknown.** An
    // operator guess has no ratio to report, and a zero would refuse it for
    // being unpopular rather than for being unevidenced. Asserted here because
    // `quote.candidate` used to carry this assertion and is being deleted as
    // dead — ⚠️ **coverage moves BEFORE the thing it covered goes.**
    expect(e.gates.results.map((r) => r.code)).not.toContain('SELL_THROUGH_TOO_LOW');
    // The control: with comps, the gate is present and evaluated.
    const withComps = evaluateOpportunity(goodOpportunity(), fund.state);
    expect(withComps.gates.results.map((r) => r.code)).toContain('SELL_THROUGH_TOO_LOW');
  });

  it('every reason is a generated string, never empty', () => {
    const fund = Fund.withBankroll(5_000);
    for (const opp of [
      goodOpportunity(),
      goodOpportunity({ askingPriceCents: 4_000 }),
      goodOpportunity({ soldLast90Days: 2, activeListings: 30 }),
    ]) {
      const e = evaluateOpportunity(opp, fund.state);
      expect(e.result.reasons.length).toBeGreaterThan(0);
      for (const r of e.result.reasons) expect(r.trim().length).toBeGreaterThan(0);
    }
  });

  it('is deterministic', () => {
    const fund = Fund.withBankroll(5_000);
    const a = evaluateOpportunity(goodOpportunity(), fund.state);
    const b = evaluateOpportunity(goodOpportunity(), fund.state);
    expect(b.buy).toEqual(a.buy);
    expect(b.risk).toEqual(a.risk);
    expect(b.result).toEqual(a.result);
  });

  it('sees category concentration the fund already has', () => {
    const fund = Fund.withBankroll(5_000).do(
      purchase({ itemId: 'x', purchasePriceCents: 2_000, category: 'GAMES' }),
    );
    const e = evaluateOpportunity(goodOpportunity(), fund.state);
    expect(e.risk.factors.concentration).toBeGreaterThan(0.5);
  });
});

describe('the opportunity schema', () => {
  it('demands that the hold time come from somewhere', () => {
    expect(() =>
      parseOpportunity({
        opportunityId: 'o3',
        name: 'x',
        category: 'GAMES',
        askingPriceCents: 100,
        expectedGrossCents: 500,
      }),
    ).toThrow(/hold time has to come from somewhere/);
  });

  it('rejects negative money', () => {
    expect(() =>
      parseOpportunity({
        opportunityId: 'o4',
        name: 'x',
        category: 'GAMES',
        askingPriceCents: -1,
        expectedGrossCents: 500,
        soldLast90Days: 10,
      }),
    ).toThrow();
  });

  it('derives economics through the fee model, not off the gross', () => {
    const e = deriveEconomics(goodOpportunity());
    expect(e.netProceedsCents).toBeLessThan(3_900);
    expect(e.expectedProfitCents).toBe(e.netProceedsCents - e.landedCostCents);
    expect(e.modeledDownsideCents).toBeGreaterThan(0);
  });
});

describe('B77 — a floored active count travels from the input to the verdict', () => {
  it('⛔ the SAME flip is a BUY exact and a REJECT once active is a floor', () => {
    // ⚠️ The unit test proves the gate. This proves the WIRING — that the flag
    // survives `parseOpportunity` -> `deriveEconomics` -> `estimateFromComps`
    // -> `PurchaseCandidate` -> `assessPurchase`. A gate nothing reaches is a
    // gate that does not exist, which this project has shipped before.
    const fund = Fund.withBankroll(5_000);

    const exact = evaluateOpportunity(goodOpportunity(), fund.state);
    expect(exact.result.recommendation).toBe('BUY');

    const floored = evaluateOpportunity(
      goodOpportunity({ activeListingsIsFloor: true }),
      fund.state,
    );
    expect(floored.economics.velocity.boundsAreOptimistic).toBe(true);
    expect(floored.gates.failures.map((f) => f.code)).toContain('VELOCITY_COUNTS_UNBOUNDED');
    expect(floored.result.recommendation).toBe('REJECT');
    // The operator is told what to do about it, in the verdict itself.
    expect(floored.result.reasons.join(' ')).toContain('narrow the search');
  });

  it('a floored SOLD count changes nothing — that direction refuses on its own', () => {
    const fund = Fund.withBankroll(5_000);
    const e = evaluateOpportunity(goodOpportunity({ soldLast90DaysIsFloor: true }), fund.state);
    expect(e.economics.velocity.soldIsFloor).toBe(true);
    expect(e.economics.velocity.boundsAreOptimistic).toBe(false);
    expect(e.result.recommendation).toBe('BUY');
  });
});
