/**
 * The opportunity feed.
 *
 * The property worth defending is that it **reports stored verdicts and never
 * recomputes them**. Re-scoring an old row under today's policy would show a
 * number that was never the reason for any decision, and it would do it
 * silently. Instead the row is marked stale and says which policy produced it.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FundStore } from '@/db/store.js';
import { openDb } from '@/db/driver.js';
import { migrate } from '@/db/migrate.js';
import { feedView, toFeedRow } from '@/server/feed.js';
import { parseOpportunity } from '@/domain/opportunity.js';
import { evaluateOpportunity } from '@/scoring/evaluate.js';
import { DEFAULT_POLICY } from '@/core/capital/policy.js';
import { WITH_JOB, T0 } from './helpers.js';
import type { OpportunityRow } from '@/db/repositories/opportunities.js';

/**
 * A complete stored row. Partial casts do not work here and should not: the
 * view assumes every column is present, which is true of anything the
 * repository actually wrote.
 */
function rowFixture(overrides: Partial<OpportunityRow> = {}): OpportunityRow {
  return {
    opportunity_id: 'x', created_at: T0, updated_at: T0, name: 'x', category: 'TOYS',
    source: 'MANUAL', marketplace: 'EBAY',
    asking_price_cents: 1_200, landed_cost_cents: 1_200, expected_gross_cents: 6_000,
    net_proceeds_cents: 5_000, expected_profit_cents: 3_800, expected_roi_bps: 30_000,
    modeled_downside_cents: 0, sold_last_90d: 40, active_listings: 10,
    velocity_source: 'COMPS', sell_through_bps: 8_000,
    expected_days_to_sale: 25, expected_days_p90: 40,
    buy_score: 70, risk_score: 30, confidence_bps: 7_000,
    max_recommended_cents: 2_000, price_bound_by: 'PER_ITEM', recommendation: 'BUY',
    reasoning_json: null, score_breakdown_json: null, scored_at: T0,
    policy_version: 'v1', status: 'NEW' as OpportunityRow['status'], item_id: null,
    input_json: '{}',
    ...overrides,
  };
}

function fixedClock(): () => string {
  let n = 0;
  return () => `2026-09-08T12:00:${String(n++).padStart(2, '0')}.000Z`;
}

interface Candidate {
  id: string;
  price?: number;
  resale?: number;
  sold?: number;
  active?: number;
  category?: string;
}

