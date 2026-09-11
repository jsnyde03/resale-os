/**
 * The aisle question: *can I buy this, and for how much?*
 *
 * Every number here is already computed by `src/scoring` and `src/core`. This
 * turns the operator's typed fields into an `OpportunityInput`, runs the one
 * evaluator the CLI runs, and arranges the answer so the two things that matter
 * are readable at a glance: **the price ceiling, and the single reason for it.**
 *
 * ⛔ No new financial logic. In particular `expectedDaysToSale` is NOT an input —
 * it is derived from comps (`90 * (active + 1) / sold90`), and a hand estimate
 * is capped at 30% confidence, below every mode floor, so it cannot clear a gate
 * on its own. A form field for it would be a field that quietly cannot work.
 */

import { parseOpportunity, type OpportunityInput } from '../domain/opportunity.js';
import { evaluateOpportunity, type Evaluation } from '../scoring/evaluate.js';
import { soldNeededForHold } from '../core/velocity.js';
import { parseCount } from '../core/counts.js';
import {
  isWorthRetrying,
  type CompCondition,
  type CountReading,
  type MarketFailureReason,
  type MarketResult,
  type Provenance,
  type QuotaReading,
} from '../core/market.js';
import { assessUnlock, fundAtNav, type UnlockAssessment } from './unlock.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { canonicalize } from '../db/hash.js';
import {
  CONDITION_CONFIDENCE_BPS,
  DEFAULT_CONDITION,
  DEFAULT_HASSLE,
  HASSLE_BPS,
  type Condition,
  type Hassle,
} from './condition.js';
import { formatCents, toDollarsInput } from '../core/money.js';
import type { Bps, Cents } from '../core/money.js';
import type { FundState } from '../core/capital/state.js';
import type { PriceBound } from '../scoring/max-price.js';
import type { Recommendation } from '../scoring/recommend.js';
import { money, type Money } from './views.js';

/** What a person can actually supply while holding the object. Strings, from a form. */
export interface SourcingForm {
  readonly name: string;
  readonly category: string;
  /** The price on the tag. */
  readonly price: string;
  /** What it sells for on eBay, before fees. */
  readonly resale: string;
  /** From an eBay search: sold in 90 days, and how many are listed now. */
  readonly sold90: string;
  readonly active: string;
  /** Optional: a few sold prices, comma separated. Raises confidence. */
  readonly comps?: string;
  /**
   * ⚠️ Both optional, and both default to the value the system ALREADY used —
   * so a form that omits them scores exactly as it did before (B64, B71).
   */
  readonly condition?: Condition;
  readonly hassle?: Hassle;
}

export interface SourcingProblem {
  readonly field: keyof SourcingForm | 'form';
  readonly message: string;
}

/**
 * Why the ceiling is what it is, in the operator's language.
 *
 * `boundBy` names which of five limits bit first. Saying "40% of the fund" is
 * actionable — wait, or fund it. Saying "max price $12.40" alone is not.
 */
const BOUND_REASON: Readonly<Record<PriceBound, string>> = {
  ROI: 'the ROI floor — above this the return is too thin for the risk',
  PROFIT: 'the minimum profit per flip — above this it does not clear the floor',
  PER_ITEM: 'the per-item cap — no single item may hold more of the fund',
  DEPLOYABLE: 'deployable capital — the fund does not have more to put in',
  CATEGORY: 'the category cap — too much of the fund is already in this category',
};

