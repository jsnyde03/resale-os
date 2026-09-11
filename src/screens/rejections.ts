/**
 * *Why is nothing passing?* — answered from the record instead of a hunch.
 *
 * ⛔ **Backlog B3, and it could not be built until 6.0.3.** The histogram counts
 * refusals, and nothing recorded a refusal until checking an item started saving
 * it. A walk-away is most of what an operator does in a day; until it was
 * written down, the question had no data behind it at all.
 *
 * ⚡ **The prediction was that `HOLD_TOO_LONG` dominates, and the first measured
 * case says something more useful:** six slow candidates failed hold time,
 * confidence, sell-through AND buy score — every one of them, all four tied. A
 * genuinely bad candidate is not bad in one way. That is why the headline
 * reports a tie as a tie instead of naming the alphabetically-first gate.
 *
 * Pure. It shapes a count into something a person can act on, and refuses to
 * conclude from too few.
 */

import type { Bps } from '../core/money.js';
import type { RejectionHistogram } from '../db/repositories/opportunities.js';

/**
 * ⚠️ **Below this, say so instead of concluding.** Four refusals is noise, and a
 * bar chart over noise is a confident picture of nothing. The accuracy report
 * refuses a trend under five sales for the same reason; this matches it rather
 * than inventing a second convention.
 */
export const MIN_FOR_A_CONCLUSION = 5;

/** What each gate means, for someone standing in a shop rather than reading code. */
const WORDING: Readonly<Record<string, string>> = {
  HOLD_TOO_LONG: 'takes too long to sell',
  LONG_HOLD_ALLOCATION_EXCEEDED: 'too much money in slow items',
  MAX_PER_ITEM_EXCEEDED: 'too much of the fund in one item',
  INSUFFICIENT_DEPLOYABLE_CAPITAL: 'not enough deployable cash',
  RESERVE_FLOOR_BREACH: 'would break the liquid floor',
  MAX_DEPLOYED_EXCEEDED: 'too much of the fund deployed',
  CATEGORY_CONCENTRATION: 'too much already in this category',
  DOWNSIDE_TOO_LARGE: 'the downside is too big',
  PROFIT_BELOW_MIN: 'not enough profit',
  ROI_BELOW_MIN: 'the return is too thin',
  CONFIDENCE_TOO_LOW: 'not enough evidence',
  SELL_THROUGH_TOO_LOW: 'too few sell',
  VELOCITY_COUNTS_UNBOUNDED: 'the market counts were not exact',
  BUY_SCORE_TOO_LOW: 'scores too low overall',
  RISK_SCORE_TOO_HIGH: 'too risky',
};

export interface RejectionRow {
  readonly code: string;
  readonly wording: string;
  readonly n: number;
  /** Share of all refusals this gate accounts for. Gates overlap, so these sum past 100%. */
  readonly shareBps: Bps;
}

export interface RejectionsView {
  readonly rows: readonly RejectionRow[];
  readonly rejectedRows: number;
  /**
   * ⛔ **False when refusals exist that yielded no code.** An empty chart and a
   * broken reader draw the same picture, and only this tells them apart.
   */
  readonly readable: boolean;
  readonly unreadableRows: number;
  /** Whether there is enough on record to believe the shape of it. */
  readonly conclusive: boolean;
  /**
   * ⛔ **True when these refusals were scored under more than one rule set.**
   *
   * The codes record what the rules said THEN, so a chart summing across rule
   * sets under-counts whichever gate is newest — and this chart is how the fund
   * answers *"why is nothing passing?"*. ⚠️ It is not a reason to hide the
   * chart; it is a reason to say so on it. **B88**.
   */
  readonly mixedRuleSets: boolean;
  /** The one line worth reading. */
  readonly headline: string;
}

export function rejectionsView(histogram: RejectionHistogram): RejectionsView {
  const { codes, rejectedRows, unreadableRows } = histogram;
  const mixedRuleSets = histogram.ruleSets > 1;

  const rows: RejectionRow[] = codes.map((c) => ({
    code: c.code,
    wording: WORDING[c.code] ?? c.code,
    n: c.n,
    // Integer basis points, and never a division by zero.
    shareBps: rejectedRows > 0 ? Math.round((c.n * 10_000) / rejectedRows) : 0,
  }));

  const readable = unreadableRows === 0;
  const conclusive = rejectedRows >= MIN_FOR_A_CONCLUSION && rows.length > 0;

  return {
    rows,
    rejectedRows,
    readable,
    unreadableRows,
    conclusive,
    mixedRuleSets,
    headline: headlineFor(rows, rejectedRows, unreadableRows, conclusive, mixedRuleSets),
  };
}

function headlineFor(
  rows: readonly RejectionRow[],
  rejectedRows: number,
  unreadableRows: number,
  conclusive: boolean,
  mixedRuleSets: boolean,
): string {
  // ⛔ The broken case first. It must never be reported as "nothing is refused".
  if (unreadableRows > 0 && rows.length === 0) {
    return `${rejectedRows} refusals on record and none could be read — this is a bug, not a clean run.`;
  }
  if (rejectedRows === 0) return 'Nothing has been refused yet.';
  if (!conclusive) {
    return `${rejectedRows} refusal${rejectedRows === 1 ? '' : 's'} so far — too few to call it a pattern.`;
  }
  // ⛔ **A TIE MUST NOT BE REPORTED AS A WINNER.**
  //
  // Gates overlap, and a genuinely bad candidate fails several at once — six
  // slow items failed hold, confidence, sell-through and buy score, every one of
  // them, so all four counted six. Sorting then broke the tie ALPHABETICALLY and
  // the headline read "scores too low overall", which is true, useless, and hid
  // the one dial that moves: hold time.
  //
  // Found by an on-device case failing, not by reading the code.
  const top = rows[0] as RejectionRow;
  const tied = rows.filter((r) => r.n === top.n);
  if (tied.length > 1) {
    const list = tied.map((r) => r.wording).join(', ');
    return `All ${top.n} of ${rejectedRows} refusals failed the same ${tied.length} rules: ${list}.`;
  }
  return `${sentence(top, rejectedRows)}${mixed(mixedRuleSets)}`;
}

const sentence = (top: RejectionRow, rejectedRows: number): string =>
  `Most of what you look at ${top.wording} — ${top.n} of ${rejectedRows} refusals.`;

/**
 * ⛔ **Said on the chart, not hidden from it.** The codes record what the rules
 * said THEN, so counting across rule sets under-counts the newest gate. The
 * honest move is to keep showing the shape and warn that it is mixed — a chart
 * withheld teaches nothing, and a chart that quietly averages two rule sets
 * teaches the wrong thing. **B88**.
 */
const mixed = (mixedRuleSets: boolean): string =>
  mixedRuleSets ? ' ⚠️ Scored under more than one rule set — the counts mix them.' : '';
