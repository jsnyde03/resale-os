/**
 * What is coming, what it would pay, and what the fund must reach by the date.
 *
 * 🎯 **Jason, 2026-09-11:** *"Most of my highest returns were not off the
 * clearance rack previously. They were online drops."*
 *
 * ⛔ **Every number on this screen is about a DIFFERENT PRODUCT.** The thing
 * has not been sold, so its price, its sell-through and its hold time all come
 * from whatever came before it. `evidenceIsAnalogous` carries that into the
 * evaluator, which ceilings both halves of the evidence at
 * `ANALOGOUS_EVIDENCE_CEILING_BPS` — and this screen says it in words as well,
 * because a capped number still reads like a measured one.
 *
 * ⚡ **And the refusals here are DATED**, which is what makes them different
 * from 6.5's. A clearance item refused on capital is refused at this bankroll
 * forever; a drop is refused *until the 1st of October*, and whether that is
 * reachable is a fact about time rather than about rules.
 *
 * ⛔ **Nothing here buys anything (D13).** Monitoring and alerting only.
 *
 * Pure. The clock and the evaluator are both passed in.
 */

import { formatCents, type Bps, type Cents } from '../core/money.js';
import { median } from '../core/math.js';
import type { FundState } from '../core/capital/state.js';
import {
  dropShortfall,
  dropTiming,
  type Comparable,
  type Drop,
  type DropEvidence,
  type DropShortfall,
  type DropTiming,
} from '../core/drop.js';
import { CONDITION_CONFIDENCE_BPS } from './condition.js';
import { money, type Money } from './views.js';
import { assessUnlock, fundAtNav } from './unlock.js';
import type { Evaluation } from '../scoring/evaluate.js';
import type { OpportunityInput } from '../domain/opportunity.js';
import type { Recommendation } from '../scoring/recommend.js';

export interface DropCandidate {
  readonly drop: Drop;
  /** ⚠️ Null is TWO different things; see `DropStatus`. */
  readonly evidence: DropEvidence | null;
  /**
   * ⚠️ **When that evidence was read.** A market reading ages, and a screen
   * that cannot say when it was taken shows a three-week-old sell-through as
   * though it were measured this morning. The store records it; this is what
   * carries it to the row.
   */
  readonly valuedAt?: string | null;
}

/**
 * ⛔ **Four states, because collapsing any two of them lies.**
 *
 * A refusal is an answer. *"Nothing resembling this has ever sold"* is not, and
 * *"nobody has looked yet"* is not either — the first is a fact about the
 * market and the second is a fact about the operator's afternoon. Reporting
 * them the same way is how a fund learns to ignore its own screen.
 */
export type DropStatus =
  | { readonly kind: 'JUDGED'; readonly verdict: DropVerdict }
  /** Nothing comparable has sold, so there is no honest resale estimate. */
  | { readonly kind: 'NO_COMPARABLE' }
  /** There IS a comparable and its market has not been looked up. */
  | { readonly kind: 'NOT_VALUED'; readonly comparable: Comparable }
  /** The date is behind us. Kept, never judged — it is history now. */
  | { readonly kind: 'PASSED' };

export interface DropVerdict {
  readonly recommendation: Recommendation;
  /** ⛔ The only question this screen exists to answer. */
  readonly buyAtMsrp: boolean;
  readonly msrp: Money;
  /** What the fund would pay, from the one evaluator every purchase goes through. */
  readonly maxPrice: Money;
  /**
   * ⚡ **True when the ceiling sits BELOW retail** — the drop is not worth its
   * own MSRP, which no amount of bankroll or waiting fixes. It is the drop
   * equivalent of 6.5's NEVER, and for hyped product it is the common case.
   */
  readonly notWorthMsrp: boolean;
  /** The comparable's median sold price. ⚠️ Last year's model, by construction. */
  readonly estimatedResale: Money;
  readonly confidenceBps: Bps;
  /**
   * The one line explaining the verdict.
   *
   * ⚠️ **`reasons[0]` is a HEADER, not a reason** — `"Rejected on 4 capital
   * rules:"` — so a screen that shows it shows the operator a colon. The
   * failing gate is the explanation, and this picks it the same way
   * `evaluateForm` does rather than inventing a second convention.
   */
  readonly primaryReason: string;
  readonly reasons: readonly string[];
  readonly failedGates: readonly { readonly code: string; readonly message: string }[];
  /**
   * ⛔ **Gates that deliberately did NOT run, and why (6.6, B66).** An
   * abstention is not a pass and not a failure — it is a rule the operator
   * believes is protecting them that did not get to look. The aisle screen
   * surfaces these; a screen that judges purchases and hides them would make
   * "absent" and "forgotten" indistinguishable again, one screen over.
   */
  readonly abstentions: readonly { readonly code: string; readonly because: string }[];
  /**
   * ⚡ **Set when CAPITAL is what is missing, and it carries a deadline.** Null
   * when the fund could afford it today, and null when no bankroll fixes it —
   * those are different answers, and `notWorthMsrp` and `reasons` carry them.
   */
  readonly shortfall: DropShortfall | null;
}