export interface SourcingVerdict {
  readonly name: string;
  readonly recommendation: Recommendation;
  /** True only for an outright yes. Anything else is a stop. */
  readonly buy: boolean;
  /** The headline: pay no more than this. */
  readonly maxPrice: Money;
  /** What the tag says. */
  readonly asking: Money;
  /** True when the asking price is already above the ceiling. */
  readonly overPriced: boolean;
  /**
   * True when price is the ONLY thing wrong — i.e. the same item at the ceiling
   * would be a buy. Determined by re-running the evaluator at `maxPrice`, not
   * by guessing from which gates failed: "haggle" and "walk away" are different
   * answers and the operator is standing in front of a seller.
   */
  readonly priceFixable: boolean;
  /**
   * The one line explaining the verdict. The price ceiling is only the right
   * explanation when price is the problem; otherwise it is the failing gate.
   */
  readonly primaryReason: string;
  readonly boundBy: PriceBound;
  readonly boundReason: string;
  /** Ordered; the first is the headline. Straight from the recommender. */
  readonly reasons: readonly string[];
  readonly expectedProfit: Money;
  readonly expectedRoiBps: Bps;
  readonly expectedDaysToSale: number;
  readonly sellThroughBps: Bps;
  readonly buyScore: number;
  readonly riskScore: number;
  readonly confidenceBps: Bps;
  /** Set when the hold estimate came from a person rather than from comps. */
  readonly velocityIsEstimate: boolean;
  /** Every gate that failed, for the histogram at 4.7 and for arguing with. */
  readonly failedGates: readonly { code: string; message: string; actual: number; limit: number }[];
  /**
   * ⛔ **Gates that deliberately did NOT run, and why (6.6.2, B66).**
   *
   * ⚠️ An abstention is not a pass and it is not a failure — it is a rule the
   * operator believes is protecting them that did not get to look. Saying
   * nothing is how "absent" and "forgotten" became indistinguishable in the
   * first place, so this is surfaced rather than logged.
   */
  readonly abstentions: readonly { code: string; because: string }[];
  /**
   * ⚡ **What would FIX the hold, not just the fact that it failed.**
   *
   * `HOLD_TOO_LONG` is the gate that refuses most real candidates, and the
   * screen used to name it without naming the way out. The hold is derived —
   * `90 x (active + 1) / sold90` — so it inverts exactly: against this many
   * listings, this many sales in 90 days clears the ceiling. That number **is**
   * the sourcing rule for retail arbitrage, and it is the one an operator can
   * carry between items. Backlog **B70**.
   */
  readonly holdFix: {
    readonly soldNeededIn90Days: number;
    readonly againstActiveListings: number;
    readonly ceilingDays: number;
  };
  /**
   * ⚡ **Not yet, or never?** — the answer that ends a decision instead of
   * leaving it open. Most refusals are NEVER: hold time, margin and sell-through
   * do not care how rich the fund is. See `unlock.ts`.
   */
  readonly unlock: UnlockAssessment;
  readonly policyVersion: string;
}

const slugOf = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'item';

/** Eight hex of the canonical inputs. Same candidate in, same id out. */
const digestOf = (draft: unknown): string =>
  bytesToHex(sha256(new TextEncoder().encode(canonicalize(draft)))).slice(0, 8);

/** Null when nobody said, which is a different fact from "40% certain". */
function conditionBpsOrNull(condition: Condition | undefined): Bps | null {
  if (condition === undefined || condition === DEFAULT_CONDITION) return null;
  return CONDITION_CONFIDENCE_BPS[condition];
}

function dollars(raw: string, field: keyof SourcingForm, label: string): Cents | SourcingProblem {
  const trimmed = raw.trim().replace(/^\$/, '');
  if (trimmed === '') return { field, message: `${label} is required` };
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return { field, message: `${label} must be an amount like 12.99` };
  }
  // Integer cents, always — never `Math.round(Number(x) * 100)`, which is how
  // 12.99 becomes 1298.
  const [whole, frac = ''] = trimmed.split('.') as [string, string?];
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/**
 * ⚡ **A typed count and a fetched one are the same string.**
 *
 * eBay shows *"240,000+ results"*, the data route passes that through, and the
 * operator standing in front of the shelf is reading it off the same screen. So
 * the form accepts the `+` too, and it means what it means everywhere else:
 * **at least this many**, which makes the hold a lower bound and the gate
 * refuse to pass on it (**B77**, **6.1.0**).
 *
 * ⛔ **Without this, the fill could not carry a floor at all** — `SourcingForm`
 * is strings, because that is what a person can supply while holding an object,
 * and a boolean beside `active` would have been a field nobody could type.
 */
