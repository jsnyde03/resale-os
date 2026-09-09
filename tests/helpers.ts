import { applyCommand, type ApplyResult } from '@/core/capital/engine.js';
import type { Command } from '@/core/capital/commands.js';
import { initialFundState, type FundState } from '@/core/capital/state.js';
import { DEFAULT_POLICY, type Policy } from '@/core/capital/policy.js';
import { computeMetrics } from '@/core/capital/metrics.js';
import type { Cents } from '@/core/money.js';
import { UNCONFIGURED_TAX_PROFILE, type TaxProfile } from '@/core/tax/profile.js';

export const T0 = '2026-09-08T12:00:00.000Z';

/**
 * An illustrative filer, not anyone's real one: single, a $60k W-2 job, no
 * state income tax. Tests about
 * the tax reserve need one, because without a profile the income-tax component
 * abstains by design.
 */
export const WITH_JOB: TaxProfile = {
  configured: true,
  filingStatus: 'SINGLE',
  expectedOtherIncomeCents: 6_000_000,
  expectedW2WagesCents: 6_000_000,
  stateIncomeTaxBps: 0,
  stateRateBasis: null,
  itemizedDeductionCents: null,
  claimQbiDeduction: true,
  stateAllowsQbiDeduction: false,
};

/** A tiny fluent harness so a scenario reads like the story it models. */
export class Fund {
  state: FundState;
  readonly results: ApplyResult[] = [];

  constructor(policy: Policy = DEFAULT_POLICY, taxProfile: TaxProfile = UNCONFIGURED_TAX_PROFILE) {
    this.state = initialFundState(policy, taxProfile);
  }

  static withBankroll(
    cents: Cents,
    policy: Policy = DEFAULT_POLICY,
    taxProfile: TaxProfile = UNCONFIGURED_TAX_PROFILE,
  ): Fund {
    return new Fund(policy, taxProfile).do({
      type: 'CONTRIBUTION',
      amountCents: cents,
      occurredAt: T0,
    });
  }

  /** A fund whose owner has a job, so income tax is actually estimated. */
  static employed(cents: Cents, policy: Policy = DEFAULT_POLICY): Fund {
    return Fund.withBankroll(cents, policy, WITH_JOB);
  }

  do(command: Command): this {
    const result = applyCommand(this.state, command);
    this.state = result.state;
    this.results.push(result);
    return this;
  }

  last(): ApplyResult {
    const r = this.results[this.results.length - 1];
    if (!r) throw new Error('no commands applied yet');
    return r;
  }

  metrics() {
    return computeMetrics(this.state);
  }

  item(id: string) {
    const item = this.state.items[id];
    if (!item) throw new Error(`no item ${id}`);
    return item;
  }
}

/** A purchase with sensible defaults, so a test states only what it is about. */
export function purchase(
  overrides: Partial<Extract<Command, { type: 'PURCHASE' }>> & { itemId: string },
): Extract<Command, { type: 'PURCHASE' }> {
  return {
    type: 'PURCHASE',
    name: overrides.itemId,
    category: 'DISNEY_PINS',
    purchasePriceCents: 1_000,
    expectedDaysToSale: 7,
    expectedResaleCents: 3_000,
    occurredAt: T0,
    ...overrides,
  };
}

export function sale(
  overrides: Partial<Extract<Command, { type: 'SALE' }>> & { itemId: string },
): Extract<Command, { type: 'SALE' }> {
  return {
    type: 'SALE',
    grossProceedsCents: 3_000,
    occurredAt: T0,
    ...overrides,
  };
}
