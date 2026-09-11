/**
 * The barcode resolver, against bytes that really arrived.
 *
 * ⛔ **Nothing here touches the network** — `fetch` is injected, and the
 * fixtures are verbatim responses captured 2026-09-11.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lookUpProduct, normaliseBarcode } from '@/adapters/upcitemdb.js';
import { keywordFor } from '@/core/product.js';

const fx = (n: string): unknown =>
  JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'upcitemdb', `${n}.json`), 'utf8'));

const FOUND = fx('found');
const PLACEHOLDER = fx('not-found');

const stub = (body: unknown, status = 200) =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof globalThis.fetch;

const dead = (() => Promise.reject(new Error('ENOTFOUND'))) as unknown as typeof globalThis.fetch;

describe('a barcode becomes a product', () => {
  it('reads title, brand and category off the real response', async () => {
    const r = await lookUpProduct('673419209366', { fetch: stub(FOUND) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.identity.title).toBe('LEGO Star Wars 75038 - Jedi Interceptor');
    expect(r.identity.brand).toBe('LEGO');
    expect(r.identity.category).toContain('Building Toys');
  });

  it('⚡ and the category is the second field a scan removes from the form', async () => {
    const r = await lookUpProduct('673419209366', { fetch: stub(FOUND) });
    if (!r.ok) throw new Error('expected a hit');
    expect(r.identity.category).not.toBeNull();
  });
});

describe('⛔ the vendor’s placeholders must read as absent', () => {
  it('treats brand "N/A" as no brand, so it never reaches a keyword', async () => {
    // Measured: an unregistered code came back with brand "N/A". Passed
    // through, the keyword becomes "n/a something" and searches nothing.
    const r = await lookUpProduct('000000000000', { fetch: stub(PLACEHOLDER) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.identity.brand).toBeNull();
    expect(keywordFor(r.identity).keyword).not.toContain('n/a');
    expect(keywordFor(r.identity).alternative).toBeNull();
  });

  it('and the control — a real brand survives', async () => {
    const r = await lookUpProduct('673419209366', { fetch: stub(FOUND) });
    if (!r.ok) throw new Error('expected a hit');
    expect(r.identity.brand).toBe('LEGO');
  });
});

describe('⛔ every failure is a value, and NOT_FOUND is normal', () => {
  it('a 200 with no items is NOT_FOUND, not a vendor fault', async () => {
    // The common case for an unlisted clearance SKU.
    const r = await lookUpProduct('012345678905', { fetch: stub({ code: 'OK', items: [] }) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('NOT_FOUND');
  });

  it('an unreachable network is OFFLINE', async () => {
    const r = await lookUpProduct('012345678905', { fetch: dead });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('OFFLINE');
  });

  it('separates a busy minute from an exhausted allowance', async () => {
    for (const [status, reason] of [[429, 'RATE_LIMITED'], [401, 'QUOTA_EXCEEDED'], [500, 'VENDOR']] as const) {
      const r = await lookUpProduct('012345678905', { fetch: stub({}, status) });
      expect(r.ok, String(status)).toBe(false);
      if (!r.ok) expect(r.reason).toBe(reason);
    }
  });

  it('refuses a scan that is not a retail barcode, without spending a request', async () => {
    let calls = 0;
    const counting = (async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const r = await lookUpProduct('12345', { fetch: counting });
    expect(r.ok).toBe(false);
    expect(calls).toBe(0);
  });
});

describe('barcode normalisation', () => {
  it('accepts the four forms retail uses and strips a scanner’s noise', () => {
    expect(normaliseBarcode(' 673419209366 ')).toBe('673419209366');
    expect(normaliseBarcode('0-73419-20936-6')).toBe('073419209366');
    expect(normaliseBarcode('12345678')).toBe('12345678');
  });

  it('refuses anything that is not one of them', () => {
    for (const bad of ['', '123', '1234567890123456', 'abcdefghijkl']) {
      expect(normaliseBarcode(bad), bad).toBeNull();
    }
  });
});
