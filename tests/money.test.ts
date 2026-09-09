import { describe, expect, it } from 'vitest';
import {
  allocate,
  applyBps,
  assertCents,
  formatCents,
  MoneyError,
  parseDollars,
  toBps,
  toDollarsInput,
} from '@/core/money.js';
import { coefficientOfVariation, median, roundHalfAwayFromZero } from '@/core/math.js';

describe('integer cents', () => {
  it('rejects non-integers', () => {
    expect(() => assertCents(1.5)).toThrow(MoneyError);
    expect(() => assertCents('100' as unknown as number)).toThrow(MoneyError);
    expect(() => assertCents(Number.MAX_SAFE_INTEGER + 2)).toThrow(MoneyError);
  });

  it('rounds half away from zero, symmetrically', () => {
    expect(roundHalfAwayFromZero(0.5)).toBe(1);
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    // The behaviour Math.round gets wrong, which is why we do not use it.
    expect(Math.round(-0.5)).toBe(-0);
  });
});

describe('applyBps', () => {
  it('computes percentages exactly', () => {
    expect(applyBps(10_000, 2_500)).toBe(2_500);
    expect(applyBps(333, 2_500)).toBe(83); // 83.25 -> 83
    expect(applyBps(334, 2_500)).toBe(84); // 83.5  -> 84 (away from zero)
    expect(applyBps(0, 9_999)).toBe(0);
  });

  it('is symmetric across zero', () => {
    expect(applyBps(-334, 2_500)).toBe(-84);
  });

  it('rejects negative rates', () => {
    expect(() => applyBps(100, -1)).toThrow(MoneyError);
  });
});

describe('allocate', () => {
  it('splits exactly, with no cent created or destroyed', () => {
    const parts = allocate(100, [2_000, 1_000, 7_000]);
    expect(parts).toEqual([20, 10, 70]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('hands remainders to the largest fractional part first', () => {
    // 10 cents across 3 equal ways: 3.33 each, 1 cent left over.
    const parts = allocate(10, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10);
    expect(parts).toEqual([4, 3, 3]);
  });

  it('sums to the total for every amount in a wide sweep', () => {
    const weights = [2_000, 1_000, 7_000];
    for (let total = 0; total <= 5_000; total += 1) {
      const parts = allocate(total, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(parts.every(Number.isInteger)).toBe(true);
    }
  });

  it('handles negative totals symmetrically', () => {
    expect(allocate(-100, [2_000, 1_000, 7_000])).toEqual([-20, -10, -70]);
    expect(allocate(-10, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(-10);
  });

  it('rejects degenerate weights', () => {
    expect(() => allocate(100, [])).toThrow(MoneyError);
    expect(() => allocate(100, [0, 0])).toThrow(MoneyError);
    expect(() => allocate(100, [-1, 2])).toThrow(MoneyError);
  });
});

describe('toBps', () => {
  it('expresses ratios in basis points', () => {
    expect(toBps(50, 100)).toBe(5_000);
    expect(toBps(1, 3)).toBe(3_333);
    expect(toBps(1, 0)).toBe(0);
  });
});

describe('formatting and parsing', () => {
  it('round-trips through dollars', () => {
    for (const cents of [0, 1, 99, 100, 12_345, 1_234_567]) {
      expect(parseDollars(formatCents(cents))).toBe(cents);
      // normalizeZero() means -0 never escapes; `-0` here would be the test's bug.
      expect(parseDollars(formatCents(-cents))).toBe(cents === 0 ? 0 : -cents);
    }
  });

  it('rejects sub-cent input rather than rounding it silently', () => {
    expect(() => parseDollars('1.234')).toThrow(MoneyError);
    expect(() => parseDollars('abc')).toThrow(MoneyError);
  });
});

describe('statistics helpers', () => {
  it('computes CV and median', () => {
    expect(coefficientOfVariation([10, 10, 10])).toBe(0);
    expect(coefficientOfVariation([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe('toDollarsInput — the inverse of parseDollars', () => {
  it('round-trips every amount parseDollars accepts', () => {
    for (const cents of [0, 1, 29, 57, 100, 113, 201, 1_299, 50_000, 18_450_000, -1, -1_299]) {
      expect(parseDollars(toDollarsInput(cents))).toBe(cents);
    }
  });

  it('is plain and typeable — no currency symbol, no separators', () => {
    // ⚠️ The reason this exists: `formatCents` gives "$1,234.56", which cannot
    // be typed back into a number field, so a form reaches for `cents / 100`.
    // That arithmetic is now banned in screens by `npm run lint:imports`.
    expect(toDollarsInput(123_456)).toBe('1234.56');
    expect(toDollarsInput(500)).toBe('5.00');
    expect(toDollarsInput(5)).toBe('0.05');
    expect(toDollarsInput(0)).toBe('0.00');
    expect(toDollarsInput(-500)).toBe('-5.00');
  });

  it('pads the cents rather than truncating them', () => {
    expect(toDollarsInput(1_205)).toBe('12.05');
    expect(toDollarsInput(1_250)).toBe('12.50');
  });

  it('refuses a non-integer, like every other money function here', () => {
    expect(() => toDollarsInput(12.5)).toThrow();
  });
});
