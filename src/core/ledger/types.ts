import { normalizeZero } from '../math.js';
import type { Cents } from '../money.js';
import type { Account } from './accounts.js';

export const LEDGER_EVENT_TYPES = [
  'CONTRIBUTION',
  'PURCHASE',
  'SALE',
  'OWNER_PAYOUT',
  'BUSINESS_EXPENSE',
  'TAX_PAYMENT',
  'CHARGE_OFF',
  'PASSIVE_RECOVERY',
  'ITEM_STATE_CHANGE',
  'ADJUSTMENT',
  // Books only, no postings: corrects the analytic expense record for money
  // that already moved (or already came back). See ExpenseCorrectionCommand.
  'EXPENSE_CORRECTION',
] as const;

export type LedgerEventType = (typeof LEDGER_EVENT_TYPES)[number];

export interface Posting {
  readonly account: Account;
  /** Debit-positive, credit-negative. See accounts.ts. */
  readonly amountCents: Cents;
  readonly memo?: string;
}

export interface LedgerEvent {
  readonly eventId: string;
  readonly type: LedgerEventType;
  /** ISO-8601 UTC. When it happened in the world. */
  readonly occurredAt: string;
  readonly itemId?: string;
  readonly memo?: string;
  readonly postings: readonly Posting[];
  /** The validated command, kept verbatim so the event can be re-derived. */
  readonly payload: Readonly<Record<string, unknown>>;
}

export function debit(account: Account, amountCents: Cents, memo?: string): Posting {
  return memo === undefined ? { account, amountCents } : { account, amountCents, memo };
}

export function credit(account: Account, amountCents: Cents, memo?: string): Posting {
  const amount = normalizeZero(-amountCents);
  return memo === undefined ? { account, amountCents: amount } : { account, amountCents: amount, memo };
}

/** Drop zero-value postings; they carry no information and clutter the ledger. */
export function compactPostings(postings: readonly Posting[]): Posting[] {
  return postings.filter((p) => p.amountCents !== 0);
}
