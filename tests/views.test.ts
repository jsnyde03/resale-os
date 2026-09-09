/**
 * The view layer, and the one property that matters about it: it does not
 * compute anything.
 *
 * Every assertion here compares a view field against the pure function that
 * owns that number. That is deliberately not an independent derivation — it
 * cannot be, because the whole point is that there is only one. What it catches
 * is a view that starts doing arithmetic of its own, which is how a dashboard
 * and a CLI end up disagreeing about NAV.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FundStore } from '@/db/store.js';
import { openDb } from '@/db/driver.js';
import { migrate } from '@/db/migrate.js';
import { computeMetrics } from '@/core/capital/metrics.js';
import { profitReport } from '@/db/reporting.js';
import { formatCents } from '@/core/money.js';
import {
  dashboardView,
  headlineView,
  integrityView,
  profitView,
  taxView,
  accuracyView,
  money,
} from '@/server/views.js';
import { WITH_JOB, T0 } from './helpers.js';

function fixedClock(): () => string {
  let n = 0;
  return () => `2026-09-08T12:00:${String(n++).padStart(2, '0')}.000Z`;
}

/** A fund with real activity, so the views have something to be wrong about. */
function withFund(fn: (store: FundStore) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'resale-views-'));
  try {
    const db = openDb(join(dir, 'test.db'));
    migrate(db, T0);
    const store = new FundStore(db, fixedClock());
    store.ensureSeeded();
    store.setTaxProfile(WITH_JOB);
    store.commit({ type: 'CONTRIBUTION', amountCents: 50_000, occurredAt: T0 });
    store.commit({
      type: 'PURCHASE',
      itemId: 'pin-01',
      name: 'pin',
      category: 'DISNEY_PINS',
      purchasePriceCents: 1_500,
      expectedDaysToSale: 8,
      expectedResaleCents: 3_900,
      occurredAt: T0,
    });
    store.commit({
      type: 'SALE',
      itemId: 'pin-01',
      grossProceedsCents: 3_900,
      marketplaceFeeCents: 557,
      outboundShippingCents: 500,
      daysToSale: 7,
      occurredAt: T0,
    });
    store.commit({
      type: 'BUSINESS_EXPENSE',
      amountCents: 899,
      category: 'PACKAGING',
      occurredAt: T0,
    });
    try {
      fn(store);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

describe('the view layer reports, it does not compute', () => {
  it('headline fields come straight from computeMetrics', () => {
    withFund((store) => {
      const m = computeMetrics(store.state());
      const v = headlineView(store);
      expect(v.nav.cents).toBe(m.navCents);
      expect(v.liquid.cents).toBe(m.liquidCents);
      expect(v.inventoryAtCost.cents).toBe(m.inventoryAtCostCents);
      expect(v.earmarked.cents).toBe(m.earmarkedCents);
      expect(v.deployable.cents).toBe(m.deployableCapitalCents);
      expect(v.unencumberedCash.cents).toBe(m.unencumberedCashCents);
      expect(v.taxReserve.cents).toBe(m.taxReserveCents);
      expect(v.operatingReserve.cents).toBe(m.operatingReserveCents);
      expect(v.ownerPayable.cents).toBe(m.ownerPayableCents);
      expect(v.mode).toBe(m.mode);
      expect(v.maxPerItem.cents).toBe(m.maxCapitalPerItemCents);
      expect(v.maxHoldDays).toBe(m.modePolicy.maxHoldDays);
      expect(v.minExpectedProfit.cents).toBe(m.modePolicy.minExpectedProfitCents);
      expect(v.activeItems).toBe(m.activeItemCount);
    });
  });

  it('profit fields come straight from profitReport', () => {
    withFund((store) => {
      const r = profitReport(store.db);
      const v = profitView(store);
      expect(v.itemProfit.cents).toBe(r.itemProfitCents);
      expect(v.businessExpenses.cents).toBe(r.businessExpenseCents);
      expect(v.operatingProfit.cents).toBe(r.operatingProfitCents);
      expect(v.taxReserve.cents).toBe(r.taxReserveCents);
      expect(v.ownerDistributable.cents).toBe(r.ownerDistributableCents);
      expect(v.realisedRoi).toBe(r.realisedRoiBps);
      // Not zero, or the assertions above are comparing nothing to nothing.
      expect(r.itemProfitCents).toBeGreaterThan(0);
      expect(r.businessExpenseCents).toBe(899);
    });
  });

  it('formats money with the one formatter, never by dividing by 100', () => {
    expect(money(-1_234).text).toBe(formatCents(-1_234));
    expect(money(0).text).toBe(formatCents(0));
    expect(money(50_000).text).toBe(formatCents(50_000));
    // The trap this guards: a hand-rolled formatter renders negative zero.
    expect(money(-0).text).toBe(money(0).text);
  });

  it('carries tax-warning severity rather than flattening it to strings', () => {
    withFund((store) => {
      const v = taxView(store);
      // ⚠️ There are legitimately NO warnings now that the 2026 tables are
      // verified and current — this used to assert `length > 0`, which was only
      // ever true because the tables were unverified. Assert the shape when
      // there is something to show, and the silence when there is not.
      for (const w of v.warnings) {
        expect(typeof w.message).toBe('string');
        expect(['warn', 'info']).toContain(w.severity);
      }
      expect(v.warnings).toEqual([]);
      expect(v.incomeTaxAbstained).toBe(false);
    });
  });

  it('abstains visibly when there is no tax profile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resale-views-'));
    try {
      const db = openDb(join(dir, 'test.db'));
      migrate(db, T0);
      const store = new FundStore(db, fixedClock());
      store.ensureSeeded();
      store.commit({ type: 'CONTRIBUTION', amountCents: 50_000, occurredAt: T0 });
      // A confident wrong number is worse than an honest gap, and the screen
      // has to be able to say which it is showing.
      expect(taxView(store).incomeTaxAbstained).toBe(true);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});

describe('integrity is on the dashboard, not behind a subcommand', () => {
  it('is ok on a healthy ledger', () => {
    withFund((store) => {
      const v = integrityView(store);
      expect(v.chainOk).toBe(true);
      expect(v.replayOk).toBe(true);
      expect(v.expenseDriftOk).toBe(true);
      expect(v.ok).toBe(true);
    });
  });

  it('goes not-ok when the hash chain is broken', () => {
    withFund((store) => {
      // PLANT: a hand edit of the kind the chain exists to detect.
      store.db.run("UPDATE ledger_events SET memo = 'tampered' WHERE event_id = 'evt_000002'");
      const v = integrityView(store);
      expect(v.chainOk).toBe(false);
      expect(v.chainBrokenAt).toBe('evt_000002');
      expect(v.ok).toBe(false);
    });
  });

  it('stays ok when only the BACKUP is stale', () => {
    withFund((store) => {
      // A stale backup is a risk to the future, not evidence that the numbers
      // on screen are wrong. Conflating them would train the operator to
      // ignore a red banner that usually means nothing.
      const v = integrityView(store);
      expect(v.backupConfigured).toBe(false);
      expect(v.ok).toBe(true);
    });
  });
});

describe('dashboardView', () => {
  it('assembles every section in one pass', () => {
    withFund((store) => {
      const v = dashboardView(store);
      expect(Object.keys(v).sort()).toEqual([
        'accuracy',
        'headline',
        'integrity',
        'profit',
        'reachability',
        'tax',
      ]);
      expect(v.headline.nav.cents).toBe(headlineView(store).nav.cents);
    });
  });
});

describe('accuracy refuses to read a trend it does not have', () => {
  /** A fund with `n` completed, predicted sales. */
  function fundWithSales(n: number, fn: (store: FundStore) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'resale-acc-'));
    try {
      const db = openDb(join(dir, 'test.db'));
      migrate(db, T0);
      const store = new FundStore(db, fixedClock());
      store.ensureSeeded();
      store.setTaxProfile(WITH_JOB);
      store.commit({ type: 'CONTRIBUTION', amountCents: 500_000, occurredAt: T0 });
      for (let i = 0; i < n; i++) {
        store.commit({
          type: 'PURCHASE', itemId: `i-${i}`, name: `i-${i}`, category: 'TOYS',
          purchasePriceCents: 1_500, expectedDaysToSale: 8, expectedResaleCents: 3_900,
          expectedNetProceedsCents: 2_800, expectedProfitCents: 1_300, occurredAt: T0,
        });
        store.commit({
          type: 'SALE', itemId: `i-${i}`, grossProceedsCents: 3_900,
          marketplaceFeeCents: 557, outboundShippingCents: 500, daysToSale: 7, occurredAt: T0,
        });
      }
      try { fn(store); } finally { store.close(); }
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  }

  it('is unreadable with no sales, and says so rather than showing zeroes', () => {
    fundWithSales(0, (store) => {
      const a = accuracyView(store);
      expect(a.n).toBe(0);
      expect(a.readable).toBe(false);
      expect(a.verdict).toMatch(/no sales yet|no scored predictions/);
    });
  });

  it('is still unreadable at four sales — a trend from four is noise', () => {
    // ⛔ The threshold matches `accuracyVerdict`'s own. A screen drawing a
    // confident curve while the engine says "too few" would be a second,
    // more optimistic answer to the same question.
    fundWithSales(4, (store) => {
      const a = accuracyView(store);
      expect(a.n).toBe(4);
      expect(a.readable).toBe(false);
      expect(a.verdict).toContain('too few');
    });
  });

  it('becomes readable at five, and the totals are real', () => {
    fundWithSales(5, (store) => {
      const a = accuracyView(store);
      expect(a.n).toBe(5);
      expect(a.readable).toBe(true);
      expect(a.verdict).not.toContain('too few');
      expect(a.totalExpectedProfit.cents).toBeGreaterThan(0);
      expect(a.totalActualProfit.cents).toBeGreaterThan(0);
      expect(a.profitRealisationBps).toBeGreaterThan(0);
    });
  });
});
