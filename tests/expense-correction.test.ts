/**
 * D9: a correction to the books that moves no money.
 *
 * Two shapes, and the difference matters. **Reclassifying** moves an expense
 * between categories — the money was spent, just recorded wrongly, so the total
 * never changes. **Settling** removes an expense because its cash already came
 * back through an event that never declared what it was reversing, which is the
 * live book's $1.50 of smoke-test SUPPLIES.
 *
 * Settling is the dangerous one: nothing in the ledger moves, so nothing in the
 * ledger will contradict it afterwards. Most of the tests here are about the
 * guards on that.
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
  const dir = mkdtempSync(join(tmpdir(), 'resale-correction-'));
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
      store.close();
    }
  } finally {
      // ⚠️ `maxRetries` is NOT leak protection — measured in
      // `reporting.test.ts`, where the reasoning lives. 6.9.3.
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

function spend(store: FundStore, amountCents: number, category = 'SUPPLIES'): string {
  return store.commit({
    type: 'BUSINESS_EXPENSE',
    amountCents,
    category: category as 'SUPPLIES',
    occurredAt: T0,
  }).event.eventId;
}

function totals(store: FundStore): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of expenseBreakdown(store.db)) {
    out[line.category] = (out[line.category] ?? 0) + line.totalCents;
  }
  return out;
}

describe('reclassifying an expense', () => {
  it('moves the category without changing the total', () => {
    withStore((store) => {
      const id = spend(store, 500);
      store.commit({
        type: 'EXPENSE_CORRECTION',
        correctsEventId: id,
        amountCents: 500,
        reclassifyTo: 'POSTAGE',
        reason: 'this was postage, not supplies',
        occurredAt: T0,
      });

      expect(totals(store).SUPPLIES).toBe(0);
      expect(totals(store).POSTAGE).toBe(500);
      // The money was still spent. Only the label was wrong.
      expect(profitReport(store.db).businessExpenseCents).toBe(500);
      expect(expenseReversalDrift(store.db)).toEqual([]);
    });
  });

  it('moves no money and no business income', () => {
    withStore((store) => {
      const id = spend(store, 500);
      const before = store.state();
      store.commit({
        type: 'EXPENSE_CORRECTION',
        correctsEventId: id,
        amountCents: 500,
        reclassifyTo: 'POSTAGE',
        reason: 'mislabelled',
        occurredAt: T0,
      });
      const after = store.state();
      expect(after.balances).toEqual(before.balances);
      expect(after.ytdNetBusinessIncomeCents).toBe(before.ytdNetBusinessIncomeCents);
      // An event with no postings is still an event: it is in the chain, so the
      // correction is as tamper-evident as the thing it corrects.
      expect(after.eventCount).toBe(before.eventCount + 1);
      expect(store.postingsFor('evt_000003')).toEqual([]);
      expect(store.verifyChain()).toEqual({ ok: true });
    });
  });

  it('can reclassify part of an expense', () => {
    withStore((store) => {
      const id = spend(store, 500);
      store.commit({
        type: 'EXPENSE_CORRECTION',
        correctsEventId: id,
        amountCents: 200,
        reclassifyTo: 'POSTAGE',
        reason: 'part of it was postage',
        occurredAt: T0,
      });
      expect(totals(store).SUPPLIES).toBe(300);
      expect(totals(store).POSTAGE).toBe(200);
      expect(profitReport(store.db).businessExpenseCents).toBe(500);
    });
  });
});

describe('settling an expense whose cash already came back', () => {
  /** The live book's shape: an ADJUSTMENT that returned the money but declared nothing. */
  function undeclaredReturn(store: FundStore, amountCents: number): string {
    return store.commit({
      type: 'ADJUSTMENT',
      account: 'LIQUID',
      amountCents,
      reason: 'reverse smoke-test expenses',
      occurredAt: T0,
    }).event.eventId;
  }

  it('clears the books without moving cash a second time', () => {
    withStore((store) => {
      const expenseId = spend(store, 150);
      const returnId = undeclaredReturn(store, 150);

      // The state the live fund is in: ledger right, books wrong.
      expect(store.derivedState().balances.LIQUID).toBe(5_000);
      expect(profitReport(store.db).businessExpenseCents).toBe(150);
      expect(store.derivedState().ytdNetBusinessIncomeCents).toBe(-150);

      store.commit({
        type: 'EXPENSE_CORRECTION',
        correctsEventId: expenseId,
        amountCents: 150,
        settledByEventId: returnId,
        reason: 'cash returned by the adjustment above',
        occurredAt: T0,
      });

      expect(store.derivedState().balances.LIQUID).toBe(5_000);
      expect(profitReport(store.db).businessExpenseCents).toBe(0);
      expect(profitReport(store.db).operatingProfitCents).toBe(0);
      expect(store.derivedState().ytdNetBusinessIncomeCents).toBe(0);
      expect(expenseReversalDrift(store.db)).toEqual([]);
      expect(reconcile(store)).toEqual({ ok: true, differences: [] });
    });
  });

  it('refuses to claim more cash than the named event returned', () => {
    withStore((store) => {
      const expenseId = spend(store, 500);
      const returnId = undeclaredReturn(store, 200);
      expect(() =>
        store.commit({
          type: 'EXPENSE_CORRECTION',
          correctsEventId: expenseId,
          amountCents: 500,
          settledByEventId: returnId,
          reason: 'x',
          occurredAt: T0,
        }),
      ).toThrow(/returned 200 cents/);
    });
  });

  it('refuses to spend the same returned dollar twice', () => {
    withStore((store) => {
      const first = spend(store, 300);
      const second = spend(store, 300);
      const returnId = undeclaredReturn(store, 300);

      store.commit({
        type: 'EXPENSE_CORRECTION',
        correctsEventId: first,
        amountCents: 300,
        settledByEventId: returnId,
        reason: 'settled',
        occurredAt: T0,
      });
      // The $3.00 is spent. The second expense cannot also claim it, or the
      // books would drop $6.00 of expense against $3.00 of returned cash.
      expect(() =>
        store.commit({
          type: 'EXPENSE_CORRECTION',
          correctsEventId: second,
          amountCents: 300,
          settledByEventId: returnId,
          reason: 'settled again',
          occurredAt: T0,
        }),
      ).toThrow(/300 are already claimed/);
    });
  });

  it('lets one return settle several expenses up to its total', () => {
    withStore((store) => {
      const first = spend(store, 100);
      const second = spend(store, 50);
      const returnId = undeclaredReturn(store, 150);
      const settle = (id: string, amountCents: number) =>
        store.commit({
          type: 'EXPENSE_CORRECTION',
          correctsEventId: id,
          amountCents,
          settledByEventId: returnId,
          reason: 'settled',
          occurredAt: T0,
        });
      settle(first, 100);
      settle(second, 50);
      expect(profitReport(store.db).businessExpenseCents).toBe(0);
      expect(store.derivedState().ytdNetBusinessIncomeCents).toBe(0);
      expect(expenseReversalDrift(store.db)).toEqual([]);
    });
  });

  it('refuses an event that returned no cash', () => {
    withStore((store) => {
      const expenseId = spend(store, 150);
      const otherExpense = spend(store, 100);
      expect(() =>
        store.commit({
          type: 'EXPENSE_CORRECTION',
          correctsEventId: expenseId,
          amountCents: 100,
          settledByEventId: otherExpense,
          reason: 'x',
          occurredAt: T0,
        }),
      ).toThrow(/returned no cash/);
    });
  });

  it('refuses to let an expense settle itself', () => {
    withStore((store) => {
      const expenseId = spend(store, 150);
      expect(() =>
        store.commit({
          type: 'EXPENSE_CORRECTION',
          correctsEventId: expenseId,
          amountCents: 150,
          settledByEventId: expenseId,
          reason: 'x',
          occurredAt: T0,
        }),
      ).toThrow(/cannot settle itself/);
    });
  });
});