export interface DropRow {
  readonly dropId: string;
  readonly name: string;
  readonly retailer: string;
  readonly dropDate: string;
  readonly timing: DropTiming;
  readonly status: DropStatus;
  /**
   * ⚠️ Carried whenever there is one, judged or not. The operator has to be
   * able to disagree with the comparison, which means seeing it.
   */
  readonly comparable: Comparable | null;
  /**
   * ⚡ How old the market reading is, in whole days. Null when there is none.
   * ⛔ **Not the same as `compMedianAgeDays`**, which is how old the SALES are.
   * A fresh reading of a stale market and a stale reading of a fresh one are
   * different problems and the operator can only act on one of them.
   */
  readonly valuationAgeDays: number | null;
  /** The one line the list renders. */
  readonly line: string;
}

export interface DropsScreen {
  readonly rows: readonly DropRow[];
  readonly navCents: Cents;
  readonly headline: string;
}

/**
 * ⛔ **A retail drop is SEALED by definition**, and that is a fact rather than
 * a flattering default. It is the one thing about a drop the operator is
 * genuinely certain of, and B71 is the record of what scoring sealed stock
 * pessimistically cost.
 */
const DROP_CONDITION_BPS: Bps = CONDITION_CONFIDENCE_BPS.SEALED;

/**
 * The opportunity a drop would be, at its announced price.
 *
 * ⛔ **`askingPriceCents` is the MSRP and nothing else.** The question this
 * screen answers is whether the thing is a buy *at retail, on the day* — the
 * only price that will be available — so a ceiling above MSRP is headroom the
 * operator never gets to use.
 */
export function dropAsOpportunity(drop: Drop, evidence: DropEvidence): OpportunityInput {
  return {
    opportunityId: `drop-${drop.dropId}`,
    name: drop.name,
    category: evidence.category,
    source: 'DROP',
    sourceUrl: null,
    sourceListingId: null,
    askingPriceCents: drop.msrpCents,
    inboundShippingCents: 0,
    salesTaxCents: 0,
    acquisitionTravelCents: 0,
    expectedGrossCents: Math.round(median(evidence.comparableCompPricesCents)) as Cents,
    marketplace: 'EBAY',
    postageCents: null,
    soldLast90Days: evidence.comparableSoldLast90Days,
    activeListings: evidence.comparableActiveListings,
    activeListingsIsFloor: evidence.comparableActiveIsFloor === true,
    soldLast90DaysIsFloor: evidence.comparableSoldIsFloor === true,
    operatorDaysEstimate: null,
    compPricesCents: [...evidence.comparableCompPricesCents],
    compMedianAgeDays: evidence.comparableCompMedianAgeDays,
    // ⛔ **The whole point of the gate, in one field.** Without it a tight comp
    // set for last year's model scores near the top while describing a product
    // nobody is buying — 89% confidence, measured 2026-09-11.
    evidenceIsAnalogous: true,
    hassleBps: 2_000,
    conditionConfidenceBps: DROP_CONDITION_BPS,
    sourceConfidenceBps: null,
    counterfeitBps: null,
    returnBps: null,
    sellerBps: null,
    shippingComplexityBps: null,
    restockBps: null,
  };
}

/**
 * ⛔ Takes the evaluator as a parameter, exactly as `watchlist` does. This asks
 * hypothetical questions — *what if the bankroll were bigger by then* — and
 * must not be able to reach the real fund except through the state it is handed.
 */
