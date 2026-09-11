/**
 * The data route, against bytes that really arrived.
 *
 * ⛔ **The fixtures are verbatim responses**, captured 2026-09-11 and committed
 * under `tests/fixtures/soldcomps/`. A hand-written fixture would encode what I
 * expected the vendor to send — and the single most dangerous thing in this
 * route, `"240,000+"`, is exactly what nobody would have hand-written.
 *
 * ⛔ **Nothing here touches the network.** `fetch` is injected, so the suite
 * runs offline, on a runner, and without a key.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lookUpMarket, SOLDCOMPS_BASE_URL, type SoldCompsConfig } from '@/adapters/soldcomps.js';
import type { MarketResult } from '@/core/market.js';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures', 'soldcomps');
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'));

const ACTIVE = fixture('active');
const SOLD_PINNED = fixture('sold-pinned');
const SOLD_BROAD = fixture('sold-broad');
const HEADERS = fixture('headers-sold') as Record<string, string>;

const NOW = new Date('2026-09-11T12:00:00.000Z');

/** Records every request, so the ORDER and the pinning can be asserted. */
function stubFetch(
  pages: readonly unknown[],
  options: { status?: number; body?: unknown; headers?: Record<string, string> } = {},
) {
  const calls: URL[] = [];
  let n = 0;
  const fetchStub = (async (input: string | URL) => {
    calls.push(new URL(String(input)));
    const body = options.body ?? pages[n++];
    return new Response(JSON.stringify(body), {
      status: options.status ?? 200,
      headers: { 'content-type': 'application/json', ...HEADERS, ...options.headers },
    });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetchStub };
}

const config = (fetchStub: typeof globalThis.fetch): SoldCompsConfig => ({
  apiKey: 'sc_test',
  fetch: fetchStub,
  now: () => NOW,
});

const expectOk = (r: MarketResult) => {
  if (!r.ok) throw new Error(`expected a reading, got ${r.reason}: ${r.detail}`);
  return r.reading;
};

describe('B82 — ACTIVE first, and SOLD pinned to the category it declares', () => {
  it('⛔ makes exactly two requests, active before sold', () => {
    const { calls, fetchStub } = stubFetch([ACTIVE, SOLD_PINNED]);
    return lookUpMarket('lego star wars', config(fetchStub)).then(() => {
      expect(calls).toHaveLength(2);
      expect(calls[0]?.searchParams.get('sold')).toBe('false');
      expect(calls[1]?.searchParams.get('sold')).toBe('true');
      const first = calls[0] as URL;
      expect(`${first.origin}${first.pathname}`).toBe(SOLDCOMPS_BASE_URL);
    });
  });

  it('⛔ pins the SOLD call to the category ACTIVE auto-selected', async () => {
    // The whole finding in one assertion. Without this the two halves of the
    // ratio are counted over different populations — measured at a 17% swing.
    const { calls, fetchStub } = stubFetch([ACTIVE, SOLD_PINNED]);
    await lookUpMarket('lego star wars', config(fetchStub));
    expect((ACTIVE as { autoSelectedCategory: { id: string } }).autoSelectedCategory.id).toBe(
      '183447',
    );
    expect(calls[1]?.searchParams.get('categoryId')).toBe('183447');
  });

  it('sends no categoryId when the vendor declared none', async () => {
    // ⚠️ The control. Without it the assertion above passes for a client that
    // hard-codes a category, which is the opposite of reading what was declared.
    const noCategory = { ...(ACTIVE as object), autoSelectedCategory: null };
    const { calls, fetchStub } = stubFetch([noCategory, SOLD_BROAD]);
    await lookUpMarket('lego star wars', config(fetchStub));
    expect(calls[1]?.searchParams.has('categoryId')).toBe(false);
  });

  it('reports the category both counts were measured in', async () => {
    const { fetchStub } = stubFetch([ACTIVE, SOLD_PINNED]);
    const reading = expectOk(await lookUpMarket('lego star wars', config(fetchStub)));
    expect(reading.provenance.categoryId).toBe('183447');
    expect(reading.provenance.categoryName).toBe('LEGO (R) Building Toys');
  });
});

describe('the captured responses become numbers the gates can use', () => {
  it('reads both counts, and only ACTIVE is a floor', async () => {
    const { fetchStub } = stubFetch([ACTIVE, SOLD_PINNED]);
    const reading = expectOk(await lookUpMarket('lego star wars', config(fetchStub)));

    expect(reading.sold90).toEqual({ value: 122_956, isFloor: false });
    expect(reading.active).toEqual({ value: 240_000, isFloor: true });
  });

  it('turns sold prices into exact cents, with no float anywhere', async () => {
    const { fetchStub } = stubFetch([ACTIVE, SOLD_PINNED]);
    const reading = expectOk(await lookUpMarket('lego star wars', config(fetchStub)));

    expect(reading.compPricesCents.length).toBeGreaterThan(30);
    for (const c of reading.compPricesCents) expect(Number.isInteger(c)).toBe(true);
    // The first item of the captured sold page, read off the bytes.
    const first = (SOLD_PINNED as { items: { soldPrice: string }[] }).items[0]!.soldPrice;
    expect(reading.compPricesCents[0]).toBe(Math.round(Number(first) * 100));
  });

  it('derives the comp age from endedAt rather than defaulting it', async () => {
    const { fetchStub } = stubFetch([ACTIVE, SOLD_PINNED]);
    const reading = expectOk(await lookUpMarket('lego star wars', config(fetchStub)));
    expect(reading.compMedianAgeDays).toBeGreaterThanOrEqual(0);
    expect(reading.compMedianAgeDays).toBeLessThan(90);
  });

  it('asks for a 90-day sold window', async () => {
    const { calls, fetchStub } = stubFetch([ACTIVE, SOLD_PINNED]);
    await lookUpMarket('lego star wars', config(fetchStub));
    expect(calls[1]?.searchParams.get('soldAfter')).toBe('2026-06-13');
  });

  it('B80 — reports what was searched and how many matched', async () => {
    const { fetchStub } = stubFetch([ACTIVE, SOLD_PINNED]);
    const reading = expectOk(await lookUpMarket('  lego star wars  ', config(fetchStub)));
    expect(reading.provenance.keyword).toBe('lego star wars');
    expect(reading.provenance.activeItemsSeen).toBe(200);
    expect(reading.provenance.soldItemsSeen).toBe(40);
  });

  it('B78 — carries the metered quota off the real headers', async () => {
    // ⚠️ The vendor's docs name these `X-Usage-Current` / `X-Usage-Limit`.
    // These names came off a captured response instead, which is why they work.
    const { fetchStub } = stubFetch([ACTIVE, SOLD_PINNED]);
    const reading = expectOk(await lookUpMarket('lego star wars', config(fetchStub)));
    expect(reading.quota.monthlyLimit).toBe(100);
    expect(reading.quota.monthlyRemaining).toBe(95);
    expect(reading.quota.resetAt).toBe('2026-10-11T11:28:53.674Z');
  });
});

describe('⛔ it never throws and it never gates — every failure is a value', () => {
  it('an unreachable network is OFFLINE, not an exception', async () => {
    const dead = (() => Promise.reject(new Error('getaddrinfo ENOTFOUND'))) as unknown as
      typeof globalThis.fetch;
    const r = await lookUpMarket('anything', config(dead));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('OFFLINE');
  });

  it('separates an exhausted month from a busy minute', async () => {
    const quota = stubFetch([], {
      status: 429,
      body: { code: 'quota_exceeded', reset_at: '2026-10-11T11:28:53.674Z' },
    });
    const rq = await lookUpMarket('x', config(quota.fetchStub));
    expect(rq.ok).toBe(false);
    if (!rq.ok) {
      expect(rq.reason).toBe('QUOTA_EXCEEDED');
      expect(rq.detail).toContain('2026-10-11');
      // It still reports what is left, which is what the screen shows.
      expect(rq.quota?.monthlyLimit).toBe(100);
    }

    const busy = stubFetch([], { status: 429, body: { code: 'rate_limited' } });
    const rr = await lookUpMarket('x', config(busy.fetchStub));
    expect(rr.ok).toBe(false);
    if (!rr.ok) expect(rr.reason).toBe('RATE_LIMITED');
  });

  it('a refused key is AUTH, and a vendor fault is VENDOR', async () => {
    for (const [status, reason] of [
      [401, 'AUTH'],
      [403, 'AUTH'],
      [500, 'VENDOR'],
    ] as const) {
      const { fetchStub } = stubFetch([], { status, body: {} });
      const r = await lookUpMarket('x', config(fetchStub));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe(reason);
    }
  });

  it('⛔ REFUSES a market whose count will not parse, rather than defaulting it', async () => {
    // The plant. A total the parser rejects, on a page that also says there is
    // nothing more to fetch — so there is no honest fallback count either.
    const broken = { ...(ACTIVE as object), totalResults: 'lots', hasNextPage: false, items: [] };
    const { fetchStub } = stubFetch([broken, SOLD_PINNED]);
    const r = await lookUpMarket('lego star wars', config(fetchStub));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('UNPARSEABLE');
      expect(r.detail).toContain('lots');
    }
  });

  it('falls back to the page count as a FLOOR when the total is missing', async () => {
    // ⚠️ The other direction of the same plant. An unusable total plus
    // `hasNextPage` still yields an honest fact: at least this many exist.
    const noTotal = { ...(ACTIVE as object), totalResults: null };
    const { fetchStub } = stubFetch([noTotal, SOLD_PINNED]);
    const reading = expectOk(await lookUpMarket('lego star wars', config(fetchStub)));
    expect(reading.active).toEqual({ value: 200, isFloor: true });
  });

  it('refuses an empty keyword without spending a request', async () => {
    const { calls, fetchStub } = stubFetch([ACTIVE, SOLD_PINNED]);
    const r = await lookUpMarket('   ', config(fetchStub));
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
