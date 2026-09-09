/**
 * A day on the phone, executed against whatever SQLite is underneath.
 *
 * ⛔ **The third contract.** `driver-contract` proves the five methods behave
 * the same; `engine-scenario` proves the store built on them does; this proves
 * the sequence a person actually performs does — buy, sell, spend, adjust —
 * driven through the same pure form models the screens are made of.
 *
 * ⚠️ It is expressed as data, with no test-framework import, for the same
 * reason the other two are: Vitest does not exist on a device, and a copied
 * suite would agree with itself and prove nothing.
 *
 * ⚠️ **This is not a rendering test.** It cannot see whether the price box is
 * wired to `price`. It runs everything after that point on Apple's SQLite, in
 * Hermes, in order, against a real ledger — which is what a rendering test
 * cannot do.
 */

import type { Db } from './db-types.js';
import { FundStore } from './store.js';
import { migrateWith } from './migrate-core.js';
import { reconcile } from './replay.js';
import { computeMetrics } from '../core/capital/metrics.js';
import { assessQuote, purchaseCommandFrom } from '../core/capital/quote.js';
import { itemIdFrom } from '../core/ids.js';
import { adjustModel, sellModel, spendModel } from '../ui/forms.js';
import { profitReport } from './reporting.js';
import { makeVerifiedBackup } from './backup-portable.js';
import { importLedger, type LedgerExport } from './portable.js';
import type { TaxProfile } from '../core/tax/profile.js';
import type { ScenarioCase } from './engine-scenario.js';

const T0 = '2026-09-09T12:00:00.000Z';
const T30 = '2026-10-09T12:00:00.000Z';

const PROFILE: TaxProfile = {
  configured: true,
  filingStatus: 'SINGLE',
  expectedOtherIncomeCents: 6_000_000,
  expectedW2WagesCents: 6_000_000,
  stateIncomeTaxBps: 0,
  stateRateBasis: null,
  itemizedDeductionCents: null,
  claimQbiDeduction: true,
  stateAllowsQbiDeduction: false,
};

class ScreenFailure extends Error {}

function eq(actual: unknown, expected: unknown, what: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new ScreenFailure(`${what}: expected ${e}, got ${a}`);
}

function ok(condition: boolean, what: string): void {
  if (!condition) throw new ScreenFailure(what);
}

/** A funded store, the way the app has one after an import. */
function funded(db: Db, cents: number): FundStore {
  migrateWith(db, T0);
  let n = 0;
  const store = new FundStore(db, () => `2026-09-09T12:00:${String(n++).padStart(2, '0')}.000Z`);
  store.ensureSeeded();
  store.setTaxProfile(PROFILE);
  store.commit({ type: 'CONTRIBUTION', amountCents: cents, occurredAt: T0 });
  return store;
}

/** What the buy screen does, minus the typing. */
function buy(
  store: FundStore,
  fields: { name: string; category: string; price: number; resale: number; sold: number },
  override?: { reason: string },
): { itemId: string; failures: string[] } {
  const input = {
    category: fields.category,
    purchasePriceCents: fields.price,
    expectedGrossCents: fields.resale,
    soldLast90Days: fields.sold,
    activeListings: 10,
  };
  const { quote, assessment } = assessQuote(store.state(), input);
  const failures = assessment.failures.map((f) => f.code);
  const itemId = itemIdFrom(fields.name, store.state().eventCount);
  store.commit(
    purchaseCommandFrom(input, quote, {
      itemId,
      name: fields.name,
      occurredAt: T0,
      ...(override ? { override: { gates: failures, reason: override.reason } } : {}),
    }),
  );
  return { itemId, failures };
}

