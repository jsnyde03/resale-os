/**
 * Not yet, or never?
 *
 * ⛔ The premise this replaced: *"a refused item is waiting for the bankroll."*
 * Measured, and mostly false — hold time, margin and sell-through do not care
 * how rich the fund is. These assert both halves, because a view that only ever
 * said "wait" would be wrong about most of what an operator picks up.
 */

import { describe, expect, it } from 'vitest';
import { assessUnlock, fundAtNav, worthWatching, SCAN_NAVS_CENTS } from '@/screens/unlock.js';
import { computeMetrics } from '@/core/capital/metrics.js';
import { evaluateOpportunity } from '@/scoring/evaluate.js';
import { parseOpportunity } from '@/domain/opportunity.js';
import { DEFAULT_POLICY } from '@/core/capital/policy.js';
import { Fund, WITH_JOB } from './helpers.js';

const opp = (o: { price: number; gross: number; sold: number; active: number }) =>
  parseOpportunity({
    opportunityId: 'u',
    name: 'u',
    category: 'TOYS',
    askingPriceCents: o.price,
    expectedGrossCents: o.gross,
    soldLast90Days: o.sold,
    activeListings: o.active,
  });

const at = (input: ReturnType<typeof opp>) => (navCents: number) =>
  evaluateOpportunity(input, Fund.withBankroll(navCents, DEFAULT_POLICY, WITH_JOB).state);

const assess = (o: Parameters<typeof opp>[0], navCents: number) => {
  const input = opp(o);
  return assessUnlock(input, at(input), navCents);
};

const GOOD_VELOCITY = { sold: 40, active: 3 };

describe('not yet', () => {
  it('names the bankroll a too-expensive item becomes buyable at', () => {
    const a = assess({ price: 3_000, gross: 12_000, ...GOOD_VELOCITY }, 5_000);
    expect(a.unlock.kind).toBe('AT_NAV');
    if (a.unlock.kind === 'AT_NAV') {
      expect(a.unlock.navCents).toBeGreaterThan(5_000);
      // And the answer must be real: it genuinely passes there.
      expect(at(opp({ price: 3_000, gross: 12_000, ...GOOD_VELOCITY }))(a.unlock.navCents).result.recommendation).toBe('BUY');
    }
  });

  it('is the only kind worth keeping on a list', () => {
    expect(worthWatching(assess({ price: 3_000, gross: 12_000, ...GOOD_VELOCITY }, 5_000))).toBe(true);
    expect(worthWatching(assess({ price: 1_200, gross: 6_000, ...GOOD_VELOCITY }, 5_000))).toBe(false);
    expect(worthWatching(assess({ price: 1_200, gross: 6_000, sold: 2, active: 30 }, 5_000))).toBe(false);
  });
});

describe('never', () => {
  it('says so for a slow mover, at any bankroll in range', () => {
    // ⚡ The answer the original framing had no room for. 90 x 31 / 2 = 1395 days.
    const a = assess({ price: 1_200, gross: 6_000, sold: 2, active: 30 }, 5_000);
    expect(a.unlock.kind).toBe('NEVER');
    if (a.unlock.kind === 'NEVER') expect(a.unlock.because).toContain('HOLD_TOO_LONG');
  });

  it('says so for a thin margin, which no bankroll fixes', () => {
    const a = assess({ price: 1_200, gross: 1_500, ...GOOD_VELOCITY }, 5_000);
    expect(a.unlock.kind).toBe('NEVER');
  });

  it('is reached by SCANNING, so a non-monotonic answer cannot fool it', () => {
    // A bisection would sample the middle, see a pass, and report a threshold
    // that is wrong on both sides.
    expect(SCAN_NAVS_CENTS.length).toBeGreaterThan(15);
    expect([...SCAN_NAVS_CENTS].sort((x, y) => x - y)).toEqual([...SCAN_NAVS_CENTS]);
    // Dense around the mode switch, which is the one place it reverses.
    expect(SCAN_NAVS_CENTS).toContain(49_000);
    expect(SCAN_NAVS_CENTS).toContain(50_000);
    expect(SCAN_NAVS_CENTS).toContain(51_000);
  });
});

