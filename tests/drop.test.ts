/**
 * A dated drop.
 *
 * ⛔ The claims worth pinning are about HONESTY, not arithmetic: an analogy
 * cannot score like a measurement, "nothing to compare this to" is not the same
 * as "refused", and a shortfall with a deadline is a different answer from a
 * shortfall without one.
 */

import { describe, expect, it } from 'vitest';
import {
  dropIdFrom,
  dropReadiness,
  dropShortfall,
  dropTiming,
  evidenceFromMarket,
  IMMINENT_DAYS,
  type Drop,
} from '@/core/drop.js';
import { compConfidence, ANALOGOUS_EVIDENCE_CEILING_BPS } from '@/scoring/confidence.js';

const NOW = new Date('2026-09-11T12:00:00.000Z');

const drop = (over: Partial<Drop> = {}): Drop => ({
  dropId: 'd1',
  name: 'LEGO UCS Something 2026',
  retailer: 'LEGO Store',
  dropDate: '2026-10-01',
  msrpCents: 24_999,
  comparable: { keyword: 'lego ucs something 2025', why: "last year's UCS set, same piece count" },
  ...over,
});

describe('⛔ an analogy is capped, because comps measure precision not accuracy', () => {
  const tight = { pricesCents: [11_900, 12_000, 12_100, 12_000, 11_950, 12_050, 12_000, 12_010], medianAgeDays: 5 };

  it('scores excellent comps excellently when they are about THIS product', () => {
    const c = compConfidence(tight);
    expect(c.confidenceBps).toBeGreaterThan(ANALOGOUS_EVIDENCE_CEILING_BPS);
    expect(c.analogous).toBe(false);
  });

  it('⛔ caps the SAME comps once they are declared an analogy', () => {
    // A tight, plentiful, recent set for last year's model scores near the top
    // while describing a product nobody is buying. That is the whole hazard.
    const c = compConfidence({ ...tight, analogous: true });
    expect(c.confidenceBps).toBe(ANALOGOUS_EVIDENCE_CEILING_BPS);
    expect(c.analogous).toBe(true);
  });

  it('⚠️ does not punish a WEAK predecessor twice', () => {
    // Two comps, wildly apart, already score badly. The cap says "not about
    // this product"; it must not also re-apply a penalty already paid.
    const weak = { pricesCents: [4_000, 20_000], medianAgeDays: 80 };
    expect(compConfidence({ ...weak, analogous: true }).confidenceBps).toBe(
      compConfidence(weak).confidenceBps,
    );
  });

  it('and the ceiling sits above "no comps at all"', () => {
    // An analogy really is better evidence than nothing, or nobody would use one.
    expect(ANALOGOUS_EVIDENCE_CEILING_BPS).toBeGreaterThan(compConfidence(null).confidenceBps);
  });
});

describe('a drop is dated, and that changes the questions', () => {
  it('⛔ counts CALENDAR days — a drop happening today is not passed', () => {
    // Diffing a date against a moment made today read as -1. The worst day to
    // get wrong is the day it happens.
    expect(dropTiming(drop({ dropDate: '2026-10-01' }), NOW).daysAway).toBe(20);
    expect(dropTiming(drop({ dropDate: '2026-09-11' }), NOW).daysAway).toBe(0);
    expect(dropTiming(drop({ dropDate: '2026-09-11' }), NOW).passed).toBe(false);
    expect(dropTiming(drop({ dropDate: '2026-09-10' }), NOW).passed).toBe(true);
  });

  it('and holds at either end of the day it happens', () => {
    // ⚠️ The control for the fix: normalising to UTC midnight must work from
    // the first minute of the day to the last, not just at noon.
    for (const t of ['2026-09-11T00:00:00.000Z', '2026-09-11T23:59:59.000Z']) {
      const timing = dropTiming(drop({ dropDate: '2026-09-11' }), new Date(t));
      expect(timing.daysAway, t).toBe(0);
      expect(timing.passed, t).toBe(false);
    }
  });

  it(`treats anything inside ${IMMINENT_DAYS} days as too close to grow into`, () => {
    expect(dropTiming(drop({ dropDate: '2026-09-15' }), NOW).imminent).toBe(true);
    expect(dropTiming(drop({ dropDate: '2026-10-01' }), NOW).imminent).toBe(false);
  });

  it('⛔ refuses a date it cannot read rather than guessing at one', () => {
    expect(() => dropTiming(drop({ dropDate: 'next Tuesday' }), NOW)).toThrow(/unparseable/);
  });
});