function count(
  raw: string,
  field: keyof SourcingForm,
  label: string,
): { value: number; isFloor: boolean } | SourcingProblem {
  const trimmed = raw.trim();
  if (trimmed === '') return { field, message: `${label} is required` };
  const parsed = parseCount(trimmed);
  if (!parsed.ok) {
    return { field, message: `${label} must be a whole number, or "240,000+" for at least` };
  }
  return { value: parsed.value, isFloor: parsed.isFloor };
}

const isProblem = (v: unknown): v is SourcingProblem =>
  typeof v === 'object' && v !== null && 'field' in v;

/**
 * Parse the form, or say exactly what is wrong with it.
 *
 * ⚠️ Every problem is returned, not just the first. Someone standing in a shop
 * should not discover a second bad field after fixing the first.
 */
export function evaluateForm(
  form: SourcingForm,
  state: FundState,
):
  | {
      ok: true;
      verdict: SourcingVerdict;
      /**
       * ⚡ The pieces `OpportunityRepository.save()` needs, handed back so the
       * caller can RECORD the decision (**B68**). The model stays pure — it does
       * not write, and it does not decide when to.
       */
      input: OpportunityInput;
      evaluation: Evaluation;
    }
  | { ok: false; problems: readonly SourcingProblem[] } {
  const problems: SourcingProblem[] = [];

  const name = form.name.trim();
  if (name === '') problems.push({ field: 'name', message: 'What is it?' });
  const category = form.category.trim().toUpperCase();
  if (category === '') problems.push({ field: 'category', message: 'Category is required' });

  const price = dollars(form.price, 'price', 'The asking price');
  if (isProblem(price)) problems.push(price);
  const resale = dollars(form.resale, 'resale', 'The resale price');
  if (isProblem(resale)) problems.push(resale);
  const sold90 = count(form.sold90, 'sold90', 'Sold in 90 days');
  if (isProblem(sold90)) problems.push(sold90);
  const active = count(form.active, 'active', 'Active listings');
  if (isProblem(active)) problems.push(active);

  const comps: Cents[] = [];
  for (const raw of (form.comps ?? '').split(',')) {
    if (raw.trim() === '') continue;
    const c = dollars(raw, 'comps', 'Each comp');
    if (isProblem(c)) {
      problems.push(c);
      break;
    }
    comps.push(c);
  }

  if (problems.length > 0) return { ok: false, problems };

  // ⚠️ Zero sold in 90 days is not a validation error — it is an answer, and a
  // loud one. It flows through to the sell-through gate and gets rejected with
  // a reason, which is more useful than a form telling someone off.
  const draft = {
    name,
    category,
    source: 'MANUAL',
    sourceUrl: null,
    askingPriceCents: price as Cents,
    inboundShippingCents: 0,
    salesTaxCents: 0,
    acquisitionTravelCents: 0,
    expectedGrossCents: resale as Cents,
    marketplace: 'EBAY',
    postageCents: null,
    soldLast90Days: (sold90 as { value: number }).value,
    activeListings: (active as { value: number }).value,
    // ⛔ A count the operator typed as "240,000+" is a floor exactly as much
    // as one the API sent that way. 6.1.0's gate reads these.
    //
    // ⚠️ **Present only when TRUE, and that is deliberate.** The id below is a
    // digest of this draft, so a field that is always present changes every id
    // this screen has ever produced — orphaning stored rows and letting one
    // item appear twice in the rejection histogram. Omitted-when-false keeps
    // an exact count hashing exactly as it did before 6.1.2, while a floored
    // one is a genuinely different candidate and should not collide with it.
    ...((sold90 as { isFloor: boolean }).isFloor ? { soldLast90DaysIsFloor: true } : {}),
    ...((active as { isFloor: boolean }).isFloor ? { activeListingsIsFloor: true } : {}),
    operatorDaysEstimate: null,
    compPricesCents: comps,
    compMedianAgeDays: 45,
    // ⚡ B71. Sealed retail stock is the thing you are MOST certain about, and
    // it was being scored at the pessimistic 40% used for "nobody said" — which
    // only started costing buys when D14 made confidence decisive.
    // ⛔ "Not sure" is NULL, not 4,000. `scoreConfidence` treats the two alike —
    // both land on the pessimistic default — but the RISK score inverts this
    // field, and `null` there means "no information" while 4,000 means "40%
    // certain". Setting it explicitly moved the risk score by a point and the
    // field-for-field test against `evaluateOpportunity` caught it.
    conditionConfidenceBps: conditionBpsOrNull(form.condition),
    hassleBps: HASSLE_BPS[form.hassle ?? DEFAULT_HASSLE],
  };

  // ⛔ **The id is derived from the INPUTS, not from the name.**
  //
  // It used to be `aisle-<name-slug>`, which was harmless while nothing was
  // stored — and became a defect the moment 6.0.3 made scores persist, because
  // `save()` upserts: two different items called "Lego set" collided and the
  // second silently overwrote the first. That undercounts B3's histogram and
  // loses candidates from 6.5's watchlist.
  //
  // ⚡ Hashing the inputs gives exactly the semantics wanted: **re-scoring the
  // same item at the same price updates its row; anything different is a new
  // decision.** The slug stays in front so the id is still readable.
  const input = parseOpportunity({
    ...draft,
    opportunityId: `aisle-${slugOf(name)}-${digestOf(draft)}`,
  });

  const e = evaluateOpportunity(input, state);
  const maxPriceCents = e.price.maxPriceCents;
  const overPriced = input.askingPriceCents > maxPriceCents;

  // Would this be a buy if it were free enough? Asking the evaluator is exact;
  // inferring it from the failed-gate list is a heuristic that would be wrong
  // the first time a gate cared about price indirectly.
  const atCeiling =
    overPriced && maxPriceCents > 0
      ? evaluateOpportunity({ ...input, askingPriceCents: maxPriceCents }, state)
      : null;
  const priceFixable =
    e.result.recommendation === 'BUY'
      ? false
      : atCeiling !== null && atCeiling.result.recommendation === 'BUY';

  // ⚠️ Evaluated against HYPOTHETICAL bankrolls, which is why the evaluator is
  // passed as a function rather than this file reaching a store.
  const unlock = assessUnlock(
    input,
    (navCents) => evaluateOpportunity(input, fundAtNav(state, navCents)),
    e.metrics.navCents,
  );

  const failedGates = e.gates.results
    .filter((r) => !r.passed)
    .map((r) => ({ code: r.code, message: r.message, actual: r.actual, limit: r.limit }));

  const ceilingLine = `Ceiling set by ${BOUND_REASON[e.price.boundBy]}.`;
  const primaryReason =
    e.result.recommendation === 'BUY' || priceFixable
      ? ceilingLine
      : (failedGates[0]?.message ?? e.result.reasons[0] ?? ceilingLine);

  return {
    ok: true,
    input,
    evaluation: e,
    verdict: {
      name,
      recommendation: e.result.recommendation,
      buy: e.result.recommendation === 'BUY',
      maxPrice: money(maxPriceCents),
      asking: money(input.askingPriceCents),
      overPriced,
      priceFixable,
      primaryReason,
      boundBy: e.price.boundBy,
      boundReason: BOUND_REASON[e.price.boundBy],
      reasons: e.result.reasons,
      expectedProfit: money(e.economics.expectedProfitCents),
      expectedRoiBps: e.economics.expectedRoiBps,
      expectedDaysToSale: e.economics.velocity.expectedDaysToSale,
      sellThroughBps: e.economics.velocity.sellThroughBps,
      abstentions: e.gates.abstentions.map((a) => ({ code: a.code, because: a.because })),
      buyScore: e.result.buyScore,
      riskScore: e.result.riskScore,
      confidenceBps: e.result.confidenceBps,
      velocityIsEstimate: e.economics.velocity.source === 'OPERATOR_ESTIMATE',
      failedGates,
      unlock,
      holdFix: {
        soldNeededIn90Days: soldNeededForHold(e.metrics.modePolicy.maxHoldDays, input.activeListings),
        againstActiveListings: input.activeListings,
        ceilingDays: e.metrics.modePolicy.maxHoldDays,
      },
      policyVersion: e.policyVersion,
    },
  };
}

