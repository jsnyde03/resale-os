/**
 * Is the minimum-profit floor actually reachable at this bankroll?
 *
 * WHY THIS EXISTS: a profit floor and a per-item cap are set independently, and
 * they multiply into a constraint neither one states. A $100 floor with a $20
 * per-item cap silently means "every flip must be a 7.2x" — which is not a
 * policy anyone would write down on purpose. Without this, the symptom is that
 * the system rejects everything and nobody can say why.
 *
 * This turns that into a number, and answers the useful inverse: what bankroll
 * does this floor actually imply?
 *
 * Pure. No I/O.
 */

import { toBps, type Bps, type Cents } from '../money.js';
import { grossNeededForNet, type FeeModel } from '../fees.js';
import type { ModePolicy } from './policy.js';

/**
 * The gross-to-landed multiple a flip can plausibly hit. 3x is generous for
 * sourced-at-retail goods and ordinary for genuinely underpriced ones; above
 * it, a policy is describing luck rather than a repeatable process.
 */
export const PLAUSIBLE_MULTIPLE_BPS: Bps = 30_000;

export interface ProfitFloorReachability {
  readonly navCents: Cents;
  readonly maxPerItemCents: Cents;
  readonly minProfitCents: Cents;
  /** Gross sale price needed on a max-size item to clear the floor. */
  readonly grossNeededCents: Cents;
  /** grossNeeded / maxPerItem. The multiple EVERY flip has to hit. */
  readonly requiredMultipleBps: Bps;
  readonly plausibleMultipleBps: Bps;
  readonly reachable: boolean;
  /** NAV at which the floor becomes clearable at the plausible multiple. */
  readonly impliedBankrollCents: Cents;
  /** Landed cost per item at that bankroll. */
  readonly impliedMaxPerItemCents: Cents;
}

/**
 * The bankroll a profit floor implies.
 *
 *   net(g)  = g * (1 - feeRate) - fixed          where fixed = perOrder + postage + packaging
 *   g       = multiple * landed
 *   profit  = landed * (multiple * (1 - feeRate) - 1) - fixed
 *
 * Solving `profit = floor` for landed:
 *
 *   landed  = (floor + fixed) / (multiple * (1 - feeRate) - 1)
 *   bankroll = landed / maxPerItemBps
 *
 * Returns `null` when the denominator is <= 0 — at that fee rate and multiple,
 * a bigger bankroll never helps, because each item loses ground on its own.
 */
export function bankrollForProfitFloor(
  minProfitCents: Cents,
  maxPerItemBps: Bps,
  model: FeeModel,
  multipleBps: Bps = PLAUSIBLE_MULTIPLE_BPS,
): { landedCents: Cents; bankrollCents: Cents } | null {
  const fixed = model.perOrderCents + model.defaultPostageCents + model.defaultPackagingCents;
  const keepRate = (10_000 - model.finalValueBps) / 10_000;
  const multiple = multipleBps / 10_000;

  const denominator = multiple * keepRate - 1;
  if (denominator <= 0) return null;

  const landedCents = Math.ceil((minProfitCents + fixed) / denominator);
  if (maxPerItemBps <= 0) return null;

  return {
    landedCents,
    bankrollCents: Math.ceil((landedCents * 10_000) / maxPerItemBps),
  };
}

export function assessProfitFloor(
  navCents: Cents,
  policy: ModePolicy,
  model: FeeModel,
  plausibleMultipleBps: Bps = PLAUSIBLE_MULTIPLE_BPS,
): ProfitFloorReachability {
  const maxPerItemCents = Math.floor((Math.max(0, navCents) * policy.maxCapitalPerItemBps) / 10_000);
  const minProfitCents = policy.minExpectedProfitCents;

  const grossNeededCents =
    maxPerItemCents > 0 ? grossNeededForNet(maxPerItemCents + minProfitCents, model) : 0;
  const requiredMultipleBps =
    maxPerItemCents > 0 ? toBps(grossNeededCents, maxPerItemCents) : Number.MAX_SAFE_INTEGER;

  const implied = bankrollForProfitFloor(
    minProfitCents,
    policy.maxCapitalPerItemBps,
    model,
    plausibleMultipleBps,
  );

  return {
    navCents,
    maxPerItemCents,
    minProfitCents,
    grossNeededCents,
    requiredMultipleBps,
    plausibleMultipleBps,
    reachable: maxPerItemCents > 0 && requiredMultipleBps <= plausibleMultipleBps,
    impliedBankrollCents: implied?.bankrollCents ?? Number.MAX_SAFE_INTEGER,
    impliedMaxPerItemCents: implied?.landedCents ?? Number.MAX_SAFE_INTEGER,
  };
}
