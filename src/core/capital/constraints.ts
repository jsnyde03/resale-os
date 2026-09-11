/**
 * Hard capital controls.
 *
 * These are gates on a DECISION, not on a recording. Every gate is evaluated —
 * evaluation never short-circuits — so the operator sees every reason at once
 * rather than fixing one and discovering the next.
 *
 * A high expected profit can never override a capital gate: profit is not an
 * input to any function in this file.
 */

import { applyBps, type Bps, type Cents, formatCents } from '../money.js';
import type { CapitalMetrics } from './metrics.js';
import { computeMetrics } from './metrics.js';
import type { FundState } from './state.js';

export const CONSTRAINT_CODES = [
  'HOLD_TOO_LONG',
  'LONG_HOLD_ALLOCATION_EXCEEDED',
  'MAX_PER_ITEM_EXCEEDED',
  'INSUFFICIENT_DEPLOYABLE_CAPITAL',
  'RESERVE_FLOOR_BREACH',
  'MAX_DEPLOYED_EXCEEDED',
  'CATEGORY_CONCENTRATION',
  'DOWNSIDE_TOO_LARGE',
  'PROFIT_BELOW_MIN',
  'ROI_BELOW_MIN',
  'CONFIDENCE_TOO_LOW',
  'SELL_THROUGH_TOO_LOW',
  'VELOCITY_COUNTS_UNBOUNDED',
  'BUY_SCORE_TOO_LOW',
  'RISK_SCORE_TOO_HIGH',
] as const;

export type ConstraintCode = (typeof CONSTRAINT_CODES)[number];

export interface ConstraintResult {
  readonly code: ConstraintCode;
  readonly passed: boolean;
  readonly message: string;
  /** The measured value and the limit, so a UI can show the overage. */
  readonly actual: number;
  readonly limit: number;
}

/**
 * What a constraint check needs to know about a candidate purchase.
 * Scores are optional: Gate 1 evaluates the capital gates alone, and Gate 2
 * supplies the score-dependent ones.
 */
export interface PurchaseCandidate {
  readonly category: string;
  readonly landedCostCents: Cents;
  readonly expectedDaysToSale: number;
  /** landedCost - estimated liquidation net, floored at 0. */
  readonly modeledDownsideCents: Cents;
  readonly expectedNetProfitCents: Cents;
  readonly expectedRoiBps: Bps;
  readonly confidenceBps?: Bps;
  readonly buyScore?: number;
  readonly riskScore?: number;
  /**
   * Sell-through from comps. Omitted for an operator estimate, where there is
   * no ratio to test — the gate abstains rather than failing an unknown.
   */
  readonly sellThroughBps?: Bps;
  /**
   * ⛔ **Set when `expectedDaysToSale` is a LOWER bound and `sellThroughBps` an
   * UPPER one** — the market counts behind them were a floor, so both gates are
   * being shown the friendliest number consistent with the measurement.
   *
   * ⚠️ **This is the REVERSE of the sell-through rule above.** There, an absent
   * ratio makes the gate abstain, because not knowing is neutral. Here not
   * knowing is *optimistic*, and abstaining would hand the benefit of the doubt
   * to the one direction that cannot afford it. **The direction the unknown
   * leans is what decides whether abstaining is safe.** `VelocityEstimate`
   * carries it as `boundsAreOptimistic`; backlog **B77**.
   */
  readonly boundsAreOptimistic?: boolean;
}

export interface ConstraintAssessment {
  readonly results: readonly ConstraintResult[];
  readonly failures: readonly ConstraintResult[];
  readonly passed: boolean;
  readonly metrics: CapitalMetrics;
}

function result(
  code: ConstraintCode,
  passed: boolean,
  actual: number,
  limit: number,
  message: string,
): ConstraintResult {
  return { code, passed, actual, limit, message };
}

