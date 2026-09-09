/**
 * Opening a ledger on a desktop: a path, `node:sqlite`, and the migrations read
 * off disk.
 *
 * ⚠️ This was `openFundStore()`. It moved out on 2026-09-09 because opening a
 * database is the one genuinely platform-specific thing the store did, and
 * keeping it inside meant a React Native bundle pulled in `node:sqlite` and
 * `node:fs` to construct an object that needs neither.
 *
 * The phone's equivalent is `openExpoDb()` plus `migrateWith()`.
 */

import { FundStore, systemClock, type Clock } from './store.js';
import { openDb } from './driver.js';
import { migrate } from './migrate.js';

export function openFundStore(path: string, clock: Clock = systemClock): FundStore {
  const db = openDb(path);
  migrate(db, clock());
  const store = new FundStore(db, clock);
  store.ensureSeeded();
  return store;
}
