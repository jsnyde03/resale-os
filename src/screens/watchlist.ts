/**
 * The refusals that expire.
 *
 * ⛔ **Only one of the three answers belongs on a list.** A candidate that is
 * buyable NOW is a decision, not a note; one that is NEVER buyable is a closed
 * decision and keeping it would grow a list of things to keep re-reading. What
 * is left — *not yet, at $150* — is the only kind worth carrying, and the
 * before-scan found it is the minority.
 *
 * ⚠️ **This RECOMPUTES, and says so.** The rule elsewhere is that the feed
 * reports stored verdicts and never re-runs today's policy over an old row,
 * because that shows a score which was never the reason for any decision. This
 * asks a *different* question — **at what bankroll would this clear under the
 * rules as they stand now** — which is only answerable forward. The stored
 * verdict is left exactly as it was, and a row scored under older rules is
 * flagged rather than quietly re-judged.
 */

import { formatCents, type Cents } from '../core/money.js';
import type { FundState } from '../core/capital/state.js';
import type { Evaluation } from '../scoring/evaluate.js';
import type { OpportunityInput } from '../domain/opportunity.js';
import { assessUnlock, fundAtNav, worthWatching } from './unlock.js';

export interface WatchRow {
  readonly opportunityId: string;
  readonly name: string;
  readonly askingPriceCents: Cents;
  /** The bankroll at which it becomes a buy, under today's rules. */
  readonly unlocksAtCents: Cents;
  /** How much more NAV is needed. Never negative. */
  readonly shortfallCents: Cents;
  /**
   * ⚠️ True when the row was scored under a different policy version. Its stored
   * verdict is not what today's rules would say, and this is the one thing that
   * can tell a reader so.
   */
  readonly stale: boolean;
}

export interface Watchlist {
  readonly rows: readonly WatchRow[];
  /** Everything considered, so an empty list is distinguishable from an empty table. */
  readonly considered: number;
  /** Refusals that no bankroll fixes. Counted, never listed. */
  readonly closed: number;
  readonly navCents: Cents;
  readonly headline: string;
}

export interface WatchCandidate {
  readonly opportunityId: string;
  readonly input: OpportunityInput;
  readonly policyVersion: string | null;
}

/**
 * ⛔ The evaluator is injected, so this cannot reach a store — it asks about
 * hypothetical bankrolls and must not be able to touch the real one except
 * through the state it was handed.
 */
export function watchlist(
  candidates: readonly WatchCandidate[],
  state: FundState,
  navCents: Cents,
  evaluate: (input: OpportunityInput, at: FundState) => Evaluation,
): Watchlist {
  const rows: WatchRow[] = [];
  let closed = 0;

  for (const c of candidates) {
    const assessment = assessUnlock(
      c.input,
      (nav) => evaluate(c.input, fundAtNav(state, nav)),
      navCents,
    );
    if (!worthWatching(assessment)) {
      if (assessment.unlock.kind === 'NEVER') closed += 1;
      continue;
    }
    if (assessment.unlock.kind !== 'AT_NAV') continue;

    rows.push({
      opportunityId: c.opportunityId,
      name: c.input.name,
      askingPriceCents: c.input.askingPriceCents,
      unlocksAtCents: assessment.unlock.navCents,
      shortfallCents: Math.max(0, assessment.unlock.navCents - navCents),
      stale: c.policyVersion !== null && c.policyVersion !== state.policy.version,
    });
  }

  // Nearest first: the next thing that becomes possible is the useful one.
  rows.sort((a, b) => a.unlocksAtCents - b.unlocksAtCents || a.name.localeCompare(b.name));

  return { rows, considered: candidates.length, closed, navCents, headline: headlineFor(rows, candidates.length, closed) };
}

function headlineFor(rows: readonly WatchRow[], considered: number, closed: number): string {
  if (considered === 0) return 'Nothing scored yet.';
  if (rows.length === 0) {
    // ⚡ Not an empty list — a definite answer, and the common one.
    return closed === considered
      ? `None of the ${considered} you passed on would clear at any bankroll.`
      : 'Nothing is waiting on the bankroll.';
  }
  const next = rows[0] as WatchRow;
  return `${rows.length} waiting. The next clears at ${formatCents(next.unlocksAtCents)}.`;
}
