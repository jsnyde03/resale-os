/**
 * Backing up the one file that cannot be regenerated.
 *
 * ⚠️ **`data/resale.db` is git-ignored and irreplaceable.** Every other artifact
 * in this project can be rebuilt from source; the ledger is the record of money
 * that actually moved. A disk failure loses the whole book. Backlog B17.
 *
 * A copy that was never checked is not a backup, so this one is verified:
 * opened, migrated-state compared, hash chain re-walked, and event count matched
 * against the source. If any of that fails the copy is deleted rather than left
 * lying around looking like safety.
 */

import {
  closeSync,
  copyFileSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { openDb } from './driver.js';
import { FundStore } from './store.js';

export interface BackupResult {
  readonly path: string;
  readonly bytes: number;
  readonly events: number;
  readonly chainOk: boolean;
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

/** Every SQLite file begins with these bytes. Cheap, and it never opens a handle. */
const SQLITE_MAGIC = 'SQLite format 3';

export function looksLikeSqlite(path: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const buffer = Buffer.alloc(SQLITE_MAGIC.length);
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    return read === buffer.length && buffer.toString('utf8') === SQLITE_MAGIC;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** `resale-2026-09-08T12-00-00.db`, sorting chronologically as plain text. */
export function backupFilename(nowIso: string): string {
  return `resale-${nowIso.replace(/[:.]/g, '-').replace(/Z$/, '')}.db`;
}

/** One dated file per day: `resale-2026-09-08.db`. */
export function dailyBackupFilename(nowIso: string): string {
  return `resale-${nowIso.slice(0, 10)}.db`;
}

/** Always the current state. Overwritten, but only ever by a verified copy. */
export const LATEST_BACKUP_NAME = 'resale-latest.db';

/**
 * Copy the database and prove the copy is readable before reporting success.
 *
 * `nowIso` is passed in rather than read from a clock, so a caller can make this
 * deterministic and a test does not depend on wall time.
 */
export function backupDatabase(
  sourcePath: string,
  destinationDir: string,
  nowIso: string,
  fileName?: string,
): BackupResult {
  if (sourcePath === ':memory:') {
    throw new BackupError('cannot back up an in-memory database');
  }

  // ⚠️ Check the file's magic header BEFORE opening it. `openDb` runs PRAGMAs in
  // its constructor, and when those fail on a non-database `node:sqlite` leaves
  // the OS handle open — which on Windows makes the file undeletable. A 16-byte
  // read cannot leak anything.
  if (!looksLikeSqlite(sourcePath)) {
    throw new BackupError(`${sourcePath} is not a SQLite database`);
  }

  let source: ReturnType<typeof openDb> | undefined;
  let expectedEvents: number;
  try {
    source = openDb(sourcePath);
    expectedEvents = Number(
      source.get<{ n: number }>('SELECT COUNT(*) AS n FROM ledger_events')?.n ?? 0,
    );
    // WAL mode keeps recent writes outside the main file; checkpoint so the copy
    // is complete rather than merely recent.
    source.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch (err) {
    throw new BackupError(`cannot read the source database: ${(err as Error).message}`);
  } finally {
    source?.close();
  }

  mkdirSync(destinationDir, { recursive: true });
  const path = join(destinationDir, fileName ?? backupFilename(nowIso));

  // ⚠️ Verify THEN promote, never promote then verify. Writing straight to the
  // destination would let a corrupt source destroy a good previous backup before
  // anyone discovered it was corrupt. The copy lands on a temporary name and is
  // renamed over the target only once it has proven it opens.
  const staging = `${path}.tmp`;
  copyFileSync(sourcePath, staging);

  // Verify by actually opening it. A file of the right size that will not open
  // is the worst possible outcome: it looks like a backup until you need it.
  let events = 0;
  let chainOk = false;
  const discard = (message: string): never => {
    try {
      unlinkSync(staging);
    } catch {
      // Nothing useful to do; the real failure is the one being reported.
    }
    throw new BackupError(message);
  };

  try {
    if (!looksLikeSqlite(staging)) throw new Error('the copy is not a SQLite file');
    const copy = new FundStore(openDb(staging));
    try {
      events = copy.events().length;
      chainOk = copy.verifyChain().ok;
      copy.state(); // asserts every invariant on the restored data
    } finally {
      copy.close();
    }
  } catch (err) {
    discard(`the copy would not open: ${(err as Error).message}`);
  }

  if (events !== expectedEvents) {
    discard(`the copy has ${events} events but the source has ${expectedEvents}`);
  }
  if (!chainOk) discard('the copy failed its hash-chain check');

  // Proven good. Now, and only now, replace whatever was there.
  renameSync(staging, path);

  return { path, bytes: statSync(path).size, events, chainOk };
}

export interface BackupInfo {
  readonly path: string;
  readonly bytes: number;
  readonly modified: string;
}

export function listBackups(destinationDir: string): BackupInfo[] {
  let entries: string[];
  try {
    entries = readdirSync(destinationDir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.startsWith('resale-') && f.endsWith('.db'))
    .map((f) => {
      const path = join(destinationDir, f);
      const s = statSync(path);
      return { path, bytes: s.size, modified: s.mtime.toISOString() };
    })
    .sort((a, b) => (a.path < b.path ? 1 : -1));
}

export function defaultBackupDir(dbPath: string): string {
  return join(dirname(dbPath), 'backups');
}

// ---------------------------------------------------------------------------
// what the fund remembers about its own backups
// ---------------------------------------------------------------------------

// Moved to `backup-types.ts` so a React Native build can compile them without
// `node:fs`. Re-exported here so nothing else had to change.
export {
  DEFAULT_BACKUP_SETTINGS,
  EMPTY_BACKUP_STATE,
  backupStaleness,
  type BackupSettings,
  type BackupState,
} from './backup-types.js';
import type { BackupSettings, BackupState } from './backup-types.js';

/**
 * Keep `latest` plus one dated file per day inside the window.
 *
 * ⚠️ Never prunes down to nothing. A retention rule that can empty the directory
 * is a delete script wearing a backup's clothes.
 */
export function pruneBackups(
  destinationDir: string,
  nowIso: string,
  retainDays: number,
): string[] {
  const cutoffMs = Date.parse(nowIso) - retainDays * 24 * 60 * 60 * 1000;
  const dated = listBackups(destinationDir).filter(
    (b) => !b.path.endsWith(LATEST_BACKUP_NAME),
  );

  const removed: string[] = [];
  for (const backup of dated) {
    const stamp = /resale-(\d{4}-\d{2}-\d{2})/.exec(backup.path)?.[1];
    if (!stamp) continue;
    if (Date.parse(`${stamp}T00:00:00.000Z`) >= cutoffMs) continue;
    // Guard: never remove the last dated copy, however old it is.
    if (dated.length - removed.length <= 1) break;
    try {
      unlinkSync(backup.path);
      removed.push(backup.path);
    } catch {
      // A locked file is not worth failing a backup over.
    }
  }
  return removed;
}

export interface RetainedBackupResult {
  readonly latest: BackupResult;
  readonly daily: BackupResult | null;
  readonly pruned: readonly string[];
}

/**
 * The routine: refresh `latest`, ensure today has a dated copy, prune the tail.
 *
 * `latest` is written every time so a restore is never more than one command
 * stale. The dated files exist so a mistake discovered next week can be undone
 * to a point in time, which `latest` alone cannot do.
 */
export function backupWithRetention(
  sourcePath: string,
  settings: BackupSettings,
  nowIso: string,
): RetainedBackupResult {
  const latest = backupDatabase(sourcePath, settings.directory, nowIso, LATEST_BACKUP_NAME);

  const dailyName = dailyBackupFilename(nowIso);
  const alreadyToday = listBackups(settings.directory).some((b) => b.path.endsWith(dailyName));
  const daily = alreadyToday
    ? null
    : backupDatabase(sourcePath, settings.directory, nowIso, dailyName);

  return {
    latest,
    daily,
    pruned: pruneBackups(settings.directory, nowIso, settings.retainDays),
  };
}

/** How far behind the backup is, in the only unit that matters: events. */
