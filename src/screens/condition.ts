/**
 * Two judgement calls, as words instead of basis points.
 *
 * ⛔ **Backlog B64 and B71.** No screen took either, so every opportunity was
 * scored with `hassleBps` at the schema default and condition **absent** — which
 * `scoreConfidence` reads as a deliberately pessimistic 40%. That was harmless
 * while confidence was advisory. **D14 made it decisive**, and the case being
 * sourced is the one where it is most often wrong: sealed retail stock off a
 * clearance rack is the thing you are *most* certain about, and it was being
 * scored as though you had not looked at it.
 *
 * ⚠️ **These numbers are JUDGEMENT, and they are anchored rather than invented.**
 * Each scale passes through the value the system already used as its default, so
 * an operator who picks the middle option gets exactly today's behaviour and
 * nothing moves underneath them. Everything above and below is a stated opinion
 * about evidence quality, visible here, and changeable in one place.
 *
 * ⛔ Confidence is DATA QUALITY, never optimism. `SEALED` scores high because you
 * can see what the thing is, not because it is worth more.
 */

import type { Bps } from '../core/money.js';

export const CONDITIONS = ['SEALED', 'LIKE_NEW', 'USED_CHECKED', 'UNKNOWN'] as const;
export type Condition = (typeof CONDITIONS)[number];

/**
 * ⚠️ `UNKNOWN` is 4,000 on purpose: it is `CONFIDENCE_DEFAULTS.conditionBps`,
 * the value used when nothing is supplied. Choosing it must be identical to not
 * choosing at all, or adding this field would silently re-score every item.
 */
export const CONDITION_CONFIDENCE_BPS: Readonly<Record<Condition, Bps>> = {
  SEALED: 9_500,
  LIKE_NEW: 8_000,
  USED_CHECKED: 6_000,
  UNKNOWN: 4_000,
};

export const CONDITION_LABELS: Readonly<Record<Condition, string>> = {
  SEALED: 'Sealed',
  LIKE_NEW: 'Like new',
  USED_CHECKED: 'Used, checked',
  UNKNOWN: 'Not sure',
};

export const HASSLES = ['EASY', 'NORMAL', 'AWKWARD', 'HEAVY'] as const;
export type Hassle = (typeof HASSLES)[number];

/**
 * ⚠️ `NORMAL` is 2,000 for the same reason: it is the schema default for
 * `hassleBps`, so the middle option reproduces today's score exactly.
 *
 * Hassle is about the WORK, not the risk of loss: packing time, awkward postage,
 * the parcel you have to drive somewhere. It feeds the ops component of the Buy
 * Score, which is why a heavy item can be a worse buy than a light one at the
 * same margin.
 */
export const HASSLE_BPS: Readonly<Record<Hassle, Bps>> = {
  EASY: 500,
  NORMAL: 2_000,
  AWKWARD: 5_000,
  HEAVY: 8_000,
};

export const HASSLE_LABELS: Readonly<Record<Hassle, string>> = {
  EASY: 'Envelope',
  NORMAL: 'Normal box',
  AWKWARD: 'Bulky or fragile',
  HEAVY: 'Heavy or oversize',
};

export const DEFAULT_CONDITION: Condition = 'UNKNOWN';
export const DEFAULT_HASSLE: Hassle = 'NORMAL';
