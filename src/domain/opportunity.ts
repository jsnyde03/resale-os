/**
 * An opportunity: something you are considering buying, and everything the
 * system concluded about it.
 *
 * The input is deliberately small — most of what used to be typed in is now
 * derived. Comp counts give the hold time (`velocity.ts`), the gross resale
 * price gives net proceeds (`fees.ts`), and those give profit, ROI, downside,
 * confidence, both scores and the verdict.
 *
 * `OpportunityInput` is validated by zod at the boundary; everything below this
 * file works with already-valid data.
 */

import { z } from 'zod';
import type { Bps, Cents } from '../core/money.js';
import { toBps } from '../core/money.js';
import { applyBps } from '../core/money.js';
import {
  estimateNetProceeds,
  feeModel,
  MARKETPLACES,
  type FeeModel,
} from '../core/fees.js';
import { estimateFromComps, estimateFromOperator, type VelocityEstimate } from '../core/velocity.js';

/**
 * The status machine. `APPROVED` and `ARMED` are declared here and in the DB
 * CHECK constraint from day one, so adding autonomous purchasing later is not a
 * migration of live rows. **Nothing in this codebase transitions into them.**
 */
export const OPPORTUNITY_STATUSES = [
  'WATCHING',
  'ELIGIBLE',
  'RECOMMENDED',
  'PASSED',
  'APPROVED',
  'ARMED',
  'PURCHASED',
] as const;

export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

const centsSchema = z.number().int().nonnegative();
const bpsSchema = z.number().int().min(0).max(10_000);

export const opportunityInputSchema = z
  .object({
    opportunityId: z.string().min(1),
    name: z.string().min(1),
    category: z.string().min(1),
    source: z.string().min(1).default('MANUAL'),
    sourceUrl: z.string().url().nullable().default(null),
    sourceListingId: z.string().nullable().default(null),

    askingPriceCents: centsSchema,
    inboundShippingCents: centsSchema.default(0),
    salesTaxCents: centsSchema.default(0),
    acquisitionTravelCents: centsSchema.default(0),

    /** The price you expect to SELL at, before fees. */
    expectedGrossCents: centsSchema,
    marketplace: z.enum(MARKETPLACES).default('EBAY'),
    /** Overrides the fee model's default postage when you know better. */
    postageCents: centsSchema.nullable().default(null),

    // --- evidence ----------------------------------------------------------
    soldLast90Days: z.number().int().nonnegative().nullable().default(null),
    activeListings: z.number().int().nonnegative().default(0),
    /**
     * ⛔ Set when a count is known to be an undercount — a data source that
     * answers `"240,000+"` rather than a number. Only the ACTIVE one is
     * dangerous; see `CountBounds` in `core/velocity.ts` for why the two
     * directions are not symmetric. Defaults to exact, so every existing
     * caller keeps the behaviour it had.
     */
    activeListingsIsFloor: z.boolean().default(false),
    soldLast90DaysIsFloor: z.boolean().default(false),
    /** Only used when comp counts are absent. Carries low confidence. */
    operatorDaysEstimate: z.number().int().positive().nullable().default(null),
    compPricesCents: z.array(centsSchema).default([]),
    compMedianAgeDays: z.number().int().nonnegative().default(45),

    // --- judgement calls ---------------------------------------------------
    hassleBps: bpsSchema.default(2_000),
    conditionConfidenceBps: bpsSchema.nullable().default(null),
    sourceConfidenceBps: bpsSchema.nullable().default(null),
    counterfeitBps: bpsSchema.nullable().default(null),
    returnBps: bpsSchema.nullable().default(null),
    sellerBps: bpsSchema.nullable().default(null),
    shippingComplexityBps: bpsSchema.nullable().default(null),
    restockBps: bpsSchema.nullable().default(null),
  })
  .refine((v) => v.soldLast90Days !== null || v.operatorDaysEstimate !== null, {
    message:
      'give comp counts (soldLast90Days) or an explicit operatorDaysEstimate — ' +
      'the hold time has to come from somewhere',
  });

export type OpportunityInput = z.infer<typeof opportunityInputSchema>;

export interface OpportunityEconomics {
  readonly landedCostCents: Cents;
  readonly otherLandedCents: Cents;
  readonly marketplaceFeeCents: Cents;
  readonly postageCents: Cents;
  readonly packagingCents: Cents;
  readonly netProceedsCents: Cents;
  readonly expectedProfitCents: Cents;
  readonly expectedRoiBps: Bps;
  /** landedCost minus what a fire-sale would net. Floored at 0. */
  readonly modeledDownsideCents: Cents;
  readonly velocity: VelocityEstimate;
  readonly fees: FeeModel;
}

/** A fire-sale is assumed to clear at 40% of the expected gross. */
export const LIQUIDATION_SHARE_BPS: Bps = 4_000;

/**
 * Everything derivable from the input, in one place, so the scorer and the CLI
 * cannot disagree about what an opportunity is worth.
 */
export function deriveEconomics(input: OpportunityInput): OpportunityEconomics {
  const fees = feeModel(input.marketplace);
  const feeOptions = input.postageCents === null ? {} : { postageCents: input.postageCents };

  const otherLandedCents =
    input.inboundShippingCents + input.salesTaxCents + input.acquisitionTravelCents;
  const landedCostCents = input.askingPriceCents + otherLandedCents;

  const proceeds = estimateNetProceeds(input.expectedGrossCents, fees, feeOptions);
  const expectedProfitCents = proceeds.netCents - landedCostCents;

  const liquidationNet = estimateNetProceeds(
    applyBps(input.expectedGrossCents, LIQUIDATION_SHARE_BPS),
    fees,
    feeOptions,
  ).netCents;

  const velocity =
    input.soldLast90Days !== null
      ? estimateFromComps(input.soldLast90Days, input.activeListings, {
          activeIsFloor: input.activeListingsIsFloor,
          soldIsFloor: input.soldLast90DaysIsFloor,
        })
      : estimateFromOperator(input.operatorDaysEstimate ?? 7);

  return {
    landedCostCents,
    otherLandedCents,
    marketplaceFeeCents: proceeds.marketplaceFeeCents,
    postageCents: proceeds.postageCents,
    packagingCents: proceeds.packagingCents,
    netProceedsCents: proceeds.netCents,
    expectedProfitCents,
    expectedRoiBps: landedCostCents <= 0 ? 0 : toBps(expectedProfitCents, landedCostCents),
    modeledDownsideCents: Math.max(0, landedCostCents - liquidationNet),
    velocity,
    fees,
  };
}

export function parseOpportunity(raw: unknown): OpportunityInput {
  return opportunityInputSchema.parse(raw);
}
