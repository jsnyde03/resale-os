/**
 * B33: an ADJUSTMENT that corrects an expense must correct the analytic record.
 *
 * The defect this closes was found by hand at button-up. Smoke-test data was
 * reversed, the ledger returned to $50.00, and `profit --expenses` still
 * reported $1.50 of SUPPLIES — two sources of truth for expenses, and only one
 * of them self-corrected.
 *
 * Every control here is planted against. The first test in each pair reproduces
 * the original symptom exactly; the rest prove the guard rails are real rather
 * than decorative.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FundStore } from '@/db/store.js';
import { openDb } from '@/db/driver.js';
import { migrate } from '@/db/migrate.js';
import { profitReport, expenseBreakdown, expenseReversalDrift } from '@/db/reporting.js';
import { reconcile } from '@/db/replay.js';
import { EngineError } from '@/core/capital/engine.js';
import { WITH_JOB, T0 } from './helpers.js';

function fixedClock(): () => string {
  let n = 0;
  return () => `2026-09-08T12:00:${String(n++).padStart(2, '0')}.000Z`;
}

function withStore(fn: (store: FundStore) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'resale-reversal-'));
  try {
    const db = openDb(join(dir, 'test.db'));
    migrate(db, T0);
    const store = new FundStore(db, fixedClock());
    store.ensureSeeded();
    store.setTaxProfile(WITH_JOB);
    store.commit({ type: 'CONTRIBUTION', amountCents: 5_000, occurredAt: T0 });
    try {
      fn(store);
    } finally {
      // Windows will not unlink an open SQLite file, and a leaked handle turns
      // every assertion failure in this file into an EBUSY instead.
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

/** Spend $1.50 on supplies. Returns the event id, which is what gets reversed. */
function spendOnSupplies(store: FundStore, amountCents = 150): string {
  return store.commit({
    type: 'BUSINESS_EXPENSE',
    amountCents,
    category: 'SUPPLIES',
    occurredAt: T0,
    memo: 'smoke test',
  }).event.eventId;
}

function suppliesTotal(store: FundStore): number {
  return expenseBreakdown(store.db)
    .filter((l) => l.category === 'SUPPLIES')
    .reduce((acc, l) => acc + l.totalCents, 0);
}

