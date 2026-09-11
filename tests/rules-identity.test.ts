/**
 * The rules fingerprint.
 *
 * ⛔ The claim under test is narrow and load-bearing: **this string moves when
 * what the gates DO moves, and not otherwise.** A fingerprint that never
 * changes marks nothing stale; one that changes constantly marks everything
 * stale, and a flag that is always on is a flag nobody reads.
 */

import { describe, expect, it } from 'vitest';
import { rulesIdentity, rulesAreStale } from '@/core/capital/rules-identity.js';

describe('the rules identity is derived, not maintained', () => {
  it('is a short stable hex string', () => {
    expect(rulesIdentity()).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is the same every time it is asked', () => {
    // ⚠️ Not a tautology: it is computed by RUNNING the evaluator, so a gate
    // that read a clock or a random would show up here as instability.
    const first = rulesIdentity();
    for (let i = 0; i < 50; i++) expect(rulesIdentity()).toBe(first);
  });
});

describe('staleness fails toward UNKNOWN', () => {
  it('⛔ treats an absent identity as stale, never as a match', () => {
    // Every score recorded before this existed has none, and "scored under
    // rules we can no longer name" is exactly B88's situation.
    expect(rulesAreStale(null)).toBe(true);
    expect(rulesAreStale(undefined)).toBe(true);
    expect(rulesAreStale('')).toBe(true);
  });

  it('treats a different identity as stale', () => {
    expect(rulesAreStale('deadbeef')).toBe(true);
  });

  it('and the control — the current identity is NOT stale', () => {
    // Without this the three above pass for a function that returns true
    // always, which would mark every score in the fund stale forever.
    expect(rulesAreStale(rulesIdentity())).toBe(false);
  });
});
