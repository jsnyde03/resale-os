/**
 * What the year's tax actually is, and therefore what one sale adds to it.
 *
 * ⚠️ **The central idea: tax is annual and non-linear, so a per-sale reserve
 * cannot be a percentage.** The $400 self-employment threshold is a cliff. The
 * Social Security wage base is a ceiling. Income tax brackets are steps. A flat
 * rate is wrong on both sides of every one of those.
 *
 * So the reserve for a sale is the *difference* it makes to the year:
 *
 *     reserve = annualTax(ytdIncome + thisProfit) - annualTax(ytdIncome)
 *
 * That is correct across every cliff, ceiling and step by construction, it
 * self-corrects as the year fills in, and it needs no special cases.
 *
 * Pure. No clock, no I/O — the year and the year-to-date figures are passed in.
 */

import { applyBps, roundHalfAwayFromZero, type Bps, type Cents } from '../money.js';
import type { TaxProfile } from './profile.js';
import type { Bracket, FilingStatus, TaxTables } from './tables.js';
import { stateTable } from './state.js';

export interface SelfEmploymentTax {
  /** 92.35% of net SE earnings. Zero below the $400 threshold. */
  readonly netEarningsCents: Cents;
  readonly socialSecurityCents: Cents;
  readonly medicareCents: Cents;
  readonly additionalMedicareCents: Cents;
  readonly totalCents: Cents;
  /** Half of SE tax, deductible above the line before income tax. */
  readonly halfDeductionCents: Cents;
  /** True when earnings were under the $400 floor, so none is owed. */
  readonly belowThreshold: boolean;
  /** True when the Social Security portion hit the wage base. */
  readonly wageBaseReached: boolean;
}

export interface AnnualTax {
  readonly netBusinessIncomeCents: Cents;
  readonly selfEmployment: SelfEmploymentTax;
  readonly federalIncomeCents: Cents;
  readonly stateIncomeCents: Cents;
  readonly qbiDeductionCents: Cents;
  readonly taxableIncomeCents: Cents;
  /** The base the state rate was applied to. Differs when QBI is added back. */
  readonly stateTaxableIncomeCents: Cents;
  readonly totalCents: Cents;
  /** False when no tax profile is set, so income tax was not estimated. */
  readonly incomeTaxEstimated: boolean;
}

// ---------------------------------------------------------------------------
// self-employment tax
// ---------------------------------------------------------------------------

export function selfEmploymentTax(
  netBusinessIncomeCents: Cents,
  profile: TaxProfile,
  tables: TaxTables,
): SelfEmploymentTax {
  const zero: SelfEmploymentTax = {
    netEarningsCents: 0,
    socialSecurityCents: 0,
    medicareCents: 0,
    additionalMedicareCents: 0,
    totalCents: 0,
    halfDeductionCents: 0,
    belowThreshold: true,
    wageBaseReached: false,
  };

  if (netBusinessIncomeCents <= 0) return { ...zero, belowThreshold: false };

  const netEarningsCents = applyBps(netBusinessIncomeCents, tables.seEarningsFactorBps);

  // The $400 test is on net earnings, and it is a cliff: below it nothing at
  // all is owed, which a percentage-of-profit reserve gets wrong every time.
  if (netEarningsCents < tables.seMinimumEarningsCents) return zero;

  // W-2 wages consume the Social Security wage base first.
  const wageBaseRemaining = Math.max(
    0,
    tables.socialSecurityWageBaseCents - profile.expectedW2WagesCents,
  );
  const socialSecurityBase = Math.min(netEarningsCents, wageBaseRemaining);
  const socialSecurityCents = applyBps(socialSecurityBase, tables.socialSecurityRateBps);

  const medicareCents = applyBps(netEarningsCents, tables.medicareRateBps);

  const additionalMedicareThreshold =
    tables.additionalMedicareThresholdCents[profile.filingStatus];
  const combinedEarnings = profile.expectedW2WagesCents + netEarningsCents;
  const additionalMedicareBase = Math.max(0, combinedEarnings - additionalMedicareThreshold);
  const additionalMedicareCents = applyBps(
    Math.min(additionalMedicareBase, netEarningsCents),
    tables.additionalMedicareRateBps,
  );

  const totalCents = socialSecurityCents + medicareCents + additionalMedicareCents;

  return {
    netEarningsCents,
    socialSecurityCents,
    medicareCents,
    additionalMedicareCents,
    totalCents,
    // Only the regular half is deductible; the additional Medicare surtax is not.
    halfDeductionCents: Math.floor((socialSecurityCents + medicareCents) / 2),
    belowThreshold: false,
    wageBaseReached: socialSecurityBase < netEarningsCents,
  };
}