export function assessPurchase(
  state: FundState,
  candidate: PurchaseCandidate,
  metricsOverride?: CapitalMetrics,
): ConstraintAssessment {
  const m = metricsOverride ?? computeMetrics(state);
  const p = m.modePolicy;
  const cost = candidate.landedCostCents;
  const results: ConstraintResult[] = [];

  // --- hold time ----------------------------------------------------------
  results.push(
    result(
      'HOLD_TOO_LONG',
      candidate.expectedDaysToSale <= p.maxHoldDays,
      candidate.expectedDaysToSale,
      p.maxHoldDays,
      `expected ${candidate.expectedDaysToSale}d hold vs ${p.maxHoldDays}d ceiling in ${m.mode}`,
    ),
  );

  const isLongHold = candidate.expectedDaysToSale > p.longHoldThresholdDays;
  const longHoldAfter = m.longHoldCapitalCents + (isLongHold ? cost : 0);
  results.push(
    result(
      'LONG_HOLD_ALLOCATION_EXCEEDED',
      !isLongHold || longHoldAfter <= m.maxLongHoldCents,
      longHoldAfter,
      m.maxLongHoldCents,
      isLongHold
        ? `long-hold capital would be ${formatCents(longHoldAfter)} vs a ` +
          `${formatCents(m.maxLongHoldCents)} ceiling`
        : 'not a long hold',
    ),
  );

  // --- capital safety -----------------------------------------------------
  results.push(
    result(
      'MAX_PER_ITEM_EXCEEDED',
      cost <= m.maxCapitalPerItemCents,
      cost,
      m.maxCapitalPerItemCents,
      `${formatCents(cost)} in one item vs a ${formatCents(m.maxCapitalPerItemCents)} cap`,
    ),
  );

  results.push(
    result(
      'INSUFFICIENT_DEPLOYABLE_CAPITAL',
      cost <= m.deployableCapitalCents,
      cost,
      m.deployableCapitalCents,
      `${formatCents(cost)} needed, ${formatCents(m.deployableCapitalCents)} deployable`,
    ),
  );

  const cashAfter = m.unencumberedCashCents - cost;
  results.push(
    result(
      'RESERVE_FLOOR_BREACH',
      cashAfter >= m.minLiquidFloorCents,
      cashAfter,
      m.minLiquidFloorCents,
      `unencumbered cash would fall to ${formatCents(cashAfter)}, below the ` +
        `${formatCents(m.minLiquidFloorCents)} floor`,
    ),
  );

  const deployedAfter = m.capitalDeployedCents + cost;
  results.push(
    result(
      'MAX_DEPLOYED_EXCEEDED',
      deployedAfter <= m.maxDeployedCents,
      deployedAfter,
      m.maxDeployedCents,
      `${formatCents(deployedAfter)} deployed vs a ${formatCents(m.maxDeployedCents)} ceiling`,
    ),
  );

  const categoryAfter = (m.categoryExposureCents[candidate.category] ?? 0) + cost;
  results.push(
    result(
      'CATEGORY_CONCENTRATION',
      categoryAfter <= m.maxCategoryExposureCents,
      categoryAfter,
      m.maxCategoryExposureCents,
      `"${candidate.category}" exposure would be ${formatCents(categoryAfter)} vs a ` +
        `${formatCents(m.maxCategoryExposureCents)} cap`,
    ),
  );

  const maxDownside = applyBps(Math.max(0, m.navCents), p.maxDownsideBps);
  results.push(
    result(
      'DOWNSIDE_TOO_LARGE',
      candidate.modeledDownsideCents <= maxDownside,
      candidate.modeledDownsideCents,
      maxDownside,
      `modeled downside ${formatCents(candidate.modeledDownsideCents)} vs a ` +
        `${formatCents(maxDownside)} ceiling`,
    ),
  );

  // --- opportunity floors -------------------------------------------------
  results.push(
    result(
      'PROFIT_BELOW_MIN',
      candidate.expectedNetProfitCents >= p.minExpectedProfitCents,
      candidate.expectedNetProfitCents,
      p.minExpectedProfitCents,
      `expected profit ${formatCents(candidate.expectedNetProfitCents)} vs a ` +
        `${formatCents(p.minExpectedProfitCents)} minimum`,
    ),
  );

  results.push(
    result(
      'ROI_BELOW_MIN',
      candidate.expectedRoiBps >= p.minExpectedRoiBps,
      candidate.expectedRoiBps,
      p.minExpectedRoiBps,
      `expected ROI ${(candidate.expectedRoiBps / 100).toFixed(1)}% vs a ` +
        `${(p.minExpectedRoiBps / 100).toFixed(1)}% minimum`,
    ),
  );

  // Score-dependent gates: only evaluated when a score was supplied. An absent
  // score is not a silent pass — the caller decides whether to score first.
  if (candidate.confidenceBps !== undefined) {
    results.push(
      result(
        'CONFIDENCE_TOO_LOW',
        candidate.confidenceBps >= p.minConfidenceBps,
        candidate.confidenceBps,
        p.minConfidenceBps,
        `confidence ${(candidate.confidenceBps / 100).toFixed(0)}% vs a ` +
          `${(p.minConfidenceBps / 100).toFixed(0)}% minimum`,
      ),
    );
  }

  if (candidate.sellThroughBps !== undefined) {
    results.push(
      result(
        'SELL_THROUGH_TOO_LOW',
        candidate.sellThroughBps >= p.minSellThroughBps,
        candidate.sellThroughBps,
        p.minSellThroughBps,
        `sell-through ${(candidate.sellThroughBps / 100).toFixed(0)}% vs a ` +
          `${(p.minSellThroughBps / 100).toFixed(0)}% minimum in ${m.mode}`,
      ),
    );
  }

  // --- the counts underneath the hold and the ratio ------------------------
  //
  // ⛔ **An optimistic bound only matters when it is what let the item
  // through.** If the hold or the ratio already refused the item at the
  // friendly number, the true number refuses it harder and the verdict is
  // unchanged — firing here as well would add a refusal that is not binding,
  // and 6.2's histogram counts refusals to find the one that is.
  {
    const optimistic = candidate.boundsAreOptimistic === true;
    // An absent gate abstained, which did not stop anything either.
    const letThrough = (code: ConstraintCode): boolean =>
      results.find((r) => r.code === code)?.passed !== false;
    const itWasTheDecidingNumber =
      letThrough('HOLD_TOO_LONG') && letThrough('SELL_THROUGH_TOO_LOW');

    results.push(
      result(
        'VELOCITY_COUNTS_UNBOUNDED',
        !(optimistic && itWasTheDecidingNumber),
        candidate.expectedDaysToSale,
        p.maxHoldDays,
        optimistic
          ? `the market counts are a floor, so ${candidate.expectedDaysToSale}d is the ` +
            `FASTEST this could sell, not the expected hold — narrow the search ` +
            `until the counts are exact`
          : 'the market counts are exact',
      ),
    );
  }

  if (candidate.buyScore !== undefined) {
    results.push(
      result(
        'BUY_SCORE_TOO_LOW',
        candidate.buyScore >= p.minBuyScore,
        candidate.buyScore,
        p.minBuyScore,
        `buy score ${candidate.buyScore} vs a ${p.minBuyScore} minimum in ${m.mode}`,
      ),
    );
  }

  if (candidate.riskScore !== undefined) {
    results.push(
      result(
        'RISK_SCORE_TOO_HIGH',
        candidate.riskScore <= p.maxRiskScore,
        candidate.riskScore,
        p.maxRiskScore,
        `risk score ${candidate.riskScore} vs a ${p.maxRiskScore} ceiling in ${m.mode}`,
      ),
    );
  }

  const failures = results.filter((r) => !r.passed);
  return { results, failures, passed: failures.length === 0, metrics: m };
}

/**
 * The largest landed cost that clears every *capital* gate, ignoring the
 * opportunity floors (which depend on price in the other direction and are
 * solved in `src/scoring/max-price.ts`).
 */
export function maxAffordableLandedCost(state: FundState, category: string): Cents {
  const m = computeMetrics(state);
  const categoryHeadroom =
    m.maxCategoryExposureCents - (m.categoryExposureCents[category] ?? 0);
  return Math.max(
    0,
    Math.min(
      m.deployableCapitalCents,
      m.maxCapitalPerItemCents,
      m.unencumberedCashCents - m.minLiquidFloorCents,
      m.maxDeployedCents - m.capitalDeployedCents,
      categoryHeadroom,
    ),
  );
}
