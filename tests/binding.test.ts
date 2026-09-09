/**
 * Which gate is binding, and what it implies.
 *
 * The instrument for risk R2. The property that matters is **exhaustiveness**:
 * every constraint code the engine can emit must have an explanation, because
 * the one thing this screen must not do is shrug at the gate rejecting
 * everything.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FundStore } from '@/db/store.js';
import { openDb } from '@/db/driver.js';
import { migrate } from '@/db/migrate.js';
import { bindingGateView, EXPLAINED_CODES } from '@/server/binding.js';
import { CONSTRAINT_CODES } from '@/core/capital/constraints.js';
import { parseOpportunity } from '@/domain/opportunity.js';
import { evaluateOpportunity } from '@/scoring/evaluate.js';
import { WITH_JOB, T0 } from './helpers.js';

function fixedClock(): () => string {
  let n = 0;
  return () => `2026-09-08T12:00:${String(n++).padStart(2, '0')}.000Z`;
}

function withFund(bankrollCents: number, fn: (store: FundStore, add: (id: string, o?: Record<string, unknown>) => void) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'resale-binding-'));
  try {
    const db = openDb(join(dir, 'test.db'));
    migrate(db, T0);
    const store = new FundStore(db, fixedClock());
    store.ensureSeeded();
    store.setTaxProfile(WITH_JOB);
    store.commit({ type: 'CONTRIBUTION', amountCents: bankrollCents, occurredAt: T0 });
    const add = (id: string, o: Record<string, unknown> = {}) => {
      const input = parseOpportunity({
        opportunityId: id, name: id, category: 'TOYS', source: 'MANUAL', sourceUrl: null,
        askingPriceCents: 1_200, inboundShippingCents: 0, salesTaxCents: 0,
        acquisitionTravelCents: 0, expectedGrossCents: 6_000, marketplace: 'EBAY',
        postageCents: null, soldLast90Days: 40, activeListings: 10,
        operatorDaysEstimate: null, compPricesCents: [5_800, 6_100],
        compMedianAgeDays: 45, hassleBps: 2_000, ...o,
      });
      store.opportunities().save(input, evaluateOpportunity(input, store.state()), T0);
    };
    try { fn(store, add); } finally { store.close(); }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

describe('every gate the engine can fail has an explanation', () => {
  it('explains all of CONSTRAINT_CODES, with none left over', () => {
    // ⛔ Exhaustive by comparison against the engine's own list, not by a
    // hand-kept tally. A new constraint code shows up here as a failure rather
    // than as an "unrecognised gate" on the screen.
    expect([...EXPLAINED_CODES].sort()).toEqual([...CONSTRAINT_CODES].sort());
  });
});

describe('nothing rejected yet', () => {
  it('is empty, and empty is not the same as "no problem"', () => {
    withFund(200_000, (store) => {
      const v = bindingGateView(store);
      expect(v.empty).toBe(true);
      expect(v.binding).toBeNull();
      expect(v.total).toBe(0);
      expect(v.rows).toEqual([]);
    });
  });
});

describe('a small fund rejects on capital, and the screen says so', () => {
  it('names the binding gate and what it implies', () => {
    // $50 is risk R2's actual situation: the cap, not the item, is the problem.
    withFund(5_000, (_store, add) => {
      add('a', { askingPriceCents: 4_000 });
      add('b', { askingPriceCents: 4_500 });
    });
    withFund(5_000, (store, add) => {
      add('a', { askingPriceCents: 4_000 });
      const v = bindingGateView(store);
      expect(v.empty).toBe(false);
      expect(v.binding).not.toBeNull();
      expect(v.total).toBeGreaterThan(0);
      // Whatever bit first, it is explained rather than shrugged at.
      expect(v.binding!.implication.length).toBeGreaterThan(20);
      expect(v.binding!.label).not.toBe(v.binding!.code);
      expect(v.rows.every((r) => r.cause !== undefined)).toBe(true);
    });
  });

  it('reports shares that sum to the whole, in integer basis points', () => {
    withFund(5_000, (store, add) => {
      add('a', { askingPriceCents: 4_000 });
      add('b', { soldLast90Days: 0, activeListings: 30 });
      const v = bindingGateView(store);
      for (const r of v.rows) {
        expect(Number.isInteger(r.shareBps)).toBe(true);
        expect(r.shareBps).toBeGreaterThan(0);
      }
      // Rounding means it need not be exactly 10000, but it must be close.
      const sum = v.rows.reduce((s, r) => s + r.shareBps, 0);
      expect(Math.abs(sum - 10_000)).toBeLessThanOrEqual(v.rows.length);
    });
  });

  it('ranks the most frequent gate first', () => {
    withFund(5_000, (store, add) => {
      for (let i = 0; i < 4; i++) add(`dear-${i}`, { askingPriceCents: 4_800 });
      const v = bindingGateView(store);
      expect(v.rows[0]!.n).toBeGreaterThanOrEqual(v.rows[v.rows.length - 1]!.n);
      expect(v.binding!.code).toBe(v.rows[0]!.code);
    });
  });
});

describe('the cause matters more than the code', () => {
  it('groups rejections into the three things you can actually do', () => {
    withFund(5_000, (store, add) => {
      for (let i = 0; i < 3; i++) add(`dear-${i}`, { askingPriceCents: 4_800 });
      add('slow', { soldLast90Days: 0, activeListings: 30 });
      const v = bindingGateView(store);

      expect(v.dominantCause).not.toBeNull();
      expect(['FUND_TOO_SMALL', 'RULES_TOO_TIGHT', 'ITEMS_TOO_WEAK']).toContain(
        v.dominantCause!.cause,
      );
      // A cause is at least as big as the biggest single code inside it —
      // which is the whole reason to group, since codes fragment.
      expect(v.dominantCause!.n).toBeGreaterThanOrEqual(v.binding!.n);
      // Every rejection lands in exactly one cause.
      expect(v.causes.reduce((s, c) => s + c.n, 0)).toBe(v.total);
      expect(v.dominantCause!.headline).not.toContain('_');
    });
  });

  it('has no cause at all when nothing was rejected', () => {
    withFund(200_000, (store) => {
      expect(bindingGateView(store).dominantCause).toBeNull();
      expect(bindingGateView(store).causes).toEqual([]);
    });
  });
});