export const SCREEN_SCENARIO: readonly ScenarioCase[] = [
  {
    name: 'buy: a clean purchase moves the money and records no override',
    run: (db) => {
      const store = funded(db, 50_000);
      const { itemId, failures } = buy(store, {
        name: 'Lego set',
        category: 'TOYS',
        price: 1_000,
        resale: 4_000,
        sold: 90,
      });
      eq(failures, [], 'a purchase this size should pass every gate');
      eq(store.state().balances.INVENTORY_AT_COST, 1_000, 'inventory after the buy');
      eq(store.state().balances.LIQUID, 49_000, 'liquid after the buy');
      const item = store.derivedState().items[itemId];
      ok(item !== undefined, 'the item should exist on disk');
      eq(item?.overrodeGates, undefined, 'a clean purchase records no override');
    },
  },
  {
    // D4, through the exact path the screen uses.
    name: 'buy: an override with no reason is refused, and nothing is written',
    run: (db) => {
      const store = funded(db, 5_000);
      const before = store.state().eventCount;
      let refused = false;
      try {
        buy(
          store,
          { name: 'too big', category: 'TOYS', price: 4_000, resale: 12_000, sold: 90 },
          { reason: '   ' },
        );
      } catch {
        refused = true;
      }
      ok(refused, 'an override with no reason must be refused');
      store.invalidate();
      eq(store.state().eventCount, before, 'a refusal must leave the ledger untouched');
    },
  },
  {
    name: 'buy: an override with a reason is recorded on the item, permanently',
    run: (db) => {
      const store = funded(db, 5_000);
      const { itemId, failures } = buy(
        store,
        { name: 'lot deal', category: 'TOYS', price: 4_000, resale: 12_000, sold: 90 },
        { reason: 'seller would not split the lot' },
      );
      ok(failures.length > 0, 'this purchase should have failed a gate');
      const item = store.derivedState().items[itemId];
      eq(item?.overrideReason, 'seller would not split the lot', 'the reason, read off disk');
      ok((item?.overrodeGates ?? []).includes('MAX_PER_ITEM_EXCEEDED'), 'the gate it overruled');
    },
  },
  {
    name: 'sell: the form model records the sale and the hold it derived',
    run: (db) => {
      const store = funded(db, 50_000);
      const { itemId } = buy(store, {
        name: 'Lego set',
        category: 'TOYS',
        price: 1_000,
        resale: 4_000,
        sold: 90,
      });
      const item = store.state().items[itemId];
      ok(item !== undefined, 'the item should exist');

      const model = sellModel(item!, {
        gross: '40.00',
        fee: '5.70',
        postage: '5.00',
        packaging: '0.35',
      });
      eq(model.netCents, 2_895, 'net of the three costs');
      eq(model.profitCents, 1_895, 'profit over the book value');

      const command = model.command(T30);
      ok(command !== null, 'a priced sale should build a command');
      store.commit(command!);

      const sold = store.derivedState().items[itemId];
      eq(sold?.state, 'SOLD', 'the item should be sold');
      // ⛔ 30 days, derived from the two timestamps. `accuracy` ignores a sale
      // whose hold is undefined.
      eq(sold?.daysToSale, 30, 'the hold, derived rather than typed');
      eq(store.state().balances.INVENTORY_AT_COST, 0, 'nothing left on the shelf');
      eq(reconcile(store), { ok: true, differences: [] }, 'reconcile after a sale');
    },
  },
  {
    name: 'spend: an expense reduces profit and lands in the expense projection',
    run: (db) => {
      const store = funded(db, 50_000);
      const model = spendModel({
        kind: 'EXPENSE',
        amount: '4.50',
        category: 'POSTAGE',
        itemId: null,
      });
      ok(model.ready, 'an expense with an amount and a category is ready');
      store.commit(model.command(T0)!);

      eq(store.state().balances.LIQUID, 49_550, 'liquid after the expense');
      eq(profitReport(db).businessExpenseCents, 450, 'the analytic expense row');
      eq(reconcile(store), { ok: true, differences: [] }, 'reconcile after an expense');
    },
  },
  {
    name: 'spend: a payout is refused above what is payable, and nothing is written',
    run: (db) => {
      const store = funded(db, 50_000);
      const payable = computeMetrics(store.state()).ownerPayableCents;
      eq(payable, 0, 'a fund that has sold nothing owes its owner nothing');

      const before = store.state().eventCount;
      const model = spendModel({ kind: 'PAYOUT', amount: '20.00', category: null, itemId: null });
      ok(model.ready, 'a payout needs no category');
      let refused = false;
      try {
        store.commit(model.command(T0)!);
      } catch {
        refused = true;
      }
      ok(refused, 'paying out more than is payable must be refused');
      store.invalidate();
      eq(store.state().eventCount, before, 'a refusal must leave the ledger untouched');
    },
  },
  {
    name: 'adjust: a correction lands, and an unexplained one is never built',
    run: (db) => {
      const store = funded(db, 50_000);

      const tooShort = adjustModel({ account: 'LIQUID', amount: '-1.50', reason: 'oops' });
      ok(!tooShort.ready, 'a four-character reason is not a reason');
      eq(tooShort.command(T0), null, 'and nothing is built from it');

      const model = adjustModel({
        account: 'LIQUID',
        amount: '-1.50',
        reason: 'miscounted the float',
      });
      store.commit(model.command(T0)!);
      eq(store.derivedState().balances.LIQUID, 49_850, 'liquid after the adjustment');
      eq(store.verifyChain(), { ok: true }, 'the chain still verifies');
      eq(reconcile(store), { ok: true, differences: [] }, 'reconcile after an adjustment');
    },
  },
  {
    // The whole point, in one case: a day's work, then the two independent
    // derivations must still agree.
    name: 'a whole day of screens leaves a ledger that reconciles',
    run: (db) => {
      const store = funded(db, 50_000);
      const { itemId } = buy(store, {
        name: 'Lego set',
        category: 'TOYS',
        price: 1_000,
        resale: 4_000,
        sold: 90,
      });
      store.commit(
        spendModel({ kind: 'EXPENSE', amount: '4.50', category: 'POSTAGE', itemId }).command(T0)!,
      );
      const item = store.state().items[itemId]!;
      store.commit(
        sellModel(item, { gross: '40.00', fee: '5.70', postage: '5.00', packaging: '0.35' })
          .command(T30)!,
      );
      store.commit(
        adjustModel({ account: 'LIQUID', amount: '-0.25', reason: 'rounding on the payout' })
          .command(T30)!,
      );

      eq(store.verifyChain(), { ok: true }, 'the chain verifies after four screens');
      eq(reconcile(store), { ok: true, differences: [] }, 'the postings agree with a replay');
      ok(computeMetrics(store.derivedState()).navCents > 0, 'the fund still has a bankroll');
    },
  },
  {
    // ⛔ 5.7. The phone holds the only current copy, so the backup is not a
    // convenience — and the artefact is only worth having if it comes back.
    // This runs the write AND the restore on whatever SQLite is underneath.
    name: 'backup: a day of work is backed up, and the backup restores to the same fund',
    run: (db, openScratch) => {
      const store = funded(db, 50_000);
      const { itemId } = buy(store, {
        name: 'Lego set',
        category: 'TOYS',
        price: 1_000,
        resale: 4_000,
        sold: 90,
      });
      const item = store.state().items[itemId]!;
      store.commit(
        sellModel(item, { gross: '40.00', fee: '5.70', postage: '5.00', packaging: '0.35' })
          .command(T30)!,
      );
      const before = computeMetrics(store.derivedState());

      // ⚡ `makeVerifiedBackup` replays into a scratch database BEFORE handing
      // back any bytes. If this build cannot rebuild the fund from its own
      // history, no file is produced.
      const backup = makeVerifiedBackup(store.db, openScratch, () => T30);
      ok(backup.events >= 3, `expected a few events, got ${backup.events}`);
      ok(backup.json.length > 0, 'the backup should have contents');

      // And the half nobody tests until they need it.
      const restored = openScratch();
      const report = importLedger(restored, JSON.parse(backup.json) as LedgerExport, () => T30);
      ok(report.hashesMatched, 'every hash should be reproduced on this platform');
      ok(report.chainOk, 'the restored chain should verify');
      ok(report.reconciled, 'the restored ledger should reconcile');
      eq(
        computeMetrics(new FundStore(restored).state()).navCents,
        before.navCents,
        'the restored fund should be the same fund',
      );
    },
  },
  {
    name: 'backup: an empty ledger is refused rather than written as an empty file',
    run: (db, openScratch) => {
      migrateWith(db, T0);
      const store = new FundStore(db, () => T0);
      store.ensureSeeded();
      let refused = false;
      try {
        makeVerifiedBackup(store.db, openScratch, () => T0);
      } catch {
        refused = true;
      }
      // ⚠️ A zero-event backup file is worse than none: it looks like a backup
      // in a directory listing, and restores to nothing.
      ok(refused, 'backing up an empty ledger must be refused');
    },
  },
];
