/**
 * The instrument for "why is nothing passing?" (B3).
 *
 * ⛔ Two claims matter more than the arithmetic. **A broken reader must never
 * look like a clean run** — an empty chart is drawn by both. And **too few
 * refusals must not be presented as a pattern**, because a bar chart over four
 * decisions is a confident picture of noise.
 */

import { describe, expect, it } from 'vitest';
import { MIN_FOR_A_CONCLUSION, rejectionsView } from '@/screens/rejections.js';
import type { RejectionHistogram } from '@/db/repositories/opportunities.js';
import { CONSTRAINT_CODES } from '@/core/capital/constraints.js';

const hist = (
  codes: [string, number][],
  rejectedRows: number,
  unreadableRows = 0,
  // ⚠️ One rule set by default, so the helper keeps meaning "a clean record".
  // A test about mixing passes something else.
  ruleSets = 1,
): RejectionHistogram => ({
  codes: codes.map(([code, n]) => ({ code, n })),
  rejectedRows,
  unreadableRows,
  ruleSets,
});

describe('what the record says is stopping you', () => {
  it('names the gate that refuses most, in words', () => {
    const v = rejectionsView(hist([['HOLD_TOO_LONG', 8], ['CONFIDENCE_TOO_LOW', 3]], 10));
    expect(v.conclusive).toBe(true);
    expect(v.rows[0]!.code).toBe('HOLD_TOO_LONG');
    expect(v.rows[0]!.wording).toBe('takes too long to sell');
    expect(v.headline).toContain('takes too long to sell');
    expect(v.headline).toContain('8 of 10');
  });

  it('refuses to call a pattern from too few', () => {
    const few = MIN_FOR_A_CONCLUSION - 1;
    const v = rejectionsView(hist([['HOLD_TOO_LONG', few]], few));
    expect(v.conclusive).toBe(false);
    expect(v.headline).toContain('too few');
    // The rows still exist — it declines to CONCLUDE, it does not hide the data.
    expect(v.rows).toHaveLength(1);
  });

  it('says nothing has been refused, when nothing has', () => {
    const v = rejectionsView(hist([], 0));
    expect(v.headline).toBe('Nothing has been refused yet.');
    expect(v.readable).toBe(true);
    expect(v.conclusive).toBe(false);
  });

  it('⛔ calls an unreadable record a BUG, not a clean run', () => {
    // The case the denominator exists for. Before it, this drew the same empty
    // chart as "nothing was refused" — and the histogram used to regex-parse
    // prose, so a reworded reason would have produced exactly this in silence.
    const v = rejectionsView(hist([], 7, 7));
    expect(v.readable).toBe(false);
    expect(v.headline).toContain('none could be read');
    expect(v.headline).toContain('bug');
    expect(v.headline).not.toContain('Nothing has been refused');
  });

  it('⛔ reports a TIE as a tie, instead of naming an alphabetical winner', () => {
    // Gates overlap, and a genuinely bad candidate fails several at once. Six
    // slow items failed hold, confidence, sell-through and buy score — all four
    // counted six, and sorting broke the tie alphabetically, so the headline
    // read "scores too low overall": true, useless, and it hid the one dial
    // that moves. Found by an on-device case failing.
    const v = rejectionsView(
      hist([['BUY_SCORE_TOO_LOW', 6], ['CONFIDENCE_TOO_LOW', 6], ['HOLD_TOO_LONG', 6]], 6),
    );
    expect(v.headline).toContain('the same 3 rules');
    expect(v.headline).toContain('takes too long to sell');
    expect(v.headline).not.toMatch(/^Most of what you look at/);
  });

  it('still names a clear leader when there is one', () => {
    const v = rejectionsView(hist([['HOLD_TOO_LONG', 9], ['CONFIDENCE_TOO_LOW', 2]], 10));
    expect(v.headline).toMatch(/^Most of what you look at/);
    expect(v.headline).toContain('9 of 10');
  });

  it('shares are integer basis points and never divide by zero', () => {
    expect(rejectionsView(hist([['HOLD_TOO_LONG', 3]], 10)).rows[0]!.shareBps).toBe(3_000);
    expect(rejectionsView(hist([['HOLD_TOO_LONG', 1]], 0)).rows[0]!.shareBps).toBe(0);
  });

  it('does not pretend the shares sum to a whole', () => {
    // ⚠️ One refusal can fail several gates at once, so shares legitimately sum
    // past 100%. A view that normalised them would be inventing a denominator.
    const v = rejectionsView(hist([['HOLD_TOO_LONG', 5], ['MAX_PER_ITEM_EXCEEDED', 5]], 5));
    expect(v.rows.reduce((t, r) => t + r.shareBps, 0)).toBe(20_000);
  });

  it('gives every constraint code a wording, not a raw identifier', () => {
    // A screen showing SELL_THROUGH_TOO_LOW to a person in a shop has failed.
    const v = rejectionsView(hist(CONSTRAINT_CODES.map((c) => [c, 1] as [string, number]), 14));
    for (const row of v.rows) expect(row.wording).not.toBe(row.code);
  });
});

describe('B88 — the chart says when it is mixing rule sets', () => {
  it('⛔ warns on the headline rather than hiding the chart', () => {
    // The codes record what the rules said THEN, so counting across rule sets
    // under-counts the newest gate. A chart withheld teaches nothing; a chart
    // that quietly averages two rule sets teaches the wrong thing.
    const v = rejectionsView(hist([['HOLD_TOO_LONG', 6]], 6, 0, 2));
    expect(v.mixedRuleSets).toBe(true);
    expect(v.headline).toContain('more than one rule set');
    // ⚠️ And the shape is still there to read.
    expect(v.rows[0]?.n).toBe(6);
    expect(v.conclusive).toBe(true);
  });

  it('and the control — a single rule set says nothing about mixing', () => {
    // Without this the assertion above passes for a view that warns always,
    // which would make the warning invisible.
    const v = rejectionsView(hist([['HOLD_TOO_LONG', 6]], 6, 0, 1));
    expect(v.mixedRuleSets).toBe(false);
    expect(v.headline).not.toContain('rule set');
  });

  it('⚠️ a mix is reported even when there is too little to conclude', () => {
    // The two are independent: "too few to call it a pattern" and "these came
    // from different rules" are different problems, and the second does not
    // stop mattering because the first is true.
    const v = rejectionsView(hist([['HOLD_TOO_LONG', 2]], 2, 0, 3));
    expect(v.conclusive).toBe(false);
    expect(v.mixedRuleSets).toBe(true);
  });
});
