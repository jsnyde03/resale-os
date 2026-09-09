/**
 * Invariants are checked BEFORE a state is accepted, never after it is written.
 * A violation throws; there is no repair path. See docs/FINANCIAL_SPEC.md §2.
 */

import { ACCOUNTS, EARMARK_ACCOUNTS } from './accounts.js';
import type { Posting } from './types.js';
import type { Balances, FundState } from '../capital/state.js';
import { holdsCapital } from '../capital/state.js';
import { presentedBalance } from '../capital/metrics.js';
import { formatCents } from '../money.js';

export type InvariantCode =
  | 'INV_BALANCED'
  | 'INV_IDENTITY'
  | 'INV_NO_NEGATIVE_CASH'
  | 'INV_NO_NEGATIVE_INVENTORY'
  | 'INV_NO_NEGATIVE_EARMARK'
  | 'INV_ITEM_BOOK_VALUE'
  | 'INV_INTEGER_CENTS';

export class InvariantViolation extends Error {
  readonly code: InvariantCode;
  readonly detail: string;

  constructor(code: InvariantCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'InvariantViolation';
    this.code = code;
    this.detail = detail;
  }
}

/** Every posting set must sum to zero and be whole cents. */
export function assertBalancedPostings(postings: readonly Posting[]): void {
  let total = 0;
  for (const p of postings) {
    if (!Number.isInteger(p.amountCents)) {
      throw new InvariantViolation(
        'INV_INTEGER_CENTS',
        `posting to ${p.account} is not an integer: ${p.amountCents}`,
      );
    }
    total += p.amountCents;
  }
  if (total !== 0) {
    throw new InvariantViolation(
      'INV_BALANCED',
      `postings sum to ${total} cents, must be 0 (${postings
        .map((p) => `${p.account}:${p.amountCents}`)
        .join(', ')})`,
    );
  }
}

/**
 * The accounting identity. With the debit-positive convention this is simply
 * "all raw balances sum to zero" — one line, no per-class bookkeeping.
 */
export function assertIdentity(balances: Balances): void {
  let total = 0;
  for (const account of ACCOUNTS) total += balances[account];
  if (total !== 0) {
    throw new InvariantViolation(
      'INV_IDENTITY',
      `assets - earmarks - equity = ${total} cents, must be 0`,
    );
  }
}

export function assertFloors(balances: Balances): void {
  const liquid = presentedBalance(balances, 'LIQUID');
  if (liquid < 0) {
    throw new InvariantViolation(
      'INV_NO_NEGATIVE_CASH',
      `LIQUID would be ${formatCents(liquid)}; the fund cannot spend money it does not have`,
    );
  }

  const inventory = presentedBalance(balances, 'INVENTORY_AT_COST');
  if (inventory < 0) {
    throw new InvariantViolation(
      'INV_NO_NEGATIVE_INVENTORY',
      `INVENTORY_AT_COST would be ${formatCents(inventory)}`,
    );
  }

  for (const account of EARMARK_ACCOUNTS) {
    const value = presentedBalance(balances, account);
    if (value < 0) {
      throw new InvariantViolation(
        'INV_NO_NEGATIVE_EARMARK',
        `${account} would be ${formatCents(value)}`,
      );
    }
  }
}

/**
 * The books and the shelf must agree: INVENTORY_AT_COST is exactly the sum of
 * the book values of items that still hold capital.
 */
export function assertItemBookValue(state: FundState): void {
  const fromItems = Object.values(state.items)
    .filter((i) => holdsCapital(i.state))
    .reduce((acc, i) => acc + i.bookValueCents, 0);
  const fromLedger = presentedBalance(state.balances, 'INVENTORY_AT_COST');
  if (fromItems !== fromLedger) {
    throw new InvariantViolation(
      'INV_ITEM_BOOK_VALUE',
      `items sum to ${formatCents(fromItems)} but INVENTORY_AT_COST is ${formatCents(fromLedger)}`,
    );
  }

  for (const item of Object.values(state.items)) {
    if (!holdsCapital(item.state) && item.bookValueCents !== 0) {
      throw new InvariantViolation(
        'INV_ITEM_BOOK_VALUE',
        `item ${item.itemId} is ${item.state} but still carries a book value of ` +
          `${formatCents(item.bookValueCents)}`,
      );
    }
  }
}

/** Everything, in the order a failure is most usefully reported. */
export function assertAllInvariants(state: FundState): void {
  assertIdentity(state.balances);
  assertFloors(state.balances);
  assertItemBookValue(state);
}
