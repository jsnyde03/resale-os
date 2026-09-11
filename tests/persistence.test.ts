import { describe, expect, it } from 'vitest';
import { FundStore } from '@/db/store.js';
import { reconcile, replay } from '@/db/replay.js';
import { openDb } from '@/db/driver.js';
import { migrate, listMigrationFiles } from '@/db/migrate.js';
import { computeMetrics } from '@/core/capital/metrics.js';
import { DEFAULT_POLICY, PolicyError } from '@/core/capital/policy.js';
import { UNCONFIGURED_TAX_PROFILE, TaxProfileError } from '@/core/tax/profile.js';
import { InvariantViolation } from '@/core/ledger/invariants.js';
import { T0 } from './helpers.js';

/** A fixed clock: nothing in a test should depend on wall time. */
function fixedClock(): () => string {
  let n = 0;
  return () => `2026-09-08T12:00:${String(n++).padStart(2, '0')}.000Z`;
}

function freshStore(): FundStore {
  const db = openDb(':memory:');
  migrate(db, T0);
  const store = new FundStore(db, fixedClock());
  store.ensureSeeded();
  return store;
}

/** The scenario the whole system exists to get right, start to finish. */
function runBusiness(store: FundStore): void {
  // $150 seed: above the $100 set-aside threshold, so the owner is paid.
  store.commit({ type: 'CONTRIBUTION', amountCents: 15_000, occurredAt: T0 });

  store.commit({
    type: 'PURCHASE',
    itemId: 'pin-01',
    name: 'Disney 50th anniversary pin',
    category: 'DISNEY_PINS',
    purchasePriceCents: 1_200,
    inboundShippingCents: 0,
    expectedDaysToSale: 6,
    expectedResaleCents: 3_200,
    listingLive: true,
    marketplace: 'EBAY',
    occurredAt: T0,
  });

  store.commit({
    type: 'SALE',
    itemId: 'pin-01',
    grossProceedsCents: 3_200,
    marketplaceFeeCents: 424,
    paymentFeeCents: 30,
    outboundShippingCents: 468,
    packagingCents: 35,
    daysToSale: 5,
    occurredAt: T0,
  });

  store.commit({
    type: 'PURCHASE',
    itemId: 'funko-01',
    name: 'Funko Pop, chase variant',
    category: 'FUNKO',
    purchasePriceCents: 1_800,
    expectedDaysToSale: 9,
    expectedResaleCents: 3_500,
    occurredAt: T0,
  });

  store.commit({
    type: 'CHARGE_OFF',
    itemId: 'funko-01',
    reason: 'STALE',
    keepListingLive: true,
    occurredAt: T0,
  });

  store.commit({
    type: 'PASSIVE_RECOVERY',
    itemId: 'funko-01',
    grossProceedsCents: 1_500,
    marketplaceFeeCents: 199,
    outboundShippingCents: 468,
    occurredAt: T0,
  });

  store.commit({
    type: 'BUSINESS_EXPENSE',
    amountCents: 899,
    category: 'PACKAGING',
    fundedFromOperatingReserve: true,
    occurredAt: T0,
  });

  store.commit({ type: 'OWNER_PAYOUT', amountCents: 100, occurredAt: T0 });
}

describe('migrations', () => {
  it('apply once and are idempotent', () => {
    const db = openDb(':memory:');
    const applied = migrate(db, T0);
    // Every numbered file, in order, and none of them twice.
    expect(applied).toEqual(listMigrationFiles());
    expect(applied[0]).toBe('001_init.sql');
    expect(migrate(db, T0)).toEqual([]);
    db.close();
  });

  it('are append-only: a new one adds to the list rather than replacing it', () => {
    // Guards against an edit to an already-applied file, which would silently
    // never run on an existing database.
    const files = listMigrationFiles();
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect([...files].sort()).toEqual(files);
  });
});

describe('the store and the engine agree', () => {
  it('a stored fund reloads to the same state it was built with', () => {
    const store = freshStore();
    runBusiness(store);

    const inMemory = store.state();
    // Force a cold read: a brand-new store object over the same database.
    const cold = new FundStore(store.db, fixedClock()).state();

    expect(cold.balances).toEqual(inMemory.balances);
    expect(cold.mode).toBe(inMemory.mode);
    expect(Object.keys(cold.items).sort()).toEqual(Object.keys(inMemory.items).sort());
    expect(cold.items['pin-01']).toEqual(inMemory.items['pin-01']);
  });

  it('replaying every stored command reproduces the stored state exactly', () => {
    // The two sides are produced by genuinely different code: one sums the
    // postings table, the other re-runs the engine from an empty fund.
    const store = freshStore();
    runBusiness(store);

    const report = reconcile(store);
    expect(report.differences).toEqual([]);
    expect(report.ok).toBe(true);

    const replayed = replay(store);
    expect(replayed.balances).toEqual(store.state().balances);
  });

  it('detects a dropped field: a writer that loses sale fees is caught', () => {
    const store = freshStore();
    runBusiness(store);

    // Plant: corrupt one stored payload the way a lossy writer would, then
    // confirm the replay control actually notices.
    const row = store
      .events()
      .find((e) => e.type === 'SALE');
    expect(row).toBeDefined();
    const payload = JSON.parse(row!.payload_json) as Record<string, unknown>;
    payload.marketplaceFeeCents = 0;
    store.db.run('UPDATE ledger_events SET payload_json = ? WHERE event_id = ?', [
      JSON.stringify(payload),
      row!.event_id,
    ]);

    const report = reconcile(store);
    expect(report.ok).toBe(false);
    expect(report.differences.join(' ')).toMatch(/LIQUID|book value|realized profit/);
  });
});

