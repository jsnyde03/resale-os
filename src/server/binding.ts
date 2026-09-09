/**
 * Which gate is actually binding — and, more usefully, what that implies.
 *
 * This is the instrument for risk **R2**: at a $50 bankroll the gates reject a
 * lot, and *that is correct behaviour rather than a bug*. The question worth
 * answering is not "how many rejections" but **which** gate, because the three
 * possible causes have three completely different responses:
 *
 *   - the fund is too small  → add capital, or wait and compound
 *   - the rules are too tight → change a policy number, deliberately
 *   - the items are bad       → source differently
 *
 * A bare count of codes leaves the operator to make that inference every time.
 * Naming it is the whole point of the screen.
 */

import type { LedgerReader } from '../db/store.js';

export type Cause = 'FUND_TOO_SMALL' | 'RULES_TOO_TIGHT' | 'ITEMS_TOO_WEAK';

interface Meaning {
  readonly cause: Cause;
  readonly label: string;
  readonly implication: string;
}

/**
 * ⚠️ Deliberately exhaustive over `ConstraintCode` via the index signature
 * below, not a partial map with a default. A code with no entry would silently
 * become "unknown", and the one thing this screen must not do is shrug at the
 * gate that is rejecting everything.
 */
const MEANING: Readonly<Record<string, Meaning>> = {
  MAX_PER_ITEM_EXCEEDED: {
    cause: 'FUND_TOO_SMALL',
    label: 'per-item cap',
    implication: 'No single item may hold this much of the fund. More capital raises the cap.',
  },
  INSUFFICIENT_DEPLOYABLE_CAPITAL: {
    cause: 'FUND_TOO_SMALL',
    label: 'deployable capital',
    implication: 'The money is not there. Wait for a sale, or add capital.',
  },
  RESERVE_FLOOR_BREACH: {
    cause: 'FUND_TOO_SMALL',
    label: 'liquid floor',
    implication: 'Buying would eat the cash floor the fund keeps back.',
  },
  MAX_DEPLOYED_EXCEEDED: {
    cause: 'FUND_TOO_SMALL',
    label: 'deployment ceiling',
    implication: 'Too much of the fund is already in inventory.',
  },
  CATEGORY_CONCENTRATION: {
    cause: 'FUND_TOO_SMALL',
    label: 'category cap',
    implication: 'Too much of the fund is already in this category. Buy something else.',
  },
  PROFIT_BELOW_MIN: {
    cause: 'RULES_TOO_TIGHT',
    label: 'minimum profit',
    implication:
      'The flip clears less than the floor. At a small bankroll this floor is often the binding rule — check reachability before lowering it.',
  },
  ROI_BELOW_MIN: {
    cause: 'RULES_TOO_TIGHT',
    label: 'minimum ROI',
    implication: 'The return is too thin for the capital it ties up.',
  },
  HOLD_TOO_LONG: {
    cause: 'RULES_TOO_TIGHT',
    label: 'hold ceiling',
    implication: 'It sells too slowly for this mode. A bigger fund tolerates longer holds.',
  },
  LONG_HOLD_ALLOCATION_EXCEEDED: {
    cause: 'RULES_TOO_TIGHT',
    label: 'long-hold allocation',
    implication: 'This mode allows little or no capital in slow items.',
  },
  RISK_SCORE_TOO_HIGH: {
    cause: 'RULES_TOO_TIGHT',
    label: 'risk ceiling',
    implication: 'Too risky for this mode.',
  },
  SELL_THROUGH_TOO_LOW: {
    cause: 'ITEMS_TOO_WEAK',
    label: 'sell-through',
    implication: 'Not enough of these sell. This is about what you are finding, not the rules.',
  },
  CONFIDENCE_TOO_LOW: {
    cause: 'ITEMS_TOO_WEAK',
    label: 'confidence',
    implication: 'Too little evidence to trust the estimate. Better comps would fix it.',
  },
  BUY_SCORE_TOO_LOW: {
    cause: 'ITEMS_TOO_WEAK',
    label: 'buy score',
    implication: 'A composite: the item is weak on several dimensions at once.',
  },
  DOWNSIDE_TOO_LARGE: {
    cause: 'ITEMS_TOO_WEAK',
    label: 'modelled downside',
    implication: 'Too much of the fund at risk if it does not sell.',
  },
};

