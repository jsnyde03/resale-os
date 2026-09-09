/**
 * Risk Score, 0–100, higher is worse.
 *
 * ⚠️ **Risk is NOT the inverse of Buy Score, and the two are never blended.**
 * Purchase autonomy will eventually require a high Buy Score *and* a low Risk
 * Score; collapsing them into one number would destroy that gate before it is
 * built. A wonderful margin on a counterfeit-prone item in a category you are
 * already deep in is a good Buy Score and a bad Risk Score, and the operator
 * needs to see both.
 *
 * Twelve factors, each normalised to 0..1, with weights summing to exactly 100.
 * The sum is asserted at module load, so a future edit cannot quietly change
 * the scale.
 *
 * SCORING_SPEC §3. Pure.
 */

import { clamp01, roundHalfAwayFromZero } from '../core/math.js';
import type { Bps, Cents } from '../core/money.js';

export const RISK_WEIGHTS = {
  capitalConsumed: 16,
  modeledDownside: 16,
  compUncertainty: 11,
  counterfeitRisk: 9,
  holdUncertainty: 8,
  priceVolatility: 7,
  conditionUncertainty: 7,
  returnRisk: 6,
  concentration: 6,
  sellerRisk: 5,
  shippingComplexity: 5,
  restockRisk: 4,
} as const;

export type RiskFactor = keyof typeof RISK_WEIGHTS;

const WEIGHT_TOTAL = Object.values(RISK_WEIGHTS).reduce((a, b) => a + b, 0);
if (WEIGHT_TOTAL !== 100) {
  // Load-time, not test-time: a mis-weighted risk model must never run at all.
  throw new Error(`RISK_WEIGHTS must sum to 100, got ${WEIGHT_TOTAL}`);
}

/** Half the fund in one item is maximal capital risk. */
export const CAPITAL_RISK_NAV_SHARE = 0.5;
/** Losing a quarter of the fund on one item is maximal downside risk. */
export const DOWNSIDE_RISK_NAV_SHARE = 0.25;
/** A comp CV at or above this is maximal price volatility. */
export const VOLATILITY_CV_CEILING = 0.4;

/**
 * Risk inputs the ledger cannot derive. Each defaults to a middling-to-cautious
 * value rather than to zero — an unknown risk is not an absent one.
 *
 * ⚠️ No per-category defaults: D5 deferred categories until the bankroll
 * supports them, so these are per-opportunity. Category base rates are B28.
 */
export const RISK_DEFAULTS = {
  counterfeitBps: 2_000,
  returnBps: 2_000,
  sellerBps: 2_000,
  shippingComplexityBps: 2_000,
  restockBps: 3_000,
  conditionUncertaintyBps: 4_000,
} as const;

export interface RiskInputs {
  readonly landedCostCents: Cents;
  readonly navCents: Cents;
  readonly modeledDownsideCents: Cents;
  /** `compConfidence` — its inverse is comp uncertainty. */
  readonly compConfidenceBps: Bps;
  /** Coefficient of variation of the comp prices. */
  readonly compCoefficientOfVariation: number;
  readonly expectedDaysToSale: number;
  readonly expectedDaysP90: number;
  /** Category exposure after this purchase, against the mode's cap. */
  readonly categoryExposureAfterCents: Cents;
  readonly maxCategoryExposureCents: Cents;

  readonly counterfeitBps?: Bps;
  readonly returnBps?: Bps;
  readonly sellerBps?: Bps;
  readonly shippingComplexityBps?: Bps;
  readonly restockBps?: Bps;
  readonly conditionUncertaintyBps?: Bps;
}

export interface RiskBreakdown {
  readonly factors: Readonly<Record<RiskFactor, number>>;
  /** Each factor's contribution in points, so the score is explainable. */
  readonly contributions: Readonly<Record<RiskFactor, number>>;
  readonly score: number;
  /** The three factors contributing most. For the reasoning text. */
  readonly topDrivers: readonly RiskFactor[];
}

export function scoreRisk(inputs: RiskInputs): RiskBreakdown {
  const nav = Math.max(1, inputs.navCents);

  const factors: Record<RiskFactor, number> = {
    capitalConsumed: clamp01(inputs.landedCostCents / (CAPITAL_RISK_NAV_SHARE * nav)),
    modeledDownside: clamp01(inputs.modeledDownsideCents / (DOWNSIDE_RISK_NAV_SHARE * nav)),
    compUncertainty: 1 - clamp01(inputs.compConfidenceBps / 10_000),
    counterfeitRisk: clamp01((inputs.counterfeitBps ?? RISK_DEFAULTS.counterfeitBps) / 10_000),
    // How wide the hold could be, relative to the expectation. A hold that is
    // usually 12 days and occasionally 28 is a different animal from a reliable 12.
    holdUncertainty: clamp01(
      (inputs.expectedDaysP90 - inputs.expectedDaysToSale) /
        Math.max(1, inputs.expectedDaysToSale),
    ),
    priceVolatility: clamp01(inputs.compCoefficientOfVariation / VOLATILITY_CV_CEILING),
    conditionUncertainty: clamp01(
      (inputs.conditionUncertaintyBps ?? RISK_DEFAULTS.conditionUncertaintyBps) / 10_000,
    ),
    returnRisk: clamp01((inputs.returnBps ?? RISK_DEFAULTS.returnBps) / 10_000),
    concentration:
      inputs.maxCategoryExposureCents <= 0
        ? 1
        : clamp01(inputs.categoryExposureAfterCents / inputs.maxCategoryExposureCents),
    sellerRisk: clamp01((inputs.sellerBps ?? RISK_DEFAULTS.sellerBps) / 10_000),
    shippingComplexity: clamp01(
      (inputs.shippingComplexityBps ?? RISK_DEFAULTS.shippingComplexityBps) / 10_000,
    ),
    restockRisk: clamp01((inputs.restockBps ?? RISK_DEFAULTS.restockBps) / 10_000),
  };

  const contributions = {} as Record<RiskFactor, number>;
  let total = 0;
  for (const key of Object.keys(RISK_WEIGHTS) as RiskFactor[]) {
    const points = RISK_WEIGHTS[key] * factors[key];
    contributions[key] = points;
    total += points;
  }

  const topDrivers = (Object.keys(RISK_WEIGHTS) as RiskFactor[])
    .sort((a, b) => contributions[b] - contributions[a] || a.localeCompare(b))
    .slice(0, 3);

  return {
    factors,
    contributions,
    score: roundHalfAwayFromZero(total),
    topDrivers,
  };
}