describe('the hash chain', () => {
  it('verifies clean on an untouched ledger', () => {
    const store = freshStore();
    runBusiness(store);
    expect(store.verifyChain()).toEqual({ ok: true });
  });

  it('names the event where a hand edit broke the chain', () => {
    const store = freshStore();
    runBusiness(store);

    const target = store.events()[2]!;
    store.db.run('UPDATE ledger_events SET memo = ? WHERE event_id = ?', [
      'edited by hand',
      target.event_id,
    ]);

    const result = store.verifyChain();
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(target.event_id);
  });

  it('catches a tampered posting amount, not just a tampered event row', () => {
    const store = freshStore();
    runBusiness(store);

    const target = store.events()[1]!; // the purchase
    store.db.run(
      'UPDATE ledger_postings SET amount_cents = amount_cents + 1 WHERE event_id = ? AND seq = 0',
      [target.event_id],
    );

    expect(store.verifyChain().ok).toBe(false);
  });
});

describe('a rejected command leaves the database untouched', () => {
  it('rolls back completely when an invariant would break', () => {
    const store = freshStore();
    store.commit({ type: 'CONTRIBUTION', amountCents: 1_000, occurredAt: T0 });

    const before = {
      events: store.events().length,
      items: store.db.all('SELECT * FROM items').length,
      balances: { ...store.state().balances },
    };

    expect(() =>
      store.commit({
        type: 'PURCHASE',
        itemId: 'too-expensive',
        name: 'a thing the fund cannot afford',
        category: 'LEGO',
        purchasePriceCents: 50_000,
        expectedDaysToSale: 5,
        expectedResaleCents: 90_000,
        occurredAt: T0,
      }),
    ).toThrow(InvariantViolation);

    expect(store.events().length).toBe(before.events);
    expect(store.db.all('SELECT * FROM items').length).toBe(before.items);
    expect(store.derivedState().balances).toEqual(before.balances);
  });
});

describe('a stored policy older than the code', () => {
  it('fails loudly rather than silently running the old rules', () => {
    const store = freshStore();
    // The exact shape that shipped before setAsideMinNavCents existed.
    const stale = JSON.parse(JSON.stringify(DEFAULT_POLICY)) as Record<string, unknown>;
    delete (stale.allocation as Record<string, unknown>).setAsideMinNavCents;
    store.db.run('UPDATE config SET value_json = ? WHERE key = ?', [
      JSON.stringify(stale),
      'policy',
    ]);
    expect(() => new FundStore(store.db, fixedClock()).policy()).toThrow(PolicyError);
  });

  it('can still be replaced, because the recovery path does not read it', () => {
    // A repair that depends on the broken thing is not a repair. setPolicy()
    // must not need the stored policy to be valid first.
    const store = freshStore();
    store.db.run('UPDATE config SET value_json = ? WHERE key = ?', ['{"nonsense":true}', 'policy']);

    const fresh = new FundStore(store.db, fixedClock());
    expect(() => fresh.policy()).toThrow();
    expect(() => fresh.setPolicy(DEFAULT_POLICY)).not.toThrow();
    expect(fresh.policy().version).toBe(DEFAULT_POLICY.version);
  });

  it('refuses to store a policy that would not validate', () => {
    const store = freshStore();
    expect(() =>
      store.setPolicy({
        ...DEFAULT_POLICY,
        allocation: { ...DEFAULT_POLICY.allocation, setAsideMinNavCents: 999_999 },
      }),
    ).toThrow(PolicyError);
    // and the good one is still in place
    expect(store.policy().version).toBe(DEFAULT_POLICY.version);
  });
});

