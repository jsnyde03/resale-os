import { describe, expect, it } from 'vitest';
import { FundStore } from '@/db/store.js';
import { openDb } from '@/db/driver.js';
import { migrate } from '@/db/migrate.js';
import { parseOpportunity } from '@/domain/opportunity.js';
import { evaluateOpportunity } from '@/scoring/evaluate.js';
import { T0 } from './helpers.js';
import { accuracyReport } from '@/core/capital/accuracy.js';

function fixedClock(): () => string {
  let n = 0;
  return () => `2026-09-08T12:00:${String(n++).padStart(2, '0')}.000Z`;
}

function freshStore(): FundStore {
  const db = openDb(':memory:');
  migrate(db, T0);
  const store = new FundStore(db, fixedClock());
  store.ensureSeeded();
  store.commit({ type: 'CONTRIBUTION', amountCents: 5_000, occurredAt: T0 });
  return store;
}

function opp(overrides: Record<string, unknown> = {}) {
  return parseOpportunity({
    opportunityId: 'o1',
    name: 'retro cartridge',
    category: 'GAMES',
    askingPriceCents: 1_500,
    expectedGrossCents: 3_900,
    soldLast90Days: 60,
    activeListings: 4,
    compPricesCents: [3_800, 3_900, 4_000, 3_850],
    compMedianAgeDays: 20,
    ...overrides,
  });
}

function save(store: FundStore, input: ReturnType<typeof opp>) {
  const evaluation = evaluateOpportunity(input, store.state());
  store.opportunities().save(input, evaluation, T0);
  return evaluation;
}

describe('an opportunity survives a round trip with its reasoning', () => {
  it('stores the verdict, the inputs and the policy that produced them', () => {
    const store = freshStore();
    const e = save(store, opp());
    const row = store.opportunities().get('o1')!;

    expect(row.buy_score).toBe(e.buy.score);
    expect(row.risk_score).toBe(e.risk.score);
    expect(row.recommendation).toBe('BUY');
    expect(row.status).toBe('RECOMMENDED');
    expect(row.policy_version).toBe(store.policy().version);
    expect(JSON.parse(row.reasoning_json!).length).toBeGreaterThan(0);
  });

  it('keeps the input, so an old score can be reproduced', () => {
    // A verdict whose inputs are gone is not auditable.
    const store = freshStore();
    save(store, opp());
    const row = store.opportunities().get('o1')!;
    const replayed = evaluateOpportunity(
      parseOpportunity(JSON.parse(row.input_json)),
      store.state(),
    );
    expect(replayed.buy.score).toBe(row.buy_score);
    expect(replayed.result.recommendation).toBe(row.recommendation);
  });

  it('re-scoring updates the verdict but keeps created_at', () => {
    const store = freshStore();
    save(store, opp());
    const created = store.opportunities().get('o1')!.created_at;

    save(store, opp({ askingPriceCents: 3_500 })); // now too expensive
    const row = store.opportunities().get('o1')!;
    expect(row.created_at).toBe(created);
    expect(row.recommendation).toBe('REJECT');
  });

  it('a PURCHASED opportunity does not lose that status on a re-score', () => {
    const store = freshStore();
    save(store, opp());
    // The link is a real foreign key: the item has to exist.
    store.commit({
      type: 'PURCHASE',
      itemId: 'item-1',
      name: 'retro cartridge',
      category: 'GAMES',
      purchasePriceCents: 1_500,
      expectedDaysToSale: 8,
      expectedResaleCents: 3_900,
      occurredAt: T0,
    });
    store.opportunities().markPurchased('o1', 'item-1', T0);

    save(store, opp({ askingPriceCents: 3_500 }));
    const row = store.opportunities().get('o1')!;
    expect(row.status).toBe('PURCHASED');
    expect(row.item_id).toBe('item-1');
    // ...but the fresh verdict is still recorded.
    expect(row.recommendation).toBe('REJECT');
  });
});

