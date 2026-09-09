/**
 * The ONLY place `node:sqlite` is imported.
 *
 * Everything else in the app talks to the `Db` interface below, which is five
 * methods wide on purpose: porting to Postgres means implementing this over
 * `pg` and adjusting the migration dialect, not touching application code.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// The interface moved to `db-types.ts` so a React Native build can compile it
// without `node:sqlite`. Re-exported here so every existing import still works.
export type { Db, ReadOnlyDb, SqlParam } from './db-types.js';
import type { Db, SqlParam } from './db-types.js';

// `toParam`/`toParams` moved to `db-types.ts`: they are pure normalisation and
// a phone needs them without `node:sqlite`.
export { toParam, toParams } from './db-types.js';
import { toParams } from './db-types.js';


class SqliteDb implements Db {
  readonly #db: DatabaseSync;
  #depth = 0;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec('PRAGMA foreign_keys = ON');
    // Durability over throughput: this is a ledger on one machine.
    this.#db.exec('PRAGMA synchronous = FULL');
  }

  exec(sql: string): void {
    this.#db.exec(sql);
  }

  run(sql: string, params: readonly SqlParam[] = []): { changes: number } {
    const stmt = this.#db.prepare(sql);
    const info = stmt.run(...params);
    return { changes: Number(info.changes) };
  }

  all<T = Record<string, unknown>>(sql: string, params: readonly SqlParam[] = []): T[] {
    return this.#db.prepare(sql).all(...params) as T[];
  }

  get<T = Record<string, unknown>>(sql: string, params: readonly SqlParam[] = []): T | undefined {
    const row = this.#db.prepare(sql).get(...params);
    return row === undefined ? undefined : (row as T);
  }

  transaction<T>(fn: () => T): T {
    const name = `sp_${this.#depth}`;
    const outermost = this.#depth === 0;
    this.#db.exec(outermost ? 'BEGIN' : `SAVEPOINT ${name}`);
    this.#depth += 1;
    try {
      const out = fn();
      this.#depth -= 1;
      this.#db.exec(outermost ? 'COMMIT' : `RELEASE ${name}`);
      return out;
    } catch (err) {
      this.#depth -= 1;
      this.#db.exec(outermost ? 'ROLLBACK' : `ROLLBACK TO ${name}`);
      if (!outermost) this.#db.exec(`RELEASE ${name}`);
      throw err;
    }
  }

  close(): void {
    this.#db.close();
  }
}

export function openDb(path: string): Db {
  return new SqliteDb(path);
}

export const DEFAULT_DB_PATH = 'data/resale.db';
