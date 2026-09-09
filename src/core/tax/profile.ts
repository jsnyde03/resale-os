/**
 * The owner's tax situation — the part of a correct reserve that no amount of
 * ledger data can derive.
 *
 * A reserve cannot be correct without knowing the marginal rate the business
 * income lands on, and that depends on filing status, other household income,
 * and the state. Those are facts about the owner, not about the fund.
 *
 * Until they are supplied, `configured` is false and the income-tax component
 * is **not estimated at all** — the reserve says so rather than guessing. A
 * confident wrong number is worse than an honest gap.
 */

import { assertConfigShape } from '../config-shape.js';
import { assertCents, type Bps, type Cents } from '../money.js';
import { FILING_STATUSES, type FilingStatus } from './tables.js';

export interface TaxProfile {
  /** False until the owner supplies their situation. */
  readonly configured: boolean;
  readonly filingStatus: FilingStatus;
  /**
   * Expected non-business income for the year that lands on the same return:
   * W-2 wages, a spouse's income, interest, dividends. This is what decides
   * which bracket the business income falls into, so it matters more than any
   * other single input.
   */
  readonly expectedOtherIncomeCents: Cents;
  /**
   * W-2 wages already subject to Social Security this year. They consume the
   * wage base before self-employment income does.
   */
  readonly expectedW2WagesCents: Cents;
  /**
   * Combined state + local income tax, as a flat MARGINAL rate. 0 for no-tax
   * states. In states with local income tax (Maryland, Ohio, Pennsylvania,
   * Indiana, New York City) this is state + local added together, because the
   * business income is exposed to both.
   */
  readonly stateIncomeTaxBps: Bps;
  /**
   * Optional. Naming a jurisdiction switches the state calculation from the
   * flat rate above to that state's real brackets plus its local rate.
   *
   * ⚠️ Additive on purpose: a profile without it keeps working exactly as it
   * did, so adding this field does not invalidate anything already stored —
   * the failure this project has already shipped twice.
   */
  readonly stateJurisdiction?: { readonly state: string; readonly locality: string } | null;
  /**
   * Where `stateIncomeTaxBps` came from, in words.
   *
   * ⚠️ A bare rate is unexplainable six months later, and a wrong one is
   * invisible. This is the same discipline the tax tables get: the number
   * carries its own derivation and its own confidence, so a reader can check it
   * instead of trusting it.
   *
   * e.g. "MD 4.75% state + <county> 2.40%, recalled 2026-09-08, UNVERIFIED"
   */
  readonly stateRateBasis: string | null;
  /**
   * Whether the state allows the federal Section 199A (QBI) deduction.
   *
   * ⚠️ **Almost none do**, because most states start from federal *adjusted
   * gross* income, which is before QBI. Defaulting this to `true` would apply
   * the state rate to a base that is 20% too small on business income.
   * Maryland, for one, does not allow it.
   */
  readonly stateAllowsQbiDeduction: boolean;
  /** Deduction taken on the return; null means take the standard deduction. */
  readonly itemizedDeductionCents: Cents | null;
  /** Section 199A: a 20% deduction on qualified business income. */
  readonly claimQbiDeduction: boolean;
}

/**
 * Deliberately NOT a guess. `configured: false` makes the income-tax component
 * abstain, and every consumer reports that it abstained.
 */
export const UNCONFIGURED_TAX_PROFILE: TaxProfile = {
  configured: false,
  filingStatus: 'SINGLE',
  expectedOtherIncomeCents: 0,
  expectedW2WagesCents: 0,
  stateIncomeTaxBps: 0,
  stateRateBasis: null,
  itemizedDeductionCents: null,
  claimQbiDeduction: true,
  stateAllowsQbiDeduction: false,
};

export class TaxProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaxProfileError';
  }
}

export function validateTaxProfile(profile: TaxProfile): void {
  // ⛔ B30: completeness first, driven off the defaults rather than a list of
  // fields somebody has to remember to extend. Everything below checks that a
  // field is SENSIBLE; this checks that it is THERE.
  assertConfigShape(
    UNCONFIGURED_TAX_PROFILE,
    profile,
    'tax profile',
    'tax profile set --filing=... --other-income=... --w2-wages=...',
    (m) => {
      throw new TaxProfileError(m);
    },
  );
  if (!(FILING_STATUSES as readonly string[]).includes(profile.filingStatus)) {
    throw new TaxProfileError(`unknown filing status "${profile.filingStatus}"`);
  }
  try {
    assertCents(profile.expectedOtherIncomeCents, 'expectedOtherIncomeCents');
    assertCents(profile.expectedW2WagesCents, 'expectedW2WagesCents');
    if (profile.itemizedDeductionCents !== null) {
      assertCents(profile.itemizedDeductionCents, 'itemizedDeductionCents');
    }
  } catch (err) {
    throw new TaxProfileError((err as Error).message);
  }
  for (const [key, value] of [
    ['expectedOtherIncomeCents', profile.expectedOtherIncomeCents],
    ['expectedW2WagesCents', profile.expectedW2WagesCents],
  ] as const) {
    if (value < 0) throw new TaxProfileError(`${key} must be >= 0, got ${value}`);
  }
  if (
    !Number.isInteger(profile.stateIncomeTaxBps) ||
    profile.stateIncomeTaxBps < 0 ||
    profile.stateIncomeTaxBps > 3_000
  ) {
    // 30% would be higher than any US state; anything above it is a typo.
    throw new TaxProfileError(
      `stateIncomeTaxBps must be an integer 0..3000, got ${profile.stateIncomeTaxBps}`,
    );
  }
  if (typeof profile.claimQbiDeduction !== 'boolean') {
    throw new TaxProfileError('claimQbiDeduction must be a boolean');
  }
  if (typeof profile.stateAllowsQbiDeduction !== 'boolean') {
    throw new TaxProfileError('stateAllowsQbiDeduction must be a boolean');
  }
  if (profile.stateRateBasis !== null && typeof profile.stateRateBasis !== 'string') {
    throw new TaxProfileError('stateRateBasis must be a string or null');
  }
  if (profile.stateIncomeTaxBps > 0 && !profile.stateRateBasis) {
    // A non-zero state rate with no stated derivation is exactly the number
    // nobody can check later. Cheap to require, expensive to omit.
    throw new TaxProfileError(
      'stateRateBasis is required whenever stateIncomeTaxBps is greater than 0: ' +
        'say where the rate came from',
    );
  }
}

export function assertValidTaxProfile(profile: TaxProfile): TaxProfile {
  validateTaxProfile(profile);
  return profile;
}
