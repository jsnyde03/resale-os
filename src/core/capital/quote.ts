/**
 * Pricing a purchase you are standing in front of.
 *
 * Everything between "here is what they want for it" and "here is what the
 * capital rules say": landed cost, a velocity estimate, fees, the profit that
 * implies, and the candidate the constraints are assessed against.
 *
 * ⛔ **Extracted from `src/cli/index.ts`, not copied.** It lived inline in the
 * `buy` command, and the phone needs the identical arithmetic — two
 * implementations of "what will this net" is exactly how a fund starts
 * disagreeing with itself about whether a purchase was allowed. The CLI is
 * scheduled for retirement (5.10) and this outlives it.
 *
 * Pure: no I/O, no clock, no store. It takes the fund's state because the
 * capital gates are relative to the bankroll, and returns what it computed
 * rather than a verdict.
 */

import type { Bps, Cents } from '../money.js';
import { applyBps, toBps } from '../money.js';
import { estimateNetProceeds, feeModel, type FeeModel, type NetProceedsEstimate } from '../fees.js';
import { estimateFromComps, estimateFromOperator, type VelocityEstimate } from '../velocity.js';
// ⚠️ The CANDIDATE only. This file no longer imports `assessPurchase` at all,
// so it cannot gate a purchase even by accident — that is `scoring/purchase.ts`.
import type { PurchaseCandidate } from './constraints.js';
import type { PurchaseCommand } from './commands.js';

/**
 * A liquidation is modelled at 40% of the expected gross, net of the same fees.
 * Not a prediction — a floor to size the downside against.
 */
const FIRE_SALE_BPS: Bps = 4_000;

/** The default expectation when nobody supplied one: a 3x flip. */
const DEFAULT_MULTIPLE = 3;

export interface PurchaseQuoteInput {
  readonly category: string;
  readonly purchasePriceCents: Cents;
  readonly inboundShippingCents?: Cents;
  readonly salesTaxCents?: Cents;
  readonly acquisitionTravelCents?: Cents;
  /**
   * The GROSS price you expect to sell at. Fees and postage come off it before
   * any gate sees a profit figure. Omitted means `landed * 3`.
   */
  readonly expectedGrossCents?: Cents;
  readonly marketplace?: string;
  /** Overrides the marketplace's default postage when you know the parcel. */
  readonly estPostageCents?: Cents;
  /**
   * Comps if you have them, an operator guess if you do not. Comps supply a
   * sell-through ratio; a guess deliberately does not, and the gate abstains
   * rather than failing an unknown.
   */
  readonly soldLast90Days?: number;
  readonly activeListings?: number;
  readonly operatorDaysEstimate?: number;
}

export interface PurchaseQuote {
  readonly landedCostCents: Cents;
  readonly expectedGrossCents: Cents;
  readonly feeModel: FeeModel;
  readonly estimate: NetProceedsEstimate;
  readonly expectedProfitCents: Cents;
  readonly expectedRoiBps: Bps;
  readonly modeledDownsideCents: Cents;
  readonly velocity: VelocityEstimate;
  readonly candidate: PurchaseCandidate;
  /** Whether the expected gross was supplied or assumed. */
  readonly grossWasAssumed: boolean;
}

export function landedCostOf(input: PurchaseQuoteInput): Cents {
  return (
    input.purchasePriceCents +
    (input.inboundShippingCents ?? 0) +
    (input.salesTaxCents ?? 0) +
    (input.acquisitionTravelCents ?? 0)
  );
}

export function quotePurchase(input: PurchaseQuoteInput): PurchaseQuote {
  const landedCostCents = landedCostOf(input);

  const velocity =
    input.soldLast90Days !== undefined
      ? estimateFromComps(input.soldLast90Days, input.activeListings ?? 0)
      : estimateFromOperator(input.operatorDaysEstimate ?? 7);

  const grossWasAssumed = input.expectedGrossCents === undefined;
  const expectedGrossCents = input.expectedGrossCents ?? landedCostCents * DEFAULT_MULTIPLE;

  const model = feeModel(input.marketplace);
  const estimate = estimateNetProceeds(expectedGrossCents, model, {
    ...(input.estPostageCents !== undefined ? { postageCents: input.estPostageCents } : {}),
  });
  const expectedProfitCents = estimate.netCents - landedCostCents;

  const modeledDownsideCents = Math.max(
    0,
    landedCostCents - estimateNetProceeds(applyBps(expectedGrossCents, FIRE_SALE_BPS), model).netCents,
  );

  const candidate: PurchaseCandidate = {
    category: input.category,
    landedCostCents,
    expectedDaysToSale: velocity.expectedDaysToSale,
    modeledDownsideCents,
    expectedNetProfitCents: expectedProfitCents,
    expectedRoiBps: landedCostCents === 0 ? 0 : toBps(expectedProfitCents, landedCostCents),
    confidenceBps: velocity.confidenceBps,
    // ⚠️ Present only for comps. An operator estimate has no ratio to test, and
    // supplying a zero would fail the gate on an unknown rather than abstain.
    ...(velocity.source === 'COMPS' ? { sellThroughBps: velocity.sellThroughBps } : {}),
  };

  return {
    landedCostCents,
    expectedGrossCents,
    feeModel: model,
    estimate,
    expectedProfitCents,
    expectedRoiBps: candidate.expectedRoiBps,
    modeledDownsideCents,
    velocity,
    candidate,
    grossWasAssumed,
  };
}

