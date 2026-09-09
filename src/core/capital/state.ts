import type { Cents } from '../money.js';
import { ACCOUNTS, type Account } from '../ledger/accounts.js';
import type { Policy } from './policy.js';
import { DEFAULT_POLICY } from './policy.js';
import type { BankrollMode } from './policy.js';
import type { TaxProfile } from '../tax/profile.js';
import { UNCONFIGURED_TAX_PROFILE } from '../tax/profile.js';
import type { TaxTables } from '../tax/tables.js';
import { DEFAULT_TAX_TABLES } from '../tax/tables.js';

/** Item states that still hold capital, i.e. that sum to INVENTORY_AT_COST. */
export const CAPITAL_HOLDING_STATES = ['ACTIVE', 'MARKDOWN', 'CAPITAL_RECOVERY'] as const;

export const ITEM_STATES = [
  'ACTIVE',
  'MARKDOWN',
  'CAPITAL_RECOVERY',
  'SOLD',
  'CHARGED_OFF',
  'PASSIVE_RECOVERY',
  'PERSONAL_KEEP',
] as const;

export type ItemState = (typeof ITEM_STATES)[number];

export const CHARGE_OFF_REASONS = [
  'UNSELLABLE',
  'DAMAGED',
  'LOST',
  'PERSONAL_KEEP',
  'STALE',
] as const;

export type ChargeOffReason = (typeof CHARGE_OFF_REASONS)[number];

export function holdsCapital(state: ItemState): boolean {
  return (CAPITAL_HOLDING_STATES as readonly string[]).includes(state);
}

export interface ItemRecord {
  readonly itemId: string;
  readonly name: string;
  readonly category: string;
  readonly acquiredAt: string;
  /** What it cost, immutably. Never changes after PURCHASE. */
  readonly landedCostCents: Cents;
  /** What the fund still has tied up in it. 0 once sold or charged off. */
  readonly bookValueCents: Cents;
  readonly expectedDaysToSale: number;
  /** The GROSS price expected at purchase. */
  readonly expectedResaleCents: Cents;
  /**
   * What the sale was expected to NET, and the profit that implied. Null when
   * nothing predicted them — an unscored purchase has no prediction, and a zero
   * would be a lie about a number nobody produced.
   */
  readonly expectedNetProceedsCents?: Cents;
  readonly expectedProfitCents?: Cents;
  /** What it actually netted. Set at sale or recovery. */
  readonly actualNetProceedsCents?: Cents;
  /** The scored opportunity this came from, when there was one. */
  readonly opportunityId?: string;
  /**
   * D4: which capital gates this purchase overruled, and why.
   *
   * Absent on a clean buy — which is a different fact from an empty list, so
   * the two never collapse. The codes are what the constraints said AT the
   * time of purchase; they are a record, not a live reference.
   */
  readonly overrodeGates?: readonly string[];
  readonly overrideReason?: string;
  readonly state: ItemState;
  readonly chargeOffReason?: ChargeOffReason;
  readonly listingLive: boolean;
  readonly marketplace?: string;
  readonly soldAt?: string;
  readonly daysToSale?: number;
  /** Cumulative realized profit on this item, including passive recoveries. */
  readonly realizedProfitCents: Cents;
}

export type Balances = Record<Account, Cents>;

export interface FundState {
  /** Raw debit-positive balances. See ledger/accounts.ts for the convention. */
  readonly balances: Balances;
  readonly items: Readonly<Record<string, ItemRecord>>;
  readonly policy: Policy;
  /** The owner's situation. Needed for income tax; not derivable from the ledger. */
  readonly taxProfile: TaxProfile;
  readonly taxTables: TaxTables;
  /** Sticky, because mode transitions are hysteretic. */
  readonly mode: BankrollMode;

  /**
   * Tax is annual, so the reserve for a sale depends on what the year has
   * already earned. These reset when a command lands in a new calendar year.
   */
  readonly taxYear: number;
  /** Realised profit minus business expenses, this year, so far. */
  readonly ytdNetBusinessIncomeCents: Cents;
  readonly ytdTaxReservedCents: Cents;

  readonly eventCount: number;
}

export function emptyBalances(): Balances {
  const b = {} as Balances;
  for (const account of ACCOUNTS) b[account] = 0;
  return b;
}

export function initialFundState(
  policy: Policy = DEFAULT_POLICY,
  taxProfile: TaxProfile = UNCONFIGURED_TAX_PROFILE,
  taxTables: TaxTables = DEFAULT_TAX_TABLES,
): FundState {
  return {
    balances: emptyBalances(),
    items: {},
    policy,
    taxProfile,
    taxTables,
    mode: 'BOOTSTRAP',
    taxYear: 0,
    ytdNetBusinessIncomeCents: 0,
    ytdTaxReservedCents: 0,
    eventCount: 0,
  };
}

/** The calendar year an ISO-8601 timestamp falls in. */
export function yearOf(isoTimestamp: string): number {
  return Number(isoTimestamp.slice(0, 4));
}
