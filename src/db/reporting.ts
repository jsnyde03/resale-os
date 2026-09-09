/**
 * Three different profit numbers, and why they must never be conflated.
 *
 * The brief asked the dashboard to distinguish item profit, operating profit
 * and owner-distributable profit. They differ by real money and by who has a
 * claim on it:
 *
 *   item profit          = what the flips made, before the cost of running a business
 *   operating profit     = item profit - business-level expenses (tape, mailers, hosting)
 *   owner-distributable  = operating profit - the tax reserve
 *
 * Reporting item profit as "profit" is how a business quietly spends its tax
 * money on boxes.
 *
 * ⚠️ **Capitalised costs are excluded from expenses here.** Inbound shipping and
 * acquisition travel are already inside an item's book value, so counting them
 * again would double-charge every item. That is what `capitalized = 1` is for.
 *
 * This module reads the database rather than the pure core, because expenses
 * live in their own table.
 */

import type { Cents } from '../core/money.js';
import { toBps, type Bps } from '../core/money.js';
import { normalizeZero } from '../core/math.js';
import type { ReadOnlyDb } from './db-types.js';

export interface ProfitReport {
  /** Realised profit on items: sales and recoveries, net of sale-side costs. */
  readonly itemProfitCents: Cents;
  /** Business-level expenses. Not attached to any one item. */
  readonly businessExpenseCents: Cents;
  readonly operatingProfitCents: Cents;
  /** Set aside for tax and therefore not the owner's to take. */
  readonly taxReserveCents: Cents;
  readonly ownerDistributableCents: Cents;

  /** Already paid out to the owner. */
  readonly ownerPaidCents: Cents;
  /** Allocated to the owner but still sitting in the fund. */
  readonly ownerPayableCents: Cents;

  readonly soldItems: number;
  readonly chargedOffItems: number;
  readonly chargeOffCents: Cents;
  readonly recoveryCents: Cents;
  /** Realised profit over capital deployed on sold items. */
  readonly realisedRoiBps: Bps;
}

function scalar(db: ReadOnlyDb, sql: string, params: readonly (string | number)[] = []): number {
  const row = db.get<{ v: number | null }>(sql, params);
  return Number(row?.v ?? 0);
}

export function profitReport(db: ReadOnlyDb): ProfitReport {
  // ⚠️ Business expenses are read from the `expenses` table, not the ledger.
  // That is only safe because an `ADJUSTMENT` carrying `reversesEventId` writes
  // a compensating negative row here (B33, closed 2026-09-08). An adjustment
  // WITHOUT that link still moves the ledger alone — which is correct, since it
  // is not claiming to reverse an expense. `expenseReversalDrift()` below is the
  // check that the two have not come apart anyway.

  // Item profit: what closed positions actually made.
  const itemProfitCents = scalar(
    db,
    `SELECT SUM(realized_profit_cents) AS v FROM items
      WHERE state IN ('SOLD','PASSIVE_RECOVERY')`,
  );

  // Business-level only, and never the capitalised ones.
  const businessExpenseCents = scalar(
    db,
    `SELECT SUM(amount_cents) AS v FROM expenses
      WHERE scope = 'BUSINESS' AND capitalized = 0`,
  );

  const taxReserveCents = -scalar(
    db,
    `SELECT SUM(amount_cents) AS v FROM ledger_postings WHERE account = 'TAX_RESERVE'`,
  );
  const ownerPayableCents = -scalar(
    db,
    `SELECT SUM(amount_cents) AS v FROM ledger_postings WHERE account = 'OWNER_PAYABLE'`,
  );
  const ownerPaidCents = scalar(
    db,
    `SELECT SUM(p.amount_cents) AS v
       FROM ledger_postings p
       JOIN ledger_events e ON e.event_id = p.event_id
      WHERE p.account = 'OWNER_PAYABLE' AND e.type = 'OWNER_PAYOUT'`,
  );

  const operatingProfitCents = itemProfitCents - businessExpenseCents;

  const soldItems = scalar(
    db,
    `SELECT COUNT(*) AS v FROM items WHERE state IN ('SOLD','PASSIVE_RECOVERY')`,
  );
  const chargedOffItems = scalar(
    db,
    `SELECT COUNT(*) AS v FROM items WHERE state IN ('CHARGED_OFF','PERSONAL_KEEP')`,
  );
  const chargeOffCents = scalar(
    db,
    `SELECT SUM(landed_cost_cents) AS v FROM items
      WHERE state IN ('CHARGED_OFF','PERSONAL_KEEP')`,
  );
  const recoveryCents = scalar(
    db,
    `SELECT SUM(actual_net_proceeds_cents) AS v FROM items WHERE state = 'PASSIVE_RECOVERY'`,
  );
  const capitalOnSold = scalar(
    db,
    `SELECT SUM(landed_cost_cents) AS v FROM items WHERE state = 'SOLD'`,
  );

  return {
    itemProfitCents,
    businessExpenseCents,
    operatingProfitCents,
    taxReserveCents,
    // The owner's share is what is left after the business is paid for AND the
    // tax is set aside. Never the top line.
    ownerDistributableCents: operatingProfitCents - taxReserveCents,
    ownerPaidCents,
    ownerPayableCents,
    soldItems,
    chargedOffItems,
    chargeOffCents,
    recoveryCents,
    realisedRoiBps: capitalOnSold <= 0 ? 0 : toBps(itemProfitCents, capitalOnSold),
  };
}

