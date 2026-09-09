/**
 * What the fund is holding, and what has gone stale.
 *
 * `now` is a parameter rather than a clock read, so these assert what the
 * screen says on a specific day without mocking time.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FundStore } from '@/db/store.js';
import { openDb } from '@/db/driver.js';
import { migrate } from '@/db/migrate.js';
import { inventoryView } from '@/server/inventory.js';
import { WITH_JOB, T0 } from './helpers.js';

const DAY = 86_400_000;
const T0_MS = Date.parse(T0);

function fixedClock(): () => string {
  let n = 0;
  return () => `2026-09-08T12:00:${String(n++).padStart(2, '0')}.000Z`;
}

function withFund(fn: (store: FundStore, buy: (id: string, days: number, price?: number) => void) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'resale-inv-'));
  try {
    const db = openDb(join(dir, 'test.db'));
    migrate(db, T0);
    const store = new FundStore(db, fixedClock());
    store.ensureSeeded();
    store.setTaxProfile(WITH_JOB);
    store.commit({ type: 'CONTRIBUTION', amountCents: 200_000, occurredAt: T0 });
    const buy = (id: string, expectedDaysToSale: number, price = 1_500) =>
      store.commit({
        type: 'PURCHASE', itemId: id, name: id, category: 'TOYS',
        purchasePriceCents: price, expectedDaysToSale, expectedResaleCents: 3_900,
        occurredAt: T0,
      });
    try { fn(store, buy); } finally { store.close(); }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

describe('inventory', () => {
  it('is empty before anything is bought', () => {
    withFund((store) => {
      const v = inventoryView(store, T0_MS);
      expect(v.empty).toBe(true);
      expect(v.count).toBe(0);
      expect(v.totalBookValue.cents).toBe(0);
    });
  });

  it('shows only what still holds capital', () => {
    withFund((store, buy) => {
      buy('held', 10);
      buy('sold', 10);
      store.commit({
        type: 'SALE', itemId: 'sold', grossProceedsCents: 3_900,
        marketplaceFeeCents: 557, outboundShippingCents: 500, daysToSale: 7, occurredAt: T0,
      });
      // A sold item is history, and history is the performance screen's job.
      expect(inventoryView(store, T0_MS).rows.map((r) => r.id)).toEqual(['held']);
    });
  });

  it('counts days held from the acquisition date, not from a clock', () => {
    withFund((store, buy) => {
      buy('a', 10);
      expect(inventoryView(store, T0_MS).rows[0]!.daysHeld).toBe(0);
      expect(inventoryView(store, T0_MS + 5 * DAY).rows[0]!.daysHeld).toBe(5);
      expect(inventoryView(store, T0_MS + 40 * DAY).rows[0]!.daysHeld).toBe(40);
    });
  });

  it('flags an item past its expected hold, and only then', () => {
    withFund((store, buy) => {
      buy('a', 10);
      const at = (d: number) => inventoryView(store, T0_MS + d * DAY).rows[0]!;
      expect(at(10).overdue).toBe(false); // on the day it was due: not yet late
      expect(at(11).overdue).toBe(true);
      expect(at(11).daysOverdue).toBe(1);
      expect(at(10).daysOverdue).toBe(0);
    });
  });

  it('sorts the most overdue first — that is what to act on', () => {
    withFund((store, buy) => {
      buy('slow', 5);
      buy('fast', 60);
      const rows = inventoryView(store, T0_MS + 30 * DAY).rows;
      expect(rows[0]!.id).toBe('slow');
      expect(rows[0]!.daysOverdue).toBe(25);
      expect(rows[1]!.overdue).toBe(false);
    });
  });

  it('totals the capital that is not working', () => {
    withFund((store, buy) => {
      buy('slow', 5, 2_000);
      buy('fine', 90, 3_000);
      const v = inventoryView(store, T0_MS + 30 * DAY);
      expect(v.count).toBe(2);
      expect(v.totalBookValue.cents).toBe(5_000);
      expect(v.overdueCount).toBe(1);
      // Only the overdue item's capital, not the whole book.
      expect(v.overdueBookValue.cents).toBe(2_000);
    });
  });
});
