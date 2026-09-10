/**
 * One gate set, wherever the purchase came from.
 *
 * ⛔ **This exists because there were two, and they disagreed.** `assessQuote`
 * and `evaluateOpportunity` both end at `assessPurchase`, which skips any gate
 * whose field is `undefined` — so the buy screen, whose candidate carried
 * *velocity* confidence and no buy score, ran a strictly weaker rule set than
 * the sourcing screen, whose candidate carries *composite* confidence and one.
 * Measured 2026-09-10: **64 divergences in 96 cases, in both directions** — a
 * BUY that the buy screen then refused for `CONFIDENCE_TOO_LOW`, and a REJECT
 * it would have recorded without a word. Backlog **B58**, decision **D14**.
 *
 * ⚠️ The economics were never the problem — `quotePurchase` and
 * `deriveEconomics` agree to the cent across 144 cases, and a test pins that.
 * What differed was which gates ran, and on what evidence.
 *
 * Pure. Layer: `scoring`, because `core` may not import `domain` and the bridge
 * needs both.
 */

import type { Bps, Cents } from '../core/money.js';
import type { FundState } from '../core/capital/state.js';
import { MARKETPLACES } from '../core/fees.js';
import {
  quotePurchase,
  type PurchaseQuote,
  type PurchaseQuoteInput,
} from '../core/capital/quote.js';
import { parseOpportunity, type OpportunityInput } from '../domain/opportunity.js';
import { evaluateOpportunity, type Evaluation } from './evaluate.js';

/**
 * What a purchase is, beyond its numbers.
 *
 * ⛔ **`opportunityId` is the marker that a scorer produced the expectation**
 * (`accuracy.ts` reads it to tell SCORED from QUOTED), so it must be absent for
 * a purchase somebody typed. Evaluating needs *an* id because the schema does;
 * that one is synthetic and never leaves this file. See `evaluatePurchase`.
 */
export interface PurchaseIdentity {
  readonly name: string;
  readonly opportunityId?: string;
  /** Sold prices, if the operator looked them up. They raise comp confidence. */
  readonly compPricesCents?: readonly Cents[];
  readonly compMedianAgeDays?: number;
  readonly hassleBps?: Bps;
}

const isMarketplace = (m: string | undefined): m is (typeof MARKETPLACES)[number] =>
  m !== undefined && (MARKETPLACES as readonly string[]).includes(m);

/**
 * The same purchase, described the way the evaluator needs it.
 *
 * ⚠️ Every derived number comes off the `quote` rather than being recomputed,
 * so the two descriptions cannot drift: the gross here is the gross the quote
 * defaulted to (landed × 3 when nobody supplied one), not a second guess at it.
 *
 * ⚠️ An unrecognised marketplace is OMITTED rather than passed through. The
 * schema would reject it, and `feeModel` already falls back to eBay for
 * anything it does not know — so the default produces the identical fee model
 * rather than a different one.
 */
export function opportunityFromQuote(
  input: PurchaseQuoteInput,
  quote: PurchaseQuote,
  identity: PurchaseIdentity,
  opportunityId: string,
): OpportunityInput {
  return parseOpportunity({
    opportunityId,
    name: identity.name,
    category: input.category,
    source: 'MANUAL',
    sourceUrl: null,
    askingPriceCents: input.purchasePriceCents,
    inboundShippingCents: input.inboundShippingCents ?? 0,
    salesTaxCents: input.salesTaxCents ?? 0,
    acquisitionTravelCents: input.acquisitionTravelCents ?? 0,
    expectedGrossCents: quote.expectedGrossCents,
    ...(isMarketplace(input.marketplace) ? { marketplace: input.marketplace } : {}),
    postageCents: input.estPostageCents ?? null,
    // ⛔ Mirrors `quotePurchase` exactly: comps if there are any, otherwise the
    // operator's estimate, otherwise seven days. A velocity derived differently
    // here would be the same class of bug this file was written to close.
    soldLast90Days: input.soldLast90Days ?? null,
    activeListings: input.activeListings ?? 0,
    operatorDaysEstimate:
      input.soldLast90Days !== undefined ? null : (input.operatorDaysEstimate ?? 7),
    compPricesCents: identity.compPricesCents ?? [],
    ...(identity.compMedianAgeDays !== undefined
      ? { compMedianAgeDays: identity.compMedianAgeDays }
      : {}),
    ...(identity.hassleBps !== undefined ? { hassleBps: identity.hassleBps } : {}),
  });
}

export interface PurchaseAssessment {
  /** The arithmetic, and what `purchaseCommandFrom` records. */
  readonly quote: PurchaseQuote;
  /** The whole judgement, including the gates that decide it. */
  readonly evaluation: Evaluation;
}

/**
 * Quote a purchase and put it through the full evaluation — **the** gate set.
 *
 * ⛔ The synthetic id below is for the schema's benefit only. Passing it on to
 * `purchaseCommandFrom` would make every hand-typed buy claim a scorer produced
 * its expectation, and the accuracy report would pool guesses with predictions —
 * exactly the distinction B59 was answered to preserve. Callers pass
 * `identity.opportunityId` to the command, never this.
 */
export function evaluatePurchase(
  state: FundState,
  input: PurchaseQuoteInput,
  identity: PurchaseIdentity,
): PurchaseAssessment {
  const quote = quotePurchase(input);
  const opportunityId = identity.opportunityId ?? 'unscored-purchase';
  return {
    quote,
    evaluation: evaluateOpportunity(
      opportunityFromQuote(input, quote, identity, opportunityId),
      state,
    ),
  };
}