describe('a stored tax profile older than the code', () => {
  it('degrades to unconfigured rather than throwing, so income tax abstains', () => {
    // The safe direction: a profile too old to read must not take the whole
    // fund down, and must not silently keep estimating from stale fields.
    const store = freshStore();
    store.db.run('UPDATE config SET value_json = ? WHERE key = ?', [
      '{"configured":true}',
      'tax_profile',
    ]);
    const fresh = new FundStore(store.db, fixedClock());
    const loaded = fresh.taxProfileOrDefault();
    expect(loaded.stale).toBe(true);
    expect(loaded.profile.configured).toBe(false);
    expect(() => fresh.state()).not.toThrow();
  });

  it('can still be replaced, because the repair path does not read it', () => {
    // This exact bug shipped twice - once for policy, once for the tax profile.
    // Gated here so the class cannot come back a third time.
    const store = freshStore();
    store.db.run('UPDATE config SET value_json = ? WHERE key = ?', ['{"junk":1}', 'tax_profile']);

    const fresh = new FundStore(store.db, fixedClock());
    expect(() => fresh.taxProfile()).toThrow(TaxProfileError);
    expect(() =>
      fresh.setTaxProfile({ ...UNCONFIGURED_TAX_PROFILE, configured: true }),
    ).not.toThrow();
    expect(fresh.taxProfile().configured).toBe(true);
  });

  it('refuses to store a profile that would not validate', () => {
    const store = freshStore();
    expect(() =>
      store.setTaxProfile({ ...UNCONFIGURED_TAX_PROFILE, stateIncomeTaxBps: 9_999 }),
    ).toThrow(TaxProfileError);
  });
});

describe('expense records', () => {
  it('separates sale-side costs from capitalised acquisition costs', () => {
    const store = freshStore();
    store.commit({ type: 'CONTRIBUTION', amountCents: 7_500, occurredAt: T0 });
    store.commit({
      type: 'PURCHASE',
      itemId: 'i1',
      name: 'thing',
      category: 'LEGO',
      purchasePriceCents: 1_000,
      inboundShippingCents: 300,
      acquisitionTravelCents: 120,
      expectedDaysToSale: 5,
      expectedResaleCents: 3_000,
      occurredAt: T0,
    });
    store.commit({
      type: 'SALE',
      itemId: 'i1',
      grossProceedsCents: 3_000,
      marketplaceFeeCents: 400,
      outboundShippingCents: 500,
      occurredAt: T0,
    });

    const capitalised = store.db.all<{ category: string; amount_cents: number }>(
      'SELECT category, amount_cents FROM expenses WHERE capitalized = 1 ORDER BY category',
    );
    expect(capitalised).toEqual([
      { category: 'POSTAGE', amount_cents: 300 },
      { category: 'TRAVEL', amount_cents: 120 },
    ]);

    const expensed = store.db.get<{ total: number }>(
      'SELECT SUM(amount_cents) AS total FROM expenses WHERE capitalized = 0',
    );
    expect(expensed?.total).toBe(900);

    // The capitalised half is already inside book value, so counting both would
    // double-charge the item by $4.20.
    expect(store.derivedState().items.i1!.landedCostCents).toBe(1_420);
  });

  it('scopes a business expense to the business, not to an item', () => {
    const store = freshStore();
    store.commit({ type: 'CONTRIBUTION', amountCents: 7_500, occurredAt: T0 });
    store.commit({
      type: 'BUSINESS_EXPENSE',
      amountCents: 2_499,
      category: 'EQUIPMENT',
      occurredAt: T0,
    });
    const row = store.db.get<{ scope: string; item_id: string | null }>(
      'SELECT scope, item_id FROM expenses',
    );
    expect(row).toEqual({ scope: 'BUSINESS', item_id: null });
  });
});

describe('the full business scenario reconciles to the cent', () => {
  it('every number is explainable from the postings', () => {
    const store = freshStore();
    runBusiness(store);
    const m = computeMetrics(store.state());

    // pin-01: net 3200-424-30-468-35 = 2243; cost 1200; profit 1043
    // funko-01: cost 1800 charged off; recovery net 1500-199-468 = 833 (all profit)
    // expense 899 with a reserve release
    // owner payout 100
    const profitPin = 1_043;
    const profitRecovery = 833;

    // No tax profile is set on this fund and the year stays under the $400
    // self-employment floor, so nothing is owed and nothing is reserved.
    expect(profitPin + profitRecovery).toBeLessThan(43_315);
    expect(m.taxReserveCents).toBe(0);

    expect(m.liquidCents).toBe(
      15_000 - 1_200 + 2_243 - 1_800 + 833 - 899 - 100,
    );
    expect(m.inventoryAtCostCents).toBe(0);
    expect(m.ownerPayableCents).toBeGreaterThan(0);

    // identity
    const raw = Object.values(store.state().balances).reduce((a, b) => a + b, 0);
    expect(raw).toBe(0);

    // and the fund is honest about the loss it took
    expect(m.navCents).toBeLessThan(15_000 + profitPin);
    expect(store.derivedState().items['funko-01']!.realizedProfitCents).toBe(-1_800 + 833);
  });

  it('is still BOOTSTRAP, because $150 did not become $500', () => {
    const store = freshStore();
    runBusiness(store);
    expect(store.derivedState().mode).toBe('BOOTSTRAP');
    expect(store.derivedState().policy.version).toBe(DEFAULT_POLICY.version);
  });
});
