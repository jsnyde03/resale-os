/**
 * Opening the ledger on a phone.
 *
 * The mirror of `src/db/open-store.ts`, which does the same three things with
 * `node:sqlite` and the migrations read off disk. Opening a database is the one
 * genuinely platform-specific thing `FundStore` needed, which is why it lives
 * outside the store on both sides.
 *
 * ⛔ **The migrations come from the bundle, not a directory.** There is no
 * filesystem to read them from here, so `migrateWith` takes them as data and
 * `tests/migrations-bundle.test.ts` gates the bundle against the directory. A
 * `.sql` file nobody regenerated reds the desktop suite rather than silently
 * never running on the phone.
 */

import { FundStore, systemClock, type Clock } from '../../../src/db/store.js';
import { migrateWith } from '../../../src/db/migrate-core.js';
import { openExpoDb } from './expo-driver.js';

/** The real ledger. `:memory:` is what the contract runs against instead. */
export const LEDGER_DB = 'resale.db';

export function openMobileFundStore(name: string = LEDGER_DB, clock: Clock = systemClock): FundStore {
  const db = openExpoDb(name);
  migrateWith(db, clock());
  const store = new FundStore(db, clock);
  store.ensureSeeded();
  return store;
}