// ---------------------------------------------------------------------------
// federal income tax
// ---------------------------------------------------------------------------

/**
 * Progressive tax over any bracket set. Federal and state share this, because
 * "walk the steps" is one piece of arithmetic and two copies of it would drift.
 */
export function bracketTax(taxableIncomeCents: Cents, brackets: readonly Bracket[]): Cents {
  if (taxableIncomeCents <= 0) return 0;

  let tax = 0;
  let floor = 0;
  for (const bracket of brackets) {
    const ceiling = bracket.upToCents ?? Number.MAX_SAFE_INTEGER;
    const slice = Math.min(taxableIncomeCents, ceiling) - floor;
    if (slice > 0) tax += applyBps(slice, bracket.rateBps);
    if (taxableIncomeCents <= ceiling) break;
    floor = ceiling;
  }
  return tax;
}

/** Progressive federal tax on `taxableIncome`. */
export function federalIncomeTax(
  taxableIncomeCents: Cents,
  filingStatus: FilingStatus,
  tables: TaxTables,
): Cents {
  return bracketTax(taxableIncomeCents, tables.brackets[filingStatus]);
}

/** The rate the next dollar would be taxed at. For display, not for reserving. */
export function marginalRateBps(
  taxableIncomeCents: Cents,
  filingStatus: FilingStatus,
  tables: TaxTables,
): Bps {
  const brackets = tables.brackets[filingStatus];
  for (const bracket of brackets) {
    if (bracket.upToCents === null || taxableIncomeCents <= bracket.upToCents) {
      return bracket.rateBps;
    }
  }
  return brackets[brackets.length - 1]?.rateBps ?? 0;
}

// ---------------------------------------------------------------------------
// the whole year
// ---------------------------------------------------------------------------

export function annualTax(
  netBusinessIncomeCents: Cents,
  profile: TaxProfile,
  tables: TaxTables,
): AnnualTax {
  const se = selfEmploymentTax(netBusinessIncomeCents, profile, tables);

  if (!profile.configured) {
    // No profile: reserve self-employment tax, which is knowable from the
    // ledger alone, and abstain on income tax rather than inventing a rate.
    return {
      netBusinessIncomeCents,
      selfEmployment: se,
      federalIncomeCents: 0,
      stateIncomeCents: 0,
      qbiDeductionCents: 0,
      taxableIncomeCents: 0,
      stateTaxableIncomeCents: 0,
      totalCents: se.totalCents,
      incomeTaxEstimated: false,
    };
  }

  const businessIncome = Math.max(0, netBusinessIncomeCents);

  // Section 199A: 20% of qualified business income, after the half-SE deduction.
  const qbiBase = Math.max(0, businessIncome - se.halfDeductionCents);
  const qbiDeductionCents = profile.claimQbiDeduction
    ? applyBps(qbiBase, tables.qbiRateBps)
    : 0;

  const deduction =
    profile.itemizedDeductionCents ?? tables.standardDeductionCents[profile.filingStatus];

  const grossIncome = profile.expectedOtherIncomeCents + businessIncome;
  const taxableIncomeCents = Math.max(
    0,
    grossIncome - se.halfDeductionCents - deduction - qbiDeductionCents,
  );

  const federalIncomeCents = federalIncomeTax(taxableIncomeCents, profile.filingStatus, tables);

  // State bases vary enormously, so a flat marginal rate is the honest
  // simplification. But the BASE has to be right: most states start from
  // federal adjusted gross income and do not allow the QBI deduction, so it is
  // added back. Applying the state rate to the federal taxable figure would
  // under-reserve by rate x QBI on every dollar of business income.
  const stateTaxableCents = profile.stateAllowsQbiDeduction
    ? taxableIncomeCents
    : taxableIncomeCents + qbiDeductionCents;
  const stateIncomeCents = stateIncomeTax(stateTaxableCents, profile, tables.year);

  return {
    netBusinessIncomeCents,
    selfEmployment: se,
    federalIncomeCents,
    stateIncomeCents,
    qbiDeductionCents,
    taxableIncomeCents,
    stateTaxableIncomeCents: stateTaxableCents,
    totalCents: se.totalCents + federalIncomeCents + stateIncomeCents,
    incomeTaxEstimated: true,
  };
}

