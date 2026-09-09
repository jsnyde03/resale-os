/**
 * D4, answered 2026-09-09: **a purchase may overrule the capital gates, and it
 * may never do so silently.**
 *
 * ⛔ The defect this closes was live on the real fund. `cli buy --force`
 * printed "recording it as it happened" and then committed an ordinary
 * PURCHASE carrying no marker of any kind — so once the terminal scrolled,
 * an overruled buy and a clean one were the same row.
 *
 * The engine does not judge WHETHER the override was right. `constraints.ts`
 * assesses a decision; the engine records what happened. What it insists on is
 * that a purchase claiming to have overruled something says why.
 */

import { describe, expect, it } from 'vitest';
import { EngineError } from '@/core/capital/engine.js';
import { FundStore } from '@/db/store.js';
import { openDb } from '@/db/driver.js';
import { migrate } from '@/db/migrate.js';
import { reconcile } from '@/db/replay.js';
import { Fund, purchase, T0 } from './helpers.js';

function freshStore(): FundStore {
  const db = openDb(':memory:');
  migrate(db, T0);
  let n = 0;
  const store = new FundStore(db, () => `2026-09-09T12:00:${String(n++).padStart(2, '0')}.000Z`);
  store.ensureSeeded();
  store.commit({ type: 'CONTRIBUTION', amountCents: 15_000, occurredAt: T0 });
  return store;
}

describe('an override must state a reason', () => {
  it('refuses a purchase that overrode gates with no reason', () => {
    expect(() =>
      Fund.withBankroll(10_000).do(
        purchase({ itemId: 'pin-01', overrodeGates: ['MAX_PER_ITEM_EXCEEDED'] }),
      ),
    ).toThrowError(EngineError);
  });

  it('names the gates it overrode in the refusal', () => {
    try {
      Fund.withBankroll(10_000).do(
        purchase({ itemId: 'pin-01', overrodeGates: ['MAX_PER_ITEM_EXCEEDED', 'PROFIT_BELOW_MIN'] }),
      );
      expect.unreachable('the purchase should have been refused');
    } catch (error) {
      expect(error).toBeInstanceOf(EngineError);
      expect((error as EngineError).code).toBe('OVERRIDE_NEEDS_REASON');
      expect((error as EngineError).message).toContain('MAX_PER_ITEM_EXCEEDED');
      expect((error as EngineError).message).toContain('PROFIT_BELOW_MIN');
    }
  });

  it('refuses whitespace as a reason', () => {
    expect(() =>
      Fund.withBankroll(10_000).do(
        purchase({
          itemId: 'pin-01',
          overrodeGates: ['MAX_PER_ITEM_EXCEEDED'],
          overrideReason: '   ',
        }),
      ),
    ).toThrowError(/OVERRIDE_NEEDS_REASON|must say why/);
  });

  it('accepts an override that gives a reason, and records both', () => {
    const fund = Fund.withBankroll(10_000).do(
      purchase({
        itemId: 'pin-01',
        overrodeGates: ['MAX_PER_ITEM_EXCEEDED'],
        overrideReason: 'seller would not split the lot',
      }),
    );
    const item = fund.item('pin-01');
    expect(item.overrodeGates).toEqual(['MAX_PER_ITEM_EXCEEDED']);
    expect(item.overrideReason).toBe('seller would not split the lot');
  });

  it('leaves both absent on a clean purchase', () => {
    const item = Fund.withBankroll(10_000).do(purchase({ itemId: 'pin-01' })).item('pin-01');
    expect(item.overrodeGates).toBeUndefined();
    expect(item.overrideReason).toBeUndefined();
  });

  // ⚠️ An empty array is not the same fact as "no override", and a purchase
  // cannot overrule an empty set of gates. It must not be treated as one that
  // owes a reason.
  it('treats an empty gate list as no override at all', () => {
    const item = Fund.withBankroll(10_000)
      .do(purchase({ itemId: 'pin-01', overrodeGates: [] }))
      .item('pin-01');
    expect(item.overrodeGates).toBeUndefined();
  });
});

describe('the override survives the database', () => {
  it('round-trips through the items table', () => {
    const store = freshStore();
    store.commit(
      purchase({
        itemId: 'pin-01',
        overrodeGates: ['MAX_PER_ITEM_EXCEEDED', 'PROFIT_BELOW_MIN'],
        overrideReason: 'bundled with two pins that clear on their own',
      }),
    );
    store.commit(purchase({ itemId: 'pin-02' }));

    // ⛔ `derivedState()`, never `state()`. After a commit the cache holds the
    // engine's own output, so `state().items` would answer from memory and
    // this test would pass with the column dropped on write — measured, by
    // planting exactly that.
    const items = store.derivedState().items;
    expect(items['pin-01']?.overrodeGates).toEqual(['MAX_PER_ITEM_EXCEEDED', 'PROFIT_BELOW_MIN']);
    expect(items['pin-01']?.overrideReason).toBe(
      'bundled with two pins that clear on their own',
    );
    expect(items['pin-02']?.overrodeGates).toBeUndefined();
  });

  // The fast path reads the items table; the derived path replays the commands.
  // If the column were dropped on write, or parsed differently on read, these
  // two would disagree — which is the whole point of reconcile().
  it('reconciles: the stored item agrees with the replayed one', () => {
    const store = freshStore();
    store.commit(
      purchase({
        itemId: 'pin-01',
        overrodeGates: ['MAX_PER_ITEM_EXCEEDED'],
        overrideReason: 'seller would not split the lot',
      }),
    );
    expect(reconcile(store).ok).toBe(true);
  });

  // An override is a fact about the PURCHASE. Nothing later in an item's life
  // creates or erases one, so a sale must not quietly clear it.
  it('is not erased by a later sale', () => {
    const store = freshStore();
    store.commit(
      purchase({
        itemId: 'pin-01',
        overrodeGates: ['MAX_PER_ITEM_EXCEEDED'],
        overrideReason: 'seller would not split the lot',
      }),
    );
    store.commit({
      type: 'SALE',
      itemId: 'pin-01',
      grossProceedsCents: 3_000,
      occurredAt: T0,
    });
    const item = store.derivedState().items['pin-01'];
    expect(item?.state).toBe('SOLD');
    expect(item?.overrodeGates).toEqual(['MAX_PER_ITEM_EXCEEDED']);
    expect(reconcile(store).ok).toBe(true);
  });
});
