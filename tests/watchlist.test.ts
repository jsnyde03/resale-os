/**
 * The refusals that expire.
 *
 * ⛔ The claim that shapes the whole screen: **only "not yet" belongs on a
 * list.** A buyable item is a decision, a never-buyable one is a closed
 * decision, and the before-scan found the closed ones are the majority. A
 * watchlist that kept everything would be a list of things to re-read forever.
 */

import { describe, expect, it } from 'vitest';
import { watchlist, type WatchCandidate } from '@/screens/watchlist.js';
import { evaluateOpportunity } from '@/scoring/evaluate.js';
import { parseOpportunity } from '@/domain/opportunity.js';
import { DEFAULT_POLICY } from '@/core/capital/policy.js';
import { computeMetrics } from '@/core/capital/metrics.js';
import { Fund, WITH_JOB } from './helpers.js';

const state = () => Fund.withBankroll(5_000, DEFAULT_POLICY, WITH_JOB).state;

const cand = (
  id: string,
  o: { price: number; gross: number; sold: number; active: number },
  policyVersion: string | null = DEFAULT_POLICY.version,
): WatchCandidate => ({
  opportunityId: id,
  policyVersion,
  input: parseOpportunity({
    opportunityId: id,
    name: id,
    category: 'TOYS',
    askingPriceCents: o.price,
    expectedGrossCents: o.gross,
    soldLast90Days: o.sold,
    activeListings: o.active,
  }),
});

const FAST = { sold: 40, active: 3 };
const run = (candidates: readonly WatchCandidate[]) => {
  const s = state();
  return watchlist(candidates, s, computeMetrics(s).navCents, evaluateOpportunity);
};

describe('what earns a place on the list', () => {
  it('keeps the not-yet, drops the never, and counts what it dropped', () => {
    const v = run([
      cand('dear', { price: 3_000, gross: 12_000, ...FAST }),
      cand('slow', { price: 1_200, gross: 6_000, sold: 2, active: 30 }),
      cand('thin', { price: 1_200, gross: 1_500, ...FAST }),
    ]);
    expect(v.rows.map((r) => r.name)).toEqual(['dear']);
    expect(v.considered).toBe(3);
    // ⛔ Counted, never listed. A closed decision must not come back as a chore.
    expect(v.closed).toBe(2);
  });

  it('drops an item that is buyable right now — that is a decision, not a note', () => {
    const v = run([cand('buyable', { price: 1_200, gross: 6_000, ...FAST })]);
    expect(v.rows).toEqual([]);
    expect(v.closed).toBe(0);
  });

  it('orders by what becomes possible soonest', () => {
    const v = run([
      cand('far', { price: 9_000, gross: 36_000, ...FAST }),
      cand('near', { price: 2_200, gross: 8_800, ...FAST }),
    ]);
    expect(v.rows.map((r) => r.name)).toEqual(['near', 'far']);
    expect(v.rows[0]!.unlocksAtCents).toBeLessThan(v.rows[1]!.unlocksAtCents);
  });

  it('says how much more bankroll is needed, never a negative', () => {
    const v = run([cand('dear', { price: 3_000, gross: 12_000, ...FAST })]);
    const row = v.rows[0]!;
    expect(row.shortfallCents).toBe(row.unlocksAtCents - v.navCents);
    expect(row.shortfallCents).toBeGreaterThan(0);
  });
});

describe('being honest about what it recomputed', () => {
  it('flags a row scored under different rules', () => {
    // ⚠️ The stored verdict is not what today's rules would say. Elsewhere the
    // project refuses to re-run policy over an old row; this asks a different,
    // forward question — so it answers, and marks the row.
    const v = run([cand('old', { price: 3_000, gross: 12_000, ...FAST }, 'some-older-version')]);
    expect(v.rows[0]!.stale).toBe(true);
  });

  it('does not flag a row scored under the current rules', () => {
    const v = run([cand('current', { price: 3_000, gross: 12_000, ...FAST })]);
    expect(v.rows[0]!.stale).toBe(false);
  });
});

describe('an empty list is not one message', () => {
  it('distinguishes "nothing scored" from "nothing waiting" from "all closed"', () => {
    expect(run([]).headline).toBe('Nothing scored yet.');

    const allClosed = run([cand('slow', { price: 1_200, gross: 6_000, sold: 2, active: 30 })]);
    expect(allClosed.headline).toContain('would clear at any bankroll');

    const nothingWaiting = run([cand('buyable', { price: 1_200, gross: 6_000, ...FAST })]);
    expect(nothingWaiting.headline).toBe('Nothing is waiting on the bankroll.');
  });

  it('names the next threshold when something is waiting', () => {
    const v = run([cand('dear', { price: 3_000, gross: 12_000, ...FAST })]);
    expect(v.headline).toContain('1 waiting');
    expect(v.headline).toMatch(/clears at \$/);
  });
});