/**
 * State plus mandatory local income tax.
 *
 * ⚠️ Two paths on purpose. A profile naming a jurisdiction gets that state's
 * real brackets plus its county rate; one that does not keeps the flat marginal
 * rate it was configured with. The flat path is not wrong for an incremental
 * reserve — a marginal rate is exactly what an increment is taxed at — it is
 * only wrong once the increment crosses a bracket edge.
 *
 * ⛔ Falls back to the flat rate when the jurisdiction is not modelled, rather
 * than to zero. An unmodelled county must not silently become tax-free.
 */
export function stateIncomeTax(
  stateTaxableCents: Cents,
  profile: TaxProfile,
  year: number,
): Cents {
  const jurisdiction = profile.stateJurisdiction;
  if (!jurisdiction) return applyBps(stateTaxableCents, profile.stateIncomeTaxBps);

  const table = stateTable(jurisdiction.state, year);
  const localBps = table?.localRateBps[jurisdiction.locality];
  if (!table || localBps === undefined) {
    return applyBps(stateTaxableCents, profile.stateIncomeTaxBps);
  }

  return (
    bracketTax(stateTaxableCents, table.brackets[profile.filingStatus]) +
    applyBps(stateTaxableCents, localBps)
  );
}

// ---------------------------------------------------------------------------
// the incremental reserve
// ---------------------------------------------------------------------------

export interface IncrementalReserve {
  readonly additionalIncomeCents: Cents;
  readonly selfEmploymentCents: Cents;
  readonly federalIncomeCents: Cents;
  readonly stateIncomeCents: Cents;
  readonly totalCents: Cents;
  /** The effective rate this sale was reserved at. Derived, for display. */
  readonly effectiveRateBps: Bps;
  readonly incomeTaxEstimated: boolean;
  readonly before: AnnualTax;
  readonly after: AnnualTax;
}

/**
 * What this sale adds to the year's tax bill.
 *
 * Correct across the $400 cliff, the wage base and every bracket step, because
 * it never assumes a rate — it computes the year twice and subtracts.
 *
 * Never returns a negative reserve: a sale cannot reduce the year's tax, and a
 * negative would silently release someone else's reserve.
 */
export function incrementalReserve(
  ytdNetBusinessIncomeCents: Cents,
  additionalIncomeCents: Cents,
  profile: TaxProfile,
  tables: TaxTables,
): IncrementalReserve {
  const before = annualTax(ytdNetBusinessIncomeCents, profile, tables);
  const after = annualTax(
    ytdNetBusinessIncomeCents + additionalIncomeCents,
    profile,
    tables,
  );

  const selfEmploymentCents = Math.max(
    0,
    after.selfEmployment.totalCents - before.selfEmployment.totalCents,
  );
  const federalIncomeCents = Math.max(0, after.federalIncomeCents - before.federalIncomeCents);
  const stateIncomeCents = Math.max(0, after.stateIncomeCents - before.stateIncomeCents);

  // Never reserve more than the income that caused it.
  const uncapped = selfEmploymentCents + federalIncomeCents + stateIncomeCents;
  const totalCents = Math.max(0, Math.min(Math.max(0, additionalIncomeCents), uncapped));

  return {
    additionalIncomeCents,
    selfEmploymentCents,
    federalIncomeCents,
    stateIncomeCents,
    totalCents,
    effectiveRateBps:
      additionalIncomeCents > 0
        ? roundHalfAwayFromZero((totalCents / additionalIncomeCents) * 10_000)
        : 0,
    incomeTaxEstimated: after.incomeTaxEstimated,
    before,
    after,
  };
}
