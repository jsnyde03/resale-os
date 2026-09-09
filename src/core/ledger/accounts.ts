/**
 * The chart of accounts.
 *
 * SIGN CONVENTION — one convention, applied everywhere:
 *   stored `amount_cents` is POSITIVE for a debit and NEGATIVE for a credit,
 *   for every account regardless of class.
 *
 * Therefore:
 *   - an account's raw balance is simply SUM(amount_cents);
 *   - the sum of raw balances across ALL accounts is always exactly 0, which
 *     makes the accounting identity a one-line check;
 *   - liability and equity accounts carry negative raw balances internally, and
 *     `presentedBalance()` flips them for display.
 */

export const ACCOUNTS = [
  'LIQUID',
  'INVENTORY_AT_COST',
  'TAX_RESERVE',
  'OPERATING_RESERVE',
  'OWNER_PAYABLE',
  'CONTRIBUTED_CAPITAL',
  'RETAINED_EARNINGS',
] as const;

export type Account = (typeof ACCOUNTS)[number];

export type AccountClass = 'ASSET' | 'EARMARK' | 'EQUITY';

export const ACCOUNT_CLASS: Readonly<Record<Account, AccountClass>> = {
  LIQUID: 'ASSET',
  INVENTORY_AT_COST: 'ASSET',
  TAX_RESERVE: 'EARMARK',
  OPERATING_RESERVE: 'EARMARK',
  OWNER_PAYABLE: 'EARMARK',
  CONTRIBUTED_CAPITAL: 'EQUITY',
  RETAINED_EARNINGS: 'EQUITY',
};

/** Assets are debit-normal; earmarks and equity are credit-normal. */
export const IS_DEBIT_NORMAL: Readonly<Record<Account, boolean>> = {
  LIQUID: true,
  INVENTORY_AT_COST: true,
  TAX_RESERVE: false,
  OPERATING_RESERVE: false,
  OWNER_PAYABLE: false,
  CONTRIBUTED_CAPITAL: false,
  RETAINED_EARNINGS: false,
};

export const ASSET_ACCOUNTS = ACCOUNTS.filter((a) => ACCOUNT_CLASS[a] === 'ASSET');
export const EARMARK_ACCOUNTS = ACCOUNTS.filter((a) => ACCOUNT_CLASS[a] === 'EARMARK');
export const EQUITY_ACCOUNTS = ACCOUNTS.filter((a) => ACCOUNT_CLASS[a] === 'EQUITY');

export function isAccount(value: unknown): value is Account {
  return typeof value === 'string' && (ACCOUNTS as readonly string[]).includes(value);
}
