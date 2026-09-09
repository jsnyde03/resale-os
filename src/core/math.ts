/**
 * Pure numeric helpers. No I/O, no clock, no randomness.
 */

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

/**
 * Math.round() rounds -0.5 to -0 (toward +Infinity), which makes rounding
 * asymmetric around zero and lets a cent go missing on negative amounts.
 * Everything financial uses this instead.
 */
export function roundHalfAwayFromZero(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/**
 * JS distinguishes -0 from 0 under Object.is, and negating a zero balance
 * produces -0. That is never a meaningful money value and it makes equality
 * assertions lie, so every sign flip in this codebase goes through here.
 */
export function normalizeZero(x: number): number {
  return x === 0 ? 0 : x;
}

export function sum(xs: readonly number[]): number {
  let total = 0;
  for (const x of xs) total += x;
  return total;
}

export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : sum(xs) / xs.length;
}

/** Population standard deviation. 0 for fewer than two samples. */
export function stddev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / xs.length);
}

/** Coefficient of variation. 0 when the mean is 0 or there is too little data. */
export function coefficientOfVariation(xs: readonly number[]): number {
  const m = mean(xs);
  if (m === 0) return 0;
  return stddev(xs) / Math.abs(m);
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid]!;
  return (s[mid - 1]! + s[mid]!) / 2;
}
