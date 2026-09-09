/**
 * Backup settings and state, with no filesystem attached.
 *
 * ⚠️ Split out of `backup.ts` on 2026-09-09 for the phone port. `FundStore`
 * needs these shapes and defaults; it does not need `node:fs`, and importing
 * the module that copies files dragged the whole desktop backup implementation
 * into a React Native bundle.
 *
 * Same flaw, same fix as `db-types.ts`: data a phone can compile, separated
 * from an implementation only a desktop can.
 */

export interface BackupSettings {
  /** Where copies go. Empty means "not configured", not "use a default". */
  readonly directory: string;
  /** Copy after every command that moves money. */
  readonly auto: boolean;
  /** Dated daily files older than this are pruned. `latest` never is. */
  readonly retainDays: number;
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  directory: '',
  auto: true,
  retainDays: 90,
};

export interface BackupState {
  readonly lastSuccessAt: string | null;
  /** Event count at the last success — the honest measure of staleness. */
  readonly lastSuccessEvents: number;
  readonly lastPath: string | null;
  readonly lastError: string | null;
  readonly lastErrorAt: string | null;
}

export const EMPTY_BACKUP_STATE: BackupState = {
  lastSuccessAt: null,
  lastSuccessEvents: 0,
  lastPath: null,
  lastError: null,
  lastErrorAt: null,
};

/** How far behind the last successful copy is, in events. Pure arithmetic. */
export function backupStaleness(
  state: BackupState,
  currentEvents: number,
): { behind: number; stale: boolean } {
  const behind = Math.max(0, currentEvents - state.lastSuccessEvents);
  return { behind, stale: state.lastSuccessAt === null || behind > 0 };
}