/**
 * ⛔ **`assessQuote` was here, and it was deleted with D14 (2026-09-10).**
 *
 * It returned `assessPurchase(state, quote.candidate)` — and that candidate
 * carries velocity confidence and no buy score, so `assessPurchase` silently
 * skipped a gate and the buy screen ran a weaker rule set than the screen that
 * recommends the purchase. 64 divergences in 96 cases, in both directions.
 *
 * ⚠️ **The gates live in `scoring/purchase.ts` now**, which is the only layer
 * that can see both the quote and the evaluator — `core` may not import
 * `domain`. This file still owns the arithmetic: `quotePurchase` prices a
 * purchase and `purchaseCommandFrom` records one. Neither decides.
 *
 * It is deleted rather than deprecated because it had tests, and a tested
 * export reads as a blessed one.
 */

export interface PurchaseCommandInput {
  readonly itemId: string;
  readonly name: string;
  readonly occurredAt: string;
  readonly listingLive?: boolean;
  readonly opportunityId?: string;
  /**
   * D4: the gates this purchase overruled, and why. The engine refuses an
   * override with no reason, so passing gates without one is a refusal, not a
   * silent buy.
   */
  readonly override?: { readonly gates: readonly string[]; readonly reason: string };
}

/**
 * The PURCHASE command a quote implies.
 *
 * ⛔ Shared by the CLI and the phone for the same reason the quote is: the
 * fields the engine hashes must not depend on which surface recorded the buy.
 */
export function purchaseCommandFrom(
  input: PurchaseQuoteInput,
  quote: PurchaseQuote,
  meta: PurchaseCommandInput,
): PurchaseCommand {
  return {
    type: 'PURCHASE',
    itemId: meta.itemId,
    name: meta.name,
    category: input.category,
    purchasePriceCents: input.purchasePriceCents,
    ...(input.inboundShippingCents !== undefined
      ? { inboundShippingCents: input.inboundShippingCents }
      : {}),
    ...(input.salesTaxCents !== undefined ? { salesTaxCents: input.salesTaxCents } : {}),
    ...(input.acquisitionTravelCents !== undefined
      ? { acquisitionTravelCents: input.acquisitionTravelCents }
      : {}),
    // ⚠️ From the QUOTE, not from the input. The operator supplies comps or a
    // guess; the days that go on the record are what the velocity model made
    // of them, and that is the number the hold-time gate was assessed against.
    expectedDaysToSale: quote.velocity.expectedDaysToSale,
    expectedResaleCents: quote.expectedGrossCents,
    // ⛔ B59, answered 2026-09-09: record it — but only when the operator said
    // what they expect to sell for.
    //
    // `accuracyReport` measures the items that HAVE a prediction, and that
    // population used to mean "came through the scorer". After 5.10 retires the
    // CLI the scorer is the RARE path, so a report that ignores the number the
    // operator actually decided from is blind rather than conservative.
    //
    // ⚠️ And the exclusion matters as much as the inclusion. When no expected
    // gross was given the quote assumes a 3x flip — that is the app's guess,
    // not a prediction, and scoring accuracy against it would measure
    // `DEFAULT_MULTIPLE` while looking like it measured judgement.
    ...(quote.grossWasAssumed
      ? {}
      : {
          expectedNetProceedsCents: quote.estimate.netCents,
          expectedProfitCents: quote.expectedProfitCents,
        }),
    ...(input.marketplace !== undefined ? { marketplace: input.marketplace } : {}),
    ...(meta.opportunityId !== undefined ? { opportunityId: meta.opportunityId } : {}),
    listingLive: meta.listingLive ?? false,
    ...(meta.override && meta.override.gates.length > 0
      ? { overrodeGates: meta.override.gates, overrideReason: meta.override.reason }
      : {}),
    occurredAt: meta.occurredAt,
  };
}
