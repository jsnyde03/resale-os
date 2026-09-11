/**
 * Opportunities: what you are considering, and what the system concluded.
 *
 * Unlike the ledger, this table is mutable — an opportunity gets re-scored as
 * the fund changes around it, and a price that was too high last week may not
 * be today. What is *not* mutable is the record of what a score was based on:
 * every row stores its `input_json` and its `policy_version`, so an old verdict
 * can always be reproduced or explained.
 */

import type { Db, ReadOnlyDb } from '../db-types.js';
import { toParams } from '../db-types.js';
import type { OpportunityInput, OpportunityStatus } from '../../domain/opportunity.js';
import type { Evaluation } from '../../scoring/evaluate.js';

export interface OpportunityRow {
  opportunity_id: string;
  created_at: string;
  updated_at: string;
  name: string;
  category: string;
  source: string;
  marketplace: string;
  asking_price_cents: number;
  landed_cost_cents: number;
  expected_gross_cents: number;
  net_proceeds_cents: number;
  expected_profit_cents: number;
  expected_roi_bps: number;
  modeled_downside_cents: number;
  sold_last_90d: number | null;
  active_listings: number;
  velocity_source: string;
  sell_through_bps: number;
  expected_days_to_sale: number;
  expected_days_p90: number;
  buy_score: number | null;
  risk_score: number | null;
  confidence_bps: number | null;
  max_recommended_cents: number | null;
  price_bound_by: string | null;
  recommendation: string | null;
  reasoning_json: string | null;
  score_breakdown_json: string | null;
  scored_at: string | null;
  policy_version: string | null;
  rules_version: string | null;
  status: OpportunityStatus;
  item_id: string | null;
  input_json: string;
}

export interface OpportunityFilter {
  readonly status?: OpportunityStatus;
  readonly recommendation?: string;
  readonly minBuyScore?: number;
  readonly maxRiskScore?: number;
  readonly category?: string;
  readonly limit?: number;
}

/**
 * The queries themselves, shared by the reader and the repository so there is
 * one implementation of "which opportunities, in what order".
 */
function listOpportunities(db: ReadOnlyDb, filter: OpportunityFilter = {}): OpportunityRow[] {
    const where: string[] = [];
    const params: (string | number)[] = [];

    if (filter.status) {
      where.push('status = ?');
      params.push(filter.status);
    }
    if (filter.recommendation) {
      where.push('recommendation = ?');
      params.push(filter.recommendation);
    }
    if (filter.category) {
      where.push('category = ?');
      params.push(filter.category);
    }
    if (filter.minBuyScore !== undefined) {
      where.push('buy_score >= ?');
      params.push(filter.minBuyScore);
    }
    if (filter.maxRiskScore !== undefined) {
      where.push('risk_score <= ?');
      params.push(filter.maxRiskScore);
    }

    const sql =
      'SELECT * FROM opportunities' +
      (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '') +
      // Best score first, then least risk, then soonest to sell.
      ' ORDER BY buy_score DESC, risk_score ASC, expected_days_to_sale ASC' +
      ` LIMIT ${Math.max(1, Math.min(500, filter.limit ?? 50))}`;

    return db.all<OpportunityRow>(sql, params);
  }


export interface RejectionHistogram {
  readonly codes: readonly { readonly code: string; readonly n: number }[];
  /** Refusals on record. The denominator — without it a chart is a shape. */
  readonly rejectedRows: number;
  /**
   * ⚠️ Rows that were refused and yielded no code. **`rejectedRows > 0` with
   * `codes` empty is a BROKEN READER, not a fund that refuses nothing**, and the
   * two look identical on a chart. Surfacing the count is what tells them apart.
   */
  readonly unreadableRows: number;
  /**
   * ⛔ **How many DISTINCT rule sets these refusals were scored under (B88).**
   *
   * The codes are a historical record of what the rules said THEN. When the
   * code changes what a gate decides, older rows keep their old codes — so a
   * chart summing across rule sets under-counts whichever gate is newest and
   * reports one number for two different questions. ⚠️ Rows written before
   * migration 007 have no identity at all and are counted here as their own
   * unknown set, because *"scored under rules we cannot name"* is exactly the
   * situation that must not read as agreement.
   *
   * **1 is the healthy answer.** Anything more means the chart is mixing.
   */
  readonly ruleSets: number;
}

