/**
 * Policy = every number the operator is allowed to tune. Nothing here is
 * hardcoded anywhere else; the defaults below are seeded into the `config`
 * table and read back at startup, so tuning never requires a deploy.
 *
 * See docs/FINANCIAL_SPEC.md §5-§6 for the rationale behind each default.
 */

import { BPS_ONE, type Bps, type Cents, MoneyError } from '../money.js';

export const BANKROLL_MODES = ['BOOTSTRAP', 'GROWTH'] as const;
export type BankrollMode = (typeof BANKROLL_MODES)[number];

/**
 * What the tax reserve is FOR, stated as its components rather than as one
 * blended guess. Reselling at a profit is self-employment income, so the
 * reserve is built from the actual self-employment tax formula:
 *
 *   SE tax = 15.3% (12.4% Social Security + 2.9% Medicare)
 *            applied to 92.35% of net earnings
 *          = 14.13% of profit, effective
 *
 * Income tax on the same profit is a SEPARATE component, defaulting to zero.
 * See docs/FINANCIAL_SPEC.md §3.3-B for what that leaves uncovered.
 */
export interface TaxPolicy {
  /** Share of net profit subject to SE tax. The IRS figure is 92.35%. */
  readonly selfEmploymentBaseBps: Bps;
  /** SE tax rate on that base. 15.3% = 12.4% SS + 2.9% Medicare. */
  readonly selfEmploymentRateBps: Bps;
  /**
   * Estimated marginal income tax (federal + state) on the same profit.
   * 0 means "reserve self-employment tax only" — which is what it is set to.
   */
  readonly incomeTaxBps: Bps;
  /**
   * Half of SE tax is deductible above the line before income tax is figured.
   * Only has an effect when `incomeTaxBps > 0`.
   */
  readonly deductHalfSelfEmploymentTax: boolean;
}

export interface AllocationPolicy {
  /** Taken off profit FIRST, before owner and reinvestment see anything. */
  readonly tax: TaxPolicy;
  /**
   * NAV below which NO profit is set aside: the owner distribution and the
   * operating reserve are both skipped, and everything after tax reinvests.
   *
   * Below this the fund is too small for a split to mean anything — a 20% cut
   * of a $25 profit is $5, and taking it out is the difference between the
   * fund compounding and the fund crawling. The tax reserve still accrues,
   * because tax is an obligation rather than a distribution.
   *
   * This is a WARM-UP, not a phase: `validatePolicy` requires it to end well
   * before GROWTH, so the fund can never permanently retain 100% of profit.
   */
  readonly setAsideMinNavCents: Cents;
  /** The three below split the AFTER-TAX remainder and must sum to 10000. */
  readonly ownerBps: Bps;
  readonly operatingReserveBps: Bps;
  readonly reinvestBps: Bps;
}

export interface ModeThresholds {
  /** NAV at or above which the fund promotes to GROWTH. */
  readonly promoteAtCents: Cents;
  /** NAV below which the fund demotes to BOOTSTRAP. Must be < promoteAtCents. */
  readonly demoteAtCents: Cents;
}

export interface ModePolicy {
  // --- hold-time shape -----------------------------------------------------
  readonly idealHoldDays: number;
  readonly penaltyHardDays: number;
  readonly maxHoldDays: number;
  readonly longHoldThresholdDays: number;
  readonly maxLongHoldBps: Bps;

  // --- capital safety ------------------------------------------------------
  readonly maxCapitalPerItemBps: Bps;
  readonly maxCategoryExposureBps: Bps;
  readonly minLiquidFloorBps: Bps;
  readonly maxDeployedBps: Bps;
  readonly maxDownsideBps: Bps;

  // --- opportunity floors --------------------------------------------------
  readonly minExpectedProfitCents: Cents;
  readonly minExpectedRoiBps: Bps;
  readonly minConfidenceBps: Bps;
  /**
   * Minimum sold / (sold + active) before an item may be bought.
   *
   * Mostly a backstop: a derived hold time already implies a sell-through, so
   * this rarely binds on comp-based estimates. It exists to catch an OPTIMISTIC
   * HAND-TYPED hold — the one path where nothing else is watching.
   */
  readonly minSellThroughBps: Bps;
  readonly minBuyScore: number;
  readonly maxRiskScore: number;