describe('lost by growing', () => {
  it('⚠️ reports an item that stops being buyable as the fund grows', () => {
    // ⛔ Measured, not invented: $12 -> $30 is a BUY at $490 and REFUSED at $500,
    // because GROWTH lifts the minimum profit from $8 to $15. Growing the fund
    // can take a buy away, and hiding that would be a lie by omission.
    const a = assess({ price: 1_200, gross: 3_000, ...GOOD_VELOCITY }, 45_000);
    expect(a.unlock.kind).toBe('NOW');
    expect(a.lostAboveCents).toBe(50_000);
  });

  it('does not cry wolf on an item that keeps working', () => {
    const a = assess({ price: 3_000, gross: 12_000, ...GOOD_VELOCITY }, 45_000);
    expect(a.unlock.kind).toBe('NOW');
    expect(a.lostAboveCents).toBeNull();
  });
});

describe('the hypothetical fund', () => {
  const real = () => Fund.withBankroll(5_000, DEFAULT_POLICY, WITH_JOB).state;

  it('actually moves NAV, which a type cast will happily pretend', () => {
    // ⛔ The first version spread `{ ...state, hypotheticalNavCents }` and cast
    // it to FundState. It TYPECHECKED, and every hypothetical silently evaluated
    // at the real bankroll — the scan would have returned one answer repeated
    // twenty times. NAV is DERIVED, so a hypothesis has to move a balance.
    for (const target of [5_000, 25_000, 50_000, 100_000]) {
      expect(computeMetrics(fundAtNav(real(), target)).navCents).toBe(target);
    }
  });

  it('flips the mode at the promotion threshold', () => {
    const promote = DEFAULT_POLICY.thresholds.promoteAtCents;
    expect(computeMetrics(fundAtNav(real(), promote - 1)).mode).toBe('BOOTSTRAP');
    expect(computeMetrics(fundAtNav(real(), promote)).mode).toBe('GROWTH');
  });

  it('shows the pinch that makes the answer non-monotonic', () => {
    // ⚡ $250 in BOOTSTRAP and $500 in GROWTH cap a single item at the SAME
    // $100 — 40% of the smaller fund, 20% of the larger. Doubling the bankroll
    // buys no extra room, while GROWTH's profit floor nearly doubles.
    expect(computeMetrics(fundAtNav(real(), 25_000)).maxCapitalPerItemCents).toBe(10_000);
    expect(computeMetrics(fundAtNav(real(), 50_000)).maxCapitalPerItemCents).toBe(10_000);
    expect(DEFAULT_POLICY.modes.GROWTH.minExpectedProfitCents).toBeGreaterThan(
      DEFAULT_POLICY.modes.BOOTSTRAP.minExpectedProfitCents,
    );
  });

  it('leaves everything else about the fund alone', () => {
    const s0 = real();
    const s1 = fundAtNav(s0, 100_000);
    expect(s1.items).toBe(s0.items);
    expect(s1.policy).toBe(s0.policy);
    expect(s1.taxProfile).toBe(s0.taxProfile);
    expect(s1.eventCount).toBe(s0.eventCount);
  });
});

describe('B77 — a measurement problem is NEVER, not not-yet', () => {
  it('⛔ no bankroll fixes a floored count, so it is a closed answer', () => {
    // ⚡ The composition worth asserting: `VELOCITY_COUNTS_UNBOUNDED` does not
    // read the fund, so it fails identically at every NAV in the scan. That
    // makes a floored item a NEVER — which is the right answer and the useful
    // one, but only because the gate is NAV-independent. If it ever starts
    // reading the fund, this test is what notices.
    const input = parseOpportunity({
      opportunityId: 'u',
      name: 'u',
      category: 'TOYS',
      askingPriceCents: 1_000,
      expectedGrossCents: 4_000,
      soldLast90Days: 40,
      activeListings: 3,
      activeListingsIsFloor: true,
    });
    const a = assessUnlock(input, at(input), 5_000);
    expect(a.unlock.kind).toBe('NEVER');
    // ⛔ And it must not sit on the watchlist waiting for a day that cannot come.
    expect(worthWatching(a)).toBe(false);
  });

  it('the same item with exact counts is buyable now', () => {
    // The control. Without it the test above passes for any reason at all.
    const a = assess({ price: 1_000, gross: 4_000, sold: 40, active: 3 }, 5_000);
    expect(a.unlock.kind).toBe('NOW');
  });
});
