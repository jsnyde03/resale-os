/**
 * The two doors to one purchase must open onto the same rules.
 *
 * ⛔ **This file exists because 583 tests passed while the fund had two
 * answers.** The sourcing screen recommended with `evaluateOpportunity` and the
 * buy screen gated with `assessQuote`, both ending at `assessPurchase` — which
 * skips any gate whose field is `undefined`. The quote candidate carried
 * *velocity* confidence and no buy score; the evaluation carried *composite*
 * confidence and one. Measured 2026-09-10: **64 divergences in 96 cases, in
 * both directions.** Not one test failed, before or after the fix, because
 * nothing compared the doors to each other. B58, D14.
 *
 * ⚠️ The sweep below is the control, and it must stay a comparison of two
 * genuinely different entry points — a form a person fills in on the sourcing
 * screen, and the fields they type into the buy screen. Rewriting it to call
 * `evaluateOpportunity` twice would be a round trip through one encoder: it
 * cannot fail, and reading it would never reveal that.
 */

import { describe, expect, it } from 'vitest';
import { evaluateForm, type SourcingForm } from '@/server/sourcing.js';
import { evaluatePurchase } from '@/scoring/purchase.js';
import { quotePurchase, type PurchaseQuoteInput } from '@/core/capital/quote.js';
import { deriveEconomics, parseOpportunity } from '@/domain/opportunity.js';
import { DEFAULT_POLICY } from '@/core/capital/policy.js';
import { Fund, WITH_JOB } from './helpers.js';

const fund = (cents: number) => Fund.withBankroll(cents, DEFAULT_POLICY, WITH_JOB).state;

/**
 * The same object, described at both doors.
 *
 * ⚠️ The grid is not decorative. The original divergence hid at the edges —
 * seven to eighteen sales against one to six active listings, which is where
 * velocity confidence and composite confidence straddle a mode floor. A grid of
 * comfortable items would have been all green against the broken code.
 */
const GRID: readonly { sold: number; active: number; comps: string | null }[] = (() => {
  const rows: { sold: number; active: number; comps: string | null }[] = [];
  for (const sold of [3, 7, 8, 9, 10, 11, 14, 18, 25, 40]) {
    for (const active of [1, 2, 3, 4, 5, 6, 8]) {
      for (const comps of [null, '54.00,55.00,55.50,56.00,54.50,55.25,55.75,55.10']) {
        rows.push({ sold, active, comps });
      }
    }
  }
  return rows;
})();

function bothDoors(
  navCents: number,
  row: { sold: number; active: number; comps: string | null },
  priceCents = 1_500,
) {
  const state = fund(navCents);

  const form: SourcingForm = {
    name: 'Widget',
    category: 'TOOLS',
    price: '15.00',
    resale: '55.00',
    sold90: String(row.sold),
    active: String(row.active),
    ...(row.comps === null ? {} : { comps: row.comps }),
  };
  const sourcing = evaluateForm(form, state);
  if (!sourcing.ok) throw new Error('the form should parse');

  const quoteInput: PurchaseQuoteInput = {
    category: 'TOOLS',
    purchasePriceCents: priceCents,
    expectedGrossCents: 5_500,
    soldLast90Days: row.sold,
    activeListings: row.active,
  };
  const buy = evaluatePurchase(state, quoteInput, {
    name: 'Widget',
    ...(row.comps === null
      ? {}
      : { compPricesCents: row.comps.split(',').map((c) => Math.round(Number(c) * 100)) }),
  });

  return { sourcing: sourcing.verdict, buy };
}

