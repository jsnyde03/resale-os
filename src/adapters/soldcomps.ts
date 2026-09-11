/**
 * SoldComps — the fund's only automated view of a market.
 *
 * ⛔ **eBay is unavailable and not retryable** (**D16**, 2026-09-11): the
 * developer account was denied outright, which takes the Browse API with it.
 * One small vendor now supplies every automated number the fund sees —
 * `sold=true` for the comps and the sales count, `sold=false` for the
 * competition. ⚡ **That is what makes this an adapter rather than a client.**
 * The gates, the scoring and the screens never learn where a number came from;
 * only this file does, so swapping vendors is a new file beside this one.
 *
 * ## ⛔ ACTIVE FIRST, THEN SOLD PINNED TO ITS CATEGORY (B82)
 *
 * The single most important thing in this file, and it was not predicted —
 * it was found by reading two real responses side by side:
 *
 * ```
 * sold,   no category     "147764"     autoSelectedCategory: null
 * active, count=200       "240,000+"   autoSelectedCategory: 183447 LEGO (R) Building Toys
 * active, categoryId=0    "240,000+"   autoSelectedCategory: 183447   <- cannot be turned off
 * ```
 *
 * **The ACTIVE call silently restricts itself to a category it chooses. The
 * SOLD call counts everything.** Both report in a way that reads like *"no
 * restriction applied"* — `autoSelectedCategory: null` on the sold side is
 * indistinguishable from "I did not narrow anything", because that is exactly
 * what it means, while the other half of the same ratio narrowed silently.
 *
 * Pinning the category moved the sold total **147,764 → 122,956, a 17% swing**.
 * And both gates that refuse most real candidates are computed *across the two*:
 * `90 × (active + 1)/sold` and `sold/(sold + active)`. A ratio of two different
 * populations is not a ratio of anything.
 *
 * ⚡ **The fix costs no extra request.** Both calls were being made anyway; only
 * the order changes. ACTIVE goes first because it is the one that declares a
 * category, and SOLD is then pinned to whatever it declared.
 *
 * ## What this file will not do
 *
 * ⛔ **It never throws at the caller and it never gates.** A shop with no signal
 * is the normal case, and a quota refusal arrives mid-decision with the operator
 * holding the object. Every failure is a value, so the screen keeps working with
 * typed numbers exactly as well as it does today (6.1.2).
 *
 * ⛔ **It never defaults a number it could not read.** See `total-results.ts`.
 */

import { parseDollars, type Cents } from '../core/money.js';
import { parseTotalResults, type TotalResult } from './total-results.js';

export const SOLDCOMPS_BASE_URL = 'https://api.sold-comps.com/v1/scrape';

/** eBay's sold index reaches back about 90 days, which is the window the gates use. */
export const SOLD_WINDOW_DAYS = 90;

/**
 * ⚠️ **Measured, not chosen.** SOLD pages cap at 40 and ACTIVE at 200. Asking
 * for more is not an error, it just does not arrive — so these are the real
 * sample sizes the comps and the provenance are drawn from.
 */
export const SOLD_PAGE_SIZE = 40;
export const ACTIVE_PAGE_SIZE = 200;

/** A count, and whether the vendor meant "at least". @see ParsedTotal */
export interface CountReading {
  readonly value: number;
  readonly isFloor: boolean;
}

/**
 * ⚡ **B80: the keyword is an input to a money gate.** `totalResults` counts
 * whatever the keyword matched, so a vague name measures the broad market and a
 * precise one measures the item. ⚠️ It is not directionally biased — measured,
 * a broad search gave a 49-day hold and a specific one 18 — so the risk is
 * **misattribution, not optimism**: a confident, correctly computed number
 * about a different item. The screen shows all of this so a wrong keyword is
 * visible rather than silently authoritative.
 */
export interface Provenance {
  readonly keyword: string;
  /** The category BOTH halves were counted in, or null if the vendor picked none. */
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly soldItemsSeen: number;
  readonly activeItemsSeen: number;
  readonly soldAfter: string;
  readonly fetchedAt: string;
}