describe('reversing a business expense', () => {
  it('returns the expenses table to zero, not just the ledger', () => {
    withStore((store) => {
      const expenseId = spendOnSupplies(store);
      expect(suppliesTotal(store)).toBe(150);
      expect(profitReport(store.db).businessExpenseCents).toBe(150);

      store.commit({
        type: 'ADJUSTMENT',
        account: 'LIQUID',
        amountCents: 150,
        reason: 'smoke test data',
        reversesEventId: expenseId,
        occurredAt: T0,
      });

      // The exact symptom from button-up: the ledger came back, the table did not.
      expect(store.state().balances.LIQUID).toBe(5_000);
      expect(suppliesTotal(store)).toBe(0);
      expect(profitReport(store.db).businessExpenseCents).toBe(0);
      expect(profitReport(store.db).operatingProfitCents).toBe(0);
    });
  });

  it('keeps the compensating row rather than deleting the original', () => {
    withStore((store) => {
      const expenseId = spendOnSupplies(store);
      store.commit({
        type: 'ADJUSTMENT',
        account: 'LIQUID',
        amountCents: 150,
        reason: 'smoke test data',
        reversesEventId: expenseId,
        occurredAt: T0,
      });

      // Append-only: both the mistake and the correction stay visible.
      const rows = store.db.all<{ amount_cents: number; category: string }>(
        'SELECT amount_cents, category FROM expenses ORDER BY amount_cents',
      );
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.amount_cents)).toEqual([-150, 150]);
      expect(rows.every((r) => r.category === 'SUPPLIES')).toBe(true);
    });
  });

  it('restores the business income the expense consumed, so tax reserves against the truth', () => {
    withStore((store) => {
      const expenseId = spendOnSupplies(store);
      expect(store.state().ytdNetBusinessIncomeCents).toBe(-150);

      store.commit({
        type: 'ADJUSTMENT',
        account: 'LIQUID',
        amountCents: 150,
        reason: 'smoke test data',
        reversesEventId: expenseId,
        occurredAt: T0,
      });
      expect(store.state().ytdNetBusinessIncomeCents).toBe(0);
    });
  });

  it('survives reconciliation — the store scan and the engine replay still agree', () => {
    withStore((store) => {
      const expenseId = spendOnSupplies(store);
      store.commit({
        type: 'ADJUSTMENT',
        account: 'LIQUID',
        amountCents: 150,
        reason: 'smoke test data',
        reversesEventId: expenseId,
        occurredAt: T0,
      });
      // Two genuinely different derivations of ytd business income. If only one
      // side learned about reversals, this is what catches it.
      expect(reconcile(store)).toEqual({ ok: true, differences: [] });
    });
  });

  it('allows a partial reversal and nets the table to the remainder', () => {
    withStore((store) => {
      const expenseId = spendOnSupplies(store, 500);
      store.commit({
        type: 'ADJUSTMENT',
        account: 'LIQUID',
        amountCents: 200,
        reason: 'overcharged by $2',
        reversesEventId: expenseId,
        occurredAt: T0,
      });
      expect(suppliesTotal(store)).toBe(300);
      expect(profitReport(store.db).businessExpenseCents).toBe(300);
    });
  });

  it('refuses to reverse more than is outstanding, across several reversals', () => {
    withStore((store) => {
      const expenseId = spendOnSupplies(store, 500);
      const reverse = (amountCents: number) =>
        store.commit({
          type: 'ADJUSTMENT',
          account: 'LIQUID',
          amountCents,
          reason: 'partial refund',
          reversesEventId: expenseId,
          occurredAt: T0,
        });
      reverse(200);
      reverse(200);
      // 100 left. Asking for 101 would invent income out of a correction.
      expect(() => reverse(101)).toThrow(EngineError);
      expect(() => reverse(101)).toThrow(/100 cents of expense/);
      reverse(100);
      expect(suppliesTotal(store)).toBe(0);
    });
  });

  it('refuses an unknown event and a non-expense event', () => {
    withStore((store) => {
      const saleless = () =>
        store.commit({
          type: 'ADJUSTMENT',
          account: 'LIQUID',
          amountCents: 100,
          reason: 'x',
          reversesEventId: 'no-such-event',
          occurredAt: T0,
        });
      expect(saleless).toThrow(/no event no-such-event to reverse/);

      const contributionId = store.events()[0]!.event_id;
      expect(() =>
        store.commit({
          type: 'ADJUSTMENT',
          account: 'LIQUID',
          amountCents: 100,
          reason: 'x',
          reversesEventId: contributionId,
          occurredAt: T0,
        }),
      ).toThrow(/only a BUSINESS_EXPENSE can be reversed/);
    });
  });

  it('refuses a reversal that is not cash coming back', () => {
    withStore((store) => {
      const expenseId = spendOnSupplies(store);
      expect(() =>
        store.commit({
          type: 'ADJUSTMENT',
          account: 'OPERATING_RESERVE',
          amountCents: 150,
          reason: 'x',
          reversesEventId: expenseId,
          occurredAt: T0,
        }),
      ).toThrow(/the account must be LIQUID/);
      expect(() =>
        store.commit({
          type: 'ADJUSTMENT',
          account: 'LIQUID',
          amountCents: -150,
          reason: 'x',
          reversesEventId: expenseId,
          occurredAt: T0,
        }),
      ).toThrow(/must be positive/);
    });
  });

  it('leaves an unlinked adjustment alone — it is not claiming to reverse anything', () => {
    withStore((store) => {
      spendOnSupplies(store);
      store.commit({
        type: 'ADJUSTMENT',
        account: 'LIQUID',
        amountCents: 25,
        reason: 'found a quarter',
        occurredAt: T0,
      });
      // No compensating row, no business-income change: this is a cash
      // correction, not an expense reversal, and conflating them would make
      // every adjustment silently rewrite the expense history.
      expect(suppliesTotal(store)).toBe(150);
      expect(store.state().ytdNetBusinessIncomeCents).toBe(-150);
    });
  });
});

