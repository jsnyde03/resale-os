/**
 * Drops on disk.
 *
 * ⛔ **The claims are about what the row REFUSES**, not about SQL. A keyword
 * with no stated reason, a date that will throw when it is read, a half-written
 * valuation — each is a row that looks fine until the screen reads it, and each
 * is refused by the schema rather than by a comment.
 *
 * ⚠️ Every round trip asserts against **the value that went in**, never against
 * a second trip through the same writer: a field the writer drops is dropped
 * identically on both sides and the comparison passes.
 */

import { describe, expect, it } from 'vitest';
import { FundStore } from '@/db/store.js';
import { openDb } from '@/db/driver.js';
import { migrate } from '@/db/migrate.js';
import type { Drop, DropEvidence } from '@/core/drop.js';
import { T0 } from './helpers.js';

const NOW = '2026-09-11T12:00:00.000Z';
const LATER = '2026-09-12T09:30:00.000Z';

function freshStore(): FundStore {
  const db = openDb(':memory:');
  migrate(db, T0);
  const store = new FundStore(db, () => NOW);
  store.ensureSeeded();
  return store;
}

const drop = (over: Partial<Drop> = {}): Drop => ({
  dropId: 'd1',
  name: 'LEGO UCS Something 2026',
  retailer: 'LEGO Store',
  dropDate: '2026-10-01',
  msrpCents: 24_999,
  comparable: { keyword: 'lego ucs something 2025', why: "last year's UCS set, same piece count" },
  ...over,
});

const evidence = (over: Partial<DropEvidence> = {}): DropEvidence => ({
  comparableCompPricesCents: [5_900, 6_000, 6_100],
  comparableCompMedianAgeDays: 20,
  comparableSoldLast90Days: 90,
  comparableActiveListings: 15,
  category: 'TOYS',
  ...over,
});

describe('a drop survives the app closing', () => {
  it('comes back field for field, against what went in', () => {
    const store = freshStore();
    const d = drop();
    store.drops().save(d, NOW);

    const back = store.drops().get('d1');
    expect(back).toBeDefined();
    expect(back!.drop).toEqual(d);
    expect(back!.evidence).toBeNull();
    expect(back!.valuedAt).toBeNull();
    expect(back!.source).toBe('MANUAL');
  });

  it('⛔ round-trips a drop with NO comparable, which is the other class', () => {
    // Planting only the "has a comparable" direction would leave this silently
    // vacuous — and null-vs-present is the distinction the screen renders.
    const store = freshStore();
    const d = drop({ dropId: 'd2', comparable: null });
    store.drops().save(d, NOW);
    expect(store.drops().get('d2')!.drop.comparable).toBeNull();
  });

  it('records the valuation with the time it was taken', () => {
    const store = freshStore();
    store.drops().save(drop(), NOW);
    store.drops().value('d1', evidence(), LATER);

    const back = store.drops().get('d1')!;
    expect(back.evidence).toEqual({
      ...evidence(),
      comparableSoldIsFloor: false,
      comparableActiveIsFloor: false,
    });
    // ⚠️ A reading ages. A screen that cannot say when it was taken shows a
    // three-week-old sell-through as though it were measured this morning.
    expect(back.valuedAt).toBe(LATER);
  });

  it('⚠️ keeps a floored count floored across the round trip', () => {
    // The gates read this. A "240,000+" that comes back as exact is a count
    // the fund believes it measured.
    const store = freshStore();
    store.drops().save(drop(), NOW);
    store.drops().value('d1', evidence({ comparableActiveIsFloor: true }), LATER);
    expect(store.drops().get('d1')!.evidence!.comparableActiveIsFloor).toBe(true);
  });

  it('⛔ editing the drop does not discard the valuation', () => {
    // Fixing a typo in a name must not silently throw away a market reading.
    const store = freshStore();
    store.drops().save(drop(), NOW);
    store.drops().value('d1', evidence(), LATER);
    store.drops().save(drop({ name: 'LEGO UCS Something 2026 (corrected)' }), LATER);

    const back = store.drops().get('d1')!;
    expect(back.drop.name).toContain('corrected');
    expect(back.evidence).not.toBeNull();
    expect(back.valuedAt).toBe(LATER);
  });

  it('lists soonest first, and a removed drop is gone', () => {
    const store = freshStore();
    store.drops().save(drop({ dropId: 'far', name: 'Far', dropDate: '2026-12-01' }), NOW);
    store.drops().save(drop({ dropId: 'soon', name: 'Soon', dropDate: '2026-09-20' }), NOW);
    expect(store.drops().list().map((d) => d.drop.dropId)).toEqual(['soon', 'far']);

    // ⚠️ Deletable, unlike anything in the ledger: a cancelled drop that cannot
    // be removed is a permanently wrong row on a screen read for decisions.
    store.drops().remove('soon');
    expect(store.drops().list().map((d) => d.drop.dropId)).toEqual(['far']);
  });
});

describe('⛔ what the row refuses', () => {
  it('a keyword with no stated reason', () => {
    // An analogy nobody can inspect is a guess with a number attached, and the
    // number becomes the resale price.
    const store = freshStore();
    expect(() =>
      store.db.run(
        `INSERT INTO drops (drop_id, created_at, updated_at, name, retailer, drop_date,
           msrp_cents, comparable_keyword, comparable_why)
         VALUES ('x', ?, ?, 'n', 'r', '2026-10-01', 100, 'a keyword', NULL)`,
        [NOW, NOW],
      ),
    ).toThrow();
  });

  it('a date that would throw when the screen read it', () => {
    // `dropTiming` throws on an unparseable date, and the row that would throw
    // is written long before it is read.
    const store = freshStore();
    expect(() => store.drops().save(drop({ dropDate: 'next Tuesday' }), NOW)).toThrow();
  });

  it('a HALF-written valuation', () => {
    // Counts with no comps would price a drop off nothing; comps with no
    // category would escape the exposure cap. The reader tests one field —
    // `valued_at` — and this CHECK is what makes that safe.
    const store = freshStore();
    store.drops().save(drop(), NOW);
    expect(() =>
      store.db.run(`UPDATE drops SET valued_at = ? WHERE drop_id = 'd1'`, [LATER]),
    ).toThrow();
  });
});
