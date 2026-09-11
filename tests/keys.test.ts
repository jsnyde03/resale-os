/**
 * The vendor keys, and the advice the app gives about them.
 *
 * ⛔ **The claim worth pinning is that the app never tells the operator to do
 * something impossible.** The AUTH failure said *"check it in Settings"* for a
 * key that Metro inlines at build time, into a field that does not exist. That
 * is a defect no type checks and no gate catches — it is a sentence.
 */

import { describe, expect, it } from 'vitest';
import { keyStatus, keysStatus, VENDOR_KEYS } from '@/screens/keys.js';
import { fillFromMarket, type SourcingForm } from '@/screens/sourcing.js';
import type { MarketFailureReason } from '@/core/market.js';

/** ⛔ Driven through the REAL path, not read off the constant: what the
 *  operator sees is whatever `fillFromMarket` returns, and a message the
 *  screen never reaches is not the message the screen shows. */
const blank: SourcingForm = {
  name: '', category: '', price: '', resale: '', sold90: '', active: '',
};
const messageFor = (reason: MarketFailureReason): string => {
  const { status } = fillFromMarket(blank, { ok: false, reason, detail: 'vendor said so' });
  if (status.kind !== 'UNAVAILABLE') throw new Error('expected an unavailable status');
  return status.message;
};
const ALL_REASONS: MarketFailureReason[] = [
  'OFFLINE', 'QUOTA_EXCEEDED', 'RATE_LIMITED', 'UNPARSEABLE', 'AUTH', 'VENDOR',
];

const soldcomps = VENDOR_KEYS[0]!;
const upcitemdb = VENDOR_KEYS[1]!;

describe('⛔ the app never advises an impossible action', () => {
  it('the refused-key message does not send the operator to Settings', () => {
    // There is no field there, and there cannot be one without a storage
    // decision: `portable.ts` exports config wholesale, so a key stored there
    // would travel in every backup.
    expect(messageFor('AUTH')).not.toMatch(/settings/i);
  });

  it('⚠️ and every failure still ends by pointing at the manual path', () => {
    // The original rule, which the fix must not break: all six say what to do
    // instead, because "what is wrong" alone leaves someone standing in an
    // aisle wondering whether to wait.
    for (const reason of ALL_REASONS) {
      expect(messageFor(reason).toLowerCase(), reason).toMatch(/type the counts|wait a moment/);
    }
  });
});

describe('a key is present or it is absent, and the difference is said plainly', () => {
  it('reports a set key as set', () => {
    expect(keyStatus(soldcomps, 'abc123').present).toBe(true);
  });

  it('⛔ treats blank and whitespace as ABSENT, not as a key', () => {
    // A build that sets the variable to "" or a stray space produces a key the
    // adapter sends and the vendor refuses — surfacing mid-decision as an AUTH
    // failure, which sends the operator after the wrong problem.
    expect(keyStatus(soldcomps, '').present).toBe(false);
    expect(keyStatus(soldcomps, '   ').present).toBe(false);
    expect(keyStatus(soldcomps, undefined).present).toBe(false);
  });

  it('says what stops working without each one, and they differ', () => {
    // ⚠️ Absence is NORMAL for the barcode vendor — its trial tier answers
    // without a key — and abnormal for the market one, which is the fund's
    // only automated route. Reporting both as "missing" would be wrong twice.
    expect(keyStatus(soldcomps, undefined).detail).toContain('typed by hand');
    expect(keyStatus(upcitemdb, undefined).detail).toContain('trial tier');
  });

  it('⚠️ never claims a key can be changed here', () => {
    // It is inlined into the bundle at build time. Saying otherwise would
    // recreate the defect this file exists to close.
    const set = keyStatus(soldcomps, 'abc123').detail;
    expect(set).toMatch(/build time/);
    expect(set).not.toMatch(/settings/i);
  });

  it('maps a whole environment, keyed by vendor id', () => {
    const rows = keysStatus({ soldcomps: 'x', upcitemdb: '' });
    expect(rows.map((r) => [r.id, r.present])).toEqual([
      ['soldcomps', true],
      ['upcitemdb', false],
    ]);
  });
});
