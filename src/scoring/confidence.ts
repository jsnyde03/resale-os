/**
 * How much the estimates behind an opportunity should be trusted.
 *
 * ⚠️ **Confidence is data quality, not optimism.** It never rises because an
 * item looks good; it rises because the evidence behind the numbers is better.
 * It caps the Buy Score directly (see `buy-score.ts`), which is what stops a
 * thin guess from ever scoring like a measured fact.
 *
 * Every signal defaults to a deliberately pessimistic value when absent, so
 * missing data reads as "we don't know" rather than as "fine".
 *
 * SCORING_SPEC §1. Pure.
 */

import { clamp01, coefficientOfVariation, roundHalfAwayFromZero } from '../core/math.js';
import type { Bps, Cents } from '../core/money.js';

/** Weights over the four signals. Must sum to 1. */
export const CONFIDENCE_WEIGHTS = {
  comp: 0.4,
  demand: 0.25,
  condition: 0.2,
  source: 0.15,
} as const;

/** Used when the corresponding signal is not supplied. Pessimistic on purpose. */
export const CONFIDENCE_DEFAULTS = {
  compBps: 3_000,
  demandBps: 2_500,
  conditionBps: 4_000,
  sourceBps: 5_000,
} as const;

/** Comps stop teaching you much past this many. */
export const COMP_COUNT_SATURATION = 8;
/** A coefficient of variation at or above this makes comps worthless. */
export const COMP_CV_WORTHLESS = 0.5;
/** Comps older than this contribute nothing to recency. */
export const COMP_RECENCY_HORIZON_DAYS = 90;

export interface CompEvidence {
  /** Sold prices, in cents. */
  readonly pricesCents: readonly Cents[];
  /** Median age of those sales, in days. */
  readonly medianAgeDays: number;
}

export interface CompConfidence {
  readonly countTermBps: Bps;
  readonly dispersionTermBps: Bps;
  readonly recencyTermBps: Bps;
  readonly confidenceBps: Bps;
  /** Coefficient of variation of the comp prices. Reused by the Risk Score. */
  readonly coefficientOfVariation: number;
}

const toBpsFrom01 = (x: number): Bps => roundHalfAwayFromZero(clamp01(x) * 10_000);

/**
 * Three things make comps trustworthy: how many, how tightly they agree, and
 * how recent they are. Count and dispersion matter most — eight comps that
 * disagree wildly are worse than three that agree.
 */
export function compConfidence(evidence: CompEvidence | null): CompConfidence {
  if (!evidence || evidence.pricesCents.length === 0) {
    return {
      countTermBps: 0,
      dispersionTermBps: 0,
      recencyTermBps: 0,
      confidenceBps: CONFIDENCE_DEFAULTS.compBps,
      coefficientOfVariation: COMP_CV_WORTHLESS,
    };
  }

  const cv = coefficientOfVariation(evidence.pricesCents);
  const countTerm = clamp01(evidence.pricesCents.length / COMP_COUNT_SATURATION);
  const dispersionTerm = 1 - clamp01(cv / COMP_CV_WORTHLESS);
  const recencyTerm = 1 - clamp01(evidence.medianAgeDays / COMP_RECENCY_HORIZON_DAYS);

  return {
    countTermBps: toBpsFrom01(countTerm),
    dispersionTermBps: toBpsFrom01(dispersionTerm),
    recencyTermBps: toBpsFrom01(recencyTerm),
    confidenceBps: toBpsFrom01(0.4 * countTerm + 0.4 * dispersionTerm + 0.2 * recencyTerm),
    coefficientOfVariation: cv,
  };
}

export interface ConfidenceInputs {
  /** Sold comps behind the resale estimate. */
  readonly comps?: CompEvidence | null;
  /**
   * Confidence in the hold time. This is `velocity.confidenceBps` — how many
   * sales the rate estimate rests on — not a flag for whether comps existed.
   */
  readonly demandConfidenceBps?: Bps;
  /** Operator's read on condition: photos, description, ability to inspect. */
  readonly conditionConfidenceBps?: Bps;
  /** How reliable the listing data itself is. Adapters declare this. */
  readonly sourceConfidenceBps?: Bps;
}

export interface ConfidenceBreakdown {
  readonly compBps: Bps;
  readonly demandBps: Bps;
  readonly conditionBps: Bps;
  readonly sourceBps: Bps;
  readonly confidenceBps: Bps;
  readonly comp: CompConfidence;
}

export function scoreConfidence(inputs: ConfidenceInputs): ConfidenceBreakdown {
  const comp = compConfidence(inputs.comps ?? null);
  const compBps = comp.confidenceBps;
  const demandBps = inputs.demandConfidenceBps ?? CONFIDENCE_DEFAULTS.demandBps;
  const conditionBps = inputs.conditionConfidenceBps ?? CONFIDENCE_DEFAULTS.conditionBps;
  const sourceBps = inputs.sourceConfidenceBps ?? CONFIDENCE_DEFAULTS.sourceBps;

  const confidenceBps = roundHalfAwayFromZero(
    CONFIDENCE_WEIGHTS.comp * compBps +
      CONFIDENCE_WEIGHTS.demand * demandBps +
      CONFIDENCE_WEIGHTS.condition * conditionBps +
      CONFIDENCE_WEIGHTS.source * sourceBps,
  );

  return { compBps, demandBps, conditionBps, sourceBps, confidenceBps, comp };
}
