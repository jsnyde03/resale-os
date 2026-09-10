/**
 * What the fund is currently holding.
 *
 * The operationally useful question is not "what do I own" but **"what is
 * going stale"** — an item past its expected hold is capital that is not
 * working, and at a small bankroll that is the whole constraint.
 *
 * ⚠️ `now` is a parameter, never read from a clock here. `src/core` is pure and
 * this layer keeps the same discipline, so a test can ask what the screen said
 * on a particular day without mocking time.
 */

import type { LedgerReader } from '../db/store.js';
import type { ItemRecord } from '../core/capital/state.js';
import { holdsCapital } from '../core/capital/state.js';
import { money, type Money } from '../screens/views.js';

const MS_PER_DAY = 86_400_000;

export interface InventoryRow {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly state: string;
  readonly bookValue: Money;
  readonly expectedResale: Money;
  readonly daysHeld: number;
  readonly expectedDaysToSale: number;
  /** Held longer than predicted. Capital that is not working. */
  readonly overdue: boolean;
  /** How far past, in days. Zero when not overdue. */
  readonly daysOverdue: number;
  readonly listingLive: boolean;
}

export interface InventoryView {
  readonly rows: readonly InventoryRow[];
  readonly count: number;
  readonly totalBookValue: Money;
  readonly overdueCount: number;
  readonly overdueBookValue: Money;
  readonly empty: boolean;
}

function daysBetween(fromIso: string, nowMs: number): number {
  const from = Date.parse(fromIso);
  if (Number.isNaN(from)) return 0;
  return Math.max(0, Math.floor((nowMs - from) / MS_PER_DAY));
}

export function inventoryRow(item: ItemRecord, nowMs: number): InventoryRow {
  const daysHeld = daysBetween(item.acquiredAt, nowMs);
  const overdue = daysHeld > item.expectedDaysToSale;
  return {
    id: item.itemId,
    name: item.name,
    category: item.category,
    state: item.state,
    bookValue: money(item.bookValueCents),
    expectedResale: money(item.expectedResaleCents),
    daysHeld,
    expectedDaysToSale: item.expectedDaysToSale,
    overdue,
    daysOverdue: overdue ? daysHeld - item.expectedDaysToSale : 0,
    listingLive: item.listingLive,
  };
}

export function inventoryView(store: LedgerReader, nowMs: number): InventoryView {
  // Only items still holding capital. A sold or charged-off item is history,
  // and history belongs on the performance screen.
  const rows = Object.values(store.state().items)
    .filter((i) => holdsCapital(i.state))
    .map((i) => inventoryRow(i, nowMs))
    // Most overdue first — that is the thing to act on.
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.daysHeld - a.daysHeld);

  const overdue = rows.filter((r) => r.overdue);
  return {
    rows,
    count: rows.length,
    totalBookValue: money(rows.reduce((sum, r) => sum + r.bookValue.cents, 0)),
    overdueCount: overdue.length,
    overdueBookValue: money(overdue.reduce((sum, r) => sum + r.bookValue.cents, 0)),
    empty: rows.length === 0,
  };
}
