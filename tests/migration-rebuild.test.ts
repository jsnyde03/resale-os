/**
 * Migration 005 rebuilds `ledger_events` to widen a CHECK constraint, and it
 * will run against a live book that already has money in it.
 *
 * Every other test migrates a fresh database all at once, so 005 has never met
 * data written under 001–004 — which is the only situation that actually
 * matters. This runs the migrations in two stages with real events in between,
 * the way the live fund will experience it.
 *
 * What has to survive: the hash chain (the rebuild copies rows column for
 * column, so every hash must still verify), the foreign keys pointing at
 * `ledger_events` from `ledger_postings` and `expenses`, and the reconciliation
 * between the postings scan and the engine replay.
 */

import { describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FundStore } from '@/db/store.js';
import { openDb } from '@/db/driver.js';
import { migrate, listMigrationFiles, isSelfManaged } from '@/db/migrate.js';
import { reconcile } from '@/db/replay.js';
import { profitReport } from '@/db/reporting.js';
import { WITH_JOB, T0 } from './helpers.js';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');
const REBUILD = '005_expense_correction.sql';

function fixedClock(): () => string {
  let n = 0;
  return () => `2026-09-08T12:00:${String(n++).padStart(2, '0')}.000Z`;
}

/** A migrations directory holding only the files before the rebuild. */
function stagedDir(dir: string): string {
  const staged = join(dir, 'migrations');
  rmSync(staged, { recursive: true, force: true });
  mkdirSync(staged, { recursive: true });
  for (const f of readdirSync(MIGRATIONS)) {
    if (f >= REBUILD) continue;
    copyFileSync(join(MIGRATIONS, f), join(staged, f));
  }
  return staged;
}

describe('migration 005 rebuilds the events table under live data', () => {
  it('preserves the hash chain, the foreign keys and the reconciliation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resale-migrate-'));
    // ⚠️ Closed in its own `finally`. Without that, a failed assertion leaves
    // the handle open, the cleanup below fails with EBUSY on Windows, and the
    // EBUSY is the ONLY error reported — hiding the assertion that actually
    // broke. Measured 2026-09-09: migration 006 landed, the stage-2 assertion
    // below went stale, and the failure read as a filesystem problem.
    let store: FundStore | undefined;
    try {
      const staged = stagedDir(dir);
      const path = join(dir, 'test.db');

      // Stage 1: the schema as it stood before this migration existed.
      const db = openDb(path);
      const applied = migrate(db, T0, staged);
      expect(applied).not.toContain(REBUILD);

      store = new FundStore(db, fixedClock());
      store.ensureSeeded();
      store.setTaxProfile(WITH_JOB);
      store.commit({ type: 'CONTRIBUTION', amountCents: 5_000, occurredAt: T0 });
      const expenseId = store.commit({
        type: 'BUSINESS_EXPENSE',
        amountCents: 150,
        category: 'SUPPLIES',
        occurredAt: T0,
      }).event.eventId;
      store.commit({
        type: 'ADJUSTMENT',
        account: 'LIQUID',
        amountCents: 150,
        reason: 'returned, but declaring nothing',
        occurredAt: T0,
      });

      const hashesBefore = store.events().map((e) => e.hash);
      expect(store.verifyChain()).toEqual({ ok: true });
      expect(hashesBefore).toHaveLength(3);

      // Stage 2: the rebuild, against exactly that data.
      // Everything from the rebuild onward, derived rather than listed — a
      // hard-coded `[REBUILD]` goes stale the day a 006 is added.
      const ran = migrate(db, T0, MIGRATIONS);
      expect(ran).toEqual(listMigrationFiles(MIGRATIONS).filter((f) => f >= REBUILD));
      expect(ran).toContain(REBUILD);

      expect(store.events().map((e) => e.hash)).toEqual(hashesBefore);
      expect(store.verifyChain()).toEqual({ ok: true });
      expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
      expect(reconcile(store)).toEqual({ ok: true, differences: [] });

      // And the whole point: the new event type is now accepted, so the book
      // that was migrated can be corrected.
      store.commit({
        type: 'EXPENSE_CORRECTION',
        correctsEventId: expenseId,
        amountCents: 150,
        settledByEventId: 'evt_000003',
        reason: 'settled against the adjustment that returned it',
        occurredAt: T0,
      });
      expect(profitReport(db).businessExpenseCents).toBe(0);
      expect(store.verifyChain()).toEqual({ ok: true });
    } finally {
      store?.close();
      // ⚠️ `maxRetries` is NOT leak protection — measured in
      // `reporting.test.ts`, where the reasoning lives. 6.9.3.
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('is safe to run twice — the runner records it only after it commits', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resale-migrate-'));
    try {
      const path = join(dir, 'test.db');
      const db = openDb(path);
      migrate(db, T0);

      // Simulate a crash in the gap between the file committing and the runner
      // recording it: the schema change landed, the bookkeeping row did not.
      db.run('DELETE FROM schema_migrations WHERE name = ?', [REBUILD]);
      const ran = migrate(db, T0);
      expect(ran).toEqual([REBUILD]);
      expect(db.all('PRAGMA foreign_key_check')).toEqual([]);

      const store = new FundStore(db, fixedClock());
      try {
        store.ensureSeeded();
        store.commit({ type: 'CONTRIBUTION', amountCents: 5_000, occurredAt: T0 });
        expect(store.verifyChain()).toEqual({ ok: true });
      } finally {
        // ⛔ 6.9. A failing chain assertion used to skip this close, leak the
        // handle, and surface as an EBUSY from the rmSync below — which is
        // precisely how 5.5.1's real failure got hidden, in this very file.
        store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('marks exactly the files that manage their own transaction', () => {
    // A self-managed file that lost its marker would run inside the runner's
    // transaction, where its PRAGMA is silently ignored and the rebuild fails.
    const selfManaged = listMigrationFiles().filter((f) =>
      isSelfManaged(readFileSync(join(MIGRATIONS, f), 'utf8')),
    );
    expect(selfManaged).toEqual([REBUILD]);
  });
});
