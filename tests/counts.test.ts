/**
 * A market count, and the notation it arrives in.
 *
 * ⛔ **Two of the three forms break the naive parses**, and the consequence is
 * money: `parseInt("240,000+")` is 240, a thousandfold under, and at 240 active
 * an item clears every ceiling in the policy.
 *
 * ⚡ These moved out of the adapter's suite at 6.1.2, when the FORM started
 * accepting the same notation — the operator is reading `"240,000+"` off eBay,
 * so a typed count and a fetched one are the same string.
 */

import { describe, expect, it } from 'vitest';
import { parseCount } from '@/core/counts.js';

describe('B79 — one field, three forms, and two naive parses are catastrophic', () => {
  it('reads a clean integer as exact', () => {
    const r = parseCount('122956');
    expect(r).toEqual({ ok: true, value: 122_956, isFloor: false });
  });

  it('⛔ reads "240,000+" as 240000 AND as a floor', () => {
    // parseInt gives 240 — a thousandfold under. Number gives NaN.
    expect(parseInt('240,000+', 10)).toBe(240);
    expect(Number('240,000+')).toBeNaN();
    expect(parseCount('240,000+')).toEqual({
      ok: true,
      value: 240_000,
      isFloor: true,
    });
  });

  it('reads comma grouping without a plus as exact', () => {
    expect(parseCount('72,000')).toEqual({ ok: true, value: 72_000, isFloor: false });
  });

  it('⛔ REFUSES null — the documented third form', () => {
    // "The vendor does not know how many" and "there are none" are different
    // facts, and only one of them is safe to feed a gate.
    expect(parseCount(null).ok).toBe(false);
    expect(parseCount(undefined).ok).toBe(false);
  });

  it('refuses anything it cannot read rather than defaulting it', () => {
    for (const raw of ['', '  ', 'about 500', '1,2,3', '1.5', '-5', 'NaN', '1234,567', {}, []]) {
      expect(parseCount(raw).ok, JSON.stringify(raw)).toBe(false);
    }
  });

  it('accepts a plain number, which would be a vendor change not a bad value', () => {
    expect(parseCount(133_392)).toEqual({ ok: true, value: 133_392, isFloor: false });
    expect(parseCount(1.5).ok).toBe(false);
    expect(parseCount(-1).ok).toBe(false);
  });

  it('refuses a count too large to hold exactly', () => {
    expect(parseCount('9007199254740993').ok).toBe(false);
  });
});
