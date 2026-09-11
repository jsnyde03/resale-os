/**
 * A scan, from barcode to a form the operator can check.
 *
 * ⛔ **The decisions live here, not in the `.tsx`.** What the screen says when a
 * barcode resolves to nothing, which fields a scan is allowed to fill, and
 * whether the keyword it proposes is shown or applied — all of that is testable
 * where there is no camera and no device, which is the only place this project
 * can test it at all.
 *
 * ## ⛔ Why a scan PROPOSES
 *
 * Two measurements decide the shape of this file, and both say the same thing:
 *
 * - **B89.** Two defensible keywords from one barcode gave sold medians **68%
 *   apart** ($47.50 against $80.00 on LEGO 75038). The keyword is a money
 *   decision, so it is shown and editable rather than applied.
 * - **The resolver returns confident nonsense for a bad scan.** `000000000000`
 *   resolves, with HTTP 200, to *"ORGANIC BLUE CORN TORTILLA CHIPS"*. A mis-scan
 *   therefore does not fail — it succeeds, wrongly. **The only thing that can
 *   catch that is the operator seeing the title next to the object in their
 *   hand**, which is why the title is surfaced before anything is decided.
 *
 * ⚠️ **And a scan is not a verdict.** It fills fields; `Check it` still runs the
 * same evaluator it always did, against the same gates. Nothing here can decide
 * to buy anything.
 *
 * Pure. No I/O, no clock, no camera.
 */

import { keywordFor, type ProductResult } from '../core/product.js';
import type { SourcingForm } from './sourcing.js';

/**
 * What the screen shows after a scan.
 *
 * ⚠️ `IDENTIFIED` is not success in the sense of "we know what this is" — it is
 * "the database says this, look at it." The operator is the check.
 */
export type ScanOutcome =
  | {
      readonly kind: 'IDENTIFIED';
      readonly barcode: string;
      /** ⛔ Shown FIRST. It is the only thing that catches a mis-scan. */
      readonly title: string;
      readonly brand: string | null;
      /** The search that will run unless the operator edits it. */
      readonly keyword: string;
      /** ⚠️ The other defensible reading, or null. B89: these ran 68% apart. */
      readonly alternativeKeyword: string | null;
      /** The vendor's category path, verbatim. Coarsened before it is used. */
      readonly categoryPath: string | null;
      /** Which form fields the scan proposes to fill. Never the asking price. */
      readonly fills: readonly (keyof SourcingForm)[];
    }
  | {
      readonly kind: 'UNIDENTIFIED';
      readonly barcode: string;
      /** One line, ending in what to do instead. */
      readonly message: string;
      readonly canRetry: boolean;
    };

/**
 * ⚠️ **Every one ends by pointing at typing**, because that is the answer in
 * all five cases and a message that only names the fault leaves somebody
 * standing in an aisle wondering whether to wait.
 *
 * ⛔ **`NOT_FOUND` is phrased as normal, not as an error.** The resolver has
 * never been pointed at a Walmart clearance SKU — a store brand, a seasonal
 * line — which is exactly the population it exists to serve, so a miss is
 * expected rather than exceptional.
 */
const WORDING = {
  NOT_FOUND: 'Not in the product database — type the name instead',
  OFFLINE: 'No signal — type the name instead',
  QUOTA_EXCEEDED: "Today's lookups are used up — type the name instead",
  RATE_LIMITED: 'Too many scans just now — wait a moment, or type the name',
  VENDOR: 'The product database is having trouble — type the name instead',
} as const;

/** Only these clear by trying again; offering it for the rest teaches the operator to ignore it. */
const RETRYABLE = new Set(['OFFLINE', 'RATE_LIMITED']);

export function scanOutcome(barcode: string, result: ProductResult): ScanOutcome {
  if (!result.ok) {
    return {
      kind: 'UNIDENTIFIED',
      barcode,
      message: WORDING[result.reason],
      canRetry: RETRYABLE.has(result.reason),
    };
  }

  const { identity } = result;
  const suggestion = keywordFor(identity);

  // ⛔ The asking price is NEVER here. It is the tag in front of them, no data
  // source knows it, and a field that sometimes fills is worse than one that
  // never does. The market lookup fills the counts and comps separately.
  const fills: (keyof SourcingForm)[] = ['name'];
  if (identity.category !== null) fills.push('category');

  return {
    kind: 'IDENTIFIED',
    barcode: identity.barcode,
    title: identity.title,
    brand: identity.brand,
    keyword: suggestion.keyword,
    alternativeKeyword: suggestion.alternative,
    categoryPath: identity.category,
    fills,
  };
}

/**
 * Put a scan into the form.
 *
 * ⛔ **Never overwrites something already typed.** A scan may fill a blank; it
 * may not replace a judgement — the same rule the market fill follows, and for
 * the same reason.
 *
 * ⛔ **The fund's category is a CONCENTRATION BUCKET, not a taxonomy.**
 * `CATEGORY_CONCENTRATION` caps how much of the fund sits in one of them, so
 * the bucket only works if several holdings land in the same one. The resolver
 * returns `"Toys & Games > Toys > Building Toys > Interlocking"` — a path that
 * is nearly unique per product, and would make every item its own category so
 * the gate could never fire.
 *
 * ⚡ **Brand beats taxonomy here**, because the fund's real exposure risk is
 * "too much LEGO", not "too much Building Toys". The path's second segment is
 * the fallback when there is no brand, and neither is used when the operator
 * has already named a category.
 */
export function applyScan(form: SourcingForm, outcome: ScanOutcome): SourcingForm {
  if (outcome.kind !== 'IDENTIFIED') return form;
  const next = { ...form };
  if (form.name.trim() === '') next.name = outcome.title;
  if (form.category.trim() === '') {
    const bucket = categoryBucket(outcome);
    if (bucket !== '') next.category = bucket;
  }
  return next;
}

const asBucket = (raw: string): string =>
  raw.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Brand first, then the path's second segment. @see applyScan */
export function categoryBucket(outcome: ScanOutcome & { kind: 'IDENTIFIED' }): string {
  if (outcome.brand !== null && outcome.brand.trim() !== '') return asBucket(outcome.brand);
  const segments = (outcome.categoryPath ?? '').split('>').map((x) => x.trim()).filter(Boolean);
  // ⚠️ Second segment, not the first: the first is almost always a top-level
  // department ("Toys & Games") that every holding would share.
  return segments.length >= 2 ? asBucket(segments[1] as string) : '';
}
