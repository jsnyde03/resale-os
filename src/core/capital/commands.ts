import type { Cents } from '../money.js';
import type { Account } from '../ledger/accounts.js';
import type { ChargeOffReason, ItemState } from './state.js';

/** Fields every command carries. `occurredAt` is supplied by the caller: core has no clock. */
export interface CommandBase {
  /** ISO-8601 UTC. */
  readonly occurredAt: string;
  /** Optional override; otherwise derived deterministically from the event count. */
  readonly eventId?: string;
  readonly memo?: string;
}

export interface ContributionCommand extends CommandBase {
  readonly type: 'CONTRIBUTION';
  readonly amountCents: Cents;
}

export interface PurchaseCommand extends CommandBase {
  readonly type: 'PURCHASE';
  readonly itemId: string;
  readonly name: string;
  readonly category: string;
  readonly purchasePriceCents: Cents;
  readonly inboundShippingCents?: Cents;
  readonly salesTaxCents?: Cents;
  readonly acquisitionTravelCents?: Cents;
  readonly expectedDaysToSale: number;
  /** The GROSS price you expect to sell at. */
  readonly expectedResaleCents: Cents;
  /** What that gross was expected to net, once fees and postage came off. */
  readonly expectedNetProceedsCents?: Cents;
  readonly expectedProfitCents?: Cents;
  /** The scored opportunity behind this purchase, if any. */
  readonly opportunityId?: string;
  readonly marketplace?: string;
  readonly listingLive?: boolean;
  /**
   * The capital rules this purchase broke, recorded because it was made anyway.
   *
   * ⛔ **D4, answered 2026-09-09.** An override IS allowed — the operator may
   * have handed over cash in a parking lot, and a ledger that refuses to record
   * reality is worse than useless. But it must say so: before this, `--force`
   * committed an ordinary PURCHASE and an overruled buy was indistinguishable
   * from a clean one.
   *
   * Empty or absent means the purchase passed. A non-empty list REQUIRES
   * `overrideReason` — an override with no stated reason is the thing this
   * field exists to prevent.
   */
  readonly overrodeGates?: readonly string[];
  readonly overrideReason?: string;
}

/** Sale-side costs. None of these ever enter an item's book value. */
export interface SaleCosts {
  readonly marketplaceFeeCents?: Cents;
  readonly paymentFeeCents?: Cents;
  readonly outboundShippingCents?: Cents;
  readonly packagingCents?: Cents;
  readonly otherSaleCostCents?: Cents;
}

export interface SaleCommand extends CommandBase, SaleCosts {
  readonly type: 'SALE';
  readonly itemId: string;
  readonly grossProceedsCents: Cents;
  /** Actual days held, for prediction accuracy. Optional; caller computes it. */
  readonly daysToSale?: number;
}

export interface OwnerPayoutCommand extends CommandBase {
  readonly type: 'OWNER_PAYOUT';
  readonly amountCents: Cents;
}