function rejectionHistogram(db: ReadOnlyDb): RejectionHistogram {
  const counts = new Map<string, number>();
  let rejectedRows = 0;
  let unreadableRows = 0;

  // ⛔ `rules_version` comes back so the chart can say whether it is summing
  // across one rule set or several. B88.
  const identities = new Set<string>();

  for (const row of db.all<{
    reasoning_json: string | null;
    score_breakdown_json: string | null;
    rules_version: string | null;
  }>(
    'SELECT reasoning_json, score_breakdown_json, rules_version FROM opportunities ' +
      "WHERE recommendation = 'REJECT'",
  )) {
    rejectedRows += 1;
    // ⚠️ NULL is its own set, not "the same as everything else".
    identities.add(row.rules_version ?? '<before rules were identified>');
    let found = 0;

    // Structured first. Rows written before 6.2 do not have it.
    if (row.score_breakdown_json) {
      const parsed = JSON.parse(row.score_breakdown_json) as { gates?: unknown };
      if (Array.isArray(parsed.gates)) {
        for (const code of parsed.gates as string[]) {
          counts.set(code, (counts.get(code) ?? 0) + 1);
          found += 1;
        }
      }
    }

    // ⚠️ Fall back to the prose for older rows, rather than dropping decisions
    // that were correctly recorded under the previous shape.
    if (found === 0 && row.reasoning_json) {
      for (const reason of JSON.parse(row.reasoning_json) as string[]) {
        const match = /^([A-Z_]+) —/.exec(reason);
        if (match) {
          counts.set(match[1]!, (counts.get(match[1]!) ?? 0) + 1);
          found += 1;
        }
      }
    }

    if (found === 0) unreadableRows += 1;
  }

  return {
    codes: [...counts.entries()]
      .map(([code, n]) => ({ code, n }))
      .sort((a, b) => b.n - a.n || a.code.localeCompare(b.code)),
    rejectedRows,
    unreadableRows,
    ruleSets: identities.size,
  };
}

/**
 * The reading half, so the dashboard can show opportunities without being
 * handed something that can `save()` or `setStatus()`. See `LedgerReader`.
 */
export class OpportunityReader {
  readonly #db: ReadOnlyDb;

  constructor(db: ReadOnlyDb) {
    this.#db = db;
  }