export interface ExpenseLine {
  readonly category: string;
  readonly scope: string;
  readonly capitalized: number;
  readonly totalCents: Cents;
  readonly n: number;
}

export function expenseBreakdown(db: ReadOnlyDb): ExpenseLine[] {
  return db.all<ExpenseLine>(
    `SELECT category, scope, capitalized,
            SUM(amount_cents) AS totalCents, COUNT(*) AS n
       FROM expenses
      GROUP BY category, scope, capitalized
      ORDER BY totalCents DESC`,
  );
}

export interface ExpenseDriftLine {
  readonly eventId: string;
  /** Cash that actually left the fund for this expense, net of reversals. */
  readonly ledgerCents: Cents;
  /** What the analytic table still says the expense was, net of compensating rows. */
  readonly tableCents: Cents;
}

/**
 * The control on B33: does the expenses table still agree with the ledger?
 *
 * The two sides are derived from genuinely different places. The ledger side
 * reads `LIQUID` postings and the ADJUSTMENT payloads that name what they
 * reverse; the table side reads `expenses`. Neither is computed from the other,
 * so a writer that drops one of them shows up here instead of silently
 * overstating operating profit.
 *
 * Returns the events where the two disagree. An empty array is the healthy
 * state, and a test plants a divergence to prove that is not vacuous.
 */
export function expenseReversalDrift(db: ReadOnlyDb): ExpenseDriftLine[] {
  // Ledger side. An expense's LIQUID posting is never compacted with anything
  // else — the operating-reserve release touches RETAINED_EARNINGS, not cash —
  // so this is exactly the amount that was spent.
  const ledger = new Map<string, number>();
  for (const row of db.all<{ event_id: string; v: number }>(
    `SELECT p.event_id AS event_id, SUM(p.amount_cents) AS v
       FROM ledger_postings p
       JOIN ledger_events e ON e.event_id = p.event_id
      WHERE p.account = 'LIQUID' AND e.type = 'BUSINESS_EXPENSE'
      GROUP BY p.event_id`,
  )) {
    ledger.set(row.event_id, normalizeZero(-Number(row.v)));
  }

  for (const row of db.all<{ payload_json: string; v: number }>(
    `SELECT e.payload_json AS payload_json, SUM(p.amount_cents) AS v
       FROM ledger_events e
       JOIN ledger_postings p ON p.event_id = e.event_id
      WHERE e.type = 'ADJUSTMENT' AND p.account = 'LIQUID'
      GROUP BY e.event_id`,
  )) {
    const target = (JSON.parse(row.payload_json) as { reversesEventId?: string }).reversesEventId;
    if (target === undefined) continue;
    ledger.set(target, normalizeZero((ledger.get(target) ?? 0) - Number(row.v)));
  }

  // A settlement is a declaration, made after the fact, that some OTHER event
  // already returned this expense's cash. It moves no money itself, so it does
  // not appear in the postings at all — but it is exactly what tells this side
  // that the expense is no longer outstanding. The store checks the named event
  // really did return that much, and that no two settlements claim it twice.
  for (const row of db.all<{ payload_json: string }>(
    "SELECT payload_json FROM ledger_events WHERE type = 'EXPENSE_CORRECTION'",
  )) {
    const p = JSON.parse(row.payload_json) as {
      correctsEventId?: string;
      amountCents?: number;
      settledByEventId?: string;
    };
    if (p.settledByEventId === undefined || p.correctsEventId === undefined) continue;
    const target = p.correctsEventId;
    ledger.set(target, normalizeZero((ledger.get(target) ?? 0) - Number(p.amountCents ?? 0)));
  }

  // Table side, over the same events and their compensating rows.
  const table = new Map<string, number>();
  for (const row of db.all<{ event_id: string; v: number }>(
    `SELECT COALESCE(x.reverses_event_id, x.event_id) AS event_id, SUM(x.amount_cents) AS v
       FROM expenses x
       JOIN ledger_events e ON e.event_id = x.event_id
      WHERE e.type IN ('BUSINESS_EXPENSE','ADJUSTMENT','EXPENSE_CORRECTION')
      GROUP BY COALESCE(x.reverses_event_id, x.event_id)`,
  )) {
    table.set(row.event_id, Number(row.v));
  }

  const drift: ExpenseDriftLine[] = [];
  for (const eventId of [...new Set([...ledger.keys(), ...table.keys()])].sort()) {
    const ledgerCents = ledger.get(eventId) ?? 0;
    const tableCents = table.get(eventId) ?? 0;
    if (ledgerCents !== tableCents) drift.push({ eventId, ledgerCents, tableCents });
  }
  return drift;
}
