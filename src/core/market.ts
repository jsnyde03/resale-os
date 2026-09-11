/**
 * What a market looks like — and deliberately not *who said so*.
 *
 * ⛔ **These types are the seam.** An adapter's whole job is to turn one
 * vendor's response into this shape; a screen's whole job is to render it. Both
 * depend on this file and neither depends on the other, so swapping the data
 * route is a new file in `src/adapters/` and nothing else.
 *
 * ⚠️ **That boundary is load-bearing now, not tidy.** eBay's developer account
 * was denied outright (**D16**) and is not retryable, so every automated number
 * the fund sees comes from one small vendor. Alternatives exist and are
 * unevaluated; this seam is what buys the option to evaluate them later rather
 * than rewrite then.
 *
 * Pure types and one predicate. No I/O, no clock.
 */

import type { Cents } from './money.js';

/**
 * A count, and whether the source meant *"at least"*.
 *
 * ⛔ **The floor is not a detail.** `90 × (active + 1)/sold` is not linear in
 * either count, and the two directions land on opposite sides of safe — see
 * `CountBounds` in `velocity.ts`. A reading that cannot say "at least" is a
 * reading that hands the gate its friendliest number and calls it measured.
 */
export interface CountReading {
  readonly value: number;
  readonly isFloor: boolean;
}

/**
 * ⛔ **Which condition the comps describe (B90).**
 *
 * Measured 2026-09-11 on LEGO 75038: unfiltered comps span 234× with a
 * coefficient of variation of **1.24**, and `COMP_CV_WORTHLESS` is **0.50** — so
 * they score a dispersion term of **exactly zero** and contribute nothing to the
 * confidence gate that decides everything. Filtered to new: 3× spread, CV 0.26,
 * and a median **three times higher** ($120 against $40).
 *
 * ⚠️ **The dispersion was manufactured, not measured.** Sealed sets, loose
 * parts and instruction booklets are three markets, and averaging them describes
 * none of them.
 */
export type CompCondition = 'any' | 'new' | 'used';

/**
 * ⚡ **B80: the keyword is an input to a money gate.** A count counts whatever
 * the keyword matched, so a vague name measures the broad market and a precise
 * one measures the item. ⚠️ It is not directionally biased — measured, a broad
 * search gave a 49-day hold and a specific one 18 — so the risk is
 * **misattribution, not optimism**: a confident, correctly computed number about
 * a different item.
 *
 * ⛔ **And the category matters as much as the words.** A vendor that narrows
 * one half of the ratio and not the other produces two counts over two
 * populations (**B82**), so the category BOTH halves were measured in is part
 * of the reading rather than a footnote.
 */
export interface Provenance {
  readonly keyword: string;
  /** ⛔ The condition the comps were drawn from. `any` means they mix markets. */
  readonly compCondition: CompCondition;
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly soldItemsSeen: number;
  readonly activeItemsSeen: number;
  readonly soldAfter: string;
  readonly fetchedAt: string;
}

/**
 * ⚡ **B78: the route is metered and paid, and the app should say so rather than
 * discover it.** Each item costs 2 requests, so a 100/month tier is ~50 items —
 * two rack visits.
 */
export interface QuotaReading {
  readonly monthlyLimit: number | null;
  readonly monthlyRemaining: number | null;
  readonly resetAt: string | null;
}

export interface MarketReading {
  readonly sold90: CountReading;
  readonly active: CountReading;
  readonly compPricesCents: readonly Cents[];
  readonly compMedianAgeDays: number;
  readonly provenance: Provenance;
  readonly quota: QuotaReading;
}

export type MarketFailureReason =
  /** No signal. The normal case in a shop, and not an error. */
  | 'OFFLINE'
  /** ⚠️ The month's requests are gone. Degrade to typing, do not break. */
  | 'QUOTA_EXCEEDED'
  /** A per-minute limit. Worth retrying, unlike the one above. */
  | 'RATE_LIMITED'
  /** ⛔ A count that would not parse. Refused rather than defaulted. */
  | 'UNPARSEABLE'
  | 'AUTH'
  | 'VENDOR';

export interface MarketFailure {
  readonly ok: false;
  readonly reason: MarketFailureReason;
  /** Shown to the operator. Says what happened, not what to think about it. */
  readonly detail: string;
  /** Present whenever the vendor answered at all. */
  readonly quota?: QuotaReading;
}

export type MarketResult = { readonly ok: true; readonly reading: MarketReading } | MarketFailure;

/**
 * ⚠️ **Only one of these is worth trying again on the spot.** Offline clears
 * when the signal does and a per-minute limit clears in under a minute; an
 * exhausted month, a refused key and a count that will not parse do not clear
 * by pressing the button again. A screen that offers "retry" for all six
 * teaches the operator to ignore it.
 */
export function isWorthRetrying(failure: MarketFailure): boolean {
  return failure.reason === 'OFFLINE' || failure.reason === 'RATE_LIMITED';
}