export interface BindingRow {
  readonly code: string;
  readonly n: number;
  readonly label: string;
  readonly cause: Cause;
  readonly implication: string;
  /** Share of all rejections, in basis points. */
  readonly shareBps: number;
}

export interface CauseRow {
  readonly cause: Cause;
  readonly n: number;
  readonly shareBps: number;
  readonly headline: string;
  readonly implication: string;
}

export interface BindingView {
  readonly rows: readonly BindingRow[];
  readonly total: number;
  /** The gate rejecting most, or null when nothing has been rejected. */
  readonly binding: BindingRow | null;
  /**
   * ⚠️ The more useful answer. Individual codes fragment — a single rejected
   * item trips several at once, and `BUY_SCORE_TOO_LOW` is a *composite* that
   * often tops the list while saying nothing you can act on. Grouped by cause,
   * the three possible responses separate cleanly.
   */
  readonly causes: readonly CauseRow[];
  readonly dominantCause: CauseRow | null;
  /** True when there is nothing to report — no rejections, not "no problem". */
  readonly empty: boolean;
}

const CAUSE_TEXT: Readonly<Record<Cause, { headline: string; implication: string }>> = {
  FUND_TOO_SMALL: {
    headline: 'the fund is too small',
    implication:
      'These are capital limits, not judgements about the items. They loosen on their own as the bankroll compounds.',
  },
  RULES_TOO_TIGHT: {
    headline: 'the rules are tight for this bankroll',
    implication:
      'Deliberate floors doing their job. Changing one is a policy decision — check reachability first, since a floor and a cap can multiply into something neither states.',
  },
  ITEMS_TOO_WEAK: {
    headline: 'the items are not good enough',
    implication: 'Nothing to fix in the rules. This is about what you are finding.',
  },
};

const UNKNOWN: Meaning = {
  cause: 'RULES_TOO_TIGHT',
  label: 'an unrecognised gate',
  implication:
    'This code has no entry in the binding-cause map. That is a gap in the screen, not in the engine.',
};

export function bindingGateView(store: LedgerReader): BindingView {
  const counts = store.opportunityReader().rejectionHistogram();
  const total = counts.reduce((sum, c) => sum + c.n, 0);

  const rows = counts.map((c) => {
    const meaning = MEANING[c.code] ?? UNKNOWN;
    return {
      code: c.code,
      n: c.n,
      label: meaning.label,
      cause: meaning.cause,
      implication: meaning.implication,
      // Integer basis points, so no float creeps into a displayed figure.
      shareBps: total === 0 ? 0 : Math.round((c.n * 10_000) / total),
    };
  });

  const byCause = new Map<Cause, number>();
  for (const r of rows) byCause.set(r.cause, (byCause.get(r.cause) ?? 0) + r.n);
  const causes: CauseRow[] = [...byCause.entries()]
    .map(([cause, n]) => ({
      cause,
      n,
      shareBps: total === 0 ? 0 : Math.round((n * 10_000) / total),
      headline: CAUSE_TEXT[cause].headline,
      implication: CAUSE_TEXT[cause].implication,
    }))
    .sort((a, b) => b.n - a.n || a.cause.localeCompare(b.cause));

  return {
    rows,
    total,
    binding: rows[0] ?? null,
    causes,
    dominantCause: causes[0] ?? null,
    empty: rows.length === 0,
  };
}

/** Every constraint code the screen can explain. Used by a test to prove it is exhaustive. */
export const EXPLAINED_CODES = Object.keys(MEANING);
