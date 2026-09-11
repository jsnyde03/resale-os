/**
 * Drops: what is coming, and the market of whatever came before it.
 *
 * ⛔ **No verdict is stored, and that is the design.** `opportunities` records
 * a decision that was MADE — re-scoring an old row would show a number that was
 * never the reason for anything. A drop has not happened yet, so the only
 * useful question is what TODAY's rules say at today's bankroll, and the screen
 * recomputes it exactly as the watchlist does. See `008_drops.sql`.
 *
 * ⚠️ **Two different absences, kept apart.** A null `comparable` means nothing
 * similar has ever sold; a null valuation means nobody has looked it up yet.
 * Collapsing them is how a screen tells an operator "no" when the honest answer
 * is "not yet asked".
 */

import type { Db, ReadOnlyDb } from '../db-types.js';
import { toParams } from '../db-types.js';
import type { Cents } from '../../core/money.js';
import type { Drop, DropEvidence } from '../../core/drop.js';

export interface DropRow {
  drop_id: string;
  created_at: string;
  updated_at: string;
  name: string;
  retailer: string;
  drop_date: string;
  msrp_cents: number;
  comparable_keyword: string | null;
  comparable_why: string | null;
  valued_at: string | null;
  comp_prices_json: string | null;
  comp_median_age_days: number | null;
  comparable_sold_90d: number | null;
  comparable_active: number | null;
  comparable_sold_is_floor: number;
  comparable_active_is_floor: number;
  category: string | null;
  source: string;
  source_url: string | null;
}

/** A stored drop, in the shape the screen model takes. */
export interface StoredDrop {
  readonly drop: Drop;
  readonly evidence: DropEvidence | null;
  /** ⚠️ When the comparable's market was last read. Null until it has been. */
  readonly valuedAt: string | null;
  readonly source: string;
}

export function rowToStoredDrop(row: DropRow): StoredDrop {
  const drop: Drop = {
    dropId: row.drop_id,
    name: row.name,
    retailer: row.retailer,
    dropDate: row.drop_date,
    msrpCents: row.msrp_cents as Cents,
    // ⛔ The schema enforces both-or-neither, so one check answers for both.
    comparable:
      row.comparable_keyword === null
        ? null
        : { keyword: row.comparable_keyword, why: row.comparable_why ?? '' },
  };

  // ⚠️ `valued_at` is the ONE field that says whether a reading exists. The
  // schema refuses a half-written valuation precisely so that reading one
  // field here is safe; without that CHECK this would be five null tests and a
  // silent partial row.
  if (row.valued_at === null) return { drop, evidence: null, valuedAt: null, source: row.source };

  const evidence: DropEvidence = {
    comparableCompPricesCents: JSON.parse(row.comp_prices_json ?? '[]') as Cents[],
    comparableCompMedianAgeDays: row.comp_median_age_days ?? 0,
    comparableSoldLast90Days: row.comparable_sold_90d ?? 0,
    comparableActiveListings: row.comparable_active ?? 0,
    comparableSoldIsFloor: row.comparable_sold_is_floor === 1,
    comparableActiveIsFloor: row.comparable_active_is_floor === 1,
    category: row.category ?? '',
  };
  return { drop, evidence, valuedAt: row.valued_at, source: row.source };
}

function listDrops(db: ReadOnlyDb): StoredDrop[] {
  // Soonest first. The screen re-sorts (it knows which have passed), but a
  // reader that hands back insertion order makes every caller do this again.
  return db
    .all<DropRow>('SELECT * FROM drops ORDER BY drop_date ASC, name ASC')
    .map(rowToStoredDrop);
}

/** The reading half, for a screen that must not be able to write. */
export class DropReader {
  readonly #db: ReadOnlyDb;

  constructor(db: ReadOnlyDb) {
    this.#db = db;
  }

  get(dropId: string): StoredDrop | undefined {
    const row = this.#db.get<DropRow>('SELECT * FROM drops WHERE drop_id = ?', [dropId]);
    return row === undefined ? undefined : rowToStoredDrop(row);
  }

  list(): StoredDrop[] {
    return listDrops(this.#db);
  }
}

export class DropRepository {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  get(dropId: string): StoredDrop | undefined {
    return new DropReader(this.#db).get(dropId);
  }

  list(): StoredDrop[] {
    return listDrops(this.#db);
  }

  /**
   * Insert or update the drop itself.
   *
   * ⛔ **It does not touch the valuation.** Editing a typo in a name must not
   * silently discard a market reading, and re-reading a market must not revert
   * an edited date. They are separate facts with separate clocks, so they are
   * separate writes — `value()` below.
   */
  save(drop: Drop, now: string, source = 'MANUAL', sourceUrl: string | null = null): void {
    const existing = this.#db.get<DropRow>('SELECT created_at FROM drops WHERE drop_id = ?', [
      drop.dropId,
    ]);

    this.#db.run(
      `INSERT INTO drops (
         drop_id, created_at, updated_at, name, retailer, drop_date, msrp_cents,
         comparable_keyword, comparable_why, source, source_url
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(drop_id) DO UPDATE SET
         updated_at         = excluded.updated_at,
         name               = excluded.name,
         retailer           = excluded.retailer,
         drop_date          = excluded.drop_date,
         msrp_cents         = excluded.msrp_cents,
         comparable_keyword = excluded.comparable_keyword,
         comparable_why     = excluded.comparable_why,
         source             = excluded.source,
         source_url         = excluded.source_url`,
      toParams([
        drop.dropId,
        existing?.created_at ?? now,
        now,
        drop.name,
        drop.retailer,
        drop.dropDate,
        drop.msrpCents,
        drop.comparable?.keyword ?? null,
        drop.comparable?.why ?? null,
        source,
        sourceUrl,
      ]),
    );
  }

  /**
   * Record what the comparable's market said, and when.
   *
   * ⚠️ **`valuedAt` is written with the reading, not derived at read time.** A
   * market reading ages, and a screen that cannot say *when* it was taken shows
   * a three-week-old sell-through as though it were measured this morning.
   */
  value(dropId: string, evidence: DropEvidence, now: string): void {
    this.#db.run(
      `UPDATE drops SET
         updated_at                 = ?,
         valued_at                  = ?,
         comp_prices_json           = ?,
         comp_median_age_days       = ?,
         comparable_sold_90d        = ?,
         comparable_active          = ?,
         comparable_sold_is_floor   = ?,
         comparable_active_is_floor = ?,
         category                   = ?
       WHERE drop_id = ?`,
      toParams([
        now,
        now,
        JSON.stringify(evidence.comparableCompPricesCents),
        evidence.comparableCompMedianAgeDays,
        evidence.comparableSoldLast90Days,
        evidence.comparableActiveListings,
        evidence.comparableSoldIsFloor === true ? 1 : 0,
        evidence.comparableActiveIsFloor === true ? 1 : 0,
        evidence.category,
        dropId,
      ]),
    );
  }

  /**
   * ⚠️ A drop is deletable, unlike anything in the ledger. It is a note about
   * the future, not a record of money — and a cancelled drop that cannot be
   * removed becomes a permanently wrong row on a screen read for decisions.
   */
  remove(dropId: string): void {
    this.#db.run('DELETE FROM drops WHERE drop_id = ?', [dropId]);
  }
}
