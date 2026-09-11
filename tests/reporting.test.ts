import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FundStore } from '@/db/store.js';
import { openDb } from '@/db/driver.js';
import { migrate } from '@/db/migrate.js';
import { profitReport, expenseBreakdown } from '@/db/reporting.js';
import {
  backupDatabase,
  backupFilename,
  backupStaleness,
  backupWithRetention,
  dailyBackupFilename,
  listBackups,
  pruneBackups,
  BackupError,
  DEFAULT_BACKUP_SETTINGS,
  EMPTY_BACKUP_STATE,
  LATEST_BACKUP_NAME,
} from '@/db/backup.js';
import { computeMetrics } from '@/core/capital/metrics.js';
import { WITH_JOB } from './helpers.js';
import { T0 } from './helpers.js';

function fixedClock(): () => string {
  let n = 0;
  return () => `2026-09-08T12:00:${String(n++).padStart(2, '0')}.000Z`;
}

function storeAt(path: string): FundStore {
  const db = openDb(path);
  migrate(db, T0);
  const store = new FundStore(db, fixedClock());
  store.ensureSeeded();
  store.setTaxProfile(WITH_JOB);
  return store;
}

/** A small but complete business: a sale, a charge-off, a recovery, an expense. */
function runBusiness(store: FundStore): void {
  store.commit({ type: 'CONTRIBUTION', amountCents: 50_000, occurredAt: T0 });

  store.commit({
    type: 'PURCHASE',
    itemId: 'sold-1',
    name: 'cart',
    category: 'GAMES',
    purchasePriceCents: 1_500,
    expectedDaysToSale: 8,
    expectedResaleCents: 3_900,
    occurredAt: T0,
  });
  store.commit({
    type: 'SALE',
    itemId: 'sold-1',
    grossProceedsCents: 3_900,
    marketplaceFeeCents: 557,
    outboundShippingCents: 500,
    daysToSale: 7,
    occurredAt: T0,
  });

  store.commit({
    type: 'PURCHASE',
    itemId: 'dud-1',
    name: 'dud',
    category: 'PINS',
    purchasePriceCents: 1_200,
    expectedDaysToSale: 9,
    expectedResaleCents: 3_000,
    occurredAt: T0,
  });
  store.commit({ type: 'CHARGE_OFF', itemId: 'dud-1', reason: 'STALE', occurredAt: T0 });
  store.commit({
    type: 'PASSIVE_RECOVERY',
    itemId: 'dud-1',
    grossProceedsCents: 900,
    occurredAt: T0,
  });

  store.commit({
    type: 'BUSINESS_EXPENSE',
    amountCents: 1_800,
    category: 'SUPPLIES',
    occurredAt: T0,
  });
}

describe('three profit numbers that must not be conflated', () => {
  it('separates item profit, operating profit and what the owner may take', () => {
    const store = storeAt(':memory:');
    runBusiness(store);
    const r = profitReport(store.db);

    // sold-1: net 2843 - cost 1500 = 1343.  dud-1: -1200 charged off, +865 recovered.
    // sold-1 made 1343; dud-1 lost 1200 then recovered 900 net (no fees).
    expect(r.itemProfitCents).toBe(1_343 + (-1_200 + 900));
    expect(r.businessExpenseCents).toBe(1_800);
    expect(r.operatingProfitCents).toBe(r.itemProfitCents - 1_800);

    // The number the owner may actually take is the smallest of the three.
    expect(r.ownerDistributableCents).toBe(r.operatingProfitCents - r.taxReserveCents);
    expect(r.ownerDistributableCents).toBeLessThan(r.operatingProfitCents);
    expect(r.operatingProfitCents).toBeLessThan(r.itemProfitCents);
  });

  it('does not count capitalised costs as expenses', () => {
    // Inbound shipping is already inside book value; counting it again would
    // double-charge the item.
    const store = storeAt(':memory:');
    store.commit({ type: 'CONTRIBUTION', amountCents: 50_000, occurredAt: T0 });
    store.commit({
      type: 'PURCHASE',
      itemId: 'i1',
      name: 'x',
      category: 'GAMES',
      purchasePriceCents: 1_000,
      inboundShippingCents: 400,
      acquisitionTravelCents: 300,
      expectedDaysToSale: 5,
      expectedResaleCents: 3_000,
      occurredAt: T0,
    });

    const r = profitReport(store.db);
    expect(r.businessExpenseCents).toBe(0);

    const capitalised = expenseBreakdown(store.db).filter((l) => l.capitalized === 1);
    expect(capitalised.reduce((a, l) => a + l.totalCents, 0)).toBe(700);
    expect(store.derivedState().items.i1!.landedCostCents).toBe(1_700);
  });

  it('reports charge-offs and recoveries separately', () => {
    const store = storeAt(':memory:');
    runBusiness(store);
    const r = profitReport(store.db);
    expect(r.soldItems).toBe(2); // the recovery counts as an outcome
    expect(r.chargedOffItems).toBe(0); // it recovered, so it is no longer charged off
    expect(r.recoveryCents).toBe(900);
  });

  it('agrees with the ledger on what is owed to the owner', () => {
    const store = storeAt(':memory:');
    runBusiness(store);
    const r = profitReport(store.db);
    const m = computeMetrics(store.state());
    expect(r.ownerPayableCents).toBe(m.ownerPayableCents);
    expect(r.taxReserveCents).toBe(m.taxReserveCents);
  });
});

