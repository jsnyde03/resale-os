/**
 * The most you may pay — the number you negotiate against.
 *
 * A deterministic inverse of the gates. What you receive from a sale does not
 * depend on what you paid for it, so every gate can be solved for the purchase
 * price and the binding one reported.
 *
 * ⚠️ **Goes through the fee model.** An earlier version of the CLI treated the
 * expected resale price as net proceeds and let a $7.01 profit look like $17.00
 * (log D-17). The resale figure here is GROSS, and `estimateNetProceeds` turns
 * it into what actually arrives.
 *
 * SCORING_SPEC §4. Pure.
 */

import type { Bps, Cents } from '../core/money.js';
import { estimateNetProceeds, type FeeModel, type NetProceedsOptions } from '../core/fees.js';
import type { ModePolicy } from '../core/capital/policy.js';

export type PriceBound = 'ROI' | 'PROFIT' | 'PER_ITEM' | 'DEPLOYABLE' | 'CATEGORY';

export interface MaxPriceInputs {
  /** The price you expect to SELL at, before fees. */
  readonly expectedGrossCents: Cents;
  /** Landed costs other than the purchase price: inbound shipping, tax, travel. */
  readonly otherLandedCents: Cents;
  readonly maxCapitalPerItemCents: Cents;
  readonly deployableCapitalCents: Cents;
  /** Remaining room in this category before its cap. */
  readonly categoryHeadroomCents: Cents;
}

export interface MaxPriceBreakdown {
  readonly netProceedsCents: Cents;
  readonly byRoiCents: Cents;
  readonly byProfitCents: Cents;
  readonly byPerItemCents: Cents;
  readonly byDeployableCents: Cents;
  readonly byCategoryCents: Cents;
  /** The lowest of them, floored at 0. */
  readonly maxPriceCents: Cents;
  /** Which limit actually binds — the one to argue with. */
  readonly boundBy: PriceBound;
}

export function maxRecommendedPrice(
  inputs: MaxPriceInputs,
  policy: ModePolicy,
  feeModel: FeeModel,
  feeOptions: NetProceedsOptions = {},
): MaxPriceBreakdown {
  const netProceedsCents = estimateNetProceeds(
    inputs.expectedGrossCents,
    feeModel,
    feeOptions,
  ).netCents;

  const other = inputs.otherLandedCents;

  // profit = net - landed >= minProfit  =>  landed <= net - minProfit
  const byProfitCents = netProceedsCents - policy.minExpectedProfitCents - other;

  // roi = (net - landed) / landed >= minRoi  =>  landed <= net / (1 + minRoi)
  const byRoiCents =
    Math.floor((netProceedsCents * 10_000) / (10_000 + policy.minExpectedRoiBps)) - other;

  const byPerItemCents = inputs.maxCapitalPerItemCents - other;
  const byDeployableCents = inputs.deployableCapitalCents - other;
  const byCategoryCents = inputs.categoryHeadroomCents - other;

  const candidates: readonly [PriceBound, Cents][] = [
    ['ROI', byRoiCents],
    ['PROFIT', byProfitCents],
    ['PER_ITEM', byPerItemCents],
    ['DEPLOYABLE', byDeployableCents],
    ['CATEGORY', byCategoryCents],
  ];

  const [firstBound, firstValue] = candidates[0]!;
  let boundBy: PriceBound = firstBound;
  let lowest: Cents = firstValue;
  for (const [bound, value] of candidates) {
    if (value < lowest) {
      lowest = value;
      boundBy = bound;
    }
  }

  return {
    netProceedsCents,
    byRoiCents,
    byProfitCents,
    byPerItemCents,
    byDeployableCents,
    byCategoryCents,
    maxPriceCents: Math.max(0, lowest),
    boundBy,
  };
}

/** The ROI that would result from paying `priceCents`. For display. */
export function roiAtPrice(
  priceCents: Cents,
  otherLandedCents: Cents,
  netProceedsCents: Cents,
): Bps {
  const landed = priceCents + otherLandedCents;
  if (landed <= 0) return 0;
  return Math.round(((netProceedsCents - landed) / landed) * 10_000);
}