/** The one line to read while holding the object. */
export function headline(verdict: SourcingVerdict): string {
  if (verdict.buy && !verdict.overPriced) return `Buy it — up to ${verdict.maxPrice.text}`;
  // ⚠️ Only say "too expensive" when the price is genuinely the whole problem.
  // Saying it about an item that fails on hold time sends someone to haggle for
  // a thing they should put down.
  if (verdict.priceFixable) return `Too expensive — pay no more than ${verdict.maxPrice.text}`;
  return 'Walk away';
}

export { formatCents };

// ---------------------------------------------------------------------------
// 6.1.3 — the fill
// ---------------------------------------------------------------------------

/**
 * ⛔ **The network FILLS fields. It never gates, and it never decides.**
 *
 * A shop with no signal is the normal case, not an error state, and an
 * exhausted month (**B78**) arrives mid-decision with the operator holding the
 * object. So a lookup can only ever do one of two things: put numbers into
 * fields the operator can overwrite, or say why it could not — and in both
 * cases the screen answers exactly as well as it did before there was a data
 * route at all.
 *
 * ⚠️ **`fetched` is not a synonym for `trusted`.** Every filled field is
 * reported by name, so "where did this number come from" is answerable at a
 * glance rather than by remembering which button was pressed last.
 */
export type FillStatus =
  | {
      readonly kind: 'FILLED';
      /** Which form fields this lookup actually wrote. Possibly empty. */
      readonly filled: readonly (keyof SourcingForm)[];
      readonly provenance: Provenance;
      readonly quota: QuotaReading;
      /**
       * ⚡ **B80's whole point, in one line the operator reads.** The keyword
       * and category decide WHICH MARKET was measured, and a wrong keyword
       * produces a confident, correctly computed number about a different item.
       */
      readonly measured: string;
      /** ⚠️ Set when a count came back as "at least". The gate will refuse. */
      readonly anyFloored: boolean;
    }
  | {
      readonly kind: 'UNAVAILABLE';
      readonly reason: MarketFailureReason;
      /** One line, in the operator's language, ending in what to do instead. */
      readonly message: string;
      readonly canRetry: boolean;
      readonly quota?: QuotaReading;
    };

