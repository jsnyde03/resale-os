/**
 * The capital engine.
 *
 * A pure reducer: (FundState, Command) -> { state, event }. No I/O, no clock,
 * no randomness. Every invariant is asserted before the next state is returned,
 * so a bug throws at the point of the mistake instead of producing wrong money.
 *
 * Scope note: the engine records what HAPPENED. Policy gates (Buy Score floors,
 * category caps, hold-time limits) live in `constraints.ts` and are advisory to
 * a *decision*, not to a *recording* — the operator may have already handed over
 * cash in a parking lot, and a ledger that refuses to record reality is worse
 * than useless. `assessPurchase()` is how a caller checks first.
 */

import { allocate, assertCents, assertNonNegativeCents, type Cents } from '../money.js';
import { computeTaxReserve, ZERO_TAX, type TaxBreakdown } from './tax.js';
import { compactPostings, credit, debit, type LedgerEvent, type Posting } from '../ledger/types.js';
import { IS_DEBIT_NORMAL } from '../ledger/accounts.js';
import {
  assertAllInvariants,
  assertBalancedPostings,
  InvariantViolation,
} from '../ledger/invariants.js';
import { navOf, presentedBalance, resolveBankrollMode } from './metrics.js';
import type { Balances, FundState, ItemRecord } from './state.js';
import { holdsCapital, yearOf } from './state.js';
import {
  landedCostOf,
  saleCostTotal,
  type Command,
  type PurchaseCommand,
  type SaleCosts,
} from './commands.js';

export class EngineError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'EngineError';
    this.code = code;
  }
}

export interface ApplyResult {
  readonly state: FundState;
  readonly event: LedgerEvent;
  /** Populated for SALE and PASSIVE_RECOVERY. Everything the split decided. */
  readonly allocation?: ProfitAllocation;
}

export interface ProfitAllocation {
  readonly profitCents: Cents;
  /** What moves into TAX_RESERVE: `tax.totalCents`. */
  readonly taxCents: Cents;
  /** The components behind `taxCents`, so the reserve is always explainable. */
  readonly tax: TaxBreakdown;
  readonly ownerCents: Cents;
  readonly operatingReserveCents: Cents;
  readonly reinvestedCents: Cents;
  /** True when the fund was below `setAsideMinNavCents` and everything compounded. */
  readonly setAsideSuppressed: boolean;
  /** NAV the decision was made against: after the sale, before allocation. */
  readonly navAtAllocationCents: Cents;
}

// ---------------------------------------------------------------------------
// profit allocation
// ---------------------------------------------------------------------------

/**
 * Tax first, then the after-tax remainder splits owner / operating / reinvest.
 * `allocate()` is remainder-exact, so the four parts always sum to `profit`.
 * Reinvestment has no posting: it is the residual already sitting in
 * RETAINED_EARNINGS, backed by cash already in LIQUID.
 *
 * The tax figure is computed from the self-employment formula in `tax.ts`, not
 * from a blended rate — see docs/FINANCIAL_SPEC.md §3.3-B.
 *
 * Below `setAsideMinNavCents` nothing is set aside: no owner cut, no operating
 * reserve, everything after tax compounds. The tax reserve still accrues,
 * because tax is an obligation rather than a distribution.
 *
 * The threshold is tested against NAV *after* this sale is recognised — the
 * bankroll as it now stands — so the very flip that crosses the line is the
 * first one to pay out.
 */
export function splitProfit(profitCents: Cents, state: FundState): ProfitAllocation {
  assertCents(profitCents, 'profit');
  const navAtAllocationCents = navOf(state.balances) + Math.max(0, profitCents);

  if (profitCents <= 0) {
    return {
      profitCents,
      taxCents: 0,
      tax: ZERO_TAX,
      ownerCents: 0,
      operatingReserveCents: 0,
      reinvestedCents: profitCents,
      setAsideSuppressed: false,
      navAtAllocationCents: navOf(state.balances) + profitCents,
    };
  }

  const a = state.policy.allocation;
  const tax = computeTaxReserve(
    profitCents,
    state.ytdNetBusinessIncomeCents,
    state.ytdTaxReservedCents,
    state.taxProfile,
    state.taxTables,
  );
  const afterTax = profitCents - tax.totalCents;

  if (navAtAllocationCents < a.setAsideMinNavCents) {
    return {
      profitCents,
      taxCents: tax.totalCents,
      tax,
      ownerCents: 0,
      operatingReserveCents: 0,
      reinvestedCents: afterTax,
      setAsideSuppressed: true,
      navAtAllocationCents,
    };
  }

  const [ownerCents, operatingReserveCents, reinvestedCents] = allocate(afterTax, [
    a.ownerBps,
    a.operatingReserveBps,
    a.reinvestBps,
  ]) as [Cents, Cents, Cents];

  return {
    profitCents,
    taxCents: tax.totalCents,
    tax,
    ownerCents,
    operatingReserveCents,
    reinvestedCents,
    setAsideSuppressed: false,
    navAtAllocationCents,
  };
}

