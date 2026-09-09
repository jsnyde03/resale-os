/**
 * The opportunity feed: what has been scored, best first.
 *
 * ⛔ **Nothing here re-scores anything.** A stored verdict belongs to the policy
 * version that produced it, and re-running today's policy over yesterday's row
 * would silently rewrite history — the feed would show a score that was never
 * the reason for any decision. When the stored `policy_version` no longer
 * matches the code's, the row is marked **stale** and says so; deciding what to
 * do about that is the operator's, and re-scoring is a CLI action.
 *
 * Ranking is `list()`'s, in SQL: buy score down, risk up, days-to-sale up.
 */

import type { LedgerReader } from '../db/store.js';
import type { OpportunityRow, OpportunityFilter } from '../db/repositories/opportunities.js';
import type { Bps } from '../core/money.js';
import { money, type Money } from './views.js';

export interface FeedRow {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly status: string;
  readonly recommendation: string | null;
  readonly asking: Money;
  readonly maxPrice: Money | null;
  /** True when the tag is already above what the fund should pay. */
  readonly overPriced: boolean;
  readonly expectedProfit: Money;
  readonly expectedRoiBps: Bps;
  readonly expectedDaysToSale: number;
  readonly sellThroughBps: Bps;
  readonly buyScore: number | null;
  readonly riskScore: number | null;
  readonly confidenceBps: Bps | null;
  readonly priceBoundBy: string | null;
  /** The headline reason, first of the stored list. */
  readonly reason: string | null;
  /** ⚠️ Scored under a policy the code no longer runs. */
  readonly stale: boolean;
  readonly policyVersion: string | null;
  readonly scoredAt: string | null;
}

export interface FeedView {
  readonly rows: readonly FeedRow[];
  readonly total: number;
  readonly staleCount: number;
  /** True when there is nothing to show at all, rather than nothing matching. */
  readonly empty: boolean;
  /** True when a filter is hiding everything. A different thing to say. */
  readonly filteredToNothing: boolean;
  readonly currentPolicyVersion: string;
}

function firstReason(row: OpportunityRow): string | null {
  if (!row.reasoning_json) return null;
  try {
    const reasons = JSON.parse(row.reasoning_json) as unknown;
    if (!Array.isArray(reasons) || reasons.length === 0) return null;
    return typeof reasons[0] === 'string' ? reasons[0] : null;
  } catch {
    // A malformed blob is not worth failing a screen over; the row still shows.
    return null;
  }
}

export function toFeedRow(row: OpportunityRow, currentPolicyVersion: string): FeedRow {
  const maxPrice = row.max_recommended_cents === null ? null : money(row.max_recommended_cents);
  return {
    id: row.opportunity_id,
    name: row.name,
    category: row.category,
    status: row.status,
    recommendation: row.recommendation,
    asking: money(row.asking_price_cents),
    maxPrice,
    overPriced: maxPrice !== null && row.asking_price_cents > maxPrice.cents,
    expectedProfit: money(row.expected_profit_cents),
    expectedRoiBps: row.expected_roi_bps,
    expectedDaysToSale: row.expected_days_to_sale,
    sellThroughBps: row.sell_through_bps,
    buyScore: row.buy_score,
    riskScore: row.risk_score,
    confidenceBps: row.confidence_bps,
    priceBoundBy: row.price_bound_by,
    reason: firstReason(row),
    // An unscored row is not stale — it was never scored. Different fact.
    stale: row.policy_version !== null && row.policy_version !== currentPolicyVersion,
    policyVersion: row.policy_version,
    scoredAt: row.scored_at,
  };
}

export function feedView(store: LedgerReader, filter: OpportunityFilter = {}): FeedView {
  const reader = store.opportunityReader();
  const currentPolicyVersion = store.policy().version;
  const rows = reader.list(filter).map((r) => toFeedRow(r, currentPolicyVersion));

  // "Nothing scored yet" and "your filter matched nothing" are different
  // problems with different fixes, and a single "no results" hides which.
  const hasAnyAtAll = rows.length > 0 || reader.list({}).length > 0;

  return {
    rows,
    total: rows.length,
    staleCount: rows.filter((r) => r.stale).length,
    empty: !hasAnyAtAll,
    filteredToNothing: hasAnyAtAll && rows.length === 0,
    currentPolicyVersion,
  };
}
