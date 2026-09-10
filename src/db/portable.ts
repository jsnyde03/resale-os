/**
 * Moving a fund between machines, and proving nothing changed on the way.
 *
 * ⚡ **A ledger is its COMMANDS.** Postings, items and expense rows are all
 * derived — `commit()` rebuilds every one of them from the command that caused
 * it. So a fund travels as the command log plus the config, and the receiving
 * machine *replays* it rather than copying a binary.
 *
 * ⛔ **And that is what makes the move verifiable.** Every regenerated event's
 * hash is compared against the exported one. If a single byte of the engine
 * behaves differently — a rounding change, a key order, a platform quirk — the
 * hashes diverge and the import **refuses**. Copying a `.db` file would move
 * the bytes without ever asking whether the new machine agrees with them.
 *
 * ⚠️ This is the one file in the project that is not regenerable, so the import
 * is written to fail loudly and leave the destination unusable rather than
 * half-populated. It runs inside a transaction.
 *
 * ⛔ **WHAT DELIBERATELY DOES NOT TRAVEL: scored opportunities.**
 *
 * The `opportunities` table is neither a command nor config. It is also not
 * derivable — it records what was *decided*, when, and under which policy
 * version, and no replay can reconstruct that. So it is **device-local**, and a
 * lost phone loses the scoring history while the money survives intact.
 *
 * That is a decision (**6.0.5**, 2026-09-10), not an oversight. Carrying rows a
 * replay cannot check would cost this format the one property that makes moving
 * a fund trustworthy: **everything in the file is verified by regenerating it.**
 * Scoring history is advisory — it feeds a rejection histogram and a watchlist.
 * The ledger is not, and it is what the guarantee is spent on.
 *
 * ⚠️ `tests/portable.test.ts` pins the top-level shape so this stays a decision
 * rather than drifting the first time someone finds it convenient.
 */

import type { Db } from './db-types.js';
import { FundStore, type Clock } from './store.js';
import { migrateWith } from './migrate-core.js';
import { reconcile } from './replay.js';
import type { Command } from '../core/capital/commands.js';

/** Bumped when the shape changes. An importer refusing an unknown one is correct. */
export const LEDGER_EXPORT_VERSION = 1;

export interface ExportedEvent {
  readonly eventId: string;
  /** The hash the SOURCE machine computed. The destination must reproduce it. */
  readonly hash: string;
  /** The command that caused the event. Everything else is derived from this. */
  readonly command: Command;
}

export interface LedgerExport {
  readonly version: number;
  readonly exportedAt: string;
  readonly config: Readonly<Record<string, string>>;
  readonly events: readonly ExportedEvent[];
}

export class LedgerTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerTransferError';
  }
}

interface EventRow {
  event_id: string;
  hash: string;
  payload_json: string;
}

interface ConfigRow {
  key: string;
  value_json: string;
}

export function exportLedger(db: Db, exportedAt: string): LedgerExport {
  const events = db
    .all<EventRow>('SELECT event_id, hash, payload_json FROM ledger_events ORDER BY id')
    .map((r) => ({
      eventId: r.event_id,
      hash: r.hash,
      command: JSON.parse(r.payload_json) as Command,
    }));

  // Config travels verbatim: policy, tax profile, table acceptance, backup
  // settings. Replaying under a DIFFERENT policy would produce different
  // allocations and therefore different hashes, so this is not optional.
  const config: Record<string, string> = {};
  for (const row of db.all<ConfigRow>('SELECT key, value_json FROM config')) {
    config[row.key] = row.value_json;
  }

  return { version: LEDGER_EXPORT_VERSION, exportedAt, config, events };
}

export interface ImportReport {
  readonly events: number;
  /** Every regenerated hash matched the exported one. */
  readonly hashesMatched: boolean;
  readonly chainOk: boolean;
  readonly reconciled: boolean;
}

/**
 * Replay an export into an EMPTY database, refusing anything that does not
 * reproduce exactly.
 *
 * @param db     an empty database; it is migrated here
 * @param clock  supplies `recorded_at`, which is not hashed and may differ
 */
export function importLedger(db: Db, exported: LedgerExport, clock: Clock): ImportReport {
  if (exported.version !== LEDGER_EXPORT_VERSION) {
    throw new LedgerTransferError(
      `export is version ${exported.version}; this build reads ${LEDGER_EXPORT_VERSION}`,
    );
  }

  migrateWith(db, clock());

  const existing = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ledger_events');
  if ((existing?.n ?? 0) > 0) {
    // ⛔ Never merge. Two ledgers interleaved would break the hash chain and
    // there is no defensible order for the result.
    throw new LedgerTransferError('destination already has events; import needs an empty ledger');
  }

  // Config BEFORE the replay: the policy in force decides how profit is split,
  // so replaying under the wrong one produces different postings and different
  // hashes.
  for (const [key, value] of Object.entries(exported.config)) {
    db.run(
      `INSERT INTO config (key, value_json, updated_at) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
                                      updated_at = excluded.updated_at`,
      [key, value, clock()],
    );
  }

  const store = new FundStore(db, clock);
  const mismatches: string[] = [];

  for (const { eventId, hash, command } of exported.events) {
    const result = store.commit(command);
    if (result.event.eventId !== eventId) {
      mismatches.push(`expected ${eventId}, replayed as ${result.event.eventId}`);
      break;
    }
    const stored = db.get<{ hash: string }>('SELECT hash FROM ledger_events WHERE event_id = ?', [
      eventId,
    ]);
    if (stored?.hash !== hash) {
      // The engine on this machine produced a different event from the same
      // command. That is the failure this whole mechanism exists to catch.
      mismatches.push(`${eventId}: expected hash ${hash}, got ${stored?.hash}`);
      break;
    }
  }

  if (mismatches.length > 0) {
    throw new LedgerTransferError(
      `import does not reproduce the source ledger: ${mismatches.join('; ')}`,
    );
  }

  const chain = store.verifyChain();
  const recon = reconcile(store);
  if (!chain.ok) {
    throw new LedgerTransferError(`imported chain does not verify at ${chain.brokenAt}`);
  }
  if (!recon.ok) {
    throw new LedgerTransferError(`imported ledger does not reconcile: ${recon.differences.join('; ')}`);
  }

  return {
    events: exported.events.length,
    hashesMatched: true,
    chainOk: true,
    reconciled: true,
  };
}
