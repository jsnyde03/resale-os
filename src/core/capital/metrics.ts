/**
 * Derived metrics. Nothing here is ever stored; every number is recomputed from
 * the ledger. "Why did my balance change?" is answerable because there is no
 * cached balance that could have drifted from the postings that caused it.
 */

import { normalizeZero } from '../math.js';
import { applyBps, toBps, type Bps, type Cents } from '../money.js';
import { IS_DEBIT_NORMAL, type Account } from '../ledger/accounts.js';
import type { Balances, FundState, ItemRecord } from './state.js';
import { holdsCapital } from './state.js';
import type { BankrollMode, ModePolicy, Policy } from './policy.js';

/**
 * Balance as a human reads it: assets positive when the fund holds them,
 * earmarks and equity positive when they are owed/held.
 */
export function presentedBalance(balances: Balances, account: Account): Cents {
  const raw = balances[account];
  return normalizeZero(IS_DEBIT_NORMAL[account] ? raw : -raw);
}

/** NAV straight from a balance sheet, without building the whole metrics object. */
export function navOf(balances: Balances): Cents {
  return (
    presentedBalance(balances, 'LIQUID') +
    presentedBalance(balances, 'INVENTORY_AT_COST') -
    presentedBalance(balances, 'TAX_RESERVE') -
    presentedBalance(balances, 'OPERATING_RESERVE') -
    presentedBalance(balances, 'OWNER_PAYABLE')
  );
}

export interface CapitalMetrics {
  readonly liquidCents: Cents;
  readonly inventoryAtCostCents: Cents;
  readonly taxReserveCents: Cents;
  readonly operatingReserveCents: Cents;
  readonly ownerPayableCents: Cents;
  readonly contributedCapitalCents: Cents;
  readonly retainedEarningsCents: Cents;

  /** TAX + OPERATING + OWNER_PAYABLE. Claims against LIQUID. */
  readonly earmarkedCents: Cents;
  /** LIQUID + INVENTORY - earmarks. THE bankroll. Drives mode. */
  readonly navCents: Cents;
  /** Cash with no claim on it. Equals NAV - inventory. */
  readonly unencumberedCashCents: Cents;
  readonly capitalDeployedCents: Cents;
  readonly minLiquidFloorCents: Cents;
  readonly maxDeployedCents: Cents;
  /** What a new purchase may actually consume, after every ceiling. */
  readonly deployableCapitalCents: Cents;
  readonly deployedBps: Bps;

  readonly mode: BankrollMode;
  readonly modePolicy: ModePolicy;

  readonly longHoldCapitalCents: Cents;
  readonly maxLongHoldCents: Cents;
  readonly categoryExposureCents: Readonly<Record<string, Cents>>;
  readonly maxCategoryExposureCents: Cents;
  readonly maxCapitalPerItemCents: Cents;
  readonly activeItemCount: number;
}

export function activeItems(state: FundState): ItemRecord[] {
  return Object.values(state.items).filter((i) => holdsCapital(i.state));
}

export function categoryExposure(state: FundState): Record<string, Cents> {
  const out: Record<string, Cents> = {};
  for (const item of activeItems(state)) {
    out[item.category] = (out[item.category] ?? 0) + item.bookValueCents;
  }
  return out;
}

export function longHoldCapital(state: FundState, policy: ModePolicy): Cents {
  return activeItems(state)
    .filter((i) => i.expectedDaysToSale > policy.longHoldThresholdDays)
    .reduce((acc, i) => acc + i.bookValueCents, 0);
}

/**
 * Hysteretic. Promotion needs NAV at or above `promoteAtCents`; demotion needs
 * NAV strictly below `demoteAtCents`. In between, the mode is whatever it was.
 * A fund hovering at $500 must not rewrite its own rules on every sale.
 */
export function resolveBankrollMode(
  navCents: Cents,
  current: BankrollMode,
  policy: Policy,
): BankrollMode {
  const { promoteAtCents, demoteAtCents } = policy.thresholds;
  if (navCents >= promoteAtCents) return 'GROWTH';
  if (navCents < demoteAtCents) return 'BOOTSTRAP';
  return current;
}

export function computeMetrics(state: FundState): CapitalMetrics {
  const b = state.balances;

  const liquidCents = presentedBalance(b, 'LIQUID');
  const inventoryAtCostCents = presentedBalance(b, 'INVENTORY_AT_COST');
  const taxReserveCents = presentedBalance(b, 'TAX_RESERVE');
  const operatingReserveCents = presentedBalance(b, 'OPERATING_RESERVE');
  const ownerPayableCents = presentedBalance(b, 'OWNER_PAYABLE');
  const contributedCapitalCents = presentedBalance(b, 'CONTRIBUTED_CAPITAL');
  const retainedEarningsCents = presentedBalance(b, 'RETAINED_EARNINGS');

  const earmarkedCents = taxReserveCents + operatingReserveCents + ownerPayableCents;
  const navCents = liquidCents + inventoryAtCostCents - earmarkedCents;
  const unencumberedCashCents = liquidCents - earmarkedCents;
  const capitalDeployedCents = inventoryAtCostCents;

  const mode = resolveBankrollMode(navCents, state.mode, state.policy);
  const modePolicy = state.policy.modes[mode];

  const minLiquidFloorCents = applyBps(Math.max(0, navCents), modePolicy.minLiquidFloorBps);
  const maxDeployedCents = applyBps(Math.max(0, navCents), modePolicy.maxDeployedBps);

  const deployableCapitalCents = Math.max(
    0,
    Math.min(
      unencumberedCashCents - minLiquidFloorCents,
      maxDeployedCents - capitalDeployedCents,
    ),
  );

  return {
    liquidCents,
    inventoryAtCostCents,
    taxReserveCents,
    operatingReserveCents,
    ownerPayableCents,
    contributedCapitalCents,
    retainedEarningsCents,
    earmarkedCents,
    navCents,
    unencumberedCashCents,
    capitalDeployedCents,
    minLiquidFloorCents,
    maxDeployedCents,
    deployableCapitalCents,
    deployedBps: toBps(capitalDeployedCents, Math.max(1, navCents)),
    mode,
    modePolicy,
    longHoldCapitalCents: longHoldCapital(state, modePolicy),
    maxLongHoldCents: applyBps(Math.max(0, navCents), modePolicy.maxLongHoldBps),
    categoryExposureCents: categoryExposure(state),
    maxCategoryExposureCents: applyBps(
      Math.max(0, navCents),
      modePolicy.maxCategoryExposureBps,
    ),
    maxCapitalPerItemCents: applyBps(Math.max(0, navCents), modePolicy.maxCapitalPerItemBps),
    activeItemCount: activeItems(state).length,
  };
}
