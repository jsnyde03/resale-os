/**
 * A dated retail drop — the thing the fund is actually good at.
 *
 * 🎯 **Jason, 2026-09-11:** *"Most of my highest returns were not off the
 * clearance rack previously. They were online drops."*
 *
 * ## ⚡ A drop has no discovery problem, and that is the whole point
 *
 * eBay refused the fund a developer account (**D16**) and Walmart's APIs are
 * partner-only, so the app cannot browse retail for opportunities. **A drop is
 * different in kind**: the product, the retailer, the date and the price are
 * *announced*, publicly, before it happens. No API denial touches that.
 *
 * ⛔ **What it does have is a valuation problem.** The thing has never been
 * sold, so there are no comps for it — only for whatever came before. Pricing
 * by analogy is the entire difficulty of this gate, and `CompEvidence.analogous`
 * is where that honesty lives: everything in `compConfidence` measures
 * PRECISION, so a tight comp set for last year's model scores near the top while
 * describing a product nobody is buying.
 *
 * ## ⛔ Monitoring and alerting only
 *
 * **D13, 2026-09-09:** checkout automation is OUT. Being first to KNOW is clean
 * and is most of the edge; automating a checkout violates retailer terms, and
 * the penalty — cancelled orders, banned accounts, flagged payment rails — is a
 * capital event for a fund this size. Nothing here buys anything.
 *
 * Pure. No I/O; the clock is passed in.
 */

import type { Cents } from './money.js';
import type { MarketReading } from './market.js';

/**
 * What stands in for a product that has never been sold.
 *
 * ⚠️ **`why` is not decoration.** An analogy nobody can inspect is a guess with
 * a number attached — and the number becomes the resale price, which sets
 * profit, ROI and the price ceiling. The operator has to be able to disagree
 * with the comparison, which means seeing it.
 */
export interface Comparable {
  /** The search that finds the predecessor's sales. */
  readonly keyword: string;
  /** In the operator's words: "last year's UCS set, same piece count". */
  readonly why: string;
}

/**
 * The market behind the COMPARABLE — never behind the drop.
 *
 * ⚠️ **Named for what it actually is.** The obvious field names
 * (`soldLast90Days`, on a thing that has never been sold) would read as
 * measurements of the drop itself, and the whole difficulty of this gate is
 * that they are not.
 */
export interface DropEvidence {
  /** Sold prices for the comparable, in cents. */
  readonly comparableCompPricesCents: readonly Cents[];
  readonly comparableCompMedianAgeDays: number;
  readonly comparableSoldLast90Days: number;
  readonly comparableActiveListings: number;
  readonly comparableSoldIsFloor?: boolean;
  readonly comparableActiveIsFloor?: boolean;
  /** The category the fund books it under. The exposure cap reads it. */
  readonly category: string;
}

/**
 * A drop's id: what it is, and when it lands.
 *
 * ⛔ **Deterministic, so re-entering the same drop is idempotent.** The aisle
 * screen digests its draft because two identical-looking items in two shops are
 * two different objects; a drop is the opposite — the same product on the same
 * date IS the same drop, however many times it is typed or a feed re-reads it.
 * ⚡ That property is what will keep D19's feed from filling the list with
 * duplicates of what the operator already entered by hand.
 */
export function dropIdFrom(name: string, dropDate: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32)
      .replace(/-$/, '') || 'drop';
  return `${slug}-${dropDate}`;
}

/**
 * What the comparable's market said, as evidence about the drop.
 *
 * ⛔ **A fact-to-fact mapping, which is why it is here and not in the screen.**
 * `fillFromMarket` produces a FORM — strings a person can edit. This produces
 * EVIDENCE, and nobody edits it: the operator's judgement about a drop is the
 * comparable they chose, not the counts that search returned.
 *
 * ⚠️ **The floors travel.** `90 x (active + 1)/sold` is not linear in either
 * count, so a "240,000+" that arrives here as an exact number is a count the
 * fund believes it measured. @see CountBounds
 */
