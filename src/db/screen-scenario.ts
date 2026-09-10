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
import { purchaseCommandFrom } from '../core/capital/quote.js';
import { evaluatePurchase } from '../scoring/purchase.js';
import { itemIdFrom } from '../core/ids.js';
import { adjustModel, reverseModel, sellModel, spendModel } from '../ui/forms.js';
import { policyEdit, policyFieldsFrom, taxEdit, taxFieldsFrom } from '../ui/settings.js';
import { evaluateForm } from '../screens/sourcing.js';
import { rejectionsView } from '../screens/rejections.js';
import { OpportunityReader, OpportunityRepository } from './repositories/opportunities.js';
import { profitReport } from './reporting.js';
import { makeVerifiedBackup } from './backup-portable.js';
import { dashboardView } from '../screens/views.js';
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
  fields: {
    name: string;
    category: string;
    price: number;
    resale: number;
    sold: number;
    /** Set only when the sourcing screen produced the numbers (5.9c.2). */
    opportunityId?: string;
  },
  override?: { reason: string },
): { itemId: string; failures: string[] } {
  const input = {
    category: fields.category,
    purchasePriceCents: fields.price,
    expectedGrossCents: fields.resale,
    soldLast90Days: fields.sold,
    activeListings: 10,
  };
  // ⛔ D14: the same gates the buy screen and `cli buy` run. This helper is the
  // on-device control for that screen, so running a weaker rule set here would
  // prove the phone works using rules the phone does not use.
  const { quote, evaluation } = evaluatePurchase(store.state(), input, {
    name: fields.name,
    ...(fields.opportunityId !== undefined ? { opportunityId: fields.opportunityId } : {}),
  });
  const failures = evaluation.gates.failures.map((f) => f.code);
  const itemId = itemIdFrom(fields.name, store.state().eventCount);
  store.commit(
    purchaseCommandFrom(input, quote, {
      itemId,
      name: fields.name,
      occurredAt: T0,
      ...(fields.opportunityId !== undefined ? { opportunityId: fields.opportunityId } : {}),
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
    // ⛔ 5.9c.2, and the mirror of the QUOTED case below. A two-class fixture
    // with only one class asserted proves half of nothing: the QUOTED case
    // passed just as happily before a scored purchase could exist at all.
    name: 'buy: a purchase handed over by the sourcing screen is measured as SCORED',
    run: (db) => {
      const store = funded(db, 50_000);
      const { itemId } = buy(store, {
        name: 'Lego set',
        category: 'TOYS',
        price: 1_000,
        resale: 4_000,
        sold: 90,
        opportunityId: 'opp-lego-set-0003',
      });

      // Off disk, not off the engine's cache — the marker has to survive being
      // written and read back, which is the half a round trip cannot see.
      const item = store.derivedState().items[itemId];
      eq(item?.opportunityId, 'opp-lego-set-0003', 'the marker survives the write');

      store.commit(
        sellModel(store.state().items[itemId]!, {
          gross: '40.00',
          fee: '5.70',
          postage: '5.00',
          packaging: '0.35',
        }).command(T30)!,
      );

      const view = dashboardView(store);
      eq(view.accuracy.n, 1, 'one measurable sale');
      eq(view.accuracy.scoredN, 1, 'the scorer produced this expectation');
      eq(view.accuracy.quotedN, 0, 'and it must not be pooled with a hand estimate');
    },
  },
  {
    // ⛔ 5.12. The rules are stored in the DATABASE, so a screen that appears to
    // save them proves nothing until a DIFFERENT store reads them back off disk.
    name: 'settings: an edited policy survives, read back by a second store',
    run: (db) => {
      const store = funded(db, 50_000);
      const before = store.policy();

      const edit = policyEdit(before, 'BOOTSTRAP', {
        ...policyFieldsFrom(before, 'BOOTSTRAP'),
        maxHoldDays: '30',
      }, 50_000);
      ok(edit.problems.length === 0, 'the edit should parse');
      ok(edit.next !== null, 'the edit should be a change');
      store.setPolicy(edit.next!);

      // ⚠️ A SECOND store over the same database. `store.state()` answers from a
      // cache, so re-reading through the writer would be the engine agreeing
      // with itself — the exact failure B54 records.
      const reopened = new FundStore(db, () => T0);
      eq(reopened.policy().modes.BOOTSTRAP.maxHoldDays, 30, 'the new ceiling is on disk');
      eq(
        reopened.policy().modes.GROWTH,
        before.modes.GROWTH,
        'the other mode was not quietly rewritten',
      );
      ok(reopened.policy().version !== before.version, 'the version moved, or drift is undetectable');

      // ⛔ And the rules must not have touched the money.
      eq(reopened.derivedState().balances.LIQUID, 50_000, 'a policy change moves no money');
      eq(reopened.derivedState().eventCount, store.state().eventCount, 'and records no event');
    },
  },
  {
    name: 'settings: a tax profile survives, and the repair path opens against a broken one',
    run: (db) => {
      const store = funded(db, 50_000);
      // ⛔ The repair must work against a stored value that is already invalid —
      // adding a required field makes every existing row invalid, including for
      // the fix. That has shipped twice on this project.
      const fields = taxFieldsFrom(undefined);
      const edited = taxEdit({
        ...fields,
        otherIncome: '45000',
        stateRatePercent: '7.15',
        stateRateBasis: 'state + local, published table',
      });
      ok(edited.problems.length === 0, 'a rate WITH a basis is accepted');
      store.setTaxProfile(edited.next!);

      const reopened = new FundStore(db, () => T0);
      eq(reopened.taxProfile().stateIncomeTaxBps, 715, 'the rate is on disk as integer bps');
      ok(reopened.taxProfile().configured, 'and the profile reads as configured');

      // The refusal half, through the same model the screen uses.
      const bare = taxEdit({ ...fields, stateRatePercent: '7.15', stateRateBasis: '' });
      ok(bare.next === null, 'a non-zero rate with no basis is refused');
    },
  },
  {
    // ⚡ 6.0.3 / B68. Until now the phone scored an opportunity and threw the
    // score away. B3's rejection histogram had nothing to count and 6.5's
    // watchlist had nothing to watch.
    name: 'sourcing: a scored opportunity is recorded, and a REJECT is recorded too',
    run: (db) => {
      const store = funded(db, 50_000);

      // A candidate that fails, which is the case that matters: walk-aways are
      // most of the decisions, and nothing else will ever see them.
      const slow = evaluateForm(
        { name: 'slow lot', category: 'TOYS', price: '12.00', resale: '60.00', sold90: '2', active: '40' },
        store.state(),
      );
      ok(slow.ok, 'the form should parse');
      if (!slow.ok) return;
      eq(slow.verdict.recommendation, 'REJECT', 'this candidate should be refused');
      new OpportunityRepository(db).save(slow.input, slow.evaluation, T0);

      // ⚠️ Read back through a SEPARATE reader over the same database, not
      // through the object that wrote it.
      const row = new OpportunityReader(db).get(slow.input.opportunityId);
      ok(row !== undefined, 'the score should be on disk');
      eq(row?.recommendation, 'REJECT', 'the verdict is stored, not recomputed');
      eq(row?.policy_version, slow.evaluation.policyVersion, 'and the rules that produced it');
      ok((row?.buy_score ?? -1) >= 0, 'with the score it was given');

      // ⛔ Recording a score moves no money and records no event.
      eq(store.derivedState().balances.LIQUID, 50_000, 'a score moves no money');

      // The histogram B3 wants now has something to count.
      const hist = new OpportunityReader(db).rejectionHistogram();
      ok(hist.codes.length > 0, 'the binding gate is now countable');
      eq(hist.rejectedRows, 1, 'one refusal on record');
      // ⛔ A refusal that yields no code is a broken reader, and on a chart it
      // looks exactly like a fund that refuses nothing.
      eq(hist.unreadableRows, 0, 'and it was readable');
    },
  },
  {
    // ⚡ 6.2 / B3, end to end on the device: score several candidates, then ask
    // the record which gate is actually binding.
    name: 'rejections: the record answers which gate is binding, and stays honest about n',
    run: (db) => {
      const store = funded(db, 50_000);
      const repo = new OpportunityRepository(db);

      // Six refusals, all slow movers — the shape a clearance rack produces.
      for (let i = 0; i < 6; i += 1) {
        const r = evaluateForm(
          {
            name: `slow ${i}`,
            category: 'TOYS',
            price: '12.00',
            resale: '60.00',
            sold90: '2',
            active: String(30 + i),
          },
          store.state(),
        );
        ok(r.ok, 'the form should parse');
        if (r.ok) repo.save(r.input, r.evaluation, T0);
      }

      const view = rejectionsView(new OpportunityReader(db).rejectionHistogram());
      eq(view.rejectedRows, 6, 'six refusals on record');
      eq(view.unreadableRows, 0, 'and every one of them readable');
      ok(view.readable, 'the reader works');
      ok(view.conclusive, 'six is enough to call a pattern');
      // ⛔ All four gates fire on every one of these, so they TIE at six. The
      // instrument must say that rather than picking the alphabetically-first
      // one and calling it the binding gate.
      ok(view.rows.some((r) => r.code === 'HOLD_TOO_LONG' && r.n === 6), 'hold time refused all six');
      ok(view.headline.includes('the same'), 'a tie is reported as a tie');
      ok(view.headline.includes('takes too long to sell'), 'and hold time is named in it');

      // ⛔ And the honest half: below the threshold it must decline to conclude.
      const thin = rejectionsView({ codes: [{ code: 'HOLD_TOO_LONG', n: 2 }], rejectedRows: 2, unreadableRows: 0 });
      ok(!thin.conclusive, 'two refusals is not a pattern');
    },
  },
  {
    // ⚡ 6.5 on device: a refusal that expires, and one that does not.
    name: 'sourcing: a refusal says NOT YET with a bankroll, or NEVER',
    run: (db) => {
      const store = funded(db, 5_000);

      // Good and fast, simply too expensive for a $50 fund.
      const dear = evaluateForm(
        { name: 'dear', category: 'TOYS', price: '30.00', resale: '120.00', sold90: '40', active: '3' },
        store.state(),
      );
      ok(dear.ok, 'the form should parse');
      if (!dear.ok) return;
      ok(!dear.verdict.buy, 'refused at this bankroll');
      eq(dear.verdict.unlock.unlock.kind, 'AT_NAV', 'but it expires');
      if (dear.verdict.unlock.unlock.kind === 'AT_NAV') {
        ok(dear.verdict.unlock.unlock.navCents > 5_000, 'at a bankroll above this one');
      }

      // Slow, and no bankroll fixes slow.
      const slow = evaluateForm(
        { name: 'slow', category: 'TOYS', price: '12.00', resale: '60.00', sold90: '2', active: '30' },
        store.state(),
      );
      ok(slow.ok, 'the form should parse');
      if (!slow.ok) return;
      eq(slow.verdict.unlock.unlock.kind, 'NEVER', 'this one is closed');
      if (slow.verdict.unlock.unlock.kind === 'NEVER') {
        ok(slow.verdict.unlock.unlock.because.includes('HOLD_TOO_LONG'), 'and it says why');
      }

      // ⛔ The two must not be the same answer. Before 6.5 both were "REJECT".
      ok(
        dear.verdict.unlock.unlock.kind !== slow.verdict.unlock.unlock.kind,
        'not yet and never are different answers',
      );
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
    // ⛔ 5.8. The read screens render `views.ts` — the model the Gate 4
    // dashboard used — rather than recomputing anything. This runs it against
    // whatever SQLite is underneath, because it reaches the store, the
    // postings scan, an engine replay and the tax tables in one pass.
    name: 'reports: the read model agrees with the ledger it was built from',
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
        spendModel({ kind: 'EXPENSE', amount: '4.50', category: 'POSTAGE', itemId: null })
          .command(T0)!,
      );
      const item = store.state().items[itemId]!;
      store.commit(
        sellModel(item, { gross: '40.00', fee: '5.70', postage: '5.00', packaging: '0.35' })
          .command(T30)!,
      );

      const view = dashboardView(store);

      // The headline is the same fund the metrics report.
      eq(
        view.headline.nav.cents,
        computeMetrics(store.derivedState()).navCents,
        'the headline NAV matches a cold derivation',
      );
      eq(view.headline.eventCount, store.derivedState().eventCount, 'event count');
      eq(view.profit.businessExpenses.cents, 450, 'the expense reached the profit view');
      eq(view.profit.soldItems, 1, 'one sale');

      // ⛔ B59 through the whole stack: the sale was priced by the operator, so
      // it is QUOTED — and the view must keep that apart rather than pooling.
      eq(view.accuracy.n, 1, 'one measurable sale');
      eq(view.accuracy.quotedN, 1, 'priced by the operator');
      eq(view.accuracy.scoredN, 0, 'nothing came through the scorer');
      ok(!view.accuracy.readable, 'one sale is not a trend, and the view must say so');

      // Integrity is a read too, and it is the one that must never be wrong.
      ok(view.integrity.chainOk, 'the chain verifies');
      ok(view.integrity.replayOk, 'the postings scan agrees with an engine replay');
      ok(view.integrity.expenseDriftOk, 'the analytic expense table agrees with the ledger');
    },
  },
  {
    // ⛔ The one that needed a ledger view to exist. An expense lives in the
    // ledger AND in the analytic `expenses` table; only an ADJUSTMENT carrying
    // `reversesEventId` moves both, and a bare one leaves the two disagreeing
    // while each goes on looking plausible.
    name: 'reverse: an expense that came back moves the ledger and the projection together',
    run: (db) => {
      const store = funded(db, 50_000);
      const expense = store.commit(
        spendModel({ kind: 'EXPENSE', amount: '4.50', category: 'POSTAGE', itemId: null })
          .command(T0)!,
      ).event.eventId;
      eq(profitReport(db).businessExpenseCents, 450, 'the expense is in the projection');
      eq(store.outstandingExpense(expense), 450, 'all of it is standing');

      // Half of it comes back.
      const partial = reverseModel({
        eventId: expense,
        outstandingCents: store.outstandingExpense(expense),
        amount: '2.00',
        reason: 'the seller refunded half the postage',
      });
      ok(partial.ready, 'a partial reversal is allowed');
      store.commit(partial.command(T30)!);

      eq(profitReport(db).businessExpenseCents, 250, 'the projection moved with the ledger');
      eq(store.outstandingExpense(expense), 250, 'and the outstanding amount agrees');
      eq(reconcile(store), { ok: true, differences: [] }, 'reconcile after a reversal');

      // ⚠️ Over-reversing would turn a correction into invented income. The
      // model refuses to build it, and the store refuses it if anything else
      // does — both are checked, because only one of them is in the app.
      const tooMuch = reverseModel({
        eventId: expense,
        outstandingCents: store.outstandingExpense(expense),
        amount: '99.00',
        reason: 'this should never be recorded',
      });
      ok(!tooMuch.ready, 'the form refuses to over-reverse');
      eq(tooMuch.command(T30), null, 'and builds nothing');

      let refused = false;
      try {
        store.commit({
          type: 'ADJUSTMENT',
          account: 'LIQUID',
          amountCents: 9_900,
          reason: 'bypassing the form entirely',
          reversesEventId: expense,
          occurredAt: T30,
        });
      } catch {
        refused = true;
      }
      ok(refused, 'and the store refuses it even without the form');
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
