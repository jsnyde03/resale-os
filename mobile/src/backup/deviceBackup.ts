/**
 * Backups, on the device that holds the only copy.
 *
 * ⛔ **The phone is the ledger now, and a phone is a thing that gets lost.**
 * The desktop backed up to OneDrive after every command that moved money; that
 * path dies with 5.10. This is its replacement, and it has a harder job: the
 * desktop's copy was already on a different disk from the original, and this
 * one starts out on the same device as the thing it is protecting.
 *
 * So it is two separate obligations, and only the first is automatic:
 *
 *   1. **A verified copy exists** — written after every write, cheap, and
 *      proven by replay before the file is created (`makeVerifiedBackup`).
 *   2. **A copy exists somewhere else** — the operator's job, because nothing
 *      here can put a file on another machine without a network service, and
 *      this phone may not carry one.
 *
 * ⚠️ A backup in the app's own Documents directory survives a crash, a bad
 * restore and a fat-fingered adjustment. It does **not** survive deleting the
 * app, losing the phone, or replacing it — which are the failures that end a
 * fund. `UIFileSharingEnabled` puts this directory in the Files app so the
 * copies can be dragged to iCloud Drive; that drag is obligation 2, and the
 * home screen says so until it happens.
 */

import { Directory, File, Paths } from 'expo-file-system';

import { makeVerifiedBackup, BackupRefused } from '../../../src/db/backup-portable.js';
import type { FundStore } from '../../../src/db/store.js';
import { systemClock } from '../../../src/db/store.js';
import { EMPTY_BACKUP_STATE, type BackupState } from '../../../src/db/backup-types.js';
import { openExpoDb } from '../db/expo-driver.js';

/** Where copies land. Visible in Files when `UIFileSharingEnabled` is set. */
export const BACKUP_DIR = 'backups';

/** ⚠️ Dated copies kept. The ledger is tens of KB; this is not a space problem. */
export const KEEP = 30;

export interface DeviceBackupResult {
  readonly ok: boolean;
  readonly path?: string;
  readonly events?: number;
  readonly bytes?: number;
  /** Present when it did not happen, in words an operator can act on. */
  readonly problem?: string;
}

function backupDirectory(): Directory {
  const dir = new Directory(Paths.document, BACKUP_DIR);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/**
 * Write one, having first proven it restores.
 *
 * ⛔ Never throws. A backup failure must not take down the command that
 * succeeded — the money moved, the ledger is correct, and the right response
 * is to say the copy did not happen, not to make the operator think their sale
 * was lost.
 */
export function writeDeviceBackup(store: FundStore): DeviceBackupResult {
  try {
    const backup = makeVerifiedBackup(store.db, () => openExpoDb(':memory:'), systemClock);
    const dir = backupDirectory();
    const file = new File(dir, backup.suggestedFilename);
    file.create({ overwrite: true });
    file.write(backup.json);

    // ⚠️ Recorded AFTER the write, and only then. `lastSuccessEvents` is what
    // the staleness warning reads; setting it before the file existed would
    // report a fund as backed up because it was about to be.
    const state: BackupState = {
      lastSuccessAt: backup.exportedAt,
      lastSuccessEvents: backup.events,
      lastPath: file.uri,
      lastError: null,
      lastErrorAt: null,
    };
    store.setBackupState(state);
    prune(dir);
    return { ok: true, path: file.uri, events: backup.events, bytes: backup.bytes };
  } catch (err) {
    const problem =
      err instanceof BackupRefused ? err.message : `the backup could not be written: ${String(err)}`;
    try {
      const previous = store.backupState();
      store.setBackupState({
        ...previous,
        lastError: problem,
        lastErrorAt: systemClock(),
      });
    } catch {
      // If even recording the failure fails, the returned result is the only
      // report there is — which is why it is a value and not a thrown error.
    }
    return { ok: false, problem };
  }
}

/**
 * Keep the newest `KEEP`.
 *
 * The filenames sort chronologically as plain text (that is why the timestamp
 * has no colons), so this needs no dates parsed and no clock.
 */
function prune(dir: Directory): void {
  try {
    const files = dir
      .list()
      .filter((entry): entry is File => entry instanceof File && entry.name.endsWith('.json'))
      .map((f) => f.name)
      .sort();
    for (const name of files.slice(0, Math.max(0, files.length - KEEP))) {
      new File(dir, name).delete();
    }
  } catch {
    // ⛔ Pruning is housekeeping. Failing it must never fail the backup that
    // has already been written and verified.
  }
}

/** Every copy on the device, newest first. */
export function listDeviceBackups(): { name: string; uri: string; bytes: number }[] {
  try {
    return backupDirectory()
      .list()
      .filter((entry): entry is File => entry instanceof File && entry.name.endsWith('.json'))
      .map((f) => ({ name: f.name, uri: f.uri, bytes: f.size ?? 0 }))
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch {
    return [];
  }
}

export { EMPTY_BACKUP_STATE };
