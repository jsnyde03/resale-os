/**
 * The `Db` interface, over `expo-sqlite`.
 *
 * ⚡ This is the whole platform-specific surface of the port. Gate 1's
 * `ASSUMPTIONS_AND_RISKS` A1 said *"the driver interface is 5 methods; swapping
 * is one file"* — this is that file, and it is the second implementation of a
 * contract the first one has been passing since Gate 1.
 *
 * ⛔ Every method is SYNCHRONOUS, matching `node:sqlite`. `expo-sqlite` offers
 * both, and taking the async half would have forced `FundStore`, the engine and
 * every caller to become async — a rewrite of the thing the port exists to
 * preserve. The sync API is the reason this is one file rather than a project.
 *
 * ⚠️ Transaction handling is deliberately NOT `withTransactionSync`. That would
 * be a second implementation of the re-entrancy rules; instead the same
 * BEGIN/SAVEPOINT ladder as `src/db/driver.ts` is used, so both drivers behave
 * identically under nesting — which the contract asserts.
 */

import * as SQLite from 'expo-sqlite';
import type { Db, SqlParam } from '../../../src/db/db-types.js';

type Bind = SQLite.SQLiteBindValue;

/** The engine passes `readonly SqlParam[]`; expo wants a mutable array. */
function bind(params: readonly SqlParam[] | undefined): Bind[] {
  return (params ?? []).map((p) => p as Bind);
}

class ExpoDb implements Db {
  readonly #db: SQLite.SQLiteDatabase;
  #depth = 0;

  constructor(db: SQLite.SQLiteDatabase) {
    this.#db = db;
  }

  exec(sql: string): void {
    this.#db.execSync(sql);
  }

  run(sql: string, params?: readonly SqlParam[]): { changes: number } {
    const result = this.#db.runSync(sql, bind(params));
    return { changes: result.changes };
  }

  all<T = Record<string, unknown>>(sql: string, params?: readonly SqlParam[]): T[] {
    return this.#db.getAllSync<T>(sql, bind(params));
  }

  get<T = Record<string, unknown>>(sql: string, params?: readonly SqlParam[]): T | undefined {
    // ⚠️ expo returns `null` for "no row"; the contract requires `undefined`,
    // because `null` is a legitimate stored VALUE elsewhere in this codebase
    // and the two must not blur.
    return this.#db.getFirstSync<T>(sql, bind(params)) ?? undefined;
  }

  transaction<T>(fn: () => T): T {
    const name = `sp_${this.#depth}`;
    const outermost = this.#depth === 0;
    this.#db.execSync(outermost ? 'BEGIN' : `SAVEPOINT ${name}`);
    this.#depth += 1;
    try {
      const out = fn();
      this.#depth -= 1;
      this.#db.execSync(outermost ? 'COMMIT' : `RELEASE ${name}`);
      return out;
    } catch (err) {
      this.#depth -= 1;
      this.#db.execSync(outermost ? 'ROLLBACK' : `ROLLBACK TO ${name}`);
      if (!outermost) this.#db.execSync(`RELEASE ${name}`);
      throw err;
    }
  }

  close(): void {
    this.#db.closeSync();
  }
}

/**
 * Open a database in the app's document directory.
 *
 * ⚠️ `:memory:` is supported and is what the contract runs against, so the
 * suite never touches the real ledger.
 */
export function openExpoDb(name: string): Db {
  const db = SQLite.openDatabaseSync(name);
  // Same pragmas as the desktop driver. Foreign keys are ON in this schema and
  // migration 005 depends on being able to turn them off deliberately.
  db.execSync('PRAGMA journal_mode = WAL');
  db.execSync('PRAGMA foreign_keys = ON');
  return new ExpoDb(db);
}
