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
  /**
   * ⛔ **True when this evidence is for a DIFFERENT product (Gate 7.5).**
   *
   * A drop has not been sold yet, so it is priced by analogy — last year's
   * model, the previous colourway. ⚠️ **Everything else in `compConfidence`
   * measures PRECISION, not ACCURACY**: count, dispersion and recency. A tight,
   * plentiful, recent comp set for the predecessor scores near the top, and the
   * number it supports is about something the operator is not buying.
   *
   * ⛔ So an analogy is CAPPED rather than discounted. However good the
   * predecessor's comps are, they are not about this product, and the cap says
   * exactly that. A weak predecessor set is already low and is not punished
   * twice.
   *
   * ⚡ **And it ceilings the DEMAND term too — see `scoreConfidence` (Jason,
   * 2026-09-11).** The sold and active counts behind a drop come from the same
   * predecessor, and `velocity.confidenceBps` is a sample size: precision
   * again. Capping one half and not the other let a drop report **89%**
   * confidence off evidence for a product nobody is buying.
   */
  readonly analogous?: boolean;
}

/**
 * The most an analogy may contribute — to **either** half of the evidence.
 *
 * ⚡ Set deliberately ABOVE `CONFIDENCE_DEFAULTS.compBps` (3,000) — last year's
 * model really is better evidence than nothing — and well below what measured
 * comps reach, so an analogy informs a decision without being able to carry
 * one. The same shape as `OPERATOR_ESTIMATE_CONFIDENCE_BPS`, which is capped
 * below every mode floor for the same reason.
 */
export const ANALOGOUS_EVIDENCE_CEILING_BPS: Bps = 5_000;

export interface CompConfidence {
  readonly countTermBps: Bps;
  readonly dispersionTermBps: Bps;
  readonly recencyTermBps: Bps;
  readonly confidenceBps: Bps;
  /** ⛔ True when these comps describe a different product. @see CompEvidence */
  readonly analogous: boolean;
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
      analogous: evidence?.analogous === true,
      coefficientOfVariation: COMP_CV_WORTHLESS,
    };
  }

  const cv = coefficientOfVariation(evidence.pricesCents);
  const countTerm = clamp01(evidence.pricesCents.length / COMP_COUNT_SATURATION);
  const dispersionTerm = 1 - clamp01(cv / COMP_CV_WORTHLESS);
  const recencyTerm = 1 - clamp01(evidence.medianAgeDays / COMP_RECENCY_HORIZON_DAYS);

  const measured = toBpsFrom01(0.4 * countTerm + 0.4 * dispersionTerm + 0.2 * recencyTerm);

  return {
    countTermBps: toBpsFrom01(countTerm),
    dispersionTermBps: toBpsFrom01(dispersionTerm),
    recencyTermBps: toBpsFrom01(recencyTerm),
    // ⛔ An analogy is capped, never scaled. @see CompEvidence.analogous
    confidenceBps:
      evidence.analogous === true ? Math.min(measured, ANALOGOUS_EVIDENCE_CEILING_BPS) : measured,
    analogous: evidence.analogous === true,
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
  const measuredDemandBps = inputs.demandConfidenceBps ?? CONFIDENCE_DEFAULTS.demandBps;
  // ⛔ **The analogy ceilings BOTH halves, and the rule lives HERE so no caller
  // can wire one of them.** A drop's sold and active counts are the
  // predecessor's as surely as its comp prices are, and `demandConfidenceBps`
  // is a sample size — precision, not accuracy, the same hazard `compConfidence`
  // caps for. ⚠️ Measured 2026-09-11 on a strong predecessor: 89.3% uncapped,
  // 71.5% with comps capped alone, **59.0%** with both. Jason chose both.
  const demandBps = comp.analogous
    ? Math.min(measuredDemandBps, ANALOGOUS_EVIDENCE_CEILING_BPS)
    : measuredDemandBps;
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