/**
 * ⚠️ **Each one ends by pointing at the manual path**, because that is the
 * answer in all six cases and a message that only names the fault leaves the
 * operator standing in an aisle wondering whether to wait.
 */
const UNAVAILABLE_WORDING: Readonly<Record<MarketFailureReason, string>> = {
  OFFLINE: 'No signal — type the counts from eBay',
  QUOTA_EXCEEDED: "This month's lookups are used up — type the counts from eBay",
  RATE_LIMITED: 'Too many lookups in a minute — wait a moment, or type the counts',
  UNPARSEABLE: 'The market data came back unreadable — type the counts from eBay',
  AUTH: 'The data key was refused — check it in Settings, or type the counts',
  VENDOR: 'The data source is having trouble — type the counts from eBay',
};

/**
 * ⛔ **The condition the operator picked decides which market the comps come
 * from (B90).**
 *
 * Measured 2026-09-11: unfiltered comps for one product spanned 234× with a
 * coefficient of variation of **1.24**, against a `COMP_CV_WORTHLESS` of 0.50 —
 * a dispersion term of **exactly zero**, contributing nothing to the confidence
 * gate that decides everything. Filtered to new: 3× spread, CV 0.26, median
 * **three times higher**.
 *
 * ⚠️ `UNKNOWN` maps to `any` on purpose. If the operator has not said what they
 * are holding, narrowing the comps would be guessing on their behalf — the wide
 * spread is then an honest signal that the evidence is poor, rather than a
 * manufactured one.
 */
