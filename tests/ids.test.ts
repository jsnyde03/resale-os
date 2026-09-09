/**
 * Item ids are hashed into the ledger and are permanent, so they get a test
 * rather than a glance.
 */

import { describe, expect, it } from 'vitest';
import { itemIdFrom } from '@/core/ids.js';

describe('itemIdFrom', () => {
  it('slugs a name and numbers it from the event count', () => {
    expect(itemIdFrom('Lego Millennium Falcon', 6)).toBe('lego-millennium-falcon-0007');
  });

  it('collapses punctuation and spacing into single hyphens', () => {
    expect(itemIdFrom('  Star Wars: Episode  IV  ', 0)).toBe('star-wars-episode-iv-0001');
  });

  it('never emits a leading or trailing hyphen, even after truncation', () => {
    // 24 characters lands mid-word or on a separator; either way the id must
    // not end in one.
    const id = itemIdFrom('aaaaaaaaaaaaaaaaaaaaaaa bbbb', 0);
    expect(id.startsWith('-')).toBe(false);
    expect(id).toBe('aaaaaaaaaaaaaaaaaaaaaaa-0001');
    // The slug is exactly the 24 characters before the number.
    expect(id.slice(0, -5)).toHaveLength(23);
  });

  it('falls back to "item" when the name has nothing usable in it', () => {
    expect(itemIdFrom('!!!', 41)).toBe('item-0042');
    expect(itemIdFrom('', 0)).toBe('item-0001');
  });

  it('keeps non-Latin names addressable rather than producing an empty slug', () => {
    expect(itemIdFrom('ポケモン', 3)).toBe('item-0004');
  });

  // ⛔ The property that matters: two purchases in a row cannot collide, even
  // with the same name, because the event count moved.
  it('does not collide for the same name at different points in the ledger', () => {
    expect(itemIdFrom('Lego set', 6)).not.toBe(itemIdFrom('Lego set', 7));
  });

  // ⚠️ Four digits of padding, so ids sort in ledger order up to 9,999 events
  // and stop doing so after that. At this fund's rate that is years away, and
  // sort order is a convenience rather than something the ledger relies on —
  // but the limit is asserted rather than assumed.
  it('sorts in ledger order below ten thousand events, and says where it stops', () => {
    const ids = [9, 98, 997, 9_998].map((n) => itemIdFrom('pin', n));
    expect(ids).toEqual(['pin-0010', 'pin-0099', 'pin-0998', 'pin-9999']);
    expect([...ids].sort()).toEqual(ids);
    // The next one is longer, and lexical order gives up here.
    expect(itemIdFrom('pin', 9_999)).toBe('pin-10000');
    expect(['pin-9999', 'pin-10000'].sort()).toEqual(['pin-10000', 'pin-9999']);
  });
});