function allocationPostings(alloc: ProfitAllocation): Posting[] {
  if (alloc.profitCents <= 0) return [];
  return compactPostings([
    debit('RETAINED_EARNINGS', alloc.taxCents, 'tax reserve (self-employment)'),
    credit('TAX_RESERVE', alloc.taxCents),
    debit('RETAINED_EARNINGS', alloc.ownerCents, 'owner distribution'),
    credit('OWNER_PAYABLE', alloc.ownerCents),
    debit('RETAINED_EARNINGS', alloc.operatingReserveCents, 'operating reserve'),
    credit('OPERATING_RESERVE', alloc.operatingReserveCents),
    // reinvestedCents: intentionally no posting. See docs/FINANCIAL_SPEC.md §1.
  ]);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function nextEventId(state: FundState, override?: string): string {
  return override ?? `evt_${String(state.eventCount + 1).padStart(6, '0')}`;
}

function applyPostings(balances: Balances, postings: readonly Posting[]): Balances {
  const next: Balances = { ...balances };
  for (const p of postings) next[p.account] = next[p.account] + p.amountCents;
  return next;
}

function requireItem(state: FundState, itemId: string): ItemRecord {
  const item = state.items[itemId];
  if (!item) throw new EngineError('UNKNOWN_ITEM', `no item with id "${itemId}"`);
  return item;
}

function netProceeds(grossCents: Cents, costs: SaleCosts): Cents {
  assertNonNegativeCents(grossCents, 'grossProceeds');
  const total = saleCostTotal(costs);
  assertNonNegativeCents(total, 'sale costs');
  return grossCents - total;
}

// ---------------------------------------------------------------------------
// the reducer
// ---------------------------------------------------------------------------

export function applyCommand(state: FundState, command: Command): ApplyResult {
  const eventId = nextEventId(state, command.eventId);
  let postings: Posting[] = [];
  let items = state.items;
  let itemId: string | undefined;
  let allocation: ProfitAllocation | undefined;
  /**
   * How this command moves the year's net business income — the base the tax
   * model reserves against. Sales and recoveries add their profit; business
   * expenses deduct. A charge-off is deliberately NOT deducted: for a
   * cash-basis reseller the cost of unsold goods is not a deduction until the
   * goods are disposed of, and over-reserving is the safe direction.
   */
  let businessIncomeDelta = 0;

  switch (command.type) {
    case 'CONTRIBUTION': {
      assertNonNegativeCents(command.amountCents, 'contribution');
      postings = [
        debit('LIQUID', command.amountCents),
        credit('CONTRIBUTED_CAPITAL', command.amountCents),
      ];
      break;
    }

    case 'PURCHASE': {
      const landed = landedCostOf(command);
      assertNonNegativeCents(command.purchasePriceCents, 'purchasePrice');
      assertNonNegativeCents(landed, 'landedCost');
      if (state.items[command.itemId]) {
        throw new EngineError('DUPLICATE_ITEM', `item "${command.itemId}" already exists`);
      }
      // ⛔ D4: an override is allowed, but never a silent one. The engine does
      // not judge WHETHER the gates were right — that is `constraints.ts`, and
      // advisory to a decision rather than to a recording. It only insists that
      // a purchase claiming to have overruled them says why.
      if (command.overrodeGates !== undefined && command.overrodeGates.length > 0) {
        if (!command.overrideReason || command.overrideReason.trim() === '') {
          throw new EngineError(
            'OVERRIDE_NEEDS_REASON',
            `this purchase overrode ${command.overrodeGates.join(', ')} and must say why`,
          );
        }
      }
      if (!Number.isInteger(command.expectedDaysToSale) || command.expectedDaysToSale < 0) {
        throw new EngineError('BAD_INPUT', 'expectedDaysToSale must be a non-negative integer');
      }

      itemId = command.itemId;
      postings = [debit('INVENTORY_AT_COST', landed), credit('LIQUID', landed)];
      items = {
        ...items,
        [command.itemId]: {
          itemId: command.itemId,
          name: command.name,
          category: command.category,
          acquiredAt: command.occurredAt,
          landedCostCents: landed,
          bookValueCents: landed,
          expectedDaysToSale: command.expectedDaysToSale,
          expectedResaleCents: command.expectedResaleCents,
          ...(command.expectedNetProceedsCents !== undefined
            ? { expectedNetProceedsCents: command.expectedNetProceedsCents }
            : {}),
          ...(command.expectedProfitCents !== undefined
            ? { expectedProfitCents: command.expectedProfitCents }
            : {}),
          ...(command.opportunityId !== undefined
            ? { opportunityId: command.opportunityId }
            : {}),
          ...(command.overrodeGates !== undefined && command.overrodeGates.length > 0
            ? {
                overrodeGates: command.overrodeGates,
                overrideReason: command.overrideReason,
              }
            : {}),
          state: 'ACTIVE',
          listingLive: command.listingLive ?? false,
          ...(command.marketplace !== undefined ? { marketplace: command.marketplace } : {}),
          realizedProfitCents: 0,
        },
      };
      break;
    }

    case 'SALE': {
      const item = requireItem(state, command.itemId);
      if (!holdsCapital(item.state)) {
        throw new EngineError(
          'ITEM_NOT_SELLABLE',
          `item "${item.itemId}" is ${item.state}; a charged-off item sells via PASSIVE_RECOVERY`,
        );
      }

      const net = netProceeds(command.grossProceedsCents, command);
      const bookValue = item.bookValueCents;
      const profit = net - bookValue;

      itemId = item.itemId;
      allocation = splitProfit(profit, state);
      businessIncomeDelta = profit;

      postings = compactPostings([
        // Principal returns to the fund first, always: the credit to inventory
        // is exactly what leaves the shelf, so nothing is profit until the fund
        // has been made whole.
        debit('LIQUID', net),
        credit('INVENTORY_AT_COST', bookValue),
        profit >= 0
          ? credit('RETAINED_EARNINGS', profit)
          : debit('RETAINED_EARNINGS', -profit),
        ...allocationPostings(allocation),
      ]);

      items = {
        ...items,
        [item.itemId]: {
          ...item,
          bookValueCents: 0,
          state: 'SOLD',
          listingLive: false,
          actualNetProceedsCents: net,
          soldAt: command.occurredAt,
          ...(command.daysToSale !== undefined ? { daysToSale: command.daysToSale } : {}),
          realizedProfitCents: item.realizedProfitCents + profit,
        },
      };
      break;
    }

    case 'OWNER_PAYOUT': {
      assertNonNegativeCents(command.amountCents, 'payout');
      const payable = presentedBalance(state.balances, 'OWNER_PAYABLE');
      if (command.amountCents > payable) {
        throw new EngineError(
          'PAYOUT_EXCEEDS_PAYABLE',
          `owner payable is ${payable} cents; cannot pay out ${command.amountCents}`,
        );
      }
      postings = [
        debit('OWNER_PAYABLE', command.amountCents),
        credit('LIQUID', command.amountCents),
      ];
      break;
    }

    case 'BUSINESS_EXPENSE': {
      assertNonNegativeCents(command.amountCents, 'expense');
      if (command.itemId !== undefined) requireItem(state, command.itemId);
      itemId = command.itemId;
      businessIncomeDelta = -command.amountCents;
      postings = [
        debit('RETAINED_EARNINGS', command.amountCents, command.category),
        credit('LIQUID', command.amountCents),
      ];
      if (command.fundedFromOperatingReserve) {
        // Releases the earmark; it does not pay the bill a second time.
        const available = presentedBalance(state.balances, 'OPERATING_RESERVE');
        const release = Math.min(command.amountCents, available);
        postings = compactPostings([
          ...postings,
          debit('OPERATING_RESERVE', release, 'reserve release'),
          credit('RETAINED_EARNINGS', release),
        ]);
      }
      break;
    }

    case 'TAX_PAYMENT': {
      assertNonNegativeCents(command.amountCents, 'tax payment');
      const reserve = presentedBalance(state.balances, 'TAX_RESERVE');
      if (command.amountCents > reserve) {
        throw new EngineError(
          'TAX_PAYMENT_EXCEEDS_RESERVE',
          `tax reserve is ${reserve} cents; cannot pay ${command.amountCents}`,
        );
      }
      postings = [
        debit('TAX_RESERVE', command.amountCents),
        credit('LIQUID', command.amountCents),
      ];
      break;
    }

    case 'CHARGE_OFF': {
      const item = requireItem(state, command.itemId);
      if (!holdsCapital(item.state)) {
        throw new EngineError(
          'ITEM_NOT_CHARGEABLE',
          `item "${item.itemId}" is already ${item.state}`,
        );
      }

      const bookValue = item.bookValueCents;
      itemId = item.itemId;

      // No cash moves. Capital does NOT return to the fund — that is the point.
      postings = compactPostings([
        debit('RETAINED_EARNINGS', bookValue, `charge-off: ${command.reason}`),
        credit('INVENTORY_AT_COST', bookValue),
      ]);

      items = {
        ...items,
        [item.itemId]: {
          ...item,
          bookValueCents: 0,
          state: command.reason === 'PERSONAL_KEEP' ? 'PERSONAL_KEEP' : 'CHARGED_OFF',
          chargeOffReason: command.reason,
          listingLive: command.keepListingLive ?? item.listingLive,
          realizedProfitCents: item.realizedProfitCents - bookValue,
        },
      };
      break;
    }

    case 'PASSIVE_RECOVERY': {
      const item = requireItem(state, command.itemId);
      if (holdsCapital(item.state)) {
        throw new EngineError(
          'ITEM_NOT_CHARGED_OFF',
          `item "${item.itemId}" still holds capital; use SALE`,
        );
      }
      if (item.state === 'SOLD' || item.state === 'PASSIVE_RECOVERY') {
        throw new EngineError('ITEM_ALREADY_SOLD', `item "${item.itemId}" is ${item.state}`);
      }

      const net = netProceeds(command.grossProceedsCents, command);
      itemId = item.itemId;
      // Book value is already 0, so the entire net is profit.
      allocation = splitProfit(net, state);
      businessIncomeDelta = net;

      postings = compactPostings([
        debit('LIQUID', net),
        net >= 0 ? credit('RETAINED_EARNINGS', net) : debit('RETAINED_EARNINGS', -net),
        ...allocationPostings(allocation),
      ]);

      items = {
        ...items,
        [item.itemId]: {
          ...item,
          state: 'PASSIVE_RECOVERY',
          listingLive: false,
          actualNetProceedsCents: net,
          soldAt: command.occurredAt,
          realizedProfitCents: item.realizedProfitCents + net,
        },
      };
      break;
    }

    case 'SET_ITEM_STATE': {
      const item = requireItem(state, command.itemId);
      if (!holdsCapital(item.state)) {
        throw new EngineError(
          'ITEM_NOT_ACTIVE',
          `item "${item.itemId}" is ${item.state} and cannot re-enter active inventory`,
        );
      }
      itemId = item.itemId;
      postings = []; // a lifecycle move with no money in it
      items = {
        ...items,
        [item.itemId]: {
          ...item,
          state: command.state,
          listingLive: command.listingLive ?? item.listingLive,
        },
      };
      break;
    }

    case 'ADJUSTMENT': {
      assertCents(command.amountCents, 'adjustment');
      if (!command.reason || command.reason.trim() === '') {
        throw new EngineError('BAD_INPUT', 'an ADJUSTMENT requires a reason');
      }
      if (command.account === 'RETAINED_EARNINGS') {
        throw new EngineError(
          'BAD_INPUT',
          'adjustments are always paired AGAINST retained earnings; pick another account',
        );
      }
      if (command.reversesEventId !== undefined) {
        // An expense credited LIQUID and deducted business income. Undoing it
        // has exactly one shape: cash comes back. Any other account or sign
        // would be a different correction wearing a reversal's label, and the
        // store would have no honest amount to compensate the expense row with.
        if (command.account !== 'LIQUID') {
          throw new EngineError(
            'BAD_INPUT',
            'reversing an expense returns cash; the account must be LIQUID',
          );
        }
        if (command.amountCents <= 0) {
          throw new EngineError(
            'BAD_INPUT',
            'an expense reversal must be positive; it returns money to the fund',
          );
        }
        // The expense deducted this from the year's net business income. Give
        // it back, or the tax reserve keeps reserving against a cost that was
        // withdrawn. The store's independent derivation mirrors this, and
        // `reconcile()` is what proves the two still agree.
        businessIncomeDelta = command.amountCents;
      }
      // `amountCents` is presented-sign: positive means "more of this account".
      const raw = IS_DEBIT_NORMAL[command.account]
        ? command.amountCents
        : -command.amountCents;
      postings = compactPostings([
        { account: command.account, amountCents: raw, memo: command.reason },
        { account: 'RETAINED_EARNINGS', amountCents: -raw, memo: command.reason },
      ]);
      break;
    }

    case 'EXPENSE_CORRECTION': {
      assertNonNegativeCents(command.amountCents, 'correction');
      if (command.amountCents === 0) {
        throw new EngineError('BAD_INPUT', 'an EXPENSE_CORRECTION of zero corrects nothing');
      }
      if (!command.reason || command.reason.trim() === '') {
        throw new EngineError('BAD_INPUT', 'an EXPENSE_CORRECTION requires a reason');
      }
      // Exactly one of the two shapes. Reclassifying moves an expense between
      // categories; settling removes it because the cash already came back.
      // Both at once is incoherent, and NEITHER would silently drop an expense
      // the ledger still says was paid — which is the drift this whole
      // mechanism exists to prevent.
      const reclassifying = command.reclassifyTo !== undefined;
      const settling = command.settledByEventId !== undefined;
      if (reclassifying === settling) {
        throw new EngineError(
          'BAD_INPUT',
          'an EXPENSE_CORRECTION either reclassifies (reclassifyTo) or settles ' +
            '(settledByEventId) — exactly one',
        );
      }
      if (settling) {
        // The expense deducted this from the year's business income, and the
        // returning event never gave it back because it did not know it was a
        // reversal. This is where it comes back.
        businessIncomeDelta = command.amountCents;
      }
      // No postings, deliberately: nothing happened to the money. This event
      // corrects the RECORD of money that already moved. An empty set sums to
      // zero, so `assertBalancedPostings` is satisfied by construction.
      postings = [];
      break;
    }
  }

  assertBalancedPostings(postings);

  const balances = applyPostings(state.balances, postings);
  const navAfter =
    presentedBalance(balances, 'LIQUID') +
    presentedBalance(balances, 'INVENTORY_AT_COST') -
    presentedBalance(balances, 'TAX_RESERVE') -
    presentedBalance(balances, 'OPERATING_RESERVE') -
    presentedBalance(balances, 'OWNER_PAYABLE');

  // Tax is annual, so the year-to-date figures reset when a command lands in a
  // new calendar year. Derived from the command's own timestamp: core has no clock.
  const commandYear = yearOf(command.occurredAt);
  const sameYear = commandYear === state.taxYear;
  const ytdIncomeBefore = sameYear ? state.ytdNetBusinessIncomeCents : 0;
  const ytdReservedBefore = sameYear ? state.ytdTaxReservedCents : 0;

  const nextState: FundState = {
    balances,
    items,
    policy: state.policy,
    taxProfile: state.taxProfile,
    taxTables: state.taxTables,
    mode: resolveBankrollMode(navAfter, state.mode, state.policy),
    taxYear: commandYear,
    ytdNetBusinessIncomeCents: ytdIncomeBefore + businessIncomeDelta,
    ytdTaxReservedCents: ytdReservedBefore + (allocation?.taxCents ?? 0),
    eventCount: state.eventCount + 1,
  };

  assertAllInvariants(nextState);

  const event: LedgerEvent = {
    eventId,
    type: command.type === 'SET_ITEM_STATE' ? 'ITEM_STATE_CHANGE' : command.type,
    occurredAt: command.occurredAt,
    ...(itemId !== undefined ? { itemId } : {}),
    ...(command.memo !== undefined ? { memo: command.memo } : {}),
    postings,
    payload: command as unknown as Record<string, unknown>,
  };

  return allocation === undefined
    ? { state: nextState, event }
    : { state: nextState, event, allocation };
}

/** Fold a command list. Throws on the first command that breaks an invariant. */
export function applyAll(
  state: FundState,
  commands: readonly Command[],
): { state: FundState; events: LedgerEvent[] } {
  let current = state;
  const events: LedgerEvent[] = [];
  for (const command of commands) {
    const result = applyCommand(current, command);
    current = result.state;
    events.push(result.event);
  }
  return { state: current, events };
}

export { InvariantViolation };
export type { PurchaseCommand };