describe('the sourcing screen and the buy screen decide with the same rules', () => {
  it('never recommends a purchase the buy screen would refuse to record', () => {
    // ⛔ The dangerous direction. Someone is standing in front of a seller with
    // the phone saying "Buy it — up to $18", and the next screen says no.
    const contradictions: string[] = [];
    for (const navCents of [5_000, 100_000, 500_000]) {
      for (const row of GRID) {
        const { sourcing, buy } = bothDoors(navCents, row);
        if (sourcing.buy && !buy.evaluation.gates.passed) {
          contradictions.push(
            `NAV ${navCents} sold=${row.sold} active=${row.active} comps=${row.comps ? 'y' : 'n'}: ` +
              `recommended BUY, refused for ${buy.evaluation.gates.failures.map((f) => f.code).join(',')}`,
          );
        }
      }
    }
    expect(contradictions).toEqual([]);
  });

  it('never records a purchase it told you to walk away from', () => {
    // ⚠️ The quieter direction, and the one that was 60 of the 64. The screen
    // said REJECT and the buy screen would have taken the money without a
    // word — no refusal, no override, nothing on the item to say so.
    const contradictions: string[] = [];
    for (const navCents of [5_000, 100_000, 500_000]) {
      for (const row of GRID) {
        const { sourcing, buy } = bothDoors(navCents, row);
        if (sourcing.recommendation === 'REJECT' && buy.evaluation.gates.passed) {
          contradictions.push(
            `NAV ${navCents} sold=${row.sold} active=${row.active} comps=${row.comps ? 'y' : 'n'}: ` +
              `rejected on ${sourcing.failedGates.map((f) => f.code).join(',')}, recorded clean`,
          );
        }
      }
    }
    expect(contradictions).toEqual([]);
  });

  it('fails the same gates, by name, at both doors', () => {
    // The strongest form: not just the same verdict, the same reasons. A
    // verdict that agrees by luck would pass the two tests above.
    const mismatches: string[] = [];
    for (const navCents of [5_000, 100_000, 500_000]) {
      for (const row of GRID) {
        const { sourcing, buy } = bothDoors(navCents, row);
        const a = sourcing.failedGates.map((f) => f.code).sort();
        const b = buy.evaluation.gates.failures.map((f) => f.code).sort();
        if (a.join(',') !== b.join(',')) {
          mismatches.push(
            `NAV ${navCents} sold=${row.sold} active=${row.active} comps=${row.comps ? 'y' : 'n'}: ` +
              `[${a.join(',')}] vs [${b.join(',')}]`,
          );
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('gates on the same confidence number at both doors', () => {
    // ⚡ The mechanism, asserted directly — and asserted on the number the GATE
    // compared, `results.find(CONFIDENCE).actual`, not on the one the screen
    // displays. Those were the same figure on the sourcing side and different
    // figures on the buy side, which is the whole bug: velocity confidence
    // saturates on sold count alone, while the composite still holds a
    // pessimistic default for every signal nobody supplied. Comparing the two
    // displayed numbers would be true by construction and would have caught
    // nothing.
    const confidenceActual = (results: readonly { code: string; actual: number }[]) =>
      results.find((r) => r.code === 'CONFIDENCE_TOO_LOW')?.actual;

    let compared = 0;
    for (const row of GRID) {
      const state = fund(100_000);
      const { buy } = bothDoors(100_000, row);
      const form: SourcingForm = {
        name: 'Widget',
        category: 'TOOLS',
        price: '15.00',
        resale: '55.00',
        sold90: String(row.sold),
        active: String(row.active),
        ...(row.comps === null ? {} : { comps: row.comps }),
      };
      const sourcing = evaluateForm(form, state);
      if (!sourcing.ok) throw new Error('the form should parse');

      const a = confidenceActual(buy.evaluation.gates.results);
      // The sourcing verdict keeps only the FAILED gates, so the passing case
      // is re-derived from the same evaluation the screen rendered.
      const b = sourcing.verdict.confidenceBps;
      expect(a).toBeDefined();
      expect(a).toBe(b);
      compared++;
    }
    // ⚠️ A loop that compared nothing would pass silently. It has happened on
    // this project — an absence assertion is true of an empty page.
    expect(compared).toBe(GRID.length);
  });
});

describe('the two economics implementations agree to the cent', () => {
  // ⚠️ `quotePurchase` and `deriveEconomics` are still two implementations of
  // landed cost, net proceeds, profit, ROI, downside and velocity. They agreed
  // when measured, and nothing but this test keeps them agreeing — `core` may
  // not import `domain`, so neither can delegate to the other.
  it('across prices, shipping, gross and both velocity sources', () => {
    const diffs: string[] = [];
    for (const price of [500, 1_500, 2_999, 12_345]) {
      for (const gross of [1_200, 5_500, 19_999]) {
        for (const ship of [0, 799]) {
          for (const sold of [0, 6, 40]) {
            for (const active of [0, 8]) {
              const q = quotePurchase({
                category: 'TOOLS',
                purchasePriceCents: price,
                inboundShippingCents: ship,
                expectedGrossCents: gross,
                ...(sold > 0
                  ? { soldLast90Days: sold, activeListings: active }
                  : { operatorDaysEstimate: 7 }),
              });
              const e = deriveEconomics(
                parseOpportunity({
                  opportunityId: 'x',
                  name: 'x',
                  category: 'TOOLS',
                  askingPriceCents: price,
                  inboundShippingCents: ship,
                  expectedGrossCents: gross,
                  soldLast90Days: sold > 0 ? sold : null,
                  activeListings: active,
                  operatorDaysEstimate: sold > 0 ? null : 7,
                }),
              );
              const where = `price=${price} gross=${gross} ship=${ship} sold=${sold} active=${active}`;
              if (q.landedCostCents !== e.landedCostCents) diffs.push(`${where}: landed`);
              if (q.estimate.netCents !== e.netProceedsCents) diffs.push(`${where}: net`);
              if (q.expectedProfitCents !== e.expectedProfitCents) diffs.push(`${where}: profit`);
              if (q.expectedRoiBps !== e.expectedRoiBps) diffs.push(`${where}: roi`);
              if (q.modeledDownsideCents !== e.modeledDownsideCents) diffs.push(`${where}: downside`);
              if (q.velocity.expectedDaysToSale !== e.velocity.expectedDaysToSale)
                diffs.push(`${where}: days`);
              if (q.velocity.confidenceBps !== e.velocity.confidenceBps)
                diffs.push(`${where}: velocity confidence`);
            }
          }
        }
      }
    }
    expect(diffs).toEqual([]);
  });
});

describe('the marker that a scorer was involved', () => {
  const input: PurchaseQuoteInput = {
    category: 'TOOLS',
    purchasePriceCents: 1_500,
    expectedGrossCents: 5_500,
    soldLast90Days: 40,
    activeListings: 8,
  };

  it('does not change the verdict', () => {
    // ⛔ `evaluatePurchase` invents an id for a typed buy because the schema
    // demands one. If that id could move a gate, the synthetic value would be
    // deciding real money.
    const state = fund(100_000);
    const typed = evaluatePurchase(state, input, { name: 'Widget' });
    const scored = evaluatePurchase(state, input, { name: 'Widget', opportunityId: 'opp_1' });

    expect(typed.evaluation.gates.passed).toBe(scored.evaluation.gates.passed);
    expect(typed.evaluation.result.recommendation).toBe(scored.evaluation.result.recommendation);
    expect(typed.evaluation.result.confidenceBps).toBe(scored.evaluation.result.confidenceBps);
    expect(typed.quote).toEqual(scored.quote);
  });

  it('leaves an unrecognised marketplace on the eBay fee model, as the quote does', () => {
    // ⚠️ The bridge omits a marketplace the schema does not know, rather than
    // passing it through and being rejected. That is only safe because
    // `feeModel` falls back to eBay for anything unknown — so the omission has
    // to produce the same fee model the quote used, not merely a valid one.
    const state = fund(100_000);
    const odd = { ...input, marketplace: 'CRAIGSLIST' };
    const quote = quotePurchase(odd);
    const assessed = evaluatePurchase(state, odd, { name: 'Widget' });

    expect(quote.feeModel.marketplace).toBe('EBAY');
    expect(assessed.evaluation.economics.netProceedsCents).toBe(quote.estimate.netCents);
  });
});
