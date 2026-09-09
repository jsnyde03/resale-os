/**
 * The whole judgement, in one call.
 *
 * `evaluateOpportunity(input, fundState)` is the function the CLI, the future
 * dashboard and the future opportunity feed all use. Having exactly one of
 * these is the point: a feed that ranked opportunities differently from the
 * screen that showed them would be worse than having no feed.
 *
 * Pure. It reads the fund state; it never writes.
 */

import type { Bps, Cents } from '../core/money.js';
import type { FundState } from '../core/capital/state.js';
import { computeMetrics, type CapitalMetrics } from '../core/capital/metrics.js';
import { assessPurchase, type ConstraintAssessment } from '../core/capital/constraints.js';
import {
  deriveEconomics,
  type OpportunityEconomics,
  type OpportunityInput,
} from '../domain/opportunity.js';
import { scoreConfidence, type ConfidenceBreakdown } from './confidence.js';
import { scoreBuy, type BuyScoreBreakdown } from './buy-score.js';
import { scoreRisk, type RiskBreakdown } from './risk-score.js';
import { maxRecommendedPrice, type MaxPriceBreakdown } from './max-price.js';
import { recommend, type RecommendationResult } from './recommend.js';

export interface Evaluation {
  readonly economics: OpportunityEconomics;
  readonly confidence: ConfidenceBreakdown;
  readonly buy: BuyScoreBreakdown;
  readonly risk: RiskBreakdown;
  readonly price: MaxPriceBreakdown;
  readonly gates: ConstraintAssessment;
  readonly result: RecommendationResult;
  readonly metrics: CapitalMetrics;
  /** The policy version that produced this. A score means nothing without it. */
  readonly policyVersion: string;
}

export function evaluateOpportunity(input: OpportunityInput, state: FundState): Evaluation {
  const metrics = computeMetrics(state);
  const policy = metrics.modePolicy;
  const economics = deriveEconomics(input);

  // Confidence first: it caps the Buy Score, so nothing downstream can be more
  // certain than the evidence behind it.
  const confidence = scoreConfidence({
    comps:
      input.compPricesCents.length > 0
        ? { pricesCents: input.compPricesCents, medianAgeDays: input.compMedianAgeDays }
        : null,
    demandConfidenceBps: economics.velocity.confidenceBps,
    ...(input.conditionConfidenceBps !== null
      ? { conditionConfidenceBps: input.conditionConfidenceBps }
      : {}),
    ...(input.sourceConfidenceBps !== null
      ? { sourceConfidenceBps: input.sourceConfidenceBps }
      : {}),
  });

  const buy = scoreBuy(
    {
      sellThroughBps: economics.velocity.sellThroughBps,
      soldLast90Days: economics.velocity.soldLast90Days,
      expectedDaysToSale: economics.velocity.expectedDaysToSale,
      expectedNetProfitCents: economics.expectedProfitCents,
      expectedRoiBps: economics.expectedRoiBps,
      compConfidenceBps: confidence.compBps,
      confidenceBps: confidence.confidenceBps,
      hassleBps: input.hassleBps,
    },
    policy,
  );

  const categoryExposureAfter =
    (metrics.categoryExposureCents[input.category] ?? 0) + economics.landedCostCents;

  const risk = scoreRisk({
    landedCostCents: economics.landedCostCents,
    navCents: metrics.navCents,
    modeledDownsideCents: economics.modeledDownsideCents,
    compConfidenceBps: confidence.compBps,
    compCoefficientOfVariation: confidence.comp.coefficientOfVariation,
    expectedDaysToSale: economics.velocity.expectedDaysToSale,
    expectedDaysP90: economics.velocity.expectedDaysP90,
    categoryExposureAfterCents: categoryExposureAfter,
    maxCategoryExposureCents: metrics.maxCategoryExposureCents,
    ...optionalBps('counterfeitBps', input.counterfeitBps),
    ...optionalBps('returnBps', input.returnBps),
    ...optionalBps('sellerBps', input.sellerBps),
    ...optionalBps('shippingComplexityBps', input.shippingComplexityBps),
    ...optionalBps('restockBps', input.restockBps),
    ...optionalBps('conditionUncertaintyBps', invertOrNull(input.conditionConfidenceBps)),
  });

  const price = maxRecommendedPrice(
    {
      expectedGrossCents: input.expectedGrossCents,
      otherLandedCents: economics.otherLandedCents,
      maxCapitalPerItemCents: metrics.maxCapitalPerItemCents,
      deployableCapitalCents: metrics.deployableCapitalCents,
      categoryHeadroomCents:
        metrics.maxCategoryExposureCents -
        (metrics.categoryExposureCents[input.category] ?? 0),
    },
    policy,
    economics.fees,
    input.postageCents === null ? {} : { postageCents: input.postageCents },
  );

  const gates = assessPurchase(
    state,
    {
      category: input.category,
      landedCostCents: economics.landedCostCents,
      expectedDaysToSale: economics.velocity.expectedDaysToSale,
      modeledDownsideCents: economics.modeledDownsideCents,
      expectedNetProfitCents: economics.expectedProfitCents,
      expectedRoiBps: economics.expectedRoiBps,
      confidenceBps: confidence.confidenceBps,
      buyScore: buy.score,
      riskScore: risk.score,
      // Abstain on the ratio when there are no comps to compute it from.
      ...(economics.velocity.source === 'COMPS'
        ? { sellThroughBps: economics.velocity.sellThroughBps }
        : {}),
    },
    metrics,
  );

  const result = recommend({
    gates,
    buy,
    risk,
    confidenceBps: confidence.confidenceBps,
    maxPriceCents: price.maxPriceCents,
    policy,
  });

  return {
    economics,
    confidence,
    buy,
    risk,
    price,
    gates,
    result,
    metrics,
    policyVersion: state.policy.version,
  };
}

/** Condition *uncertainty* is the inverse of condition *confidence*. */
function invertOrNull(confidenceBps: Bps | null): Bps | null {
  return confidenceBps === null ? null : 10_000 - confidenceBps;
}

function optionalBps<K extends string>(key: K, value: Cents | null): Record<K, Bps> | object {
  return value === null ? {} : ({ [key]: value } as Record<K, Bps>);
}