  get(opportunityId: string): OpportunityRow | undefined {
    return this.#db.get<OpportunityRow>('SELECT * FROM opportunities WHERE opportunity_id = ?', [
      opportunityId,
    ]);
  }

  list(filter: OpportunityFilter = {}): OpportunityRow[] {
    return listOpportunities(this.#db, filter);
  }

  rejectionHistogram(): RejectionHistogram {
    return rejectionHistogram(this.#db);
  }
}

export class OpportunityRepository {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * Insert or re-score. The evaluation and the input that produced it are
   * written together — a score whose inputs are gone is not auditable.
   */
  save(input: OpportunityInput, evaluation: Evaluation, now: string): void {
    const e = evaluation;
    const existing = this.get(input.opportunityId);

    this.#db.run(
      `INSERT INTO opportunities (
         opportunity_id, created_at, updated_at, name, category, source, source_url,
         source_listing_id, marketplace, asking_price_cents, inbound_shipping_cents,
         sales_tax_cents, acquisition_travel_cents, landed_cost_cents,
         expected_gross_cents, marketplace_fee_cents, postage_cents, packaging_cents,
         net_proceeds_cents, expected_profit_cents, expected_roi_bps,
         modeled_downside_cents, sold_last_90d, active_listings, velocity_source,
         sell_through_bps, expected_days_to_sale, expected_days_p90, buy_score,
         risk_score, confidence_bps, max_recommended_cents, price_bound_by,
         recommendation, reasoning_json, score_breakdown_json, scored_at,
         policy_version, rules_version, status, item_id, input_json
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(opportunity_id) DO UPDATE SET
         updated_at            = excluded.updated_at,
         asking_price_cents    = excluded.asking_price_cents,
         landed_cost_cents     = excluded.landed_cost_cents,
         expected_gross_cents  = excluded.expected_gross_cents,
         marketplace_fee_cents = excluded.marketplace_fee_cents,
         postage_cents         = excluded.postage_cents,
         packaging_cents       = excluded.packaging_cents,
         net_proceeds_cents    = excluded.net_proceeds_cents,
         expected_profit_cents = excluded.expected_profit_cents,
         expected_roi_bps      = excluded.expected_roi_bps,
         modeled_downside_cents= excluded.modeled_downside_cents,
         sold_last_90d         = excluded.sold_last_90d,
         active_listings       = excluded.active_listings,
         velocity_source       = excluded.velocity_source,
         sell_through_bps      = excluded.sell_through_bps,
         expected_days_to_sale = excluded.expected_days_to_sale,
         expected_days_p90     = excluded.expected_days_p90,
         buy_score             = excluded.buy_score,
         risk_score            = excluded.risk_score,
         confidence_bps        = excluded.confidence_bps,
         max_recommended_cents = excluded.max_recommended_cents,
         price_bound_by        = excluded.price_bound_by,
         recommendation        = excluded.recommendation,
         reasoning_json        = excluded.reasoning_json,
         score_breakdown_json  = excluded.score_breakdown_json,
         scored_at             = excluded.scored_at,
         policy_version        = excluded.policy_version,
         rules_version         = excluded.rules_version,
         status                = excluded.status,
         input_json            = excluded.input_json`,
      toParams([
        input.opportunityId,
        existing?.created_at ?? now,
        now,
        input.name,
        input.category,
        input.source,
        input.sourceUrl,
        input.sourceListingId,
        input.marketplace,
        input.askingPriceCents,
        input.inboundShippingCents,
        input.salesTaxCents,
        input.acquisitionTravelCents,
        e.economics.landedCostCents,
        input.expectedGrossCents,
        e.economics.marketplaceFeeCents,
        e.economics.postageCents,
        e.economics.packagingCents,
        e.economics.netProceedsCents,
        e.economics.expectedProfitCents,
        e.economics.expectedRoiBps,
        e.economics.modeledDownsideCents,
        input.soldLast90Days,
        input.activeListings,
        e.economics.velocity.source,
        e.economics.velocity.sellThroughBps,
        e.economics.velocity.expectedDaysToSale,
        e.economics.velocity.expectedDaysP90,
        e.buy.score,
        e.risk.score,
        e.confidence.confidenceBps,
        e.price.maxPriceCents,
        e.price.boundBy,
        e.result.recommendation,
        JSON.stringify(e.result.reasons),
        // ⚡ 6.2: the failed gate CODES, stored structurally. They used to exist
        // only inside the prose reasons, and the histogram regex-parsed them back
        // out — so a change to how a reason reads would have emptied the chart in
        // silence. No migration: this column is already a JSON blob.
        JSON.stringify({
          buy: e.buy,
          risk: e.risk,
          confidence: e.confidence,
          gates: e.gates.failures.map((f) => f.code),
        }),
        now,
        e.policyVersion,
        e.rulesVersion,
        // A PURCHASED opportunity keeps that status through a re-score; nothing
        // else is sticky, because everything else is a judgement that can change.
        existing?.status === 'PURCHASED' ? 'PURCHASED' : statusFor(e.result.recommendation),
        existing?.item_id ?? null,
        JSON.stringify(input),
      ]),
    );
  }

  get(opportunityId: string): OpportunityRow | undefined {
    return this.#db.get<OpportunityRow>(
      'SELECT * FROM opportunities WHERE opportunity_id = ?',
      [opportunityId],
    );
  }

  /** Ranked best-first: the feed's ordering, and the only ordering. */
  list(filter: OpportunityFilter = {}): OpportunityRow[] {
    return listOpportunities(this.#db, filter);
  }

  setStatus(opportunityId: string, status: OpportunityStatus, now: string): void {
    this.#db.run(
      'UPDATE opportunities SET status = ?, updated_at = ? WHERE opportunity_id = ?',
      toParams([status, now, opportunityId]),
    );
  }

  /** Link an opportunity to the item it became. */
  markPurchased(opportunityId: string, itemId: string, now: string): void {
    this.#db.run(
      `UPDATE opportunities SET status = 'PURCHASED', item_id = ?, updated_at = ?
       WHERE opportunity_id = ?`,
      toParams([itemId, now, opportunityId]),
    );
  }

  /** How often each rejection reason fires — which gate is actually binding. */
  rejectionHistogram(): RejectionHistogram {
    return rejectionHistogram(this.#db);
  }
}

function statusFor(recommendation: string): OpportunityStatus {
  switch (recommendation) {
    case 'BUY':
      return 'RECOMMENDED';
    case 'WATCH':
      return 'WATCHING';
    default:
      return 'PASSED';
  }
}
