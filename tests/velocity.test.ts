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