describe('expenseReversalDrift — the control on the two sources of truth', () => {
  it('is clean for ordinary expenses and for reversed ones', () => {
    withStore((store) => {
      spendOnSupplies(store, 300);
      const reversed = spendOnSupplies(store, 150);
      store.commit({
        type: 'ADJUSTMENT',
        account: 'LIQUID',
        amountCents: 150,
        reason: 'reversed',
        reversesEventId: reversed,
        occurredAt: T0,
      });
      expect(expenseReversalDrift(store.db)).toEqual([]);
    });
  });

  it('catches a table that no longer matches the ledger', () => {
    withStore((store) => {
      const expenseId = spendOnSupplies(store, 300);
      expect(expenseReversalDrift(store.db)).toEqual([]);

      // PLANT: exactly the old B33 shape — the ledger says the money came back,
      // the expenses table still says it was spent. Written directly, because
      // no command can produce this state any more.
      store.db.run(
        `INSERT INTO ledger_postings (event_id, seq, account, amount_cents, memo)
         VALUES (?,?,?,?,?)`,
        [expenseId, 9, 'LIQUID', 300, 'planted'],
      );

      const drift = expenseReversalDrift(store.db);
      expect(drift).toHaveLength(1);
      expect(drift[0]).toEqual({ eventId: expenseId, ledgerCents: 0, tableCents: 300 });
    });
  });

  it('catches a compensating row that was never written', () => {
    withStore((store) => {
      const expenseId = spendOnSupplies(store, 300);
      store.commit({
        type: 'ADJUSTMENT',
        account: 'LIQUID',
        amountCents: 300,
        reason: 'reversed',
        reversesEventId: expenseId,
        occurredAt: T0,
      });
      expect(expenseReversalDrift(store.db)).toEqual([]);

      // PLANT the other direction: the ledger reversal stands, the analytic
      // compensation is gone. This is what a regression in `#writeExpenses`
      // would look like.
      store.db.run('DELETE FROM expenses WHERE reverses_event_id = ?', [expenseId]);

      const drift = expenseReversalDrift(store.db);
      expect(drift).toHaveLength(1);
      expect(drift[0]).toEqual({ eventId: expenseId, ledgerCents: 0, tableCents: 300 });
    });
  });
});

describe('reconcile reads a cold derivation, not the write cache', () => {
  it('catches a corruption on the STORE side of the comparison', () => {
    withStore((store) => {
      store.commit({
        type: 'BUSINESS_EXPENSE',
        amountCents: 150,
        category: 'SUPPLIES',
        occurredAt: T0,
      });
      expect(reconcile(store).ok).toBe(true);

      // PLANT on the side reconcile is supposed to be checking: the postings
      // scan. `commit()` caches the engine's state, so for as long as
      // `reconcile` read `state()` this comparison was engine-vs-engine and a
      // corruption here passed every test in the suite.
      // BALANCED, deliberately. An unbalanced pair trips INV_IDENTITY inside
      // the cold load and never reaches the comparison — that is a different
      // control doing its job, not this one.
      store.db.run(
        `INSERT INTO ledger_postings (event_id, seq, account, amount_cents, memo)
         VALUES (?,?,?,?,?)`,
        ['evt_000002', 8, 'LIQUID', 12_345, 'planted'],
      );
      store.db.run(
        `INSERT INTO ledger_postings (event_id, seq, account, amount_cents, memo)
         VALUES (?,?,?,?,?)`,
        ['evt_000002', 9, 'RETAINED_EARNINGS', -12_345, 'planted'],
      );

      const report = reconcile(store);
      expect(report.ok).toBe(false);
      expect(report.differences.join(' ')).toMatch(/LIQUID/);
    });
  });

  it('still agrees with the cached state when nothing is corrupt', () => {
    withStore((store) => {
      store.commit({
        type: 'BUSINESS_EXPENSE',
        amountCents: 150,
        category: 'SUPPLIES',
        occurredAt: T0,
      });
      // The cache is an optimisation, not a second answer.
      expect(store.derivedState().balances).toEqual(store.state().balances);
      expect(store.derivedState().ytdNetBusinessIncomeCents).toBe(
        store.state().ytdNetBusinessIncomeCents,
      );
    });
  });
});
