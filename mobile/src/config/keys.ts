/**
 * The only place in the app that reads a vendor key out of the environment.
 *
 * ⛔ **The reads must be LITERAL.** Metro inlines `EXPO_PUBLIC_*` variables by
 * matching the text of the access, so `process.env[someVariable]` compiles to
 * nothing on a device — it works in Node and returns undefined in the bundle.
 * That is why this file repeats the names rather than looping over
 * `VENDOR_KEYS`, and why `keys.ts` in `src/screens` holds every other fact
 * about them: the part that cannot be tested here is one line long.
 *
 * ⚠️ Three screens read these inline before this existed — sourcing, drops and
 * scan — and the backlog entry that filed it said "two, and a third will".
 * The third already did.
 */

import { keysStatus, type KeyStatus } from '../../../src/screens/keys.js';

/** ⛔ The only automated market route the fund has (D16). */
export const SOLDCOMPS_KEY = (process.env['EXPO_PUBLIC_SOLDCOMPS_KEY'] ?? '').trim();

/** ⚠️ Optional: UPCitemdb's trial tier answers without a key. */
export const UPCITEMDB_KEY = (process.env['EXPO_PUBLIC_UPCITEMDB_KEY'] ?? '').trim();

/** What Settings shows. Read-only by design — a key cannot be set on a device. */
export function vendorKeyStatus(): KeyStatus[] {
  return keysStatus({ soldcomps: SOLDCOMPS_KEY, upcitemdb: UPCITEMDB_KEY });
}