describe('⛔ "nothing to compare this to" is not a refusal', () => {
  it('reports NO_COMPARABLE separately from a verdict', () => {
    expect(dropReadiness(drop({ comparable: null }), NOW)).toBe('NO_COMPARABLE');
  });

  it('reports a passed drop as history, never as judged', () => {
    expect(dropReadiness(drop({ dropDate: '2026-09-01' }), NOW)).toBe('PASSED');
  });

  it('and the control — a dated drop with a comparable is READY', () => {
    expect(dropReadiness(drop(), NOW)).toBe('READY');
  });
});

describe('a shortfall with a deadline', () => {
  const far = dropTiming(drop({ dropDate: '2026-10-01' }), NOW);
  const soon = dropTiming(drop({ dropDate: '2026-09-14' }), NOW);

  it('says how much is missing and how long there is to find it', () => {
    const s = dropShortfall(20_000, 7_500, far);
    expect(s.shortfallCents).toBe(12_500);
    expect(s.daysToFindIt).toBe(20);
    expect(s.reachable).toBe(true);
  });

  it('⚠️ is NOT reachable when the date is too close to grow into it', () => {
    expect(dropShortfall(20_000, 7_500, soon).reachable).toBe(false);
  });

  it('is trivially reachable when the fund can already afford it', () => {
    // Even an imminent drop, if there is no shortfall to close.
    const s = dropShortfall(5_000, 7_500, soon);
    expect(s.shortfallCents).toBe(0);
    expect(s.reachable).toBe(true);
  });
});

describe('⛔ a drop id is deterministic, so re-entering one is idempotent', () => {
  it('is the same id for the same product on the same date', () => {
    // ⚡ This is what will stop D19's feed from duplicating what the operator
    // already typed by hand.
    expect(dropIdFrom('LEGO UCS Millennium Falcon 2026', '2026-10-01')).toBe(
      dropIdFrom('lego ucs millennium falcon 2026', '2026-10-01'),
    );
  });

  it('⚠️ and a DIFFERENT id when the date moves, because that is a different drop', () => {
    expect(dropIdFrom('Same Thing', '2026-10-01')).not.toBe(dropIdFrom('Same Thing', '2026-11-01'));
  });

  it('never produces an empty id, whatever it is handed', () => {
    expect(dropIdFrom('!!!', '2026-10-01')).toBe('drop-2026-10-01');
  });
});

describe("the comparable's market becomes evidence about the drop", () => {
  const reading = {
    sold90: { value: 90, isFloor: false },
    active: { value: 240_000, isFloor: true },
    compPricesCents: [5_900, 6_000],
    compMedianAgeDays: 20,
    provenance: {
      keyword: 'lego ucs 75192',
      compCondition: 'new' as const,
      categoryId: '183447',
      categoryName: 'LEGO (R) Building Toys',
      soldItemsSeen: 40,
      activeItemsSeen: 200,
      soldAfter: '2026-06-13',
      fetchedAt: '2026-09-11T12:00:00.000Z',
    },
    quota: { monthlyLimit: 100, monthlyRemaining: 86, resetAt: null },
  };

  it('⛔ carries the FLOOR across, in both directions', () => {
    // `90 x (active + 1)/sold` is not linear in either count, so a "240,000+"
    // that arrives as exact is a number the fund believes it measured.
    const e = evidenceFromMarket(reading, 'LEGO');
    expect(e.comparableActiveIsFloor).toBe(true);
    expect(e.comparableSoldIsFloor).toBe(false);
    expect(e.comparableActiveListings).toBe(240_000);
  });

  it('takes the category from the operator, not from the vendor', () => {
    // The vendor's category decides which market was MEASURED; the fund's
    // category decides which exposure cap applies. They are different things,
    // and the reading carries a plausible-looking one of its own.
    expect(evidenceFromMarket(reading, 'LEGO').category).toBe('LEGO');
  });
});
