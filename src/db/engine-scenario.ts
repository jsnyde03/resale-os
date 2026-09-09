/**
 * A whole fund's life, run against whatever SQLite is underneath.
 *
 * ⛔ **This is the second half of the phone port's control.** The driver
 * contract proves the five methods behave the same; this proves the things
 * BUILT on them do — migrations, the append-only ledger, the hash chain, the
 * expense projection, and `reconcile()`, which compares a postings scan against
 * an engine replay.
 *
 * ⚠️ It is expressed as data, with no test-framework import, for the same
 * reason the driver contract is: Vitest does not exist on a device, and a
 * copied suite would agree with itself and prove nothing.
 *
 * ⚠️ **NOT a port of the 445 Vitest tests, and deliberately so.** Fourteen of
 * the twenty-seven test files never open a database — they exercise pure,
 * byte-identical code with no platform surface, and running them on a phone
 * would be theatre. What a different SQLite can actually break is the store,
 * and that is what this exercises.
 */

import type { Db } from './db-types.js';
import { FundStore } from './store.js';
import { migrateWith } from './migrate-core.js';
import { reconcile } from './replay.js';
import { profitReport, expenseReversalDrift } from './reporting.js';
import { exportLedger, importLedger, LedgerTransferError } from './portable.js';
import type { TaxProfile } from '../core/tax/profile.js';

const T0 = '2026-09-09T12:00:00.000Z';

const PROFILE: TaxProfile = {
  configured: true,
  filingStatus: 'SINGLE',
  expectedOtherIncomeCents: 6_000_000,
  expectedW2WagesCents: 6_000_000,
  stateIncomeTaxBps: 740,
  stateRateBasis: 'illustrative',
  itemizedDeductionCents: null,
  claimQbiDeduction: true,
  stateAllowsQbiDeduction: false,
};

export interface ScenarioCase {
  readonly name: string;
  /**
   * Throws on failure; the message is what a human reads.
   *
   * `openScratch` makes a second, empty database — the destination machine in
   * a transfer test. Passed in rather than held in module state, so a runner
   * that calls `run` directly cannot forget to provide it.
   */
  readonly run: (db: Db, openScratch: () => Db) => void;
}

class ScenarioFailure extends Error {}

function eq(actual: unknown, expected: unknown, what: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new ScenarioFailure(`${what}: expected ${e}, got ${a}`);
}

function ok(condition: boolean, what: string): void {
  if (!condition) throw new ScenarioFailure(what);
}

/** A store on a migrated database, with a deterministic clock. */
function freshStore(db: Db): FundStore {
  migrateWith(db, T0);
  let n = 0;
  const store = new FundStore(db, () => `2026-09-09T12:00:${String(n++).padStart(2, '0')}.000Z`);
  store.ensureSeeded();
  store.setTaxProfile(PROFILE);
  return store;
}