export const COMPS_FOR: Readonly<Record<Condition, CompCondition>> = {
  SEALED: 'new',
  LIKE_NEW: 'used',
  USED_CHECKED: 'used',
  UNKNOWN: 'any',
};

/**
 * ⚠️ **The median, not the mean.** One $465 outlier in a set of sealed comps
 * would drag a mean well past anything the item will actually fetch, and the
 * confidence scorer already punishes dispersion separately.
 */
function medianCents(prices: readonly Cents[]): Cents {
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as Cents;
  return Math.round(((sorted[mid - 1] as Cents) + (sorted[mid] as Cents)) / 2);
}

/** How a count renders back into a field the operator can edit. */
const countToField = (c: CountReading): string => `${c.value}${c.isFloor ? '+' : ''}`;

/**
 * Turn a lookup into a form, without ever discarding what the operator typed.
 *
 * ⛔ **The asking price is NEVER filled.** It is the tag in front of them, no
 * data source knows it, and a field that sometimes fills and sometimes does not
 * is worse than one that never does.
 *
 * ⚠️ **`resale` was not filled either, and that reasoning has been REFINED
 * rather than overturned (6.11.3).** The objection was that the operator
 * decides what condition their item is in, so a median over a mixed market
 * describes something they are not holding. ⛔ **That was right, and B90 showed
 * how right**: unfiltered comps for one product ran $1.99 to $465. A median of
 * that is not a price, it is an average of three different markets.
 *
 * ⚡ **What changed is that the comps now MATCH the condition.** Once the
 * operator has said `SEALED` and the comps are drawn from `itemCondition=new`,
 * the median describes the thing in their hand — 3× spread instead of 234×. So
 * the fill is offered exactly when it is honest, and withheld when it is not:
 * `UNKNOWN` fills nothing, because nobody has said what this is.
 */
export function fillFromMarket(
  form: SourcingForm,
  result: MarketResult,
): { readonly form: SourcingForm; readonly status: FillStatus } {
  if (!result.ok) {
    return {
      form,
      status: {
        kind: 'UNAVAILABLE',
        reason: result.reason,
        message: UNAVAILABLE_WORDING[result.reason],
        canRetry: isWorthRetrying(result),
        ...(result.quota === undefined ? {} : { quota: result.quota }),
      },
    };
  }

  const { reading } = result;
  const filled: (keyof SourcingForm)[] = ['sold90', 'active'];
  const next: { -readonly [K in keyof SourcingForm]: SourcingForm[K] } = {
    ...form,
    sold90: countToField(reading.sold90),
    active: countToField(reading.active),
  };

  // ⚠️ An empty comp set is not written over whatever the operator typed —
  // "the lookup found no prices" is not a reason to delete theirs.
  if (reading.compPricesCents.length > 0) {
    next.comps = reading.compPricesCents.map(toDollarsInput).join(',');
    filled.push('comps');

    // ⛔ **The resale price, but ONLY when the comps describe this condition.**
    //
    // `any` means the operator has not said what they are holding, so the comps
    // mix markets and their median is not a price (B90: $1.99–$465 on one
    // product). ⚠️ And a value the operator has already typed is never
    // overwritten — a fetched number may fill a blank, never replace a
    // judgement.
    if (reading.provenance.compCondition !== 'any' && form.resale.trim() === '') {
      next.resale = toDollarsInput(medianCents(reading.compPricesCents));
      filled.push('resale');
    }
  }

  const where =
    reading.provenance.categoryName === null
      ? 'all categories'
      : reading.provenance.categoryName;

  return {
    form: next,
    status: {
      kind: 'FILLED',
      filled,
      provenance: reading.provenance,
      quota: reading.quota,
      measured: `"${reading.provenance.keyword}" in ${where}`,
      anyFloored: reading.sold90.isFloor || reading.active.isFloor,
    },
  };
}
