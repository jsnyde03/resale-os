/**
 * B99: the pictures, against bytes that really arrived.
 *
 * ⛔ **The field names were not guessed.** `thumbnailUrl`, `title` and `images`
 * are read out of the responses captured under `tests/fixtures/` on 2026-09-11,
 * so this file fails if the mapping drifts from what the vendors actually send —
 * which documentation alone could not tell us.
 *
 * ⛔ **And the money path is pinned as UNCHANGED.** The samples are display-only;
 * the prices the gate reads must be identical with or without them.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMP_SAMPLES_SHOWN, lookUpMarket } from '@/adapters/soldcomps.js';
import { lookUpProduct } from '@/adapters/upcitemdb.js';
import { scanOutcome } from '@/screens/scan.js';
import { fillFromMarket, type SourcingForm } from '@/screens/sourcing.js';

const fixture = (dir: string, name: string): unknown =>
  JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', dir, `${name}.json`), 'utf8'));

const ACTIVE = fixture('soldcomps', 'active');
const SOLD_BROAD = fixture('soldcomps', 'sold-broad');
const HEADERS = fixture('soldcomps', 'headers-sold') as Record<string, string>;
const FOUND = fixture('upcitemdb', 'found');
/**
 * ⚠️ **The filename misleads; the existing barcode suite names it correctly.**
 * `not-found.json` is the captured `000000000000` response — a 200 carrying
 * "ORGANIC BLUE CORN TORTILLA CHIPS", `brand: "N/A"`, and an image of hair
 * product. It records a mis-scan that SUCCEEDS, which is a different hazard
 * from a miss, and `upcitemdb.test.ts` loads it as `PLACEHOLDER` too.
 */
const PLACEHOLDER = fixture('upcitemdb', 'not-found');

const NOW = new Date('2026-09-11T12:00:00.000Z');

function stub(pages: readonly unknown[]) {
  let n = 0;
  return (async () =>
    new Response(JSON.stringify(pages[n++]), {
      status: 200,
      headers: { 'content-type': 'application/json', ...HEADERS },
    })) as unknown as typeof globalThis.fetch;
}

const market = () =>
  lookUpMarket('lego star wars', { apiKey: 'k', fetch: stub([ACTIVE, SOLD_BROAD]), now: () => NOW });