export const ENGINE_SCENARIO: readonly ScenarioCase[] = [
  {
    name: 'migrations apply, and applying twice is a no-op',
    run: (db, openScratch) => {
      const first = migrateWith(db, T0);
      ok(first.length >= 5, `expected at least 5 migrations, ran ${first.length}`);
      eq(migrateWith(db, T0), [], 'second run should apply nothing');
    },
  },
  {
    name: 'a contribution lands and the balances derive from the postings',
    run: (db, openScratch) => {
      const store = freshStore(db);
      store.commit({ type: 'CONTRIBUTION', amountCents: 50_000, occurredAt: T0 });
      eq(store.state().balances.LIQUID, 50_000, 'liquid after contribution');
      // The cache is the engine's answer; this is the postings scan.
      eq(store.derivedState().balances.LIQUID, 50_000, 'liquid, derived cold');
    },
  },
  {
    name: 'a full buy-and-sell leaves a correct, verifiable ledger',
    run: (db, openScratch) => {
      const store = freshStore(db);
      store.commit({ type: 'CONTRIBUTION', amountCents: 50_000, occurredAt: T0 });
      store.commit({
        type: 'PURCHASE',
        itemId: 'pin-01',
        name: 'pin',
        category: 'TOYS',
        purchasePriceCents: 1_500,
        expectedDaysToSale: 8,
        expectedResaleCents: 3_900,
        occurredAt: T0,
      });
      eq(store.state().balances.INVENTORY_AT_COST, 1_500, 'inventory after purchase');

      store.commit({
        type: 'SALE',
        itemId: 'pin-01',
        grossProceedsCents: 3_900,
        marketplaceFeeCents: 557,
        outboundShippingCents: 500,
        daysToSale: 7,
        occurredAt: T0,
      });
      eq(store.state().balances.INVENTORY_AT_COST, 0, 'inventory after sale');
      ok(store.state().items['pin-01']?.state === 'SOLD', 'item should be SOLD');
      eq(store.verifyChain(), { ok: true }, 'hash chain after a sale');
    },
  },
  {
    name: 'a rejected command leaves the database exactly as it was',
    run: (db, openScratch) => {
      // ⛔ The guarantee the whole transaction machinery exists for.
      const store = freshStore(db);
      store.commit({ type: 'CONTRIBUTION', amountCents: 5_000, occurredAt: T0 });
      const before = store.derivedState();
      let threw = false;
      try {
        store.commit({ type: 'OWNER_PAYOUT', amountCents: 999_999, occurredAt: T0 });
      } catch {
        threw = true;
      }
      ok(threw, 'a payout beyond payable should be refused');
      const after = store.derivedState();
      eq(after.balances, before.balances, 'balances unchanged after a refusal');
      eq(after.eventCount, before.eventCount, 'no event written');
    },
  },
  {
    name: 'reconcile agrees — a postings scan and an engine replay match',
    run: (db, openScratch) => {
      // Two genuinely different derivations of the same state. If the driver
      // lost a write, dropped a field or reordered anything, they diverge.
      const store = freshStore(db);
      store.commit({ type: 'CONTRIBUTION', amountCents: 50_000, occurredAt: T0 });
      store.commit({
        type: 'PURCHASE',
        itemId: 'a',
        name: 'a',
        category: 'TOYS',
        purchasePriceCents: 1_200,
        expectedDaysToSale: 9,
        expectedResaleCents: 4_000,
        occurredAt: T0,
      });
      store.commit({
        type: 'SALE',
        itemId: 'a',
        grossProceedsCents: 4_000,
        marketplaceFeeCents: 570,
        outboundShippingCents: 500,
        daysToSale: 6,
        occurredAt: T0,
      });
      store.commit({ type: 'BUSINESS_EXPENSE', amountCents: 899, category: 'PACKAGING', occurredAt: T0 });
      const report = reconcile(store);
      eq(report, { ok: true, differences: [] }, 'reconciliation');
    },
  },
  {
    name: 'the hash chain detects a hand edit',
    run: (db, openScratch) => {
      const store = freshStore(db);
      store.commit({ type: 'CONTRIBUTION', amountCents: 5_000, occurredAt: T0 });
      eq(store.verifyChain(), { ok: true }, 'chain before tampering');
      // The thing the chain exists to catch, done directly to the row.
      db.run("UPDATE ledger_events SET memo = 'tampered' WHERE event_id = ?", ['evt_000001']);
      ok(store.verifyChain().ok === false, 'chain should be broken after an edit');
    },
  },
  {
    name: 'an expense reversal keeps the ledger and the analytic table together',
    run: (db, openScratch) => {
      const store = freshStore(db);
      store.commit({ type: 'CONTRIBUTION', amountCents: 5_000, occurredAt: T0 });
      const expense = store.commit({
        type: 'BUSINESS_EXPENSE',
        amountCents: 150,
        category: 'SUPPLIES',
        occurredAt: T0,
      }).event.eventId;
      eq(profitReport(db).businessExpenseCents, 150, 'expense recorded');

      store.commit({
        type: 'ADJUSTMENT',
        account: 'LIQUID',
        amountCents: 150,
        reason: 'reversed',
        reversesEventId: expense,
        occurredAt: T0,
      });
      eq(profitReport(db).businessExpenseCents, 0, 'expense reversed in the analytic table');
      eq(store.derivedState().balances.LIQUID, 5_000, 'cash returned');
      eq(expenseReversalDrift(db), [], 'no drift between ledger and table');
      eq(reconcile(store), { ok: true, differences: [] }, 'still reconciles');
    },
  },
  {
    name: 'the year-to-date tax base survives a round trip through storage',
    run: (db, openScratch) => {
      const store = freshStore(db);
      store.commit({ type: 'CONTRIBUTION', amountCents: 50_000, occurredAt: T0 });
      store.commit({ type: 'BUSINESS_EXPENSE', amountCents: 150, category: 'SUPPLIES', occurredAt: T0 });
      // Derived by an ordered pass over the ledger, not cached in a column.
      eq(store.derivedState().ytdNetBusinessIncomeCents, -150, 'ytd business income');
    },
  },
  {
    name: 'a fund exports and re-imports with every hash reproduced',
    run: (db, openScratch) => {
      // ⚡ The migration proof. The destination replays the COMMANDS and must
      // regenerate byte-identical events; if this machine's engine differed in
      // any way, the hashes would diverge and the import would refuse.
      const store = freshStore(db);
      store.commit({ type: 'CONTRIBUTION', amountCents: 50_000, occurredAt: T0 });
      store.commit({
        type: 'PURCHASE',
        itemId: 'x',
        name: 'x',
        category: 'TOYS',
        purchasePriceCents: 1_200,
        expectedDaysToSale: 9,
        expectedResaleCents: 4_000,
        occurredAt: T0,
      });
      store.commit({
        type: 'SALE',
        itemId: 'x',
        grossProceedsCents: 4_000,
        marketplaceFeeCents: 570,
        outboundShippingCents: 500,
        daysToSale: 6,
        occurredAt: T0,
      });
      store.commit({ type: 'BUSINESS_EXPENSE', amountCents: 899, category: 'PACKAGING', occurredAt: T0 });

      const dump = exportLedger(db, T0);
      eq(dump.events.length, 4, 'exported event count');
      ok(dump.config.policy !== undefined, 'policy must travel with the ledger');

      // A second, empty database standing in for the destination machine.
      const target = openScratch();
      try {
        let n = 0;
        const report = importLedger(target, dump, () => `2026-09-09T13:00:${String(n++).padStart(2, '0')}.000Z`);
        eq(report.hashesMatched, true, 'every hash reproduced');
        eq(report.chainOk, true, 'imported chain verifies');
        eq(report.reconciled, true, 'imported ledger reconciles');
        eq(report.events, 4, 'imported event count');
      } finally {
        target.close();
      }
    },
  },
  {
    name: 'an import REFUSES an export whose hashes do not match what it replays',
    run: (db, openScratch) => {
      // ⛔ The control on the control. Source and destination share an engine
      // in this test, so hashes always agree and removing the comparison
      // altogether changed nothing — measured by planting exactly that. The
      // only way to prove the check works is to hand it a mismatch.
      const store = freshStore(db);
      store.commit({ type: 'CONTRIBUTION', amountCents: 50_000, occurredAt: T0 });
      store.commit({ type: 'BUSINESS_EXPENSE', amountCents: 900, category: 'SUPPLIES', occurredAt: T0 });
      const dump = exportLedger(db, T0);

      const tampered = {
        ...dump,
        events: dump.events.map((e, i) =>
          i === 1 ? { ...e, hash: 'f'.repeat(64) } : e,
        ),
      };

      const target = openScratch();
      let refused = false;
      try {
        importLedger(target, tampered, () => T0);
      } catch (err) {
        refused = err instanceof LedgerTransferError;
      } finally {
        target.close();
      }
      ok(refused, 'an export with a wrong hash must be refused, not imported');
    },
  },
  {
    name: 'an import REFUSES an export whose command was edited',
    run: (db, openScratch) => {
      // Editing the command changes what the engine produces, so the
      // regenerated hash no longer matches the one travelling beside it. This
      // is the realistic tampering case: someone edits the JSON in transit.
      const store = freshStore(db);
      store.commit({ type: 'CONTRIBUTION', amountCents: 50_000, occurredAt: T0 });
      const dump = exportLedger(db, T0);

      const edited = {
        ...dump,
        events: dump.events.map((e) => ({
          ...e,
          command: { ...e.command, amountCents: 99_999_999 } as typeof e.command,
        })),
      };

      const target = openScratch();
      let refused = false;
      try {
        importLedger(target, edited, () => T0);
      } catch (err) {
        refused = err instanceof LedgerTransferError;
      } finally {
        target.close();
      }
      ok(refused, 'an edited command must be refused');
    },
  },
  {
    name: 'an import refuses a destination that already has events',
    run: (db, openScratch) => {
      // ⛔ Never merge two ledgers: interleaving breaks the chain and there is
      // no defensible order for the result.
      const store = freshStore(db);
      store.commit({ type: 'CONTRIBUTION', amountCents: 5_000, occurredAt: T0 });
      const dump = exportLedger(db, T0);

      let refused = false;
      try {
        importLedger(db, dump, () => T0);
      } catch (err) {
        refused = err instanceof LedgerTransferError;
      }
      ok(refused, 'importing onto a populated ledger must be refused');
    },
  },
  {
    // ⛔ The phone is the first place TWO stores can hold one ledger open —
    // `importLedger` replays through a store of its own, and the app's store
    // is still on screen. The cache is invalidated by this instance's writes
    // and by nothing else.
    name: 'a second store writes, and the first cannot see it until told',
    run: (db, openScratch) => {
      const store = freshStore(db);
      store.commit({ type: 'CONTRIBUTION', amountCents: 50_000, occurredAt: T0 });
      eq(store.state().balances.LIQUID, 50_000, 'liquid, cached');

      // A different instance over the SAME database — what an import is.
      const other = new FundStore(db, () => '2026-09-09T13:00:00.000Z');
      other.commit({ type: 'CONTRIBUTION', amountCents: 10_000, occurredAt: T0 });

      eq(store.state().balances.LIQUID, 50_000, 'the stale cache is still the old answer');
      store.invalidate();
      eq(store.state().balances.LIQUID, 60_000, 'after invalidate, the real balance');
      eq(reconcile(store), { ok: true, differences: [] }, 'reconcile after a second writer');
    },
  },
  {
    // D4: an override is allowed and may never be silent. This is here rather
    // than only in Vitest because it added a COLUMN — and a column is exactly
    // the kind of thing a different SQLite can read back differently.
    name: 'an overridden purchase records why, and survives the round trip cold',
    run: (db, openScratch) => {
      const store = freshStore(db);
      store.commit({ type: 'CONTRIBUTION', amountCents: 50_000, occurredAt: T0 });

      let refused = false;
      try {
        store.commit({
          type: 'PURCHASE',
          itemId: 'pin-00',
          name: 'pin',
          category: 'TOYS',
          purchasePriceCents: 1_500,
          expectedDaysToSale: 8,
          expectedResaleCents: 3_900,
          overrodeGates: ['MAX_PER_ITEM_EXCEEDED'],
          occurredAt: T0,
        });
      } catch {
        refused = true;
      }
      ok(refused, 'an override with no reason must be refused');
      eq(store.state().items['pin-00'], undefined, 'the refused purchase must not exist');

      store.commit({
        type: 'PURCHASE',
        itemId: 'pin-01',
        name: 'pin',
        category: 'TOYS',
        purchasePriceCents: 1_500,
        expectedDaysToSale: 8,
        expectedResaleCents: 3_900,
        overrodeGates: ['MAX_PER_ITEM_EXCEEDED', 'PROFIT_BELOW_MIN'],
        overrideReason: 'seller would not split the lot',
        occurredAt: T0,
      });
      store.commit({
        type: 'PURCHASE',
        itemId: 'pin-02',
        name: 'pin',
        category: 'TOYS',
        purchasePriceCents: 1_500,
        expectedDaysToSale: 8,
        expectedResaleCents: 3_900,
        occurredAt: T0,
      });

      // ⛔ `derivedState()`, not `state()`. The cache would answer from the
      // engine's own output and never touch the column this case is about.
      const cold = store.derivedState().items;
      eq(
        cold['pin-01']?.overrodeGates,
        ['MAX_PER_ITEM_EXCEEDED', 'PROFIT_BELOW_MIN'],
        'overridden gates, read back off disk',
      );
      eq(
        cold['pin-01']?.overrideReason,
        'seller would not split the lot',
        'override reason, read back off disk',
      );
      eq(cold['pin-02']?.overrodeGates, undefined, 'a clean purchase records no override');
      eq(reconcile(store), { ok: true, differences: [] }, 'reconcile after an override');
    },
  },
];

export interface ScenarioResult {
  readonly name: string;
  readonly passed: boolean;
  readonly error?: string;
}

/** Run every case, each on a fresh database from `open`. */
export function runEngineScenario(open: () => Db): ScenarioResult[] {
  return runScenario(ENGINE_SCENARIO, open);
}

/**
 * The runner, over any set of cases.
 *
 * Split out when a third contract arrived (`screen-scenario.ts`) — the runner
 * was never specific to these cases, and a second copy of it would be a second
 * place for "a close failure must not mask the case's own result" to be true.
 */
export function runScenario(cases: readonly ScenarioCase[], open: () => Db): ScenarioResult[] {
  return cases.map(({ name, run }) => {
    const db = open();
    try {
      run(db, open);
      return { name, passed: true };
    } catch (err) {
      return { name, passed: false, error: (err as Error).message };
    } finally {
      try {
        db.close();
      } catch {
        // A close failure must not mask the case's own result.
      }
    }
  });
}