export const EXPENSE_CATEGORIES = [
  'POSTAGE',
  'PACKAGING',
  'PLATFORM_FEE',
  'PAYMENT_FEE',
  'TRAVEL',
  'SUPPLIES',
  'SOFTWARE',
  'HOSTING',
  'MILEAGE',
  'TOLLS',
  'EQUIPMENT',
  'STORAGE',
  'OTHER',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface BusinessExpenseCommand extends CommandBase {
  readonly type: 'BUSINESS_EXPENSE';
  readonly amountCents: Cents;
  readonly category: ExpenseCategory;
  /** Releases the operating-reserve earmark alongside the payment. */
  readonly fundedFromOperatingReserve?: boolean;
  /** Set when the expense belongs to one item rather than the business. */
  readonly itemId?: string;
}

export interface TaxPaymentCommand extends CommandBase {
  readonly type: 'TAX_PAYMENT';
  readonly amountCents: Cents;
}

export interface ChargeOffCommand extends CommandBase {
  readonly type: 'CHARGE_OFF';
  readonly itemId: string;
  readonly reason: ChargeOffReason;
  /** A charged-off item can still be listed — that is what makes recovery possible. */
  readonly keepListingLive?: boolean;
}

export interface PassiveRecoveryCommand extends CommandBase, SaleCosts {
  readonly type: 'PASSIVE_RECOVERY';
  readonly itemId: string;
  readonly grossProceedsCents: Cents;
}

export interface SetItemStateCommand extends CommandBase {
  readonly type: 'SET_ITEM_STATE';
  readonly itemId: string;
  readonly state: Extract<ItemState, 'ACTIVE' | 'MARKDOWN' | 'CAPITAL_RECOVERY'>;
  readonly listingLive?: boolean;
}

export interface AdjustmentCommand extends CommandBase {
  readonly type: 'ADJUSTMENT';
  readonly account: Account;
  /** Signed, in presented terms: positive increases the account as a human reads it. */
  readonly amountCents: Cents;
  readonly reason: string;
  /**
   * The `BUSINESS_EXPENSE` event this adjustment reverses.
   *
   * Business expenses are recorded twice — once in the ledger, once in the
   * analytic `expenses` table that operating profit and the category breakdown
   * are read from. Without this link an adjustment moves only the ledger, and
   * the two quietly disagree (backlog B33).
   *
   * Setting it makes the reversal write a compensating expense row and restore
   * the year's net business income the expense consumed. It requires
   * `account: 'LIQUID'` and a positive amount — that is the shape of getting
   * money back — and the store refuses to reverse more than is outstanding.
   */
  readonly reversesEventId?: string;
}

/**
 * A correction to the analytic record that moves no money.
 *
 * The ledger and the `expenses` table can be wrong independently. An
 * `ADJUSTMENT` fixes the ledger (and, with `reversesEventId`, the table
 * alongside it). This fixes the table when the ledger is already right:
 *
 *   - **reclassify** — the money was spent, on the wrong category. Set
 *     `reclassifyTo`. The old category is credited and the new one debited, so
 *     the total is untouched and only the breakdown moves.
 *   - **settle** — the money came back, but through an event that never said
 *     what it was reversing. Set `settledByEventId` to name it. The expense is
 *     removed from the record and the year's business income is restored.
 *
 * It writes NO postings, because nothing happened to the money. That is the
 * whole point: an event that changes the books and not the balances.
 */
export interface ExpenseCorrectionCommand extends CommandBase {
  readonly type: 'EXPENSE_CORRECTION';
  /** The `BUSINESS_EXPENSE` whose analytic record is wrong. */
  readonly correctsEventId: string;
  /** How much of it to correct. Positive, and never more than is outstanding. */
  readonly amountCents: Cents;
  /** Reclassify: where the money should have been recorded. */
  readonly reclassifyTo?: ExpenseCategory;
  /**
   * Settle: the event that already returned this cash. Required when removing,
   * because an expense that vanishes from the record with nothing in the ledger
   * to match it is precisely the drift this whole mechanism exists to prevent.
   */
  readonly settledByEventId?: string;
  readonly reason: string;
}

export type Command =
  | ContributionCommand
  | PurchaseCommand
  | SaleCommand
  | OwnerPayoutCommand
  | BusinessExpenseCommand
  | TaxPaymentCommand
  | ChargeOffCommand
  | PassiveRecoveryCommand
  | SetItemStateCommand
  | AdjustmentCommand
  | ExpenseCorrectionCommand;

export function saleCostTotal(costs: SaleCosts): Cents {
  return (
    (costs.marketplaceFeeCents ?? 0) +
    (costs.paymentFeeCents ?? 0) +
    (costs.outboundShippingCents ?? 0) +
    (costs.packagingCents ?? 0) +
    (costs.otherSaleCostCents ?? 0)
  );
}

export function landedCostOf(cmd: PurchaseCommand): Cents {
  return (
    cmd.purchasePriceCents +
    (cmd.inboundShippingCents ?? 0) +
    (cmd.salesTaxCents ?? 0) +
    (cmd.acquisitionTravelCents ?? 0)
  );
}