  // --- score saturation targets -------------------------------------------
  readonly profitTargetCents: Cents;
  readonly roiTargetBps: Bps;
}

export interface Policy {
  readonly version: string;
  readonly allocation: AllocationPolicy;
  readonly thresholds: ModeThresholds;
  readonly modes: Readonly<Record<BankrollMode, ModePolicy>>;
}

/** 92.35% x 15.3% = 14.13% of profit. Self-employment tax, and nothing else. */
export const DEFAULT_TAX: TaxPolicy = {
  selfEmploymentBaseBps: 9_235,
  selfEmploymentRateBps: 1_530,
  incomeTaxBps: 0,
  deductHalfSelfEmploymentTax: true,
};

export const DEFAULT_ALLOCATION: AllocationPolicy = {
  tax: DEFAULT_TAX,
  setAsideMinNavCents: 10_000, // $100 — below this, everything compounds
  ownerBps: 2_000,
  operatingReserveBps: 1_000,
  reinvestBps: 7_000,
};

export const DEFAULT_THRESHOLDS: ModeThresholds = {
  promoteAtCents: 50_000, // $500
  demoteAtCents: 45_000, //  $450 — a 10% band, so the fund cannot oscillate
};

export const DEFAULT_BOOTSTRAP_POLICY: ModePolicy = {
  idealHoldDays: 10,
  penaltyHardDays: 14,
  maxHoldDays: 21,
  longHoldThresholdDays: 14,
  maxLongHoldBps: 0, // no intentional holds below $500

  maxCapitalPerItemBps: 4_000, // 40% of NAV — $30 on a $75 fund
  maxCategoryExposureBps: 6_000,
  minLiquidFloorBps: 1_000,
  maxDeployedBps: 8_500,
  maxDownsideBps: 1_500,

  minExpectedProfitCents: 800, // $8
  minExpectedRoiBps: 3_500, // 35%
  minConfidenceBps: 4_500,
  minSellThroughBps: 6_500, // 65% - roughly twice as many sold as listed
  minBuyScore: 65,
  maxRiskScore: 55,

  profitTargetCents: 2_500, // $25
  roiTargetBps: 10_000, // 100%
};

export const DEFAULT_GROWTH_POLICY: ModePolicy = {
  idealHoldDays: 21,
  penaltyHardDays: 35,
  maxHoldDays: 60,
  longHoldThresholdDays: 30,
  maxLongHoldBps: 3_000, // at most 30% of NAV in long holds

  maxCapitalPerItemBps: 2_000,
  maxCategoryExposureBps: 4_000,
  minLiquidFloorBps: 1_000,
  maxDeployedBps: 8_500,
  maxDownsideBps: 1_000,

  minExpectedProfitCents: 1_500,
  minExpectedRoiBps: 2_500,
  minConfidenceBps: 5_000,
  minSellThroughBps: 5_000, // 50%
  minBuyScore: 60,
  maxRiskScore: 60,

  profitTargetCents: 6_000,
  roiTargetBps: 6_000,
};

export const DEFAULT_POLICY: Policy = {
  version: '2026-09-08.5',
  allocation: DEFAULT_ALLOCATION,
  thresholds: DEFAULT_THRESHOLDS,
  modes: {
    BOOTSTRAP: DEFAULT_BOOTSTRAP_POLICY,
    GROWTH: DEFAULT_GROWTH_POLICY,
  },
};

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyError';
  }
}

/**
 * Validated at load, not at use. A malformed policy must fail at startup rather
 * than silently misallocate someone's profit six sales later.
 */