describe('what a correction refuses outright', () => {
  it('requires exactly one of reclassify and settle', () => {
    withStore((store) => {
      const id = spend(store, 150);
      const base = {
        type: 'EXPENSE_CORRECTION',
        correctsEventId: id,
        amountCents: 150,
        reason: 'x',
        occurredAt: T0,
      } as const;
      // Neither: this would silently drop an expense the ledger still says was
      // paid — the drift B33 closed, walked back in through the repair path.
      expect(() => store.commit({ ...base })).toThrow(/exactly one/);
      expect(() =>
        store.commit({ ...base, reclassifyTo: 'POSTAGE', settledByEventId: 'evt_000001' }),
      ).toThrow(/exactly one/);
    });
  });

  it('refuses zero, a missing reason, an unknown event and a non-expense', () => {
    withStore((store) => {
      const id = spend(store, 150);
      expect(() =>
        store.commit({
          type: 'EXPENSE_CORRECTION',
          correctsEventId: id,
          amountCents: 0,
          reclassifyTo: 'POSTAGE',
          reason: 'x',
          occurredAt: T0,
        }),
      ).toThrow(/corrects nothing/);
      expect(() =>
        store.commit({
          type: 'EXPENSE_CORRECTION',
          correctsEventId: id,
          amountCents: 150,
          reclassifyTo: 'POSTAGE',
          reason: '   ',
          occurredAt: T0,
        }),
      ).toThrow(/requires a reason/);
      expect(() =>
        store.commit({
          type: 'EXPENSE_CORRECTION',
          correctsEventId: 'evt_999999',
          amountCents: 150,
          reclassifyTo: 'POSTAGE',
          reason: 'x',
          occurredAt: T0,
        }),
      ).toThrow(/no event evt_999999 to correct/);
      expect(() =>
        store.commit({
          type: 'EXPENSE_CORRECTION',
          correctsEventId: 'evt_000001',
          amountCents: 150,
          reclassifyTo: 'POSTAGE',
          reason: 'x',
          occurredAt: T0,
        }),
      ).toThrow(/only a BUSINESS_EXPENSE can be corrected/);
    });
  });

  it('refuses to correct more than is outstanding', () => {
    withStore((store) => {
      const id = spend(store, 150);
      expect(() =>
        store.commit({
          type: 'EXPENSE_CORRECTION',
          correctsEventId: id,
          amountCents: 151,
          reclassifyTo: 'POSTAGE',
          reason: 'x',
          occurredAt: T0,
        }),
      ).toThrow(EngineError);
      expect(() =>
        store.commit({
          type: 'EXPENSE_CORRECTION',
          correctsEventId: id,
          amountCents: 151,
          reclassifyTo: 'POSTAGE',
          reason: 'x',
          occurredAt: T0,
        }),
      ).toThrow(/150 cents of expense/);
    });
  });

  it('counts a prior reversal against what is still correctable', () => {
    withStore((store) => {
      const id = spend(store, 500);
      store.commit({
        type: 'ADJUSTMENT',
        account: 'LIQUID',
        amountCents: 300,
        reason: 'partial refund',
        reversesEventId: id,
        occurredAt: T0,
      });
      // $2.00 left, not $5.00. The two mechanisms share one notion of outstanding.
      expect(() =>
        store.commit({
          type: 'EXPENSE_CORRECTION',
          correctsEventId: id,
          amountCents: 300,
          reclassifyTo: 'POSTAGE',
          reason: 'x',
          occurredAt: T0,
        }),
      ).toThrow(/200 cents of expense/);
    });
  });
});
