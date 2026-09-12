/**
 * UPCitemdb — a barcode into words.
 *
 * ⛔ **This vendor exists because SoldComps takes no barcode.** Verified
 * 2026-09-11 against its own documentation: every search endpoint accepts a
 * free-text `keyword` and nothing else, and `epid` is a response field rather
 * than a query parameter. So a scan produces a number the fund's only market
 * route cannot use, and something has to turn it into a title first.
 *
 * ⚠️ **That makes this the SECOND small vendor the fund depends on**, which is
 * the cost D18 accepted. `core/product.ts` is the seam: a screen renders a
 * `ProductIdentity` and never learns who resolved it, so replacing this file is
 * the whole of replacing the vendor.
 *
 * ## ⚠️ What is NOT known about it
 *
 * ⚡ **Measured before building on it**, not after: the keyless trial endpoint
 * round-tripped three real LEGO UPCs to title, brand and category. **That is the
 * whole of what has been proven.** It has never been pointed at a Walmart
 * clearance SKU — a store brand, a seasonal line, a regional exclusive — which
 * is precisely the population it exists to serve. ⛔ `NOT_FOUND` is therefore a
 * NORMAL outcome, not an error, and the screen must degrade to typing rather
 * than treat it as a failure.
 *
 * ## Tiers
 *
 * The `trial` path needs no key and allows ~100 lookups a day, rate-limited.
 * That is enough for a rack visit and not enough for a habit; a key moves the
 * base path without changing anything else here.
 *
 * ⛔ **It never throws at the caller and it never gates.** Same rule as the
 * market adapter: every failure is a value, because a shop with no signal is
 * the normal case.
 *
 * ## ⚠️ Two things the real bytes corrected
 *
 * ⛔ **`model` is not a model number.** On the LEGO record it is the UPC
 * repeated back — `model: "673419209366"` — so preferring it over the title
 * would have produced a keyword of twelve digits that no seller types. The set
 * number lives in the TITLE (`75038`), which is why `keywordFor` reads it from
 * there. **The instinct to trust a named field over a regex was wrong here**,
 * and only capturing a real response showed it.
 *
 * ⛔ **An all-zeros barcode RESOLVES.** `000000000000` returns HTTP 200 with a
 * genuine record — "ORGANIC BLUE CORN TORTILLA CHIPS". So a mis-scan does not
 * fail loudly; it succeeds quietly with the wrong product. ⚡ **The guard is
 * the operator**: the title goes on screen next to the object in their hand,
 * and nothing is decided until they have seen it.
 */

import type {
  ProductFailure,
  ProductFailureReason,
  ProductIdentity,
  ProductResult,
} from '../core/product.js';

export const UPCITEMDB_TRIAL_URL = 'https://api.upcitemdb.com/prod/trial';

export interface ProductLookupConfig {
  /** Defaults to the keyless trial endpoint. A paid key changes the base path. */
  readonly baseUrl?: string;
  readonly apiKey?: string;
  /** Injected, so every test in this repo runs without a network. */
  readonly fetch?: typeof globalThis.fetch;
}

const fail = (reason: ProductFailureReason, detail: string): ProductFailure => ({
  ok: false,
  reason,
  detail,
});

/**
 * ⚠️ **A barcode is digits, and a scanner is not always tidy.** EAN-13 and
 * UPC-A differ by a leading zero, so the raw scan is normalised before it is
 * sent and echoed back verbatim in the identity.
 */
export function normaliseBarcode(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  // 8 (EAN-8), 12 (UPC-A), 13 (EAN-13), 14 (GTIN-14) are the forms retail uses.
  return [8, 12, 13, 14].includes(digits.length) ? digits : null;
}

interface RawItem {
  readonly title?: unknown;
  readonly brand?: unknown;
  readonly category?: unknown;
  readonly images?: unknown;
}

/**
 * ⛔ **The vendor uses placeholders, and they must read as ABSENT.**
 * Measured on real bytes 2026-09-11: an unregistered code came back with
 * `brand: "N/A"`. Passed through, that becomes the keyword *"n/a something"* and
 * searches a market that does not exist.
 */
const PLACEHOLDER = /^(?:n\/?a|none|unknown|null|-)$/i;

/**
 * ⚡ **B99.** The vendor documents `images` as an array of URLs, and the captured
 * response carries one. The first usable entry is taken; anything else is null,
 * because a product with no picture is an ordinary product.
 */
const firstImage = (v: unknown): string | null => {
  if (!Array.isArray(v)) return null;
  for (const entry of v) {
    if (typeof entry === 'string' && entry.trim().startsWith('http')) return entry.trim();
  }
  return null;
};

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' || PLACEHOLDER.test(t) ? null : t;
};

export async function lookUpProduct(
  barcode: string,
  config: ProductLookupConfig = {},
): Promise<ProductResult> {
  const code = normaliseBarcode(barcode);
  if (code === null) {
    return fail('VENDOR', `"${barcode}" is not a retail barcode`);
  }

  const doFetch = config.fetch ?? globalThis.fetch;
  const url = `${config.baseUrl ?? UPCITEMDB_TRIAL_URL}/lookup?upc=${code}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (config.apiKey !== undefined && config.apiKey !== '') {
    headers['user_key'] = config.apiKey;
    headers['key_type'] = '3scale';
  }

  let res: Response;
  try {
    res = await doFetch(url, { headers });
  } catch (e) {
    return fail('OFFLINE', e instanceof Error ? e.message : 'the network did not answer');
  }

  if (res.status === 429) return fail('RATE_LIMITED', 'too many lookups just now');
  if (res.status === 404) return fail('NOT_FOUND', `nothing on record for ${code}`);
  if (res.status === 401 || res.status === 403) {
    return fail('QUOTA_EXCEEDED', "the lookup allowance is used up");
  }
  if (!res.ok) return fail('VENDOR', `the product database answered ${res.status}`);

  let body: { items?: readonly RawItem[] };
  try {
    body = (await res.json()) as { items?: readonly RawItem[] };
  } catch {
    return fail('VENDOR', 'the product database answered with something that is not JSON');
  }

  const item = body.items?.[0];
  const title = item === undefined ? null : str(item.title);
  // ⛔ A 200 with no items is the COMMON case for an unlisted SKU, and it is a
  // NOT_FOUND rather than a vendor fault. Expect it on clearance.
  if (title === null) return fail('NOT_FOUND', `nothing on record for ${code}`);

  return {
    ok: true,
    identity: {
      barcode: code,
      title,
      brand: str(item?.brand),
      category: str(item?.category),
      imageUrl: firstImage(item?.images),
    },
  };
}
