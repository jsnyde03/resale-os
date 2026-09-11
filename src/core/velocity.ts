/**
 * How long this will take to sell — derived from comps, not guessed.
 *
 * ⚠️ **Why this exists:** `expectedDaysToSale` used to be a number the operator
 * typed in, and R1 in `docs/ASSUMPTIONS_AND_RISKS.md` says estimate quality —
 * not math quality — is what decides whether this makes money. The ledger can be
 * exactly right about a hold time that was invented.
 *
 * Two counts are observable before buying anything: how many of these sold
 * recently, and how many are listed right now. That is enough.
 *
 * THE QUEUE MODEL
 *
 *     expectedDays = 90 * (activeListings + 1) / soldLast90Days
 *
 * You are joining a queue of `activeListings` sellers, and the market clears
 * `soldLast90Days / 90` of them a day. The `+ 1` is your own listing: you are
 * adding to the queue, not watching it from outside.
 *
 * It is a mean, and waiting times are roughly exponential, so the p90 is about
 * 2.3x the mean rather than a little above it. `expectedDaysP90` carries that,
 * because a hold that is usually 12 days and occasionally 28 is a different
 * risk from one that is reliably 12.
 *
 * Pure. No I/O.
 */

import { clamp01, roundHalfAwayFromZero } from './math.js';
import { toBps, type Bps } from './money.js';

/** Beyond this the number stops meaning anything; it just means "no". */
export const MAX_MODELLED_DAYS = 3_650;

/**
 * p90 of an exponential wait is -ln(0.1) = 2.303 times the mean. Waiting for one
 * buyer out of a Poisson stream is close enough to exponential for this to be
 * the right shape, and it is far more honest than mean + a fudge factor.
 */
export const P90_MULTIPLIER = 2.303;

/** Sales in 90 days at which the rate estimate stops improving much. */
export const CONFIDENCE_SATURATION_SALES = 20;

/**
 * A hand-typed hold time is a guess, and it is capped here so it can never be
 * spent like measured data. It is deliberately below every mode's
 * `minConfidenceBps`, so an operator estimate alone cannot clear the gate.
 */
export const OPERATOR_ESTIMATE_CONFIDENCE_BPS: Bps = 3_000;

export type VelocitySource = 'COMPS' | 'OPERATOR_ESTIMATE';

/**
 * ⛔ **A COUNT CAN BE A FLOOR, AND THE TWO FLOORS ARE NOT EQUALLY SAFE.**
 *
 * A market count is not always exact. SoldComps returns `totalResults` as
 * `"240,000+"` on a broad search — the `+` means *at least*, and the true number
 * is unknown and larger. Both gates that use these counts are non-linear in
 * them, and the two directions land on opposite sides of safe:
 *
 * - **SOLD undercounted** → the hold gets LONGER and sell-through gets LOWER.
 *   Both refuse a good item. **Safe**, and needs no special handling.
 * - **ACTIVE undercounted** → the hold gets SHORTER and sell-through gets
 *   HIGHER. Both let a bad item through. **Unsafe**, and it is the whole reason
 *   this type exists.
 *
 * Backlog **B77**. ⚠️ The estimate carries the facts *and* the conclusion
 * (`boundsAreOptimistic`), because the direction is the part that is easy to get
 * backwards and a consumer should never have to re-derive it.
 */
export interface CountBounds {
  /** `activeListings` is known to be an undercount of an unknown true value. */
  readonly activeIsFloor?: boolean;
  /** `soldLast90Days` is known to be an undercount. Safe, but recorded. */
  readonly soldIsFloor?: boolean;
}

export interface VelocityEstimate {
  readonly soldLast90Days: number;
  readonly activeListings: number;
  /** sold / (sold + active). The conventional sell-through ratio. */
  readonly sellThroughBps: Bps;
  /** Mean days to sale, from the queue model. Integer, floored at 1. */
  readonly expectedDaysToSale: number;
  /** A pessimistic hold: 2.3x the mean, because waits are exponential. */
  readonly expectedDaysP90: number;
  /** How much the estimate should be trusted, driven by sample size. */
  readonly confidenceBps: Bps;
  readonly source: VelocitySource;
  /** @see CountBounds */
  readonly activeIsFloor: boolean;
  /** @see CountBounds */
  readonly soldIsFloor: boolean;
  /**
   * ⛔ **The conclusion, so no consumer has to get the direction right twice.**
   *
   * True when `expectedDaysToSale` is a LOWER bound and `sellThroughBps` an
   * UPPER one — i.e. every gate reading this estimate is being shown the
   * friendliest number consistent with what was measured, by an unknown margin.
   * Derived here rather than stored, so it cannot drift from the facts above.
   */
  readonly boundsAreOptimistic: boolean;
}

