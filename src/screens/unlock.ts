/**
 * Not yet, or never?
 *
 * ⛔ **Filed as "the watchlist that unlocks", on a premise the before-scan
 * disproved.** The idea was that a refused item is waiting for the bankroll.
 * Measured 2026-09-10: mostly it is not. Three of four refused candidates never
 * become a buy at **any** NAV up to $500,000 — hold time, margin and
 * sell-through do not care how rich the fund is. So the useful answer is the one
 * nobody asked for: **put it down, it will never be a buy.**
 *
 * ⛔ **And the obvious algorithm is wrong. The unlock is NOT MONOTONIC.** A
 * $12 → $30 item is a BUY at $490 and is REFUSED at $500, because GROWTH raises
 * the minimum profit from $8 to $15 and drops the per-item cap from 40% to 20%.
 * **Growing the fund can make an item stop being buyable** — intended, and fatal
 * to a bisection, which assumes that once true it stays true.
 *
 * So this SCANS. It is a pure function over a policy and an evaluator, and it
 * answers with the bankroll or with an honest "never in the range I looked at".
 */

import type { Cents } from '../core/money.js';
import type { FundState } from '../core/capital/state.js';
import { computeMetrics } from '../core/capital/metrics.js';
import type { Evaluation } from '../scoring/evaluate.js';
import type { OpportunityInput } from '../domain/opportunity.js';

/**
 * The bankrolls tried, smallest first.
 *
 * ⚠️ **Dense where the fund actually is, and around the mode switch**, which is
 * the one place the answer can reverse. Sparse above, because "you need to be
 * ten times richer" is the same practical answer as "never" and paying for
 * precision there buys nothing.
 */
export const SCAN_NAVS_CENTS: readonly Cents[] = [
  2_500, 5_000, 7_500, 10_000, 15_000, 20_000, 25_000, 30_000, 40_000,
  // The BOOTSTRAP → GROWTH boundary. The rules change here in BOTH directions.
  45_000, 49_000, 50_000, 51_000, 55_000,
  75_000, 100_000, 150_000, 250_000, 500_000, 1_000_000, 5_000_000,
];

/**
 * The same fund, asked *what if the bankroll were this instead*.
 *
 * ⛔ **Built by moving LIQUID, not by inventing a field.** NAV is derived
 * (`LIQUID + INVENTORY - reserves - payable`), so a state carrying a
 * "hypothetical NAV" that nothing reads is a lie a type cast will happily
 * accept — I wrote exactly that first, and it typechecked while every
 * hypothetical silently evaluated at the real bankroll.
 *
 * ⚠️ **The mode is taken from the threshold, not from history.** The real mode
 * is hysteretic — it depends on the path NAV took — and a hypothesis has no
 * path. So this answers "at this bankroll, arrived at cleanly", which is the
 * question an operator means. It is an approximation and it is named as one.
 */
export function fundAtNav(state: FundState, navCents: Cents): FundState {
  const m = computeMetrics(state);
  const delta = navCents - m.navCents;
  const { promoteAtCents } = state.policy.thresholds;
  return {
    ...state,
    balances: { ...state.balances, LIQUID: state.balances.LIQUID + delta },
    mode: navCents >= promoteAtCents ? 'GROWTH' : 'BOOTSTRAP',
  };
}

export type Unlock =
  | { readonly kind: 'NOW' }
  /** It becomes a buy at this bankroll — the only case worth keeping on a list. */
  | { readonly kind: 'AT_NAV'; readonly navCents: Cents }
  /**
   * ⚡ The most valuable answer, and the one the original framing had no room
   * for. Nothing about the fund's size fixes this item.
   */
  | { readonly kind: 'NEVER'; readonly because: readonly string[] };

export interface UnlockAssessment {
  readonly unlock: Unlock;
  /**
   * ⚠️ **Set when growing the fund would LOSE this item**, which happens because
   * GROWTH is stricter on profit and per-item share. Surprising enough that
   * hiding it would be a small lie by omission.
   */
  readonly lostAboveCents: Cents | null;
}

/**
 * ⛔ Takes the evaluator as a parameter rather than importing a store. This file
 * asks a hypothetical question — *what if the fund were bigger* — and must not
 * be able to reach the real one.
 */
export function assessUnlock(
  input: OpportunityInput,
  evaluateAtNav: (navCents: Cents) => Evaluation,
  currentNavCents: Cents,
): UnlockAssessment {
  const buyableAt = new Map<Cents, boolean>();
  for (const nav of SCAN_NAVS_CENTS) {
    buyableAt.set(nav, evaluateAtNav(nav).result.recommendation === 'BUY');
  }

  const buyableNow = evaluateAtNav(currentNavCents).result.recommendation === 'BUY';

  // Where does it stop working, if it ever does? Read from the current bankroll
  // upward — a reversal below where the fund already is tells the operator
  // nothing they can act on.
  let lostAboveCents: Cents | null = null;
  const above = SCAN_NAVS_CENTS.filter((n) => n >= currentNavCents);
  for (let i = 1; i < above.length; i += 1) {
    if (buyableAt.get(above[i - 1] as Cents) === true && buyableAt.get(above[i] as Cents) === false) {
      lostAboveCents = above[i] as Cents;
      break;
    }
  }

  if (buyableNow) return { unlock: { kind: 'NOW' }, lostAboveCents };

  const next = SCAN_NAVS_CENTS.find((n) => n > currentNavCents && buyableAt.get(n) === true);
  if (next !== undefined) {
    return { unlock: { kind: 'AT_NAV', navCents: next }, lostAboveCents };
  }

  // ⚠️ "Never" means never IN THE SCANNED RANGE, and the range tops out at
  // $50,000 of NAV. The wording downstream must not promise more than that.
  const evaluation = evaluateAtNav(SCAN_NAVS_CENTS[SCAN_NAVS_CENTS.length - 1] as Cents);
  const because = evaluation.gates.failures.map((f) => f.code);
  return { unlock: { kind: 'NEVER', because }, lostAboveCents };
}

/** ⛔ Only AT_NAV is worth keeping. NOW is a decision and NEVER is a closed one. */
export function worthWatching(assessment: UnlockAssessment): boolean {
  return assessment.unlock.kind === 'AT_NAV';
}
