/**
 * The database contract, with no implementation attached.
 *
 * ⚠️ Split out of `driver.ts` on 2026-09-09, when the phone port needed the
 * *interface* without dragging `node:sqlite` into a React Native typecheck.
 * That it was ever in the same file as its Node implementation was the real
 * flaw — an interface that only one platform can compile is not an interface.
 *
 * Five methods wide on purpose: porting means implementing this, not touching
 * application code. `mobile/src/db/expo-driver.ts` is the second implementation
 * and `src/db/driver-contract.ts` is what holds them to the same behaviour.
 */

export type SqlParam = string | number | null | bigint | Uint8Array;

/**
 * The reading half.
 *
 * The dashboard is handed this rather than `Db`, so a screen cannot reach
 * `run`, `exec` or `transaction` even by accident. A positive allowlist on
 * purpose: a write method added to `Db` later is NOT exposed by default.
 */
export interface ReadOnlyDb {
  all<T = Record<string, unknown>>(sql: string, params?: readonly SqlParam[]): T[];
  get<T = Record<string, unknown>>(sql: string, params?: readonly SqlParam[]): T | undefined;
}

export interface Db extends ReadOnlyDb {
  exec(sql: string): void;
  run(sql: string, params?: readonly SqlParam[]): { changes: number };
  /** Re-entrant: nested calls use SAVEPOINTs so composing writes is safe. */
  transaction<T>(fn: () => T): T;
  close(): void;
}

/** node:sqlite rejects booleans and undefined outright; normalise at the boundary. */
export function toParam(value: unknown): SqlParam {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') {
    return value;
  }
  if (value instanceof Uint8Array) return value;
  return JSON.stringify(value);
}

export function toParams(values: readonly unknown[]): SqlParam[] {
  return values.map(toParam);
}
