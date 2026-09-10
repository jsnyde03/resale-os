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

import { parseOpportunity } from '../domain/opportunity.js';
import { evaluateOpportunity } from '../scoring/evaluate.js';
import { soldNeededForHold } from '../core/velocity.js';
import {
  CONDITION_CONFIDENCE_BPS,
  DEFAULT_CONDITION,
  DEFAULT_HASSLE,
  HASSLE_BPS,
  type Condition,
  type Hassle,
} from './condition.js';
import { formatCents } from '../core/money.js';
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
  readonly policyVersion: string;
}

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

function count(raw: string, field: keyof SourcingForm, label: string): number | SourcingProblem {
  const trimmed = raw.trim();
  if (trimmed === '') return { field, message: `${label} is required` };
  if (!/^\d+$/.test(trimmed)) return { field, message: `${label} must be a whole number` };
  return Number(trimmed);
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
): { ok: true; verdict: SourcingVerdict } | { ok: false; problems: readonly SourcingProblem[] } {
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
  const input = parseOpportunity({
    opportunityId: `aisle-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32)}`,
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
    soldLast90Days: sold90 as number,
    activeListings: active as number,
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
      buyScore: e.result.buyScore,
      riskScore: e.result.riskScore,
      confidenceBps: e.result.confidenceBps,
      velocityIsEstimate: e.economics.velocity.source === 'OPERATOR_ESTIMATE',
      failedGates,
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