export function dropsScreen(
  candidates: readonly DropCandidate[],
  state: FundState,
  navCents: Cents,
  now: Date,
  evaluate: (input: OpportunityInput, at: FundState) => Evaluation,
): DropsScreen {
  const rows = candidates.map((c) => dropRow(c, state, navCents, now, evaluate));

  // ⛔ **Soonest first, and the passed ones last regardless.** A drop that has
  // already happened cannot become urgent again, and sorting it by distance
  // from today would put yesterday's ahead of tomorrow's.
  const ordered = [...rows].sort((a, b) => {
    if (a.timing.passed !== b.timing.passed) return a.timing.passed ? 1 : -1;
    return a.timing.daysAway - b.timing.daysAway || a.name.localeCompare(b.name);
  });

  return { rows: ordered, navCents, headline: headlineFor(ordered) };
}

function dropRow(
  candidate: DropCandidate,
  state: FundState,
  navCents: Cents,
  now: Date,
  evaluate: (input: OpportunityInput, at: FundState) => Evaluation,
): DropRow {
  const { drop, evidence } = candidate;
  const timing = dropTiming(drop, now);
  const status = statusFor(drop, evidence, timing, state, navCents, evaluate);

  return {
    dropId: drop.dropId,
    name: drop.name,
    retailer: drop.retailer,
    dropDate: drop.dropDate,
    timing,
    status,
    comparable: drop.comparable,
    valuationAgeDays: ageInDays(candidate.valuedAt ?? null, now),
    line: lineFor(drop, timing, status),
  };
}

function statusFor(
  drop: Drop,
  evidence: DropEvidence | null,
  timing: DropTiming,
  state: FundState,
  navCents: Cents,
  evaluate: (input: OpportunityInput, at: FundState) => Evaluation,
): DropStatus {
  // ⚠️ **Passed is checked FIRST, and it is not a judgement.** Scoring a drop
  // that already happened produces a verdict about a purchase nobody can make,
  // and the operator reads it as advice.
  if (timing.passed) return { kind: 'PASSED' };
  if (drop.comparable === null) return { kind: 'NO_COMPARABLE' };
  if (evidence === null) return { kind: 'NOT_VALUED', comparable: drop.comparable };
  // ⚠️ An empty comp set is not a market reading. A median over nothing is 0,
  // which prices the drop at zero and then refuses it for the wrong reason.
  if (evidence.comparableCompPricesCents.length === 0) {
    return { kind: 'NOT_VALUED', comparable: drop.comparable };
  }

  return { kind: 'JUDGED', verdict: verdictFor(drop, evidence, timing, state, navCents, evaluate) };
}

function verdictFor(
  drop: Drop,
  evidence: DropEvidence,
  timing: DropTiming,
  state: FundState,
  navCents: Cents,
  evaluate: (input: OpportunityInput, at: FundState) => Evaluation,
): DropVerdict {
  const input = dropAsOpportunity(drop, evidence);
  const evaluation = evaluate(input, state);
  const buyAtMsrp = evaluation.result.recommendation === 'BUY';
  const failedGates = evaluation.gates.failures.map((f) => ({ code: f.code, message: f.message }));

  return {
    primaryReason:
      failedGates[0]?.message ?? evaluation.result.reasons[0] ?? 'Nothing stands in the way.',
    abstentions: evaluation.gates.abstentions.map((a) => ({ code: a.code, because: a.because })),
    recommendation: evaluation.result.recommendation,
    buyAtMsrp,
    msrp: money(drop.msrpCents),
    maxPrice: money(evaluation.price.maxPriceCents),
    notWorthMsrp: evaluation.price.maxPriceCents < drop.msrpCents,
    estimatedResale: money(input.expectedGrossCents),
    confidenceBps: evaluation.confidence.confidenceBps,
    reasons: evaluation.result.reasons,
    failedGates,
    shortfall: buyAtMsrp ? null : shortfallFor(input, state, navCents, timing, evaluate),
  };
}

/**
 * ⛔ **Reuses 6.5's scan rather than asking whether the price is under the
 * balance.**
 *
 * The bankroll a drop needs is not its price: the per-item cap, deployable
 * capital and the minimum-profit floor all move with NAV, and the unlock is
 * **not monotonic** — growing the fund can make an item stop being buyable as
 * it crosses into GROWTH. A subtraction gets all three wrong.
 *
 * ⚠️ Which means the answer is as coarse as `SCAN_NAVS_CENTS`: the next
 * bankroll on that grid at which the drop clears, not the exact dollar.
 */
