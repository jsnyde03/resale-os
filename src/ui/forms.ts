/**
 * What each write screen is, minus the pixels.
 *
 * ⛔ **Extracted so it can be tested at all.** The phone's screens were
 * typechecked and nothing could see them: the arithmetic was inside JSX, and a
 * transposed field or a wrong readiness rule would have shipped. Everything
 * here is pure — strings in, a command or a refusal out — so the same functions
 * are asserted by Vitest on the desktop and executed against real SQLite on the
 * device by `screen-scenario.ts`.
 *
 * ⚠️ This is NOT a replacement for rendering tests. It cannot see whether the
 * price box is wired to `price`. It can see everything that happens after.
 *
 * The rule the whole file obeys: **a half-typed number is not a number.** These
 * take raw text, because that is what a form holds, and return `undefined`
 * rather than throwing between "1" and "12".
 */

import { parseDollars, type Cents } from '../core/money.js';
import { estimateNetProceeds, feeModel, type NetProceedsEstimate } from '../core/fees.js';
import { daysBetween } from '../core/ids.js';
import type { Account } from '../core/ledger/accounts.js';
import type {
  AdjustmentCommand,
  BusinessExpenseCommand,
  ContributionCommand,
  ExpenseCategory,
  OwnerPayoutCommand,
  SaleCommand,
} from '../core/capital/commands.js';
import type { ItemRecord } from '../core/capital/state.js';

/** Cents, or `undefined` when the text is not yet a complete amount. */
export function centsOrNothing(text: string): Cents | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  try {
    return parseDollars(trimmed);
  } catch {
    return undefined;
  }
}

/** A non-negative whole number, or `undefined`. */
export function countOrNothing(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (!/^\d+$/.test(trimmed)) return undefined;
  return Number(trimmed);
}

// --- sell -----------------------------------------------------------------

export interface SellFields {
  readonly gross: string;
  readonly fee: string;
  readonly postage: string;
  readonly packaging: string;
}

export interface SellModel {
  readonly grossCents: Cents | undefined;
  /** What the marketplace model would charge. A starting point, never a record. */
  readonly suggestion: NetProceedsEstimate | null;
  readonly netCents: Cents | undefined;
  readonly profitCents: Cents | undefined;
  readonly ready: boolean;
  readonly command: (occurredAt: string) => SaleCommand | null;
}

export function sellModel(item: ItemRecord, fields: SellFields): SellModel {
  const grossCents = centsOrNothing(fields.gross);
  // ⚠️ Blank costs read as zero, not as unknown. An operator who leaves the
  // postage box empty sold something with no postage; treating it as unknown
  // would mean refusing to compute a net they can see on their payout screen.
  const feeCents = centsOrNothing(fields.fee) ?? 0;
  const postageCents = centsOrNothing(fields.postage) ?? 0;
  const packagingCents = centsOrNothing(fields.packaging) ?? 0;

  const netCents =
    grossCents === undefined ? undefined : grossCents - feeCents - postageCents - packagingCents;

  return {
    grossCents,
    suggestion:
      grossCents === undefined ? null : estimateNetProceeds(grossCents, feeModel(item.marketplace)),
    netCents,
    profitCents: netCents === undefined ? undefined : netCents - item.bookValueCents,
    ready: grossCents !== undefined,
    command: (occurredAt) =>
      grossCents === undefined
        ? null
        : {
            type: 'SALE',
            itemId: item.itemId,
            grossProceedsCents: grossCents,
            marketplaceFeeCents: feeCents,
            outboundShippingCents: postageCents,
            packagingCents,
            // ⛔ Derived from the two timestamps. `accuracy` ignores a sale
            // whose hold is undefined, so a typed-or-forgotten number here
            // silently removes the sale from the only instrument that measures
            // whether the estimates are any good.
            daysToSale: daysBetween(item.acquiredAt, occurredAt),
            occurredAt,
          },
  };
}

// --- money out ------------------------------------------------------------

export interface SpendFields {
  readonly kind: 'EXPENSE' | 'PAYOUT';
  readonly amount: string;
  readonly category: ExpenseCategory | null;
  /** Set only when the operator chose to attach the cost to one item. */
  readonly itemId: string | null;
}

export interface SpendModel {
  readonly amountCents: Cents | undefined;
  readonly ready: boolean;
  readonly command: (occurredAt: string) => BusinessExpenseCommand | OwnerPayoutCommand | null;
}

export function spendModel(fields: SpendFields): SpendModel {
  const amountCents = centsOrNothing(fields.amount);
  // ⛔ An expense with no category is not ready. The engine would accept
  // 'OTHER', and a year of OTHER is a Schedule C nobody can file.
  const ready =
    amountCents !== undefined && (fields.kind === 'PAYOUT' || fields.category !== null);

  return {
    amountCents,
    ready,
    command: (occurredAt) => {
      if (amountCents === undefined) return null;
      if (fields.kind === 'PAYOUT') {
        return { type: 'OWNER_PAYOUT', amountCents, occurredAt };
      }
      if (fields.category === null) return null;
      return {
        type: 'BUSINESS_EXPENSE',
        amountCents,
        category: fields.category,
        // ⚠️ Only when chosen. Attaching an expense to the wrong item moves the
        // cost between item profit and operating profit, and both reports go on
        // being plausible — which is what makes it expensive to find later.
        ...(fields.itemId !== null ? { itemId: fields.itemId } : {}),
        occurredAt,
      };
    },
  };
}

