/**
 * The hash swap had to be byte-identical, and this is what says so.
 *
 * ⛔ The live ledger's stored hashes were computed with `node:crypto`. Moving to
 * `@noble/hashes` for the phone would break `verifyChain()` on real data if the
 * two disagreed by a single byte — and the symptom would be a fund that reports
 * its own ledger as tampered with.
 *
 * ⚠️ This is a genuine two-source comparison: `node:crypto` is the platform's
 * OpenSSL, noble is independent JavaScript. Neither is derived from the other.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { canonicalize, hashEvent } from '@/db/hash.js';
import type { LedgerEvent } from '@/core/ledger/types.js';

const nodeSha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const nobleSha = (s: string) => bytesToHex(sha256(new TextEncoder().encode(s)));

describe('noble and node:crypto agree, byte for byte', () => {
  it('agrees on the shapes the ledger actually hashes', () => {
    const cases = [
      '',
      '|{}',
      '{"eventId":"evt_000001","type":"CONTRIBUTION"}',
      // A previous hash concatenated with a body — the real input shape.
      `${'a'.repeat(64)}|{"amountCents":-5000}`,
      // Non-ASCII, because the memo field carries whatever a human typed.
      '{"memo":"café — naïve · £20"}',
      '{"memo":"日本語のメモ"}',
      // Long, to cross the block boundary.
      'x'.repeat(1000),
    ];
    for (const c of cases) {
      expect(nobleSha(c), `disagreed on ${JSON.stringify(c.slice(0, 40))}`).toBe(nodeSha(c));
    }
  });

  it('agrees across a thousand pseudo-random inputs', () => {
    // Deterministic, so a failure is reproducible — no Math.random.
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    for (let i = 0; i < 1000; i += 1) {
      const s = String.fromCharCode(...Array.from({ length: (next() % 60) + 1 }, () => (next() % 90) + 32));
      expect(nobleSha(s)).toBe(nodeSha(s));
    }
  });
});

describe('hashEvent still produces the values the live ledger stores', () => {
  const event: LedgerEvent = {
    eventId: 'evt_000001',
    type: 'CONTRIBUTION',
    occurredAt: '2026-09-08T15:45:41.139Z',
    postings: [
      { account: 'LIQUID', amountCents: 5_000 },
      { account: 'CONTRIBUTED_CAPITAL', amountCents: -5_000 },
    ],
    payload: { type: 'CONTRIBUTION', amountCents: 5_000, occurredAt: '2026-09-08T15:45:41.139Z' },
  };

  it('matches a node:crypto computation of the same canonical body', () => {
    // Recomputes the documented algorithm independently and compares.
    // ⚠️ The postings are normalised (`memo: p.memo ?? null`) before hashing.
    // The first version of this test omitted that and failed — the TEST was
    // wrong, not the code, which is worth recording because the failure looked
    // exactly like a broken hash swap.
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
    expect(hashEvent(event, null)).toBe(nodeSha(`|${body}`));
    expect(hashEvent(event, 'a'.repeat(64))).toBe(nodeSha(`${'a'.repeat(64)}|${body}`));

    // ⛔ A golden value, pinned. The comparison above shares `canonicalize`
    // with the implementation, so it cannot catch a change to WHAT is hashed —
    // only to how. This can: if the body construction ever changes, every hash
    // in the live ledger becomes wrong and this line goes red first.
    expect(hashEvent(event, null)).toBe(
      '47c518e9368b3bb94a331dcdece0675c07df8c7112b78c2726483ef24727c87b',
    );
  });

  it('changes when anything in the event changes', () => {
    const base = hashEvent(event, null);
    expect(hashEvent({ ...event, memo: 'edited' }, null)).not.toBe(base);
    expect(hashEvent(event, 'b'.repeat(64))).not.toBe(base);
  });
});
