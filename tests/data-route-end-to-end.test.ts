/**
 * The whole route, on the bytes that really arrived.
 *
 * ⛔ **Every other test in this repo exercises one joint.** The adapter is
 * tested against fixtures, the fill against a synthetic reading, the gates
 * against hand-built candidates. This runs the real captured response all the
 * way to a verdict — which is the only place a mismatch BETWEEN those pieces
 * can show up.
 *
 * ⚠️ Nothing here touches the network; `fetch` is injected.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lookUpMarket } from '@/adapters/soldcomps.js';
import { evaluateForm, fillFromMarket, type SourcingForm } from '@/screens/sourcing.js';
import { compConfidence, COMP_CV_WORTHLESS } from '@/scoring/confidence.js';
import { Fund, WITH_JOB } from './helpers.js';
import { DEFAULT_POLICY } from '@/core/capital/policy.js';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures', 'soldcomps');
const fx = (n: string): unknown => JSON.parse(readFileSync(join(FIXTURES, `${n}.json`), 'utf8'));
const HEADERS = fx('headers-sold') as Record<string, string>;

function stub(pages: readonly unknown[]) {
  let n = 0;
  return (async () =>
    new Response(JSON.stringify(pages[n++]), {
      status: 200,
      headers: { 'content-type': 'application/json', ...HEADERS },
    })) as unknown as typeof globalThis.fetch;
}

const BLANK: SourcingForm = {
  name: 'lego star wars',
  category: 'TOYS',
  price: '12.00',
  resale: '60.00',
  sold90: '',
  active: '',
};

describe('the captured market, all the way to a verdict', () => {
  it('⛔ a real broad search is REFUSED, and for the honest reason', async () => {
    const result = await lookUpMarket('lego star wars', {
      apiKey: 'sc_test',
      fetch: stub([fx('active'), fx('sold-pinned')]),
      now: () => new Date('2026-09-11T12:00:00.000Z'),
    });

    const { form, status } = fillFromMarket(BLANK, result);
    expect(status.kind).toBe('FILLED');

    // 122,956 sold against "at least" 240,000 listed.
    expect(form.sold90).toBe('122956');
    expect(form.active).toBe('240000+');

    const r = evaluateForm(form, Fund.withBankroll(50_000, DEFAULT_POLICY, WITH_JOB).state);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // ⚡ The point of the whole gate. A vague keyword measures a huge market,
    // and a huge market is a slow one — 240,000 sellers ahead of you.
    expect(r.verdict.recommendation).toBe('REJECT');
    expect(r.verdict.failedGates.map((g) => g.code)).toContain('HOLD_TOO_LONG');
    expect(r.verdict.expectedDaysToSale).toBeGreaterThan(100);
  });

  it('⚡ and the 40 real comps are what the confidence is built on', async () => {
    const result = await lookUpMarket('lego star wars', {
      apiKey: 'sc_test',
      fetch: stub([fx('active'), fx('sold-pinned')]),
      now: () => new Date('2026-09-11T12:00:00.000Z'),
    });
    if (!result.ok) throw new Error('expected a reading');

    // Every price on the captured page parsed. ⛔ A silently-skipped comp would
    // look exactly like a page that had fewer, which is why this is a count.
    const page = fx('sold-pinned') as { items: { soldPrice: string | null }[] };
    const priced = page.items.filter((i) => typeof i.soldPrice === 'string').length;
    expect(result.reading.compPricesCents).toHaveLength(priced);

    // ⚠️ **A broad keyword prices a whole category, not an item.** These comps
    // run from a single minifigure to a sealed display set, and the spread is
    // the measurable form of B80's misattribution risk: the numbers are all
    // correct and they are about different products.
    const cents = [...result.reading.compPricesCents].sort((a, b) => a - b);
    const lo = cents[0] as number;
    const hi = cents[cents.length - 1] as number;
    expect(hi / lo).toBeGreaterThan(10);
  });

  it('⚡ and a vague keyword PENALISES ITSELF — the dispersion term is zero', async () => {
    // ⛔ **B80 was filed as an unmitigated risk and it turns out to be a
    // measured one.** The worry was a confident, correctly-computed number
    // about a different item. But comps are 40% of confidence, and the comp
    // term is scored on how tightly they AGREE — so a keyword broad enough to
    // price several products produces a spread that zeroes the term by itself.
    //
    // ⚠️ This does not make the keyword safe, it makes it VISIBLE: the penalty
    // lands on confidence, which caps the Buy Score, which is a gate. The
    // screen still has to say what was searched (it does), because the
    // operator is the only one who can tell a broad match from a narrow one.
    const result = await lookUpMarket('lego star wars', {
      apiKey: 'sc_test',
      fetch: stub([fx('active'), fx('sold-pinned')]),
      now: () => new Date('2026-09-11T12:00:00.000Z'),
    });
    if (!result.ok) throw new Error('expected a reading');

    const cc = compConfidence({
      pricesCents: result.reading.compPricesCents,
      medianAgeDays: result.reading.compMedianAgeDays,
    });

    // Measured on the captured page: $0.89 (a loose minifigure) to $572.56 (a
    // rare set), median $40 — a 643x spread across 40 sales.
    expect(cc.coefficientOfVariation).toBeGreaterThan(COMP_CV_WORTHLESS);
    expect(cc.dispersionTermBps).toBe(0);
    expect(cc.countTermBps).toBe(10_000); // 40 comps is plenty of them
  });
});