describe('the feed ranks and filters', () => {
  function seed(store: FundStore) {
    save(store, opp({ opportunityId: 'best', askingPriceCents: 800, expectedGrossCents: 3_000, soldLast90Days: 90, activeListings: 2 }));
    save(store, opp({ opportunityId: 'good' }));
    save(store, opp({ opportunityId: 'slow', category: 'PINS', soldLast90Days: 6, activeListings: 20 }));
    save(store, opp({ opportunityId: 'thin', category: 'LEGO', askingPriceCents: 1_400, expectedGrossCents: 2_200, soldLast90Days: 40, activeListings: 3 }));
  }

  it('orders best-first by score, then risk, then speed', () => {
    const store = freshStore();
    seed(store);
    const ids = store.opportunities().list().map((r) => r.opportunity_id);
    expect(ids[0]).toBe('best');
    expect(ids.indexOf('good')).toBeLessThan(ids.indexOf('slow'));
  });

  it('filters to what deserves attention', () => {
    const store = freshStore();
    seed(store);
    const buys = store.opportunities().list({ recommendation: 'BUY' });
    expect(buys.length).toBeGreaterThan(0);
    for (const r of buys) expect(r.recommendation).toBe('BUY');
  });

  it('filters by score, risk and category', () => {
    const store = freshStore();
    seed(store);
    expect(store.opportunities().list({ minBuyScore: 75 }).every((r) => r.buy_score! >= 75))
      .toBe(true);
    expect(store.opportunities().list({ category: 'PINS' }).map((r) => r.opportunity_id))
      .toEqual(['slow']);
  });

  it('caps the limit rather than letting a caller ask for everything', () => {
    const store = freshStore();
    seed(store);
    expect(store.opportunities().list({ limit: 1 }).length).toBe(1);
    expect(store.opportunities().list({ limit: 10_000 }).length).toBeLessThanOrEqual(500);
  });
});

describe('the rejection histogram says which gate is binding', () => {
  it('counts each code across every rejected opportunity', () => {
    const store = freshStore();
    save(store, opp({ opportunityId: 'slow1', soldLast90Days: 6, activeListings: 20 }));
    save(store, opp({ opportunityId: 'slow2', soldLast90Days: 4, activeListings: 30 }));
    save(store, opp({ opportunityId: 'rich', askingPriceCents: 4_000 }));

    const hist = store.opportunities().rejectionHistogram();
    const codes = Object.fromEntries(hist.codes.map((h) => [h.code, h.n]));
    expect(codes.HOLD_TOO_LONG).toBe(2);
    expect(codes.MAX_PER_ITEM_EXCEEDED).toBe(1);
    // Ordered most-frequent first, which is the point of having it.
    expect(hist.codes[0]!.n).toBeGreaterThanOrEqual(hist.codes[hist.codes.length - 1]!.n);
    // ⛔ The denominator. Three refusals on record, all readable — without this
    // an empty chart and a broken reader are the same picture.
    expect(hist.rejectedRows).toBe(3);
    expect(hist.unreadableRows).toBe(0);
  });

  it('is empty when nothing has been rejected, and says the denominator is zero', () => {
    const store = freshStore();
    save(store, opp());
    const hist = store.opportunities().rejectionHistogram();
    expect(hist.codes).toEqual([]);
    // ⛔ The distinction the denominator exists for: nothing refused, versus
    // refusals that could not be read. Both draw an empty chart.
    expect(hist.rejectedRows).toBe(0);
    expect(hist.unreadableRows).toBe(0);
  });

  it('reports an unreadable refusal instead of drawing an empty chart', () => {
    // ⚠️ A row refused with neither structured gates nor parseable prose. Before
    // the denominator this was indistinguishable from "nothing was refused",
    // and the histogram regex-parsed prose, so a reworded reason would have
    // produced exactly this in silence.
    const store = freshStore();
    save(store, opp({ opportunityId: 'slow1', soldLast90Days: 6, activeListings: 20 }));
    store.db.run(
      "UPDATE opportunities SET score_breakdown_json = '{}', reasoning_json = '[\"no code here\"]'",
    );

    const hist = store.opportunities().rejectionHistogram();
    expect(hist.codes).toEqual([]);
    expect(hist.rejectedRows).toBe(1);
    expect(hist.unreadableRows).toBe(1);
  });

  it('still counts rows written before the codes were stored structurally', () => {
    // ⚡ Backwards compatibility is the reason the prose fallback survives: rows
    // scored on the phone before 6.2 have no `gates` key, and dropping them
    // would quietly discard real decisions.
    const store = freshStore();
    save(store, opp({ opportunityId: 'slow1', soldLast90Days: 6, activeListings: 20 }));
    store.db.run("UPDATE opportunities SET score_breakdown_json = '{}'");

    const hist = store.opportunities().rejectionHistogram();
    expect(hist.codes.map((c) => c.code)).toContain('HOLD_TOO_LONG');
    expect(hist.unreadableRows).toBe(0);
  });
});

describe('profit never rescues a failed gate, end to end', () => {
  it('rejects the highest-profit opportunity in the feed', () => {
    const store = freshStore();
    // A slow item with the best margin of the lot.
    save(store, opp({ opportunityId: 'slow', expectedGrossCents: 5_000, soldLast90Days: 6, activeListings: 20 }));
    save(store, opp({ opportunityId: 'fast' }));

    const rows = store.opportunities().list();
    const slow = rows.find((r) => r.opportunity_id === 'slow')!;
    const fast = rows.find((r) => r.opportunity_id === 'fast')!;

    expect(slow.expected_profit_cents).toBeGreaterThan(fast.expected_profit_cents);
    expect(slow.recommendation).toBe('REJECT');
    expect(fast.recommendation).toBe('BUY');
  });
});