// --- money in -------------------------------------------------------------

/**
 * ⛔ **B95: the fund had no way to receive money on the phone.** The CLI's
 * contribution command went with the desktop at 5.10 and nothing replaced it,
 * so D3's $25 could not be recorded at all. Import needs an empty ledger, and
 * an ADJUSTMENT would book owner money as a correction rather than as capital.
 */
export interface ContributionFields {
  readonly amount: string;
}

export interface ContributionContext {
  readonly navCents: Cents;
  readonly promoteAtCents: Cents;
}

export interface ContributionModel {
  readonly amountCents: Cents | undefined;
  readonly ready: boolean;
  /** What the bankroll becomes. Shown before anything is written. */
  readonly navAfterCents: Cents | undefined;
  /**
   * ⚠️ **True when this contribution switches the fund's RULES.** Crossing
   * `promoteAtCents` moves BOOTSTRAP to GROWTH — a higher minimum profit and a
   * smaller per-item share — so a slipped zero ($2,500 for $25) is not just a
   * wrong number: it quietly changes every verdict after it.
   */
  readonly crossesIntoGrowth: boolean;
  readonly command: (occurredAt: string) => ContributionCommand | null;
}

export function contributionModel(
  fields: ContributionFields,
  context: ContributionContext,
): ContributionModel {
  const parsed = centsOrNothing(fields.amount);
  // ⛔ **Zero is not a contribution.** The engine accepts it — it refuses only
  // a negative — and the ledger is append-only over a hash chain, so a $0.00
  // event would sit in the fund's history permanently, meaning nothing.
  const amountCents = parsed !== undefined && parsed > 0 ? parsed : undefined;
  const navAfterCents = amountCents === undefined ? undefined : context.navCents + amountCents;
  return {
    amountCents,
    ready: amountCents !== undefined,
    navAfterCents,
    crossesIntoGrowth:
      navAfterCents !== undefined &&
      context.navCents < context.promoteAtCents &&
      navAfterCents >= context.promoteAtCents,
    command: (occurredAt) =>
      amountCents === undefined ? null : { type: 'CONTRIBUTION', amountCents, occurredAt },
  };
}

// --- adjust ---------------------------------------------------------------

/**
 * A reason shorter than this is not a reason.
 *
 * ⚠️ Arbitrary, and deliberately so: an adjustment cannot be undone, and in six
 * months this string is the entire audit trail. Eight characters will not stop
 * someone typing "asdfasdf", but it does stop the reflexive empty submit.
 */
export const MIN_ADJUSTMENT_REASON = 8;

export interface AdjustFields {
  readonly account: Account | null;
  readonly amount: string;
  readonly reason: string;
}

export interface AdjustModel {
  readonly amountCents: Cents | undefined;
  readonly ready: boolean;
  readonly command: (occurredAt: string) => AdjustmentCommand | null;
}

export function adjustModel(fields: AdjustFields): AdjustModel {
  const amountCents = centsOrNothing(fields.amount);
  const reason = fields.reason.trim();
  const ready =
    fields.account !== null && amountCents !== undefined && reason.length >= MIN_ADJUSTMENT_REASON;

  return {
    amountCents,
    ready,
    command: (occurredAt) =>
      ready && fields.account !== null && amountCents !== undefined
        ? { type: 'ADJUSTMENT', account: fields.account, amountCents, reason, occurredAt }
        : null,
  };
}

// --- reversing an expense -------------------------------------------------

/**
 * Money that went out and came back.
 *
 * ⛔ **This is an ADJUSTMENT with `reversesEventId`, and the field is not
 * optional decoration.** A business expense lives in two places — the ledger
 * and the analytic `expenses` table that operating profit and the category
 * breakdown are read from. A bare adjustment moves only the first, and the two
 * quietly disagree ever after. Setting the link makes the store write the
 * compensating expense row and restore the year's business income.
 *
 * ⚠️ The shape is fixed by the store: `account: 'LIQUID'` and a POSITIVE
 * amount, because that is what getting money back looks like. Over-reversing
 * is refused there — this model exists so the screen can agree in advance
 * rather than argue afterwards.
 */
export interface ReverseFields {
  readonly eventId: string;
  /** What is still standing against that expense, from the store. */
  readonly outstandingCents: Cents;
  readonly amount: string;
  readonly reason: string;
}

export interface ReverseModel {
  readonly amountCents: Cents | undefined;
  readonly ready: boolean;
  /** Set when the amount is readable but the store would refuse it. */
  readonly problem: string | null;
  readonly command: (occurredAt: string) => AdjustmentCommand | null;
}

export function reverseModel(fields: ReverseFields): ReverseModel {
  const amountCents = centsOrNothing(fields.amount);
  const reason = fields.reason.trim();

  const problem =
    amountCents === undefined
      ? null
      : amountCents <= 0
        ? 'A reversal is money coming back, so it has to be positive.'
        : amountCents > fields.outstandingCents
          ? `Only ${fields.outstandingCents} cents of that expense are still standing.`
          : null;

  const ready =
    amountCents !== undefined && problem === null && reason.length >= MIN_ADJUSTMENT_REASON;

  return {
    amountCents,
    ready,
    problem,
    command: (occurredAt) =>
      ready && amountCents !== undefined
        ? {
            type: 'ADJUSTMENT',
            account: 'LIQUID',
            amountCents,
            reason,
            reversesEventId: fields.eventId,
            occurredAt,
          }
        : null,
  };
}
