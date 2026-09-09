/**
 * B30: one completeness check for every stored config.
 *
 * The bug being closed shipped four times in two days — a stored config
 * predating a field the code now requires, arriving as `undefined` and coming
 * out of a calculation as `NaN`. The fix that matters is not "more checks", it
 * is that the check is **derived from the defaults**, so a new field is
 * required automatically and nobody has to remember.
 */

import { describe, expect, it } from 'vitest';
import { missingConfigKeys, assertConfigShape } from '@/core/config-shape.js';
import {
  UNCONFIGURED_TAX_PROFILE,
  assertValidTaxProfile,
  TaxProfileError,
  type TaxProfile,
} from '@/core/tax/profile.js';

describe('completeness is derived from the defaults', () => {
  it('accepts a value with every default key present', () => {
    expect(missingConfigKeys(UNCONFIGURED_TAX_PROFILE, UNCONFIGURED_TAX_PROFILE)).toEqual([]);
  });

  it('names every missing key, not just the first', () => {
    const { expectedW2WagesCents, stateIncomeTaxBps, ...partial } = UNCONFIGURED_TAX_PROFILE;
    void expectedW2WagesCents;
    void stateIncomeTaxBps;
    expect(missingConfigKeys(UNCONFIGURED_TAX_PROFILE, partial).sort()).toEqual([
      'expectedW2WagesCents',
      'stateIncomeTaxBps',
    ]);
  });

  it('treats an explicit null as present — null is a real stored value', () => {
    // `stateRateBasis` and `itemizedDeductionCents` both use null to mean
    // "deliberately not set". Rejecting null would break every valid profile.
    const withNulls = { ...UNCONFIGURED_TAX_PROFILE, stateRateBasis: null };
    expect(missingConfigKeys(UNCONFIGURED_TAX_PROFILE, withNulls)).toEqual([]);
  });

  it('treats undefined as missing, because that is the failure being caught', () => {
    const undef = { ...UNCONFIGURED_TAX_PROFILE, stateIncomeTaxBps: undefined };
    expect(missingConfigKeys(UNCONFIGURED_TAX_PROFILE, undef)).toEqual(['stateIncomeTaxBps']);
  });

  it('does not require a key the defaults do not have — optionality for free', () => {
    // `stateJurisdiction` is genuinely optional and absent from the defaults,
    // so a profile without it is complete.
    expect(UNCONFIGURED_TAX_PROFILE).not.toHaveProperty('stateJurisdiction');
    expect(missingConfigKeys(UNCONFIGURED_TAX_PROFILE, UNCONFIGURED_TAX_PROFILE)).toEqual([]);
  });

  it('rejects a non-object outright', () => {
    expect(missingConfigKeys(UNCONFIGURED_TAX_PROFILE, null)).toEqual(['(the whole object)']);
    expect(missingConfigKeys(UNCONFIGURED_TAX_PROFILE, 'nope')).toEqual(['(the whole object)']);
  });

  it('tells the operator the command that repairs it', () => {
    // A message that names the problem without naming the fix sends someone
    // hunting. Both stored configs have a repair command; it goes in the error.
    expect(() =>
      assertConfigShape({ a: 1 }, {}, 'thing', 'policy adopt-defaults', (m) => {
        throw new Error(m);
      }),
    ).toThrow(/older than the code\. Run: policy adopt-defaults/);
  });
});

describe('the tax profile uses it', () => {
  it('refuses a stored profile that predates a field', () => {
    // ⛔ This is the `minSellThroughBps` bug, which reached a gate as NaN and
    // printed "vs a NaN% minimum". It failed closed by luck.
    const stale = { ...UNCONFIGURED_TAX_PROFILE } as Record<string, unknown>;
    delete stale.stateIncomeTaxBps;
    expect(() => assertValidTaxProfile(stale as unknown as TaxProfile)).toThrow(TaxProfileError);
    expect(() => assertValidTaxProfile(stale as unknown as TaxProfile)).toThrow(
      /missing stateIncomeTaxBps/,
    );
  });

  it('still accepts a complete one', () => {
    expect(() => assertValidTaxProfile(UNCONFIGURED_TAX_PROFILE)).not.toThrow();
  });
});