function withFeed(fn: (store: FundStore, add: (c: Candidate) => void) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'resale-feed-'));
  try {
    const db = openDb(join(dir, 'test.db'));
    migrate(db, T0);
    const store = new FundStore(db, fixedClock());
    store.ensureSeeded();
    store.setTaxProfile(WITH_JOB);
    store.commit({ type: 'CONTRIBUTION', amountCents: 200_000, occurredAt: T0 });

    const add = (c: Candidate) => {
      const input = parseOpportunity({
        opportunityId: c.id,
        name: c.id,
        category: c.category ?? 'TOYS',
        source: 'MANUAL',
        sourceUrl: null,
        askingPriceCents: c.price ?? 1_200,
        inboundShippingCents: 0,
        salesTaxCents: 0,
        acquisitionTravelCents: 0,
        expectedGrossCents: c.resale ?? 6_000,
        marketplace: 'EBAY',
        postageCents: null,
        soldLast90Days: c.sold ?? 40,
        activeListings: c.active ?? 10,
        operatorDaysEstimate: null,
        compPricesCents: [5_800, 6_100, 6_000],
        compMedianAgeDays: 45,
        hassleBps: 2_000,
      });
      store.opportunities().save(input, evaluateOpportunity(input, store.state()), T0);
    };

    try {
      fn(store, add);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

describe('an empty feed says WHICH kind of empty', () => {
  it('distinguishes "nothing scored" from "your filter matched nothing"', () => {
    withFeed((store, add) => {
      // Nothing at all — the fix is to go and score something.
      let v = feedView(store);
      expect(v.empty).toBe(true);
      expect(v.filteredToNothing).toBe(false);
      expect(v.rows).toEqual([]);

      add({ id: 'a' });

      // Something exists, but this filter hides it — the fix is the filter.
      v = feedView(store, { category: 'NOTHING_LIKE_THIS' });
      expect(v.empty).toBe(false);
      expect(v.filteredToNothing).toBe(true);
      expect(v.rows).toEqual([]);
    });
  });
});

describe('ranking is the repository’s, not reinvented here', () => {
  it('puts the better buy score first', () => {
    withFeed((store, add) => {
      add({ id: 'weak', sold: 3, active: 40 });
      add({ id: 'strong', sold: 60, active: 5 });
      const rows = feedView(store).rows;
      expect(rows).toHaveLength(2);
      expect(rows[0]!.id).toBe('strong');
      expect(rows[0]!.buyScore!).toBeGreaterThan(rows[1]!.buyScore!);
    });
  });

  it('honours the filters `opp list` already supports', () => {
    withFeed((store, add) => {
      add({ id: 'toy', category: 'TOYS' });
      add({ id: 'pin', category: 'DISNEY_PINS' });
      expect(feedView(store, { category: 'TOYS' }).rows.map((r) => r.id)).toEqual(['toy']);
      expect(feedView(store, { limit: 1 }).rows).toHaveLength(1);
      // A score floor nothing meets empties the list without emptying the book.
      const strict = feedView(store, { minBuyScore: 200 });
      expect(strict.rows).toEqual([]);
      expect(strict.filteredToNothing).toBe(true);
    });
  });
});

describe('stored verdicts are reported, never recomputed', () => {
  it('carries the score and the policy that produced it', () => {
    withFeed((store, add) => {
      add({ id: 'a' });
      const row = feedView(store).rows[0]!;
      expect(row.policyVersion).toBe(DEFAULT_POLICY.version);
      expect(row.stale).toBe(false);
      expect(row.buyScore).not.toBeNull();
      expect(row.scoredAt).toBeTruthy();
    });
  });

  it('marks a row stale when the policy has moved on, and does NOT re-score it', () => {
    withFeed((store, add) => {
      add({ id: 'a' });
      const before = feedView(store).rows[0]!;

      // The policy version changes; the stored verdict must not.
      store.setPolicy({ ...DEFAULT_POLICY, version: `${DEFAULT_POLICY.version}-next` });
      const after = feedView(store).rows[0]!;

      expect(after.stale).toBe(true);
      expect(feedView(store).staleCount).toBe(1);
      // Same numbers, because a stored score belongs to its policy version.
      expect(after.buyScore).toBe(before.buyScore);
      expect(after.riskScore).toBe(before.riskScore);
      expect(after.maxPrice?.cents).toBe(before.maxPrice?.cents);
      expect(after.policyVersion).toBe(DEFAULT_POLICY.version);
    });
  });

  it('does not call an unscored row stale — it was never scored', () => {
    // Different facts. "Nobody scored this" is not "this was scored under old
    // rules", and conflating them sends the operator to re-score nothing.
    const row = toFeedRow(
      rowFixture({ policy_version: null, max_recommended_cents: null }),
      'v9',
    );
    expect(row.stale).toBe(false);
    expect(row.maxPrice).toBeNull();
  });
});

describe('the row itself', () => {
  it('flags an asking price above the stored ceiling', () => {
    withFeed((store, add) => {
      add({ id: 'dear', price: 9_000, resale: 6_000 });
      const row = feedView(store).rows[0]!;
      expect(row.maxPrice).not.toBeNull();
      expect(row.overPriced).toBe(true);
    });
  });

  it('carries the headline reason', () => {
    withFeed((store, add) => {
      add({ id: 'weak', sold: 1, active: 50 });
      expect(feedView(store).rows[0]!.reason).toBeTruthy();
    });
  });

  it('survives a malformed reason blob rather than failing the screen', () => {
    const row = toFeedRow(rowFixture({ reasoning_json: '{not json' }), 'v1');
    expect(row.reason).toBeNull();
  });
});