/**
 * ⚡ **B78: the route is metered and paid, and the app should say so rather
 * than discover it.** Each item costs 2 requests, so the free 100/month is
 * ~50 items — two rack visits.
 */
export interface QuotaReading {
  readonly monthlyLimit: number | null;
  readonly monthlyRemaining: number | null;
  readonly resetAt: string | null;
}

export interface MarketReading {
  readonly sold90: CountReading;
  readonly active: CountReading;
  /** From the sold page's `soldPrice`, exact cents. Empty when none parsed. */
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
  /** 60/minute on every plan. A plan buys quota, never speed. */
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

export interface SoldCompsConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
  /** Injected so every test in this repo runs without a network or a key. */
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
}

const fail = (
  reason: MarketFailureReason,
  detail: string,
  quota?: QuotaReading,
): MarketFailure => (quota === undefined ? { ok: false, reason, detail } : { ok: false, reason, detail, quota });

function readQuota(headers: Headers): QuotaReading {
  // ⚠️ **The vendor's own docs misname these.** They document `X-Usage-Current`
  // and `X-Usage-Limit`; the wire sends `x-usage-limit`, `x-usage-remaining`,
  // `x-usage-used` and `x-usage-reset`. Measured 2026-09-11 — the docs are
  // wrong, so these names came off a real response.
  const num = (name: string): number | null => {
    const raw = headers.get(name);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  };
  return {
    monthlyLimit: num('x-usage-limit'),
    monthlyRemaining: num('x-usage-remaining'),
    resetAt: headers.get('x-usage-reset'),
  };
}

function isoDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/** The median of an odd or even run of numbers, without floating-point drift. */
function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return Math.round(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

interface RawPage {
  readonly totalResults?: unknown;
  readonly hasNextPage?: unknown;
  readonly autoSelectedCategory?: { readonly id?: unknown; readonly name?: unknown } | null;
  readonly items?: readonly Record<string, unknown>[];
}

/**
 * ⛔ `totalResults` is the grand total; `hasNextPage` says the PAGE was capped.
 * Those are different facts, and only the first feeds a gate — but a total that
 * refuses to parse while `hasNextPage` is set is still a floor, because the
 * items in hand are provably not all of them.
 */
function readCount(page: RawPage, itemsSeen: number): TotalResult {
  const parsed = parseTotalResults(page.totalResults);
  if (parsed.ok) return parsed;
  // The vendor gave no usable total. The items on the page are a real count of
  // *something*, and `hasNextPage` says whether it is all of it.
  if (page.hasNextPage === true) return { ok: true, value: itemsSeen, isFloor: true };
  if (itemsSeen > 0) return { ok: true, value: itemsSeen, isFloor: false };
  return parsed;
}

async function getPage(
  config: SoldCompsConfig,
  params: Record<string, string>,
): Promise<{ ok: true; page: RawPage; quota: QuotaReading } | MarketFailure> {
  const doFetch = config.fetch ?? globalThis.fetch;
  const url = `${config.baseUrl ?? SOLDCOMPS_BASE_URL}?${new URLSearchParams(params)}`;

  let res: Response;
  try {
    res = await doFetch(url, { headers: { Authorization: `Bearer ${config.apiKey}` } });
  } catch (e) {
    // ⚠️ A shop with no signal lands here, and it is not an error condition.
    return fail('OFFLINE', e instanceof Error ? e.message : 'the network did not answer');
  }

  const quota = readQuota(res.headers);

  if (res.status === 429) {
    // `code` separates the two: a per-minute limit is worth retrying and an
    // exhausted month is not.
    const body = (await res.json().catch(() => ({}))) as { code?: string; reset_at?: string };
    return body.code === 'quota_exceeded'
      ? fail('QUOTA_EXCEEDED', `the month's requests are used up${body.reset_at ? `, until ${body.reset_at}` : ''}`, quota)
      : fail('RATE_LIMITED', 'more than 60 requests in a minute', quota);
  }
  if (res.status === 401 || res.status === 403) {
    return fail('AUTH', `the API key was refused (${res.status})`, quota);
  }
  if (!res.ok) return fail('VENDOR', `the data source answered ${res.status}`, quota);

  try {
    return { ok: true, page: (await res.json()) as RawPage, quota };
  } catch {
    return fail('VENDOR', 'the data source answered with something that is not JSON', quota);
  }
}

/**
 * Two requests, in this order, and the order is the point. @see B82 above.
 */
export async function lookUpMarket(
  keyword: string,
  config: SoldCompsConfig,
): Promise<MarketResult> {
  const trimmed = keyword.trim();
  if (trimmed === '') return fail('VENDOR', 'no keyword to search for');

  const now = (config.now ?? (() => new Date()))();
  const soldAfter = isoDaysAgo(now, SOLD_WINDOW_DAYS);

  // --- 1. ACTIVE, which is the half that declares a category ----------------
  const activeRes = await getPage(config, {
    keyword: trimmed,
    sold: 'false',
    count: String(ACTIVE_PAGE_SIZE),
  });
  if (!activeRes.ok) return activeRes;

  const activeItems = activeRes.page.items ?? [];
  const activeCount = readCount(activeRes.page, activeItems.length);
  if (!activeCount.ok) {
    return fail('UNPARSEABLE', `the active count read "${activeCount.raw}" — ${activeCount.reason}`, activeRes.quota);
  }

  const category = activeRes.page.autoSelectedCategory ?? null;
  const categoryId = typeof category?.id === 'string' ? category.id : null;
  const categoryName = typeof category?.name === 'string' ? category.name : null;

  // --- 2. SOLD, pinned to whatever ACTIVE just narrowed itself to -----------
  const soldRes = await getPage(config, {
    keyword: trimmed,
    sold: 'true',
    count: String(SOLD_PAGE_SIZE),
    soldAfter,
    ...(categoryId === null ? {} : { categoryId }),
  });
  if (!soldRes.ok) return soldRes;

  const soldItems = soldRes.page.items ?? [];
  const soldCount = readCount(soldRes.page, soldItems.length);
  if (!soldCount.ok) {
    return fail('UNPARSEABLE', `the sold count read "${soldCount.raw}" — ${soldCount.reason}`, soldRes.quota);
  }

  // --- the comps ------------------------------------------------------------
  //
  // ⚠️ `soldPrice` excludes shipping and `totalPrice` includes it. The fee model
  // already handles postage separately, so `soldPrice` is the consistent one —
  // and where a seller baked shipping into a free-postage listing it UNDERSTATES
  // the resale, which refuses a good item rather than accepting a bad one.
  const compPricesCents: Cents[] = [];
  const ageDays: number[] = [];
  for (const item of soldItems) {
    const price = item['soldPrice'];
    if (typeof price === 'string') {
      try {
        compPricesCents.push(parseDollars(price));
      } catch {
        // One malformed price is not a reason to refuse the market. An empty
        // comp set is already capped hard by the confidence gate.
      }
    }
    const endedAt = item['endedAt'];
    if (typeof endedAt === 'string') {
      const ended = Date.parse(`${endedAt}T00:00:00Z`);
      if (!Number.isNaN(ended)) {
        ageDays.push(Math.max(0, Math.round((now.getTime() - ended) / 86_400_000)));
      }
    }
  }

  return {
    ok: true,
    reading: {
      sold90: { value: soldCount.value, isFloor: soldCount.isFloor },
      active: { value: activeCount.value, isFloor: activeCount.isFloor },
      compPricesCents,
      // The schema's own default, used when no date survived.
      compMedianAgeDays: ageDays.length === 0 ? 45 : medianOf(ageDays),
      provenance: {
        keyword: trimmed,
        categoryId,
        categoryName,
        soldItemsSeen: soldItems.length,
        activeItemsSeen: activeItems.length,
        soldAfter,
        fetchedAt: now.toISOString(),
      },
      quota: soldRes.quota,
    },
  };
}