export function validatePolicy(policy: Policy): void {
  const a = policy.allocation;

  if (!a.tax || typeof a.tax !== 'object') {
    throw new PolicyError(
      'allocation.tax is missing. A flat `taxReserveBps` was replaced by the ' +
        'self-employment tax policy on 2026-09-08 — see MASTER_PLAN_LOG D-15.',
    );
  }

  for (const key of ['ownerBps', 'operatingReserveBps', 'reinvestBps'] as const) {
    const value = a[key];
    if (!Number.isInteger(value) || value < 0 || value > BPS_ONE) {
      throw new PolicyError(`allocation.${key} must be an integer 0..10000, got ${value}`);
    }
  }

  for (const key of [
    'selfEmploymentBaseBps',
    'selfEmploymentRateBps',
    'incomeTaxBps',
  ] as const) {
    const value = a.tax[key];
    if (!Number.isInteger(value) || value < 0 || value > BPS_ONE) {
      throw new PolicyError(`allocation.tax.${key} must be an integer 0..10000, got ${value}`);
    }
  }

  if (typeof a.tax.deductHalfSelfEmploymentTax !== 'boolean') {
    throw new PolicyError('allocation.tax.deductHalfSelfEmploymentTax must be a boolean');
  }

  const afterTaxSum = a.ownerBps + a.operatingReserveBps + a.reinvestBps;
  if (afterTaxSum !== BPS_ONE) {
    throw new PolicyError(
      `allocation owner+operatingReserve+reinvest must sum to 10000 bps, got ${afterTaxSum}`,
    );
  }

  if (a.ownerBps <= 0) {
    // Product requirement, enforced in code: once the fund is above the
    // set-aside threshold, the owner is paid on every profitable transaction.
    throw new PolicyError('allocation.ownerBps must be > 0: the owner is paid on every profit');
  }

  if (!Number.isInteger(a.setAsideMinNavCents) || a.setAsideMinNavCents < 0) {
    throw new PolicyError('allocation.setAsideMinNavCents must be a non-negative integer');
  }

  if (a.setAsideMinNavCents >= policy.thresholds.promoteAtCents) {
    // Keeps the warm-up a warm-up. Without this bound, a large threshold would
    // let the fund permanently retain 100% of profit, which is the one shape
    // this product is not allowed to have.
    throw new PolicyError(
      `allocation.setAsideMinNavCents (${a.setAsideMinNavCents}) must be below the GROWTH ` +
        `threshold (${policy.thresholds.promoteAtCents}): the warm-up cannot become a phase`,
    );
  }

  const t = policy.thresholds;
  if (!Number.isInteger(t.promoteAtCents) || !Number.isInteger(t.demoteAtCents)) {
    throw new PolicyError('mode thresholds must be integer cents');
  }
  if (t.demoteAtCents >= t.promoteAtCents) {
    throw new PolicyError('demoteAtCents must be strictly below promoteAtCents (hysteresis band)');
  }

  for (const mode of BANKROLL_MODES) {
    const m = policy.modes[mode];
    if (!m) throw new PolicyError(`missing policy for mode ${mode}`);

    // ⚠️ EXHAUSTIVE BY CONSTRUCTION. Every numeric field of the shipped default
    // must be present and finite in the stored policy. Checking a hand-written
    // list instead let `minSellThroughBps` through on 2026-09-08: a stored
    // policy older than the field produced `undefined`, which propagated as
    // `NaN` into a gate's limit and printed "vs a NaN% minimum". It happened to
    // fail closed; the comparison could as easily have failed open.
    //
    // Driving the check off the default object means adding a field to
    // ModePolicy makes it required here automatically.
    for (const key of Object.keys(DEFAULT_BOOTSTRAP_POLICY) as (keyof ModePolicy)[]) {
      const value = m[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new PolicyError(
          `modes.${mode}.${String(key)} is missing or not a finite number ` +
            `(got ${String(value)}). The stored policy is older than the code — ` +
            `run: policy adopt-defaults`,
        );
      }
    }
    if (!(m.idealHoldDays <= m.penaltyHardDays && m.penaltyHardDays <= m.maxHoldDays)) {
      throw new PolicyError(
        `${mode}: require idealHoldDays <= penaltyHardDays <= maxHoldDays, got ` +
          `${m.idealHoldDays}/${m.penaltyHardDays}/${m.maxHoldDays}`,
      );
    }
    if (m.minBuyScore < 0 || m.minBuyScore > 100 || m.maxRiskScore < 0 || m.maxRiskScore > 100) {
      throw new PolicyError(`${mode}: score bounds must be within 0..100`);
    }
    if (m.profitTargetCents <= 0 || m.roiTargetBps <= 0) {
      throw new PolicyError(`${mode}: saturation targets must be > 0`);
    }
  }
}

export function assertValidPolicy(policy: Policy): Policy {
  try {
    validatePolicy(policy);
  } catch (err) {
    if (err instanceof MoneyError) throw new PolicyError(err.message);
    throw err;
  }
  return policy;
}
