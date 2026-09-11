import { describe, expect, it } from 'vitest';
import {
  MAX_MODELLED_DAYS,
  OPERATOR_ESTIMATE_CONFIDENCE_BPS,
  VelocityError,
  estimateFromComps,
  estimateFromOperator,
  soldNeededForHold,
  velocityConfidenceBps,
} from '@/core/velocity.js';
import { DEFAULT_POLICY } from '@/core/capital/policy.js';

describe('the queue model', () => {
  it('turns comp counts into a hold time', () => {
    // 45 sold in 90 days against 5 listed: you are 6th in a queue clearing
    // half an item a day. 90 * 6 / 45 = 12 days.
    const v = estimateFromComps(45, 5);
    expect(v.expectedDaysToSale).toBe(12);
    expect(v.sellThroughBps).toBe(9_000); // 45/50
  });

  it('counts YOUR listing in the queue, not just the competition', () => {
    // With nothing else listed you are still one listing deep, not zero.
    const v = estimateFromComps(45, 0);
    expect(v.expectedDaysToSale).toBe(2); // 90 * 1 / 45
  });

  it('gets slower as competition grows, on identical demand', () => {
    const light = estimateFromComps(45, 2);
    const heavy = estimateFromComps(45, 40);
    expect(heavy.expectedDaysToSale).toBeGreaterThan(light.expectedDaysToSale);
  });

  it('gets faster as demand grows, against identical competition', () => {
    const weak = estimateFromComps(10, 5);
    const strong = estimateFromComps(90, 5);
    expect(strong.expectedDaysToSale).toBeLessThan(weak.expectedDaysToSale);
  });

  it('says "no" rather than dividing by zero when nothing has sold', () => {
    const v = estimateFromComps(0, 12);
    expect(v.expectedDaysToSale).toBe(MAX_MODELLED_DAYS);
    expect(v.sellThroughBps).toBe(0);
    expect(v.confidenceBps).toBe(0);
  });

  it('rejects nonsense counts instead of modelling them', () => {
    expect(() => estimateFromComps(-1, 5)).toThrow(VelocityError);
    expect(() => estimateFromComps(5, 1.5)).toThrow(VelocityError);
  });
});

describe('the p90 hold is not the mean plus a nudge', () => {
  it('is about 2.3x the mean, because waiting times are exponential', () => {
    const v = estimateFromComps(45, 5);
    expect(v.expectedDaysP90).toBe(Math.ceil(12 * 2.303));
    expect(v.expectedDaysP90).toBeGreaterThan(v.expectedDaysToSale * 2);
  });

  it('is never below the mean', () => {
    for (const sold of [1, 5, 20, 90, 400]) {
      const v = estimateFromComps(sold, 3);
      expect(v.expectedDaysP90).toBeGreaterThanOrEqual(v.expectedDaysToSale);
    }
  });
});

describe('confidence comes from how many sales are behind the rate', () => {
  it('is zero with no sales and saturates at 20', () => {
    expect(velocityConfidenceBps(0)).toBe(0);
    expect(velocityConfidenceBps(10)).toBe(5_000);
    expect(velocityConfidenceBps(20)).toBe(10_000);
    expect(velocityConfidenceBps(500)).toBe(10_000);
  });

  it('two sales cannot clear the bootstrap confidence floor', () => {
    // Two sales in 90 days can imply almost any hold time you like.
    const v = estimateFromComps(2, 0);
    expect(v.confidenceBps).toBeLessThan(DEFAULT_POLICY.modes.BOOTSTRAP.minConfidenceBps);
  });

  it('twenty sales can', () => {
    const v = estimateFromComps(20, 2);
    expect(v.confidenceBps).toBeGreaterThanOrEqual(
      DEFAULT_POLICY.modes.BOOTSTRAP.minConfidenceBps,
    );
  });
});

describe('a hand-typed hold is capped so it cannot be spent like data', () => {
  it('carries a low confidence no optimism can raise', () => {
    const v = estimateFromOperator(3);
    expect(v.source).toBe('OPERATOR_ESTIMATE');
    expect(v.confidenceBps).toBe(OPERATOR_ESTIMATE_CONFIDENCE_BPS);
  });

  it('sits below every mode floor, so a guess alone never clears the gate', () => {
    // This is the property that matters: typing "--days=3" must not be a way
    // around the evidence requirement.
    for (const mode of ['BOOTSTRAP', 'GROWTH'] as const) {
      expect(OPERATOR_ESTIMATE_CONFIDENCE_BPS).toBeLessThan(
        DEFAULT_POLICY.modes[mode].minConfidenceBps,
      );
    }
  });

  it('reports no sell-through, so the ratio gate abstains rather than fails', () => {
    expect(estimateFromOperator(5).sellThroughBps).toBe(0);
    expect(estimateFromOperator(5).source).toBe('OPERATOR_ESTIMATE');
  });
});

