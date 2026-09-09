/**
 * Marketplace fee models.
 *
 * WHY THIS EXISTS AS ITS OWN MODULE: without it, "expected resale value" is
 * ambiguous between gross and net, and the two differ by roughly a third at
 * bootstrap prices. The CLI briefly treated a $32 gross sale as $32 of
 * proceeds, which turned a $7.43 profit into a $17.00 one and let a purchase
 * through the $8 minimum-profit gate that should have been refused. Estimating
 * fees badly is survivable; not estimating them at all is not.
 *
 * These are estimates the operator can override per opportunity. Gate 2 extends
 * the same interface with per-marketplace routing; nothing here needs to change
 * for that.
 */

import { applyBps, type Bps, type Cents } from './money.js';

export const MARKETPLACES = ['EBAY', 'MERCARI', 'LOCAL', 'OTHER'] as const;
export type Marketplace = (typeof MARKETPLACES)[number];

export interface FeeModel {
  readonly marketplace: Marketplace;
  /** Percentage of the total sale, INCLUDING what the buyer paid for shipping. */
  readonly finalValueBps: Bps;
  /** Flat charge per order, on top of the percentage. */
  readonly perOrderCents: Cents;
  /** Typical outbound postage for a small parcel. An estimate, always. */
  readonly defaultPostageCents: Cents;
  /** Typical packaging consumed per order. */
  readonly defaultPackagingCents: Cents;
}

/**
 * eBay's standard final value fee is ~13.25% of the total amount of the sale
 * plus $0.40 per order for most categories. Category-specific rates and any
 * store subscription are an operator override, not a default.
 */
export const EBAY_FEES: FeeModel = {
  marketplace: 'EBAY',
  finalValueBps: 1_325,
  perOrderCents: 40,
  defaultPostageCents: 500,
  defaultPackagingCents: 35,
};

export const MERCARI_FEES: FeeModel = {
  marketplace: 'MERCARI',
  finalValueBps: 1_000,
  perOrderCents: 50,
  defaultPostageCents: 500,
  defaultPackagingCents: 35,
};

/** Cash in a parking lot: no platform takes a cut, and nothing is shipped. */
export const LOCAL_FEES: FeeModel = {
  marketplace: 'LOCAL',
  finalValueBps: 0,
  perOrderCents: 0,
  defaultPostageCents: 0,
  defaultPackagingCents: 0,
};

export const OTHER_FEES: FeeModel = {
  marketplace: 'OTHER',
  finalValueBps: 1_200,
  perOrderCents: 0,
  defaultPostageCents: 500,
  defaultPackagingCents: 35,
};

const MODELS: Readonly<Record<Marketplace, FeeModel>> = {
  EBAY: EBAY_FEES,
  MERCARI: MERCARI_FEES,
  LOCAL: LOCAL_FEES,
  OTHER: OTHER_FEES,
};

export function feeModel(marketplace: string | undefined): FeeModel {
  if (marketplace && marketplace in MODELS) return MODELS[marketplace as Marketplace];
  return EBAY_FEES;
}

export interface NetProceedsEstimate {
  readonly grossCents: Cents;
  readonly marketplaceFeeCents: Cents;
  readonly postageCents: Cents;
  readonly packagingCents: Cents;
  /** What actually reaches the fund. Can be negative on a small enough sale. */
  readonly netCents: Cents;
}

export interface NetProceedsOptions {
  readonly postageCents?: Cents;
  readonly packagingCents?: Cents;
  /** Shipping the buyer paid. It is part of the fee base, and it is income. */
  readonly buyerPaidShippingCents?: Cents;
}

/**
 * Gross sale price -> what the fund actually receives.
 *
 * The fee percentage applies to the whole amount the buyer paid, shipping
 * included — which is why buyer-paid shipping is added to the fee base rather
 * than netted off first.
 */
export function estimateNetProceeds(
  grossCents: Cents,
  model: FeeModel,
  options: NetProceedsOptions = {},
): NetProceedsEstimate {
  const buyerPaidShipping = options.buyerPaidShippingCents ?? 0;
  const feeBase = grossCents + buyerPaidShipping;

  const marketplaceFeeCents = applyBps(feeBase, model.finalValueBps) + model.perOrderCents;
  const postageCents = options.postageCents ?? model.defaultPostageCents;
  const packagingCents = options.packagingCents ?? model.defaultPackagingCents;

  return {
    grossCents,
    marketplaceFeeCents,
    postageCents,
    packagingCents,
    netCents:
      grossCents + buyerPaidShipping - marketplaceFeeCents - postageCents - packagingCents,
  };
}

/**
 * The gross price needed to clear a target net. The inverse of the above, and
 * the number to negotiate a listing price against.
 */
export function grossNeededForNet(targetNetCents: Cents, model: FeeModel): Cents {
  const fixed = model.perOrderCents + model.defaultPostageCents + model.defaultPackagingCents;
  const denominator = 10_000 - model.finalValueBps;
  if (denominator <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.ceil(((targetNetCents + fixed) * 10_000) / denominator);
}
