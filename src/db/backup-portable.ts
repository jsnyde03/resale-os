/**
 * A backup that proves itself by being restored.
 *
 * ⛔ **Not a copy of the database file.** The desktop copies `resale.db` and
 * verifies the copy opens and its chain verifies — good, and it still only
 * proves the bytes moved. This exports the ledger's **commands** and then
 * *replays them into a scratch database*, comparing every regenerated hash
 * against the exported one. If this build's engine cannot reproduce the fund
 * from its own history, the backup is refused rather than written.
 *
 * ⚡ That is a strictly stronger guarantee, and it is the one that matters:
 * the failure a backup exists to survive is not "the file went missing", it is
 * "the file is there and will not come back".
 *
 * It is also platform-free — JSON, no filesystem, no `node:*` — so the phone
 * and the desktop make the same artefact and either can restore the other.
 */

import type { Db } from './db-types.js';
import { exportLedger, importLedger, type LedgerExport } from './portable.js';
import type { Clock } from './store.js';

export class BackupRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupRefused';
  }
}

export interface VerifiedBackup {
  /** What to write out. */
  readonly json: string;
  readonly exportedAt: string;
  readonly events: number;
  readonly bytes: number;
  /** A name that sorts chronologically and says what it is. */
  readonly suggestedFilename: string;
}

/**
 * ⚠️ Colons are legal in a filename on iOS and a menace everywhere else — the
 * Files app renders them as `/`, and a file AirDropped to a Mac arrives
 * mangled. A backup you cannot open on the machine you fled to is not a backup.
 */
export function backupFilename(exportedAt: string): string {
  return `resale-ledger-${exportedAt.replace(/[:.]/g, '-')}.json`;
}

/**
 * Export, restore into a scratch database, and only then hand back the bytes.
 *
 * @param openScratch an EMPTY database to replay into. It is migrated here and
 *                    discarded; nothing is written to the live ledger.
 */
export function makeVerifiedBackup(
  db: Db,
  openScratch: () => Db,
  clock: Clock,
): VerifiedBackup {
  const exportedAt = clock();
  const exported: LedgerExport = exportLedger(db, exportedAt);

  if (exported.events.length === 0) {
    throw new BackupRefused('there is nothing to back up yet');
  }

  // ⛔ The restore happens HERE, before the file exists — not the first time it
  // is needed. A backup nobody has restored is a rumour about a backup.
  const scratch = openScratch();
  try {
    const report = importLedger(scratch, exported, () => exportedAt);
    if (report.events !== exported.events.length) {
      throw new BackupRefused(
        `the replay produced ${report.events} events from ${exported.events.length}`,
      );
    }
  } catch (err) {
    if (err instanceof BackupRefused) throw err;
    throw new BackupRefused(`this ledger does not restore: ${(err as Error).message}`);
  } finally {
    try {
      scratch.close();
    } catch {
      // A close failure must not mask the result of the check it was part of.
    }
  }

  const json = JSON.stringify(exported);
  return {
    json,
    exportedAt,
    events: exported.events.length,
    // ⚠️ The JSON is ASCII-safe (hashes are hex, amounts are integers, memos
    // are the operator's own text), but a memo can carry anything typed into a
    // phone keyboard — so the size is measured in BYTES, not characters.
    bytes: new TextEncoder().encode(json).length,
    suggestedFilename: backupFilename(exportedAt),
  };
}

/**
 * How far behind the last successful backup is.
 *
 * Shared with the desktop's staleness rule so both surfaces agree on when to
 * start nagging. Zero events behind is current; anything else is not.
 */
export function eventsBehind(lastBackedUpEventCount: number, eventCount: number): number {
  return Math.max(0, eventCount - lastBackedUpEventCount);
}