export function evidenceFromMarket(reading: MarketReading, category: string): DropEvidence {
  return {
    comparableCompPricesCents: reading.compPricesCents,
    comparableCompMedianAgeDays: reading.compMedianAgeDays,
    comparableSoldLast90Days: reading.sold90.value,
    comparableActiveListings: reading.active.value,
    comparableSoldIsFloor: reading.sold90.isFloor,
    comparableActiveIsFloor: reading.active.isFloor,
    category,
  };
}

export interface Drop {
  readonly dropId: string;
  readonly name: string;
  /** Where it drops. Not a gate — the operator decides where they can queue. */
  readonly retailer: string;
  /** ISO date. ⚠️ A drop with no date is a rumour, and this type refuses one. */
  readonly dropDate: string;
  /** ⛔ The price it drops AT, which is the whole reason a drop is tractable. */
  readonly msrpCents: Cents;
  /** Null when nothing comparable has sold — see `DropReadiness.NO_COMPARABLE`. */
  readonly comparable: Comparable | null;
}

/**
 * ⛔ **Why a drop cannot be judged yet — as opposed to judged and refused.**
 *
 * A refusal is an answer. *"There is nothing to compare this to"* is not, and
 * reporting the two the same way is how a fund learns to ignore its own screen.
 */
export type DropReadiness =
  /** Everything needed is present; the verdict is the gates' to give. */
  | 'READY'
  /** ⚠️ Nothing similar has sold, so there is no honest resale estimate. */
  | 'NO_COMPARABLE'
  /** The date has passed. Kept, never judged — it is history now. */
  | 'PASSED';

export interface DropTiming {
  /** Whole days from now until the drop. Negative once it has passed. */
  readonly daysAway: number;
  readonly passed: boolean;
  /**
   * ⚡ **Whether there is still time to fund it.** A drop the fund cannot afford
   * today is not refused the way a clearance item is — the bankroll may grow
   * before the date, and that is a different, dated question.
   */
  readonly imminent: boolean;
}

/** Inside this many days, a shortfall stops being something you can grow out of. */
export const IMMINENT_DAYS = 7;

export function dropTiming(drop: Drop, now: Date): DropTiming {
  const then = Date.parse(`${drop.dropDate}T00:00:00Z`);
  if (Number.isNaN(then)) {
    throw new Error(`drop ${drop.dropId} has an unparseable date: ${drop.dropDate}`);
  }
  // ⛔ **Calendar days, not elapsed hours.** A drop date is a DAY; `now` is a
  // moment inside one. Diffing them directly makes a drop happening TODAY read
  // as -1 — passed — which is the single worst day to get wrong. Normalising
  // `now` to its own UTC midnight compares like with like.
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysAway = Math.round((then - today) / 86_400_000);
  return { daysAway, passed: daysAway < 0, imminent: daysAway >= 0 && daysAway <= IMMINENT_DAYS };
}

export function dropReadiness(drop: Drop, now: Date): DropReadiness {
  if (dropTiming(drop, now).passed) return 'PASSED';
  return drop.comparable === null ? 'NO_COMPARABLE' : 'READY';
}

/**
 * ⛔ **The fund cannot buy what it cannot afford, and a drop says so with a
 * DATE attached.**
 *
 * A clearance item refused for capital is refused now and forever at this
 * bankroll — 6.5's unlock answers "not yet, or never?". A drop is different:
 * it has a deadline, so the useful answer is *"you need this much by then"*,
 * and whether that is reachable is a fact about time rather than about rules.
 */
export interface DropShortfall {
  readonly navNeededCents: Cents;
  readonly shortfallCents: Cents;
  readonly daysToFindIt: number;
  /** ⚠️ False when the date is too close to grow into it. */
  readonly reachable: boolean;
}

export function dropShortfall(
  navNeededCents: Cents,
  navCents: Cents,
  timing: DropTiming,
): DropShortfall {
  const shortfallCents = Math.max(0, navNeededCents - navCents);
  return {
    navNeededCents,
    shortfallCents,
    daysToFindIt: Math.max(0, timing.daysAway),
    // ⛔ Already affordable is trivially reachable; otherwise there must be
    // time left. `imminent` is not "soon", it is "too soon to grow into".
    reachable: shortfallCents === 0 || (!timing.passed && !timing.imminent),
  };
}
