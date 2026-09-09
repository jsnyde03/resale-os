/**
 * Buy Score, 0–100 — "should this specific listing be purchased?"
 *
 * ⚠️ **The caps are the product, not the weights** — but not for the reason
 * first written down. Measured 2026-09-08: with speed at zero the weighted
 * maximum is **80**, so the weights alone already make "91 on a 30-day hold"
 * impossible. The earlier claim that strong economics could carry a slow item
 * into the 90s was simply wrong.
 *
 * What the caps actually buy is bigger. **80 clears the 65 minimum**, so on
 * weights alone a 30-day hold in Bootstrap would be RECOMMENDED. The velocity
 * cap takes it to 30 — below the floor — and turns a buy into a pass. The
 * binding cap is reported so the operator can see what held the score down.
 *
 * SCORING_SPEC §2. Pure — same inputs, same score, forever.
 */

import { clamp01, lerp, roundHalfAwayFromZero } from '../core/math.js';
import type { Bps, Cents } from '../core/money.js';
import type { ModePolicy } from '../core/capital/policy.js';

export const BUY_SCORE_WEIGHTS = {
  demand: 0.3,
  speed: 0.2,
  profit: 0.2,
  roi: 0.15,
  comp: 0.1,
  ops: 0.05,
} as const;

/** `S_profit` reaches 1.0 at this multiple of the mode's profit target. */
export const PROFIT_SATURATION_MULTIPLE = 3;
/** One sale a day saturates the velocity term. */
export const VELOCITY_SATURATION_PER_30D = 30;

export type BuyScoreCap = 'NONE' | 'VELOCITY' | 'CONFIDENCE';

export interface BuyScoreInputs {
  /** sold / (sold + active), from comps. */
  readonly sellThroughBps: Bps;
  readonly soldLast90Days: number;
  readonly expectedDaysToSale: number;
  readonly expectedNetProfitCents: Cents;
  readonly expectedRoiBps: Bps;
  /** `compConfidence` from `confidence.ts`. */
  readonly compConfidenceBps: Bps;
  /** Overall confidence. Caps the result. */
  readonly confidenceBps: Bps;
  /** 0..10000: weight, fragility, bundle count, authentication, listing effort. */
  readonly hassleBps: Bps;
}

export interface BuyScoreBreakdown {
  readonly demand: number;
  readonly speed: number;
  readonly profit: number;
  readonly roi: number;
  readonly comp: number;
  readonly ops: number;
  /** The weighted sum before any cap, 0–100. */
  readonly rawScore: number;
  readonly velocityCap: number;
  readonly confidenceCap: number;
  /** Which cap actually bound the result. */
  readonly boundBy: BuyScoreCap;
  readonly score: number;
}

/**
 * Speed. Flat at the top until the ideal hold, then down through 0.35 at the
 * hard-penalty mark, then to zero at the ceiling — where `HOLD_TOO_LONG`
 * rejects it anyway.
 */
export function speedSubScore(expectedDaysToSale: number, policy: ModePolicy): number {
  const d = expectedDaysToSale;
  const { idealHoldDays: ideal, penaltyHardDays: hard, maxHoldDays: max } = policy;

  if (d <= ideal) return 1;
  if (d <= hard) {
    return hard === ideal ? 0.35 : lerp(1, 0.35, (d - ideal) / (hard - ideal));
  }
  if (d <= max) {
    return max === hard ? 0 : lerp(0.35, 0, (d - hard) / (max - hard));
  }
  return 0;
}

/**
 * Profit, saturating. `ln(1 + p/target) / ln(4)` reaches 1.0 at three times the
 * target — monotonic with real diminishing returns rather than a cliff.
 */
export function profitSubScore(expectedNetProfitCents: Cents, policy: ModePolicy): number {
  const p = Math.max(0, expectedNetProfitCents);
  if (policy.profitTargetCents <= 0) return 0;
  return clamp01(
    Math.log(1 + p / policy.profitTargetCents) / Math.log(1 + PROFIT_SATURATION_MULTIPLE),
  );
}

export function demandSubScore(sellThroughBps: Bps, soldLast90Days: number): number {
  const sellThrough = clamp01(sellThroughBps / 10_000);
  const soldPer30d = soldLast90Days / 3;
  const velocityNorm = clamp01(soldPer30d / VELOCITY_SATURATION_PER_30D);
  return clamp01(0.7 * sellThrough + 0.3 * velocityNorm);
}

export function scoreBuy(inputs: BuyScoreInputs, policy: ModePolicy): BuyScoreBreakdown {
  const demand = demandSubScore(inputs.sellThroughBps, inputs.soldLast90Days);
  const speed = speedSubScore(inputs.expectedDaysToSale, policy);
  const profit = profitSubScore(inputs.expectedNetProfitCents, policy);
  const roi =
    policy.roiTargetBps <= 0 ? 0 : clamp01(inputs.expectedRoiBps / policy.roiTargetBps);
  const comp = clamp01(inputs.compConfidenceBps / 10_000);
  const ops = 1 - clamp01(inputs.hassleBps / 10_000);

  const rawScore =
    100 *
    (BUY_SCORE_WEIGHTS.demand * demand +
      BUY_SCORE_WEIGHTS.speed * speed +
      BUY_SCORE_WEIGHTS.profit * profit +
      BUY_SCORE_WEIGHTS.roi * roi +
      BUY_SCORE_WEIGHTS.comp * comp +
      BUY_SCORE_WEIGHTS.ops * ops);

  // The two ceilings. Neither is a penalty applied to the score — they are hard
  // upper bounds, which is what turns a slow item from a passing 80 into a
  // failing 30.
  const velocityCap = 100 * (0.3 + 0.7 * speed);
  const confidenceCap = 100 * (0.55 + 0.45 * clamp01(inputs.confidenceBps / 10_000));

  const capped = Math.min(rawScore, velocityCap, confidenceCap);
  const boundBy: BuyScoreCap =
    capped === rawScore ? 'NONE' : velocityCap <= confidenceCap ? 'VELOCITY' : 'CONFIDENCE';

  return {
    demand,
    speed,
    profit,
    roi,
    comp,
    ops,
    rawScore: roundHalfAwayFromZero(rawScore),
    velocityCap: roundHalfAwayFromZero(velocityCap),
    confidenceCap: roundHalfAwayFromZero(confidenceCap),
    boundBy,
    score: roundHalfAwayFromZero(capped),
  };
}