export class VelocityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VelocityError';
  }
}

function assertCount(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new VelocityError(`${label} must be a non-negative integer, got ${value}`);
  }
}

/**
 * Confidence in the RATE, which comes from how many sales are behind it.
 * Two sales in 90 days can imply any hold time you like; twenty cannot.
 */
export function velocityConfidenceBps(soldLast90Days: number): Bps {
  return roundHalfAwayFromZero(
    clamp01(soldLast90Days / CONFIDENCE_SATURATION_SALES) * 10_000,
  );
}

export function estimateFromComps(
  soldLast90Days: number,
  activeListings: number,
  bounds: CountBounds = {},
): VelocityEstimate {
  assertCount(soldLast90Days, 'soldLast90Days');
  assertCount(activeListings, 'activeListings');

  const activeIsFloor = bounds.activeIsFloor === true;
  const soldIsFloor = bounds.soldIsFloor === true;
  // Only an ACTIVE floor flatters the numbers. See `CountBounds`.
  const boundsAreOptimistic = activeIsFloor;

  const sellThroughBps = toBps(soldLast90Days, soldLast90Days + activeListings);

  // Nothing has sold: there is no rate to estimate. Say "no" loudly rather than
  // dividing by zero or quietly producing a small number.
  //
  // ⚠️ The bound flags still travel. A zero sold count is already the worst
  // possible answer, so optimism cannot make it pass — but a consumer that
  // reports WHY should not have the fact disappear on one branch.
  if (soldLast90Days === 0) {
    return {
      soldLast90Days,
      activeListings,
      sellThroughBps: 0,
      expectedDaysToSale: MAX_MODELLED_DAYS,
      expectedDaysP90: MAX_MODELLED_DAYS,
      confidenceBps: 0,
      source: 'COMPS',
      activeIsFloor,
      soldIsFloor,
      boundsAreOptimistic,
    };
  }

  const mean = (90 * (activeListings + 1)) / soldLast90Days;
  const expectedDaysToSale = Math.min(MAX_MODELLED_DAYS, Math.max(1, Math.ceil(mean)));
  const expectedDaysP90 = Math.min(
    MAX_MODELLED_DAYS,
    Math.max(expectedDaysToSale, Math.ceil(mean * P90_MULTIPLIER)),
  );

  return {
    soldLast90Days,
    activeListings,
    sellThroughBps,
    expectedDaysToSale,
    expectedDaysP90,
    confidenceBps: velocityConfidenceBps(soldLast90Days),
    source: 'COMPS',
    activeIsFloor,
    soldIsFloor,
    boundsAreOptimistic,
  };
}

/**
 * The escape hatch for when comps cannot be had. It carries a low confidence
 * that no amount of optimism can raise, so a guess cannot be spent like data.
 */
export function estimateFromOperator(expectedDaysToSale: number): VelocityEstimate {
  assertCount(expectedDaysToSale, 'expectedDaysToSale');
  const days = Math.min(MAX_MODELLED_DAYS, Math.max(1, expectedDaysToSale));
  return {
    soldLast90Days: 0,
    activeListings: 0,
    // Unknown, not zero. The sell-through gate reads `source` and abstains.
    sellThroughBps: 0,
    expectedDaysToSale: days,
    expectedDaysP90: Math.min(MAX_MODELLED_DAYS, Math.ceil(days * P90_MULTIPLIER)),
    confidenceBps: OPERATOR_ESTIMATE_CONFIDENCE_BPS,
    source: 'OPERATOR_ESTIMATE',
    // There are no counts here to be a floor of. The low confidence is what
    // holds this path back, and it already cannot clear a gate alone.
    activeIsFloor: false,
    soldIsFloor: false,
    boundsAreOptimistic: false,
  };
}

/**
 * The comp counts needed to clear a target hold. The number to look for in the
 * field: "I need to see at least this many sold against that many listed."
 */
export function soldNeededForHold(targetDays: number, activeListings: number): number {
  if (targetDays <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.ceil((90 * (activeListings + 1)) / targetDays);
}