function shortfallFor(
  input: OpportunityInput,
  state: FundState,
  navCents: Cents,
  timing: DropTiming,
  evaluate: (input: OpportunityInput, at: FundState) => Evaluation,
): DropShortfall | null {
  const assessment = assessUnlock(input, (nav) => evaluate(input, fundAtNav(state, nav)), navCents);
  if (assessment.unlock.kind !== 'AT_NAV') return null;
  return dropShortfall(assessment.unlock.navCents, navCents, timing);
}

/**
 * ⚠️ **Whole days, floored at zero.** A reading taken an hour ago is 0 days
 * old, which is the honest answer; rounding it up to 1 to look tidy would make
 * a fresh reading indistinguishable from yesterday's.
 */
function ageInDays(valuedAt: string | null, now: Date): number | null {
  if (valuedAt === null) return null;
  const then = Date.parse(valuedAt);
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}

/** "in 20 days" / "TODAY" / "3 days ago". The unit the operator thinks in. */
export function whenText(timing: DropTiming): string {
  if (timing.daysAway === 0) return 'TODAY';
  if (timing.daysAway === 1) return 'tomorrow';
  if (timing.passed) {
    const ago = Math.abs(timing.daysAway);
    return ago === 1 ? 'yesterday' : `${ago} days ago`;
  }
  return `in ${timing.daysAway} days`;
}

function lineFor(drop: Drop, timing: DropTiming, status: DropStatus): string {
  const when = whenText(timing);
  switch (status.kind) {
    case 'PASSED':
      return `${drop.retailer}, ${when}. Not judged — it has happened.`;
    case 'NO_COMPARABLE':
      // ⛔ Not a refusal, and it must not read as one.
      return `${drop.retailer}, ${when}. Nothing comparable has sold, so there is no honest price for this.`;
    case 'NOT_VALUED':
      return `${drop.retailer}, ${when}. Not valued yet — look up "${status.comparable.keyword}".`;
    case 'JUDGED':
      return `${drop.retailer}, ${when}. ${verdictLine(drop, status.verdict)}`;
  }
}

function verdictLine(drop: Drop, verdict: DropVerdict): string {
  if (verdict.buyAtMsrp) {
    return `BUY at ${verdict.msrp.text} — worth up to ${verdict.maxPrice.text}.`;
  }
  // ⛔ **A ceiling below retail is the most useful refusal this screen gives**,
  // and it is not a capital problem — waiting does not fix it.
  if (verdict.shortfall === null) {
    return verdict.notWorthMsrp
      ? `Pass — it is worth ${verdict.maxPrice.text} and it drops at ${verdict.msrp.text}.`
      : // ⚠️ **Never a bare "Pass".** A refusal with no reason attached is the
        // thing 6.6 was built to stop, and the ceiling is not the explanation
        // here: it sits ABOVE MSRP in exactly this branch.
        `Pass at ${verdict.msrp.text} — ${verdict.primaryReason}`;
  }

  // ⚠️ A shortfall here is always positive: `assessUnlock` only reports AT_NAV
  // above the current bankroll, so there is no "you are short $0" branch to
  // write. A guard for it would be dead code pretending to be caution.
  const { shortfallCents, navNeededCents, reachable } = verdict.shortfall;
  // ⚡ The dated answer, which is the whole reason this is not the watchlist.
  const need = `You need ${formatCents(navNeededCents)} by ${drop.dropDate} — ${formatCents(
    shortfallCents,
  )} short`;
  return reachable ? `${need}.` : `${need}, and there is not enough time.`;
}

function headlineFor(rows: readonly DropRow[]): string {
  const upcoming = rows.filter((r) => !r.timing.passed);
  if (upcoming.length === 0) return 'Nothing coming.';

  const buys = upcoming.filter((r) => r.status.kind === 'JUDGED' && r.status.verdict.buyAtMsrp);
  if (buys.length > 0) {
    const next = buys[0] as DropRow;
    return buys.length === 1
      ? `${next.name} is a buy at MSRP, ${whenText(next.timing)}.`
      : `${buys.length} are buys at MSRP. The next is ${next.name}, ${whenText(next.timing)}.`;
  }

  // ⚠️ **"None of them is a buy" is an answer and gets said plainly**, rather
  // than being implied by a list in which everything happens to be refused.
  const next = upcoming[0] as DropRow;
  return `${upcoming.length} coming, none a buy at MSRP. Next: ${next.name}, ${whenText(next.timing)}.`;
}
