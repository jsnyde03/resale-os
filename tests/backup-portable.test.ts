/**
 * The backup that proves itself by being restored.
 *
 * ⛔ The desktop's backup copies the database file and checks the copy opens.
 * This exports the ledger's commands and **replays them into a scratch
 * database**, comparing every regenerated hash. The failure a backup exists to
 * survive is not "the file went missing" — it is "the file is there and will
 * not come back", and only a restore can see that one coming.
 */

import { describe, expect, it } from 'vitest';
import {
  BackupRefused,
  backupFilename,
  makeVerifiedBackup,
} from '@/db/backup-portable.js';
import { importLedger, type LedgerExport } from '@/db/portable.js';
import { FundStore } from '@/db/store.js';
import { openDb } from '@/db/driver.js';
import { migrate } from '@/db/migrate.js';
import { computeMetrics } from '@/core/capital/metrics.js';
import { T0 } from './helpers.js';

const CLOCK = () => '2026-09-09T15:04:05.123Z';

function fundedStore(): FundStore {
  const db = openDb(':memory:');
  migrate(db, T0);
  let n = 0;
  const store = new FundStore(db, () => `2026-09-09T12:00:${String(n++).padStart(2, '0')}.000Z`);
  store.ensureSeeded();
  store.commit({ type: 'CONTRIBUTION', amountCents: 50_000, occurredAt: T0 });
  store.commit({
    type: 'PURCHASE',
    itemId: 'pin-01',
    name: 'pin',
    category: 'TOYS',
    purchasePriceCents: 1_500,
    expectedDaysToSale: 8,
    expectedResaleCents: 3_900,
    occurredAt: T0,
  });
  return store;
}

describe('the filename', () => {
  // ⚠️ Colons are legal on iOS and a menace everywhere else — the Files app
  // renders them as `/`, and a file AirDropped to a Mac arrives mangled.
  it('carries no colons and no dots inside the timestamp', () => {
    const name = backupFilename('2026-09-09T15:04:05.123Z');
    expect(name).toBe('resale-ledger-2026-09-09T15-04-05-123Z.json');
    expect(name.slice(0, -'.json'.length)).not.toContain(':');
    expect(name.slice(0, -'.json'.length)).not.toContain('.');
  });

  it('sorts chronologically as plain text', () => {
    const names = [
      backupFilename('2026-09-09T09:00:00.000Z'),
      backupFilename('2026-09-09T15:04:05.123Z'),
      backupFilename('2026-10-01T00:00:00.000Z'),
    ];
    expect([...names].sort()).toEqual(names);
  });
});

describe('making one', () => {
  it('refuses to back up a ledger with nothing in it', () => {
    const db = openDb(':memory:');
    migrate(db, T0);
    new FundStore(db).ensureSeeded();
    expect(() => makeVerifiedBackup(db, () => openDb(':memory:'), CLOCK)).toThrowError(
      BackupRefused,
    );
  });

  it('reports what it wrote', () => {
    const store = fundedStore();
    const backup = makeVerifiedBackup(store.db, () => openDb(':memory:'), CLOCK);
    expect(backup.events).toBe(2);
    expect(backup.exportedAt).toBe('2026-09-09T15:04:05.123Z');
    expect(backup.bytes).toBeGreaterThan(0);
    expect(backup.suggestedFilename).toBe('resale-ledger-2026-09-09T15-04-05-123Z.json');
  });

  it('measures the size in bytes, not characters', () => {
    const store = fundedStore();
    // A memo the operator could plausibly type on a phone keyboard.
    store.commit({
      type: 'ADJUSTMENT',
      account: 'LIQUID',
      amountCents: -1,
      reason: 'café rounding — ☕',
      occurredAt: T0,
    });
    const backup = makeVerifiedBackup(store.db, () => openDb(':memory:'), CLOCK);
    expect(backup.bytes).toBeGreaterThan(backup.json.length);
  });

  // ⛔ The whole point: the artefact is one a fresh machine can rebuild the
  // fund from, and it was rebuilt before the file existed.
  it('produces something that restores to the same fund', () => {
    const store = fundedStore();
    const before = computeMetrics(store.state());
    const backup = makeVerifiedBackup(store.db, () => openDb(':memory:'), CLOCK);

    const fresh = openDb(':memory:');
    const report = importLedger(fresh, JSON.parse(backup.json) as LedgerExport, () => T0);
    expect(report.hashesMatched).toBe(true);
    expect(report.chainOk).toBe(true);
    expect(report.reconciled).toBe(true);

    const restored = computeMetrics(new FundStore(fresh).state());
    expect(restored.navCents).toBe(before.navCents);
    expect(restored.inventoryAtCostCents).toBe(before.inventoryAtCostCents);
  });

  it('leaves the live ledger untouched', () => {
    const store = fundedStore();
    const before = store.derivedState();
    makeVerifiedBackup(store.db, () => openDb(':memory:'), CLOCK);
    const after = store.derivedState();
    expect(after.eventCount).toBe(before.eventCount);
    expect(after.balances).toEqual(before.balances);
  });

  // ⚠️ The scratch database is where the proof happens. If it cannot be made,
  // the backup is unverified — and an unverified backup must not be written,
  // because it would look exactly like a verified one.
  it('refuses rather than writing something it could not verify', () => {
    const store = fundedStore();
    expect(() =>
      makeVerifiedBackup(store.db, () => {
        throw new Error('no scratch database available');
      }, CLOCK),
    ).toThrowError(/does not restore/);
  });

  // ⚡ THIS is the control on the whole module. Every other case here would
  // still pass if the restore never ran — the "restores to the same fund" case
  // does its own import and would prove the export good while the verification
  // was skipped. Handing it a scratch database the replay must reject is the
  // only assertion that fails when the replay is not attempted. Planted by
  // removing the `importLedger` call: this one, and only this one, reds.
  it('refuses when the scratch database is not empty', () => {
    const store = fundedStore();
    // Whatever went wrong, replaying onto a populated ledger is not a
    // verification — `importLedger` refuses it and so does this.
    expect(() =>
      makeVerifiedBackup(store.db, () => {
        const dirty = openDb(':memory:');
        migrate(dirty, T0);
        const other = new FundStore(dirty);
        other.ensureSeeded();
        other.commit({ type: 'CONTRIBUTION', amountCents: 1, occurredAt: T0 });
        return dirty;
      }, CLOCK),
    ).toThrowError(BackupRefused);
  });
});