describe('soldNeededForHold is the number to look for in the field', () => {
  it('names the sold count that clears a target hold', () => {
    // Against 5 active listings, a 10-day turn needs 54 sold in 90 days.
    expect(soldNeededForHold(10, 5)).toBe(54);
  });

  it('round-trips against the queue model', () => {
    for (const [target, active] of [
      [10, 5],
      [21, 0],
      [14, 20],
      [7, 3],
    ] as const) {
      const sold = soldNeededForHold(target, active);
      expect(estimateFromComps(sold, active).expectedDaysToSale).toBeLessThanOrEqual(target);
    }
  });

  it('asks for more as competition grows', () => {
    expect(soldNeededForHold(10, 20)).toBeGreaterThan(soldNeededForHold(10, 2));
  });
});

describe('a count can be a floor, and only one direction is dangerous', () => {
  it('defaults to exact, so every existing caller is unchanged', () => {
    const v = estimateFromComps(45, 5);
    expect(v.activeIsFloor).toBe(false);
    expect(v.soldIsFloor).toBe(false);
    expect(v.boundsAreOptimistic).toBe(false);
  });

  it('an ACTIVE floor makes the estimate optimistic', () => {
    // "240,000+" active: the hold is the FASTEST this could sell, not the
    // expected one, and the sell-through is the highest it could be.
    const v = estimateFromComps(45, 5, { activeIsFloor: true });
    expect(v.activeIsFloor).toBe(true);
    expect(v.boundsAreOptimistic).toBe(true);
  });

  it('a SOLD floor does NOT — undercounting sales refuses a good item', () => {
    // ⚠️ The asymmetry is the whole point, so it is asserted in both
    // directions rather than once. Undercounting SOLD lengthens the hold and
    // lowers the ratio; both refuse. Nothing needs to intervene.
    const v = estimateFromComps(45, 5, { soldIsFloor: true });
    expect(v.soldIsFloor).toBe(true);
    expect(v.boundsAreOptimistic).toBe(false);
  });

  it('both floors at once is still driven by the active one', () => {
    const v = estimateFromComps(45, 5, { activeIsFloor: true, soldIsFloor: true });
    expect(v.boundsAreOptimistic).toBe(true);
  });

  it('carries the flags through the nothing-has-sold branch', () => {
    // That branch returns early, which is exactly where a flag gets dropped.
    const v = estimateFromComps(0, 5, { activeIsFloor: true });
    expect(v.expectedDaysToSale).toBe(MAX_MODELLED_DAYS);
    expect(v.boundsAreOptimistic).toBe(true);
  });

  it('an operator estimate has no counts to be a floor of', () => {
    const v = estimateFromOperator(14);
    expect(v.activeIsFloor).toBe(false);
    expect(v.boundsAreOptimistic).toBe(false);
  });

  it('B77 measured: 500 active read as 200 turns a 150d hold into 60d', () => {
    // The case that made this worth building. A GROWTH ceiling is 60 days.
    //
    // ⚠️ B77 recorded this as 300 sold giving 150d and 60d. That arithmetic
    // dropped the `+ 1` — your own listing — and the ceiling, so the real
    // figures at 300 sold are 151d and 61d, and 61 is OUTSIDE the ceiling,
    // which would have made the example refuse itself. At 302 sold the
    // illustration is honest: the capped reading passes and the true one does
    // not. **The finding was right and its worked example was not.**
    const truth = estimateFromComps(302, 500);
    const capped = estimateFromComps(302, 200, { activeIsFloor: true });
    expect(truth.expectedDaysToSale).toBe(150);
    expect(capped.expectedDaysToSale).toBe(60);
    // The capped reading is INSIDE the ceiling and wrong, and the only thing
    // that can say so is the flag — the number itself looks fine.
    expect(capped.boundsAreOptimistic).toBe(true);
  });
});