describe('backups are verified, not just copied', () => {
  it('copies the ledger and proves the copy opens and verifies', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resale-backup-'));
    try {
      // ⛔ **The close goes in a `finally`, and 6.9 is why.** These used to sit
      // in the try body, so a failing assertion between the open and the close
      // skipped the close, leaked the handle, and `rmSync` below threw EBUSY
      // **over the top of the real failure** — which is what cost an hour in
      // 5.5.1 and was then left unaudited everywhere else.
      let expected: number;
      const store = storeAt(join(dir, 'live.db'));
      try {
        runBusiness(store);
        expected = store.events().length;
      } finally {
        store.close();
      }

      const result = backupDatabase(join(dir, 'live.db'), join(dir, 'backups'), T0);
      expect(result.events).toBe(expected);
      expect(result.chainOk).toBe(true);
      expect(result.bytes).toBeGreaterThan(0);

      // And the copy is genuinely usable, not just present.
      const restored = new FundStore(openDb(result.path));
      try {
        expect(restored.verifyChain().ok).toBe(true);
        expect(computeMetrics(restored.derivedState()).navCents).toBeGreaterThan(0);
      } finally {
        restored.close();
      }
    } finally {
      // ⚠️ **`maxRetries` is NOT leak protection, and that was measured.** With a
      // handle leaked from the block above, this still threw
      // `EBUSY: resource busy or locked` and **replaced the real assertion
      // failure entirely** — five retries did not help, because a leaked handle
      // is not a transient lock. It is kept for what it IS plausibly for:
      // Windows releasing a file lazily after a CLEAN close. ⛔ Removing it was
      // considered and rejected — one green run does not disprove a timing
      // flake — but it must not be read as covering the leak. 6.9.3.
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('deletes a corrupt copy rather than leaving it looking like safety', () => {
    // The worst outcome is a file of the right size that will not open.
    const dir = mkdtempSync(join(tmpdir(), 'resale-backup-'));
    try {
      const path = join(dir, 'live.db');
      writeFileSync(path, 'this is not a database');
      expect(() => backupDatabase(path, join(dir, 'backups'), T0)).toThrow(BackupError);
      expect(listBackups(join(dir, 'backups'))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('refuses to back up an in-memory database', () => {
    expect(() => backupDatabase(':memory:', tmpdir(), T0)).toThrow(/in-memory/);
  });

  it('names backups so they sort chronologically as plain text', () => {
    const a = backupFilename('2026-09-08T12:00:00.000Z');
    const b = backupFilename('2026-09-09T09:00:00.000Z');
    expect(a < b).toBe(true);
    expect(a).toMatch(/^resale-.*\.db$/);
    // No colons: they are illegal in Windows filenames.
    expect(a).not.toContain(':');
  });

  it('lists what is there, newest first, and copes with no directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resale-backup-'));
    try {
      const store = storeAt(join(dir, 'live.db'));
      try {
        runBusiness(store);
      } finally {
        store.close(); // 6.9: a throw in runBusiness must not leak the handle
      }
      expect(listBackups(join(dir, 'nope'))).toEqual([]);

      backupDatabase(join(dir, 'live.db'), join(dir, 'backups'), '2026-09-08T12:00:00.000Z');
      backupDatabase(join(dir, 'live.db'), join(dir, 'backups'), '2026-09-09T12:00:00.000Z');
      const all = listBackups(join(dir, 'backups'));
      expect(all.length).toBe(2);
      expect(all[0]!.path > all[1]!.path).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});

describe('a corrupt source cannot destroy a good backup', () => {
  it('verifies into a staging file and promotes only on success', () => {
    // The property that matters most: yesterday's good copy must survive
    // today's bad one. Write-then-verify would lose it.
    const dir = mkdtempSync(join(tmpdir(), 'resale-backup-'));
    try {
      const live = join(dir, 'live.db');
      const backups = join(dir, 'backups');
      const store = storeAt(live);
      try {
        runBusiness(store);
      } finally {
        store.close(); // 6.9
      }

      const good = backupDatabase(live, backups, T0, LATEST_BACKUP_NAME);
      const goodBytes = good.bytes;

      // Now the source goes bad, and a backup is attempted over the same name.
      writeFileSync(live, 'catastrophe');
      expect(() => backupDatabase(live, backups, T0, LATEST_BACKUP_NAME)).toThrow(BackupError);

      // The previous copy is untouched, and still restores.
      const survivors = listBackups(backups);
      expect(survivors.length).toBe(1);
      expect(survivors[0]!.bytes).toBe(goodBytes);
      const restored = new FundStore(openDb(survivors[0]!.path));
      try {
        expect(restored.verifyChain().ok).toBe(true);
      } finally {
        restored.close(); // 6.9
      }
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('leaves no staging file behind when it fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resale-backup-'));
    try {
      const live = join(dir, 'live.db');
      writeFileSync(live, 'not a database');
      expect(() => backupDatabase(live, join(dir, 'backups'), T0)).toThrow(BackupError);
      expect(listBackups(join(dir, 'backups'))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});

describe('retention keeps latest current and history dated', () => {
  function seeded(dir: string) {
    const store = storeAt(join(dir, 'live.db'));
    runBusiness(store);
    store.close();
    return { ...DEFAULT_BACKUP_SETTINGS, directory: join(dir, 'backups') };
  }

  it('refreshes latest every run and writes one dated file per day', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resale-backup-'));
    try {
      const settings = seeded(dir);
      const first = backupWithRetention(join(dir, 'live.db'), settings, '2026-09-08T09:00:00.000Z');
      expect(first.daily).not.toBeNull();

      // Same day again: latest is refreshed, no second dated copy.
      const second = backupWithRetention(join(dir, 'live.db'), settings, '2026-09-08T17:00:00.000Z');
      expect(second.daily).toBeNull();
      expect(second.latest.path).toBe(first.latest.path);

      const next = backupWithRetention(join(dir, 'live.db'), settings, '2026-09-09T09:00:00.000Z');
      expect(next.daily).not.toBeNull();
      expect(listBackups(settings.directory).length).toBe(3); // latest + 2 dailies
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('prunes past the window but never down to nothing', () => {
    // A retention rule that can empty the directory is a delete script wearing
    // a backup's clothes.
    const dir = mkdtempSync(join(tmpdir(), 'resale-backup-'));
    try {
      const settings = { ...seeded(dir), retainDays: 30 };
      for (const day of ['2026-01-01', '2026-02-01', '2026-03-01']) {
        backupDatabase(join(dir, 'live.db'), settings.directory, `${day}T09:00:00.000Z`,
          dailyBackupFilename(`${day}T09:00:00.000Z`));
      }
      expect(listBackups(settings.directory).length).toBe(3);

      const removed = pruneBackups(settings.directory, '2026-09-08T09:00:00.000Z', 30);
      expect(removed.length).toBe(2);
      const left = listBackups(settings.directory);
      expect(left.length).toBe(1); // the most recent dated copy survives
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('never prunes latest, however old it looks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resale-backup-'));
    try {
      const settings = seeded(dir);
      backupDatabase(join(dir, 'live.db'), settings.directory, T0, LATEST_BACKUP_NAME);
      pruneBackups(settings.directory, '2030-01-01T00:00:00.000Z', 1);
      expect(listBackups(settings.directory).some((b) => b.path.endsWith(LATEST_BACKUP_NAME)))
        .toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});

describe('the fund knows whether it is backed up', () => {
  it('measures staleness in events, which is what actually matters', () => {
    expect(backupStaleness(EMPTY_BACKUP_STATE, 0).stale).toBe(true); // never run
    const state = { ...EMPTY_BACKUP_STATE, lastSuccessAt: T0, lastSuccessEvents: 10 };
    expect(backupStaleness(state, 10)).toEqual({ behind: 0, stale: false });
    expect(backupStaleness(state, 13)).toEqual({ behind: 3, stale: true });
  });

  it('stores settings and state tolerantly, because backup must never break a command', () => {
    const store = storeAt(':memory:');
    // A malformed value degrades to defaults instead of throwing. Contrast
    // policy(), where a bad value must stop the world.
    store.db.run("UPDATE config SET value_json = ? WHERE key = 'backup_settings'", ['{{bad']);
    store.setBackupSettings({ directory: 'X:/backups', auto: true, retainDays: 45 });
    expect(store.backupSettings().retainDays).toBe(45);

    store.db.run(
      `INSERT INTO config (key, value_json, updated_at) VALUES ('backup_state','nonsense','x')
       ON CONFLICT(key) DO UPDATE SET value_json = 'nonsense'`,
    );
    expect(store.backupState()).toEqual(EMPTY_BACKUP_STATE);
  });

  it('defaults to no directory rather than a false sense of one', () => {
    const store = storeAt(':memory:');
    expect(store.backupSettings().directory).toBe('');
    expect(store.backupSettings().auto).toBe(true);
  });
});