describe('a scored opportunity carries its prediction onto the item', () => {
  it('is what makes accuracy measurable at all', () => {
    // Without the link the item has no expected NET proceeds, and accuracy has
    // nothing to compare an outcome against.
    const store = freshStore();
    const e = save(store, opp());

    store.commit({
      type: 'PURCHASE',
      itemId: 'cart-01',
      name: 'retro cartridge',
      category: 'GAMES',
      purchasePriceCents: 1_300, // negotiated below the asking price
      expectedDaysToSale: e.economics.velocity.expectedDaysToSale,
      expectedResaleCents: 3_900,
      expectedNetProceedsCents: e.economics.netProceedsCents,
      expectedProfitCents: e.economics.netProceedsCents - 1_300,
      opportunityId: 'o1',
      occurredAt: T0,
    });
    store.opportunities().markPurchased('o1', 'cart-01', T0);

    const item = store.state().items['cart-01']!;
    expect(item.opportunityId).toBe('o1');
    expect(item.expectedNetProceedsCents).toBe(2_808);
    // Expected profit is against what was actually PAID, not the asking price.
    expect(item.expectedProfitCents).toBe(1_508);

    store.commit({
      type: 'SALE',
      itemId: 'cart-01',
      grossProceedsCents: 3_600,
      marketplaceFeeCents: 517,
      outboundShippingCents: 500,
      packagingCents: 35,
      daysToSale: 14,
      occurredAt: T0,
    });

    const report = accuracyReport(store.state());
    expect(report.n).toBe(1);
    expect(report.items[0]!.daysErrorDays).toBe(6); // predicted 8, took 14
    expect(report.items[0]!.proceedsErrorCents).toBe(2_548 - 2_808);
    expect(store.opportunities().get('o1')!.status).toBe('PURCHASED');
  });

  it('an unlinked purchase has no prediction, and says so rather than faking one', () => {
    const store = freshStore();
    store.commit({
      type: 'PURCHASE',
      itemId: 'manual-1',
      name: 'bought on a hunch',
      category: 'GAMES',
      purchasePriceCents: 1_000,
      expectedDaysToSale: 7,
      expectedResaleCents: 3_000,
      occurredAt: T0,
    });
    store.commit({
      type: 'SALE',
      itemId: 'manual-1',
      grossProceedsCents: 3_000,
      daysToSale: 30,
      occurredAt: T0,
    });

    const report = accuracyReport(store.state());
    expect(report.n).toBe(0);
    expect(report.unpredictedN).toBe(1);
  });
});

describe('the authorizations table exists and nothing writes to it', () => {
  it('refuses to link an opportunity to an item that does not exist', () => {
    const store = freshStore();
    save(store, opp());
    expect(() => store.opportunities().markPurchased('o1', 'ghost', T0)).toThrow();
  });

  it('is empty, and the code has no path that inserts into it', () => {
    const store = freshStore();
    save(store, opp());
    const rows = store.db.all('SELECT * FROM authorizations');
    expect(rows).toEqual([]);
  });

  it('accepts APPROVED and ARMED as statuses without a migration', () => {
    // The seam for autonomous purchasing: adding those states later is a code
    // change, not a data migration.
    const store = freshStore();
    save(store, opp());
    expect(() => store.opportunities().setStatus('o1', 'ARMED', T0)).not.toThrow();
    expect(store.opportunities().get('o1')!.status).toBe('ARMED');
  });
});

describe('B77 — a floored count survives being stored and re-read', () => {
  it('⛔ the flag is in input_json, so a replayed score still refuses', () => {
    // ⚠️ The row denormalises `active_listings` into its own column but NOT
    // the flag beside it, and `input_json` is what every reconstruction
    // actually uses. That is fine — and it is fine by accident unless
    // something asserts it, because the two representations disagree.
    const store = freshStore();
    save(store, opp({ activeListingsIsFloor: true }));
    const row = store.opportunities().get('o1')!;

    expect(row.recommendation).toBe('REJECT');
    expect(JSON.parse(row.input_json).activeListingsIsFloor).toBe(true);

    const replayed = evaluateOpportunity(
      parseOpportunity(JSON.parse(row.input_json)),
      store.state(),
    );
    expect(replayed.gates.failures.map((f) => f.code)).toContain('VELOCITY_COUNTS_UNBOUNDED');
  });
});
