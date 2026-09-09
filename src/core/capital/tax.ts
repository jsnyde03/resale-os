/**
 * The tax reserve for a single sale.
 *
 * ⚠️ **This is a thin adapter, not the model.** The model is
 * `src/core/tax/annual.ts`, and the idea it implements is that tax is annual
 * and non-linear, so a per-sale reserve cannot be a percentage of that sale.
 *
 * The reserve is a **catch-up against the year**, not an increment:
 *
 *     owedSoFar = businessTaxOn(ytdIncome + thisProfit)
 *     reserve   = clamp(owedSoFar - alreadyReserved, 0, thisProfit)
 *
 * ⚠️ **Why catch-up rather than `annualTax(after) - annualTax(before)`:** the
 * $400 self-employment cliff can owe MORE than the sale that crosses it earns.
 * Crossing at $18.43 of profit makes $61.20 of SE tax owed at once, and a
 * per-sale increment capped at the profit would silently drop $42.84 and never
 * reserve it. Measuring against the year instead means the shortfall is carried
 * and picked up by the next sales, and `carriedForwardCents` says how much is
 * still outstanding.
 *
 * Superseded 2026-09-08: a flat "15.3% of 92.35%" was right about the SE formula
 * and wrong about everything around it.
 */

import { assertCents, roundHalfAwayFromZero, type Bps, type Cents } from '../money.js';
import { incrementalReserve } from '../tax/annual.js';
import type { TaxProfile } from '../tax/profile.js';
import type { TaxTables } from '../tax/tables.js';

export interface TaxBreakdown {
  /** Self-employment tax this sale added to the year. */
  readonly selfEmploymentCents: Cents;
  /** Federal income tax this sale added to the year. */
  readonly federalIncomeCents: Cents;
  /** State income tax this sale added to the year. */
  readonly stateIncomeCents: Cents;
  /** What actually moves into TAX_RESERVE, after catch-up and the profit cap. */
  readonly totalCents: Cents;
  /**
   * Tax that is owed but could not be reserved from this sale, because it
   * exceeded the sale's own profit. Picked up by later sales; non-zero only
   * around the $400 cliff.
   */
  readonly carriedForwardCents: Cents;
  /** The rate this sale was reserved at. Derived, never configured. */
  readonly effectiveRateBps: Bps;
  /** False when no tax profile is set, so income tax was NOT estimated. */
  readonly incomeTaxEstimated: boolean;
  readonly ytdNetBusinessIncomeCents: Cents;
  /** True when the year is still under the $400 self-employment floor. */
  readonly belowSelfEmploymentThreshold: boolean;
}

export const ZERO_TAX: TaxBreakdown = {
  selfEmploymentCents: 0,
  federalIncomeCents: 0,
  stateIncomeCents: 0,
  totalCents: 0,
  carriedForwardCents: 0,
  effectiveRateBps: 0,
  incomeTaxEstimated: false,
  ytdNetBusinessIncomeCents: 0,
  belowSelfEmploymentThreshold: false,
};

/** The whole year's business-attributable tax, at a given income. */
export function businessTaxForYear(
  ytdNetBusinessIncomeCents: Cents,
  profile: TaxProfile,
  tables: TaxTables,
): Cents {
  if (ytdNetBusinessIncomeCents <= 0) return 0;
  return incrementalReserve(0, ytdNetBusinessIncomeCents, profile, tables).totalCents;
}

export function computeTaxReserve(
  profitCents: Cents,
  ytdNetBusinessIncomeCents: Cents,
  ytdTaxReservedCents: Cents,
  profile: TaxProfile,
  tables: TaxTables,
): TaxBreakdown {
  assertCents(profitCents, 'profit');
  assertCents(ytdNetBusinessIncomeCents, 'ytdNetBusinessIncome');
  assertCents(ytdTaxReservedCents, 'ytdTaxReserved');
  if (profitCents <= 0) return { ...ZERO_TAX, ytdNetBusinessIncomeCents };

  // What this sale added, for the component breakdown a human reads.
  const increment = incrementalReserve(
    ytdNetBusinessIncomeCents,
    profitCents,
    profile,
    tables,
  );

  // What the year owes now, against what has already been set aside.
  const owedSoFar = businessTaxForYear(
    ytdNetBusinessIncomeCents + profitCents,
    profile,
    tables,
  );
  const outstanding = Math.max(0, owedSoFar - ytdTaxReservedCents);
  const totalCents = Math.min(outstanding, profitCents);

  return {
    selfEmploymentCents: increment.selfEmploymentCents,
    federalIncomeCents: increment.federalIncomeCents,
    stateIncomeCents: increment.stateIncomeCents,
    totalCents,
    carriedForwardCents: outstanding - totalCents,
    effectiveRateBps: roundHalfAwayFromZero((totalCents / profitCents) * 10_000),
    incomeTaxEstimated: increment.incomeTaxEstimated,
    ytdNetBusinessIncomeCents,
    belowSelfEmploymentThreshold: increment.after.selfEmployment.belowThreshold,
  };
}
