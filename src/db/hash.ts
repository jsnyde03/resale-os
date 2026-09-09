/**
 * Tamper-evidence for the ledger.
 *
 * Each event's hash covers the previous hash plus a canonical serialisation of
 * the event, so editing any historical row breaks the chain from that row
 * forward. This is what "immutable-style" means here: the repository exposes no
 * UPDATE or DELETE path for events, and if someone edits the file by hand,
 * `verifyChain()` says exactly where.
 */

// ⚠️ `@noble/hashes` rather than `node:crypto`, because the ledger has to be
// hashed on a phone and React Native has no `node:crypto`. It is audited, pure
// JavaScript and synchronous — synchronous matters, because the chain is
// computed inside the write transaction and an async digest would make
// `commit()` async all the way up.
//
// ⛔ The switch had to be byte-identical: the live ledger's stored hashes were
// computed with `node:crypto`, so anything different would break `verifyChain`
// on real data. `tests/hash.test.ts` asserts the two agree.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { LedgerEvent } from '../core/ledger/types.js';

/** JSON with object keys sorted at every depth, so serialisation is stable. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}

export function hashEvent(event: LedgerEvent, prevHash: string | null): string {
  const body = canonicalize({
    eventId: event.eventId,
    type: event.type,
    occurredAt: event.occurredAt,
    itemId: event.itemId ?? null,
    memo: event.memo ?? null,
    postings: event.postings.map((p) => ({
      account: p.account,
      amountCents: p.amountCents,
      memo: p.memo ?? null,
    })),
    payload: event.payload,
  });
  // The separator is written out rather than embedded, so no invisible byte
  // can end up in this file. `prevHash` is 64 hex characters or empty and
  // `body` always starts with '{', so a printable delimiter is unambiguous.
  return bytesToHex(sha256(new TextEncoder().encode((prevHash ?? '') + '|' + body)));
}