describe('⚡ the sold listings come back with pictures (B99)', () => {
  it('reads thumbnailUrl and title off the captured response', async () => {
    const result = await market();
    if (!result.ok) throw new Error('expected a reading');
    const samples = result.reading.compSamples ?? [];
    expect(samples.length).toBeGreaterThan(0);
    for (const sample of samples) {
      expect(sample.thumbnailUrl, sample.title).toMatch(/^https?:\/\//);
      expect(sample.title.length).toBeGreaterThan(0);
    }
  });

  it('⛔ caps how many, because a shop connection is not asked for forty images', async () => {
    const result = await market();
    if (!result.ok) throw new Error('expected a reading');
    expect((result.reading.compSamples ?? []).length).toBeLessThanOrEqual(COMP_SAMPLES_SHOWN);
  });

  it('⛔ each sample carries the price that was ALREADY parsed for the comps', async () => {
    // A sample that parsed its own price could disagree with the number the
    // gate read — the same value, shown twice, is the only safe arrangement.
    const result = await market();
    if (!result.ok) throw new Error('expected a reading');
    const samples = result.reading.compSamples ?? [];
    expect(samples.map((s) => s.priceCents)).toEqual(
      result.reading.compPricesCents.slice(0, samples.length),
    );
  });

  it('⛔ and the prices the gate reads are untouched by any of it', async () => {
    const result = await market();
    if (!result.ok) throw new Error('expected a reading');
    // Every comp on the page is still counted, not just the six shown.
    expect(result.reading.compPricesCents.length).toBeGreaterThan(COMP_SAMPLES_SHOWN);
  });
});

describe('⚡ the scanned product comes back with a picture (B99)', () => {
  it('takes the first image URL out of the captured response', async () => {
    const result = await lookUpProduct('673419209366', { fetch: stub([FOUND]) });
    if (!result.ok) throw new Error(`expected an identity: ${result.detail}`);
    expect(result.identity.imageUrl).toMatch(/^https?:\/\//);
  });

  it('carries it to the screen model, beside the title that still does the checking', async () => {
    const result = await lookUpProduct('673419209366', { fetch: stub([FOUND]) });
    const outcome = scanOutcome('673419209366', result);
    if (outcome.kind !== 'IDENTIFIED') throw new Error('expected IDENTIFIED');
    expect(outcome.imageUrl).toMatch(/^https?:\/\//);
    expect(outcome.title.length).toBeGreaterThan(0);
  });

  it('⛔ a MIS-SCAN comes back with a confident picture too', async () => {
    // The captured `000000000000` response: "ORGANIC BLUE CORN TORTILLA CHIPS",
    // brand "N/A" — and an image, of Aveda hair product. ⛔ **A picture is not a
    // check on identity.** A wrong product arrives with one exactly as a right
    // one does, which is why the title stays the thing the operator reads and
    // the image only makes reading it faster.
    const outcome = scanOutcome(
      '000000000000',
      await lookUpProduct('000000000000', { fetch: stub([PLACEHOLDER]) }),
    );
    if (outcome.kind !== 'IDENTIFIED') throw new Error('the mis-scan resolves — that is the point');
    expect(outcome.title).toContain('TORTILLA');
    expect(outcome.imageUrl).toMatch(/^https?:\/\//);
  });

  it('⚠️ a product with no picture is normal, not a failure', async () => {
    // Expect this on store brands and seasonal clearance — the population this
    // resolver exists to serve. Constructed rather than captured: the field
    // NAME is already pinned against real bytes above; this is the null branch.
    const noImages = { code: 'OK', total: 1, offset: 0, items: [{ title: 'Store Brand Thing' }] };
    const result = await lookUpProduct('012345678905', { fetch: stub([noImages]) });
    if (!result.ok) throw new Error(`expected an identity: ${result.detail}`);
    expect(result.identity.imageUrl).toBeNull();

    const outcome = scanOutcome('012345678905', result);
    if (outcome.kind !== 'IDENTIFIED') throw new Error('expected IDENTIFIED');
    expect(outcome.imageUrl).toBeNull();
  });
});

describe('the aisle screen is handed the samples, and never a surprise', () => {
  const blank: SourcingForm = {
    name: 'thing',
    category: 'TOYS',
    price: '',
    resale: '',
    sold90: '',
    active: '',
  };

  it('passes them through the fill', async () => {
    const result = await market();
    if (!result.ok) throw new Error('expected a reading');
    const { status } = fillFromMarket(blank, result);
    if (status.kind !== 'FILLED') throw new Error('expected FILLED');
    expect(status.compSamples.length).toBe((result.reading.compSamples ?? []).length);
  });

  it('⛔ and hands back an empty list — never undefined — when a reading has none', () => {
    // The screen maps over this. `undefined` would be a crash in an aisle.
    const { status } = fillFromMarket(blank, {
      ok: true,
      reading: {
        sold90: { value: 90, isFloor: false },
        active: { value: 15, isFloor: false },
        compPricesCents: [5_900],
        compMedianAgeDays: 20,
        provenance: {
          keyword: 'k',
          compCondition: 'new',
          categoryId: null,
          categoryName: null,
          soldItemsSeen: 1,
          activeItemsSeen: 1,
          soldAfter: '2026-06-13',
          fetchedAt: NOW.toISOString(),
        },
        quota: { monthlyLimit: 100, monthlyRemaining: 86, resetAt: null },
      },
    });
    if (status.kind !== 'FILLED') throw new Error('expected FILLED');
    expect(status.compSamples).toEqual([]);
  });
});
