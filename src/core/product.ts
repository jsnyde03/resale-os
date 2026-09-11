/**
 * What a barcode resolves to — and deliberately not *who resolved it*.
 *
 * ⛔ **The same seam as `core/market.ts`**, for the same reason. An adapter
 * turns one vendor's response into this shape; a screen renders it. Neither
 * knows about the other, so swapping the resolver is a new file in
 * `src/adapters/` and nothing else.
 *
 * ⚠️ **And this route needs that boundary more than the market one did.**
 * SoldComps takes **no barcode at all** — verified 2026-09-11, its search
 * endpoints accept a free-text `keyword` and nothing else, and `epid` is output
 * rather than input. So the fund now depends on a *second* small vendor purely
 * to turn a UPC into words, and that vendor is unevaluated against the thing it
 * will actually be pointed at: Walmart clearance SKUs.
 *
 * ## ⛔ A resolved title is NOT a search
 *
 * The dangerous step is the one in the middle. Measured on LEGO set 75038,
 * resolved from its real UPC:
 *
 * ```
 * "LEGO Star Wars 75038 - Jedi Interceptor"   96 sold, median $47.50
 * "lego 75038"                               147 sold, median $80.00
 * ```
 *
 * **Same object, same scan, medians 68% apart** — and that median becomes the
 * resale price, which sets profit, ROI and the price ceiling. Neither reading is
 * obviously right: the long title may be matching loose and incomplete sets
 * while the set number matches sealed ones, or the reverse.
 *
 * ⛔ **So a scan may propose a keyword and may never impose one.** The operator
 * sees it and can correct it (**B89**, **B84**). A scan that silently picks is
 * a confident wrong number arriving faster than typing did.
 *
 * Pure types and one derivation. No I/O, no clock.
 */

/** A barcode as scanned. Digits only; the symbology is the scanner's business. */
export type Barcode = string;

export interface ProductIdentity {
  readonly barcode: Barcode;
  /** The vendor's title, verbatim. ⚠️ Not a search term — see above. */
  readonly title: string;
  readonly brand: string | null;
  /** The vendor's category path, if it gave one. Used to prefill, never to gate. */
  readonly category: string | null;
}

export type ProductFailureReason =
  /** No signal. Normal in a shop. */
  | 'OFFLINE'
  /** ⚠️ The barcode is real and the database has never heard of it. Expect this
   *  on store-brand and seasonal clearance, and degrade to typing. */
  | 'NOT_FOUND'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'VENDOR';

export interface ProductFailure {
  readonly ok: false;
  readonly reason: ProductFailureReason;
  readonly detail: string;
}

export type ProductResult =
  | { readonly ok: true; readonly identity: ProductIdentity }
  | ProductFailure;

/**
 * ⛔ Words that make a title worse as a search, because every listing has them
 * and none of them narrows anything. Trademark marks are stripped outright:
 * no eBay seller types `®`, so leaving it in matches nothing.
 */
const NOISE =
  /\b(?:brand new|new in box|nib|sealed|interlocking|block|building (?:set|toy)s?|construction|set|kit|toy|w\/|with|for ages?\b.*)\b/gi;

/**
 * A model or set number: a run of 4-7 digits, optionally with a letter suffix.
 *
 * ⚡ **This is the part of a title sellers actually type.** It is also why the
 * two readings above differ so much, so it is surfaced as a SEPARATE suggestion
 * rather than silently preferred.
 */
const MODEL_NUMBER = /\b(\d{4,7}[A-Za-z]?)\b/;

export interface KeywordSuggestion {
  /** What will be searched unless the operator changes it. */
  readonly keyword: string;
  /** Why it looks like that, in one phrase, so the choice is legible. */
  readonly from: 'title' | 'brand and model';
  /**
   * ⚠️ **The other defensible reading, when there is one.** Offered, never
   * applied: on the measured case these two were 68% apart in median price and
   * nothing in the data says which is correct.
   */
  readonly alternative: string | null;
}

/**
 * Turn a resolved product into something searchable.
 *
 * ⛔ **Proposes. Does not decide.** `alternative` exists because the measurement
 * that motivated this file found two defensible answers, not one.
 */
export function keywordFor(identity: ProductIdentity): KeywordSuggestion {
  const cleaned = identity.title
    .replace(/[®™©]/g, ' ')
    .replace(NOISE, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    // ⚠️ Hyphens INSIDE a word carry meaning — `x-wing`, `z-95` — and a
    // standalone one is just the vendor's punctuation between clauses.
    .replace(/(?<![\p{L}\p{N}])-|-(?![\p{L}\p{N}])/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const model = MODEL_NUMBER.exec(identity.title)?.[1] ?? null;
  const brand = identity.brand?.trim().toLowerCase() ?? null;
  const byModel = model !== null && brand !== null ? `${brand} ${model}` : null;

  // ⚠️ The cleaned title leads, because it is what the vendor says the product
  // IS. The model number is the sharper search and the riskier one — it can
  // match a different variant of the same number — so it is the alternative.
  if (cleaned !== '') {
    return { keyword: cleaned, from: 'title', alternative: byModel };
  }
  if (byModel !== null) {
    return { keyword: byModel, from: 'brand and model', alternative: null };
  }
  // Nothing survived cleaning. The raw title is a poor search and an honest one.
  return { keyword: identity.title.trim().toLowerCase(), from: 'title', alternative: null };
}
