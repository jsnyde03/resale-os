/**
 * Integer-cent money. There are no floats in this file's outputs, ever.
 *
 * `Cents` is a signed integer number of cents.
 * `Bps`   is an integer number of basis points; 10000 bps = 100%.
 */

import { normalizeZero, roundHalfAwayFromZero, sum } from './math.js';

export { roundHalfAwayFromZero } from './math.js';

export type Cents = number;
export type Bps = number;

export const BPS_ONE = 10_000;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function assertCents(value: unknown, label = 'amount'): asserts value is Cents {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new MoneyError(`${label} must be an integer number of cents, got ${String(value)}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} exceeds safe integer range: ${value}`);
  }
}

export function assertNonNegativeCents(value: unknown, label = 'amount'): asserts value is Cents {
  assertCents(value, label);
  if ((value as number) < 0) {
    throw new MoneyError(`${label} must be >= 0, got ${String(value)}`);
  }
}

export function assertBps(value: unknown, label = 'rate'): asserts value is Bps {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new MoneyError(`${label} must be an integer number of basis points, got ${String(value)}`);
  }
  if ((value as number) < 0) {
    throw new MoneyError(`${label} must be >= 0 bps, got ${String(value)}`);
  }
}

/** amount * bps / 10000, rounded half away from zero. Always returns an integer. */
export function applyBps(amount: Cents, rate: Bps): Cents {
  assertCents(amount, 'amount');
  assertBps(rate, 'rate');
  return normalizeZero(roundHalfAwayFromZero((amount * rate) / BPS_ONE));
}

/** The ratio a/b expressed in basis points, rounded. b === 0 yields 0. */
export function toBps(numerator: number, denominator: number): Bps {
  if (denominator === 0) return 0;
  return normalizeZero(roundHalfAwayFromZero((numerator / denominator) * BPS_ONE));
}

/**
 * Split `total` across weights so the parts sum to `total` EXACTLY.
 *
 * Largest-remainder method: floor each share, then hand the leftover cents out
 * one at a time in descending fractional-remainder order, ties broken by index.
 * Works for negative totals by allocating the magnitude and flipping the signs,
 * which keeps the split symmetric around zero.
 */
export function allocate(total: Cents, weights: readonly number[]): Cents[] {
  assertCents(total, 'total');
  if (weights.length === 0) {
    throw new MoneyError('allocate() requires at least one weight');
  }
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new MoneyError('allocate() weights must be finite and >= 0');
  }

  const totalWeight = sum(weights);
  if (totalWeight <= 0) {
    throw new MoneyError('allocate() weights must sum to more than 0');
  }

  const negative = total < 0;
  const magnitude = Math.abs(total);

  const exact = weights.map((w) => (magnitude * w) / totalWeight);
  const parts = exact.map((x) => Math.floor(x));
  let remainder = magnitude - sum(parts);

  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => (b.frac - a.frac) || (a.i - b.i));

  let cursor = 0;
  while (remainder > 0) {
    // Guarded by totalWeight > 0, so `order` is non-empty.
    const target = order[cursor % order.length]!;
    parts[target.i] = parts[target.i]! + 1;
    remainder -= 1;
    cursor += 1;
  }

  return negative ? parts.map((p) => normalizeZero(-p)) : parts;
}

/** "$1,234.56" — presentation only. Never feed this back into arithmetic. */
export function formatCents(amount: Cents): string {
  assertCents(amount, 'amount');
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  const cents = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}$${dollars}.${cents}`;
}

/** Parse "12.34", "$12.34", "12" into cents. Rejects anything sub-cent. */
/**
 * Cents as a plain editable string: `1234.56`, no `$`, no thousands separator.
 *
 * ⚠️ This exists so a form never divides by 100 itself. `formatCents` is for
 * DISPLAY and produces `$1,234.56`, which cannot be typed back into a number
 * field; the obvious workaround is `cents / 100`, and that is the arithmetic
 * `views.ts` forbids screens from doing. It is the exact inverse of
 * `parseDollars`, and a test asserts the round trip.
 */
export function toDollarsInput(cents: Cents): string {
  assertCents(cents, 'toDollarsInput');
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;
  return `${negative ? '-' : ''}${whole}.${String(frac).padStart(2, '0')}`;
}

export function parseDollars(input: string): Cents {
  const cleaned = input.trim().replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new MoneyError(`cannot parse "${input}" as a dollar amount`);
  }
  const negative = cleaned.startsWith('-');
  const [whole, frac = ''] = cleaned.replace('-', '').split('.') as [string, string?];
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return negative ? normalizeZero(-cents) : cents;
}
