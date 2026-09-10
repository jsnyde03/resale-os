/**
 * Changing the fund's rules — the door the desktop had and the phone did not.
 *
 * ⛔ **5.12 exists because 5.10 deleted a capability without replacing it.**
 * `policy set`, `policy adopt-defaults` and `tax profile set` went with the CLI;
 * the settings page went with the web. `FundStore` kept `setPolicy` and
 * `setTaxProfile` and **nothing called either**, so the fund's rules were frozen
 * on the one device that holds it.
 *
 * ⚡ **Which matters more than it sounds**, because policy lives in the DATABASE:
 * `ensureSeeded()` only writes when the row is ABSENT, so editing a default in
 * `policy.ts` could not reach the live fund by any route at all.
 *
 * Pure, like every other model the screens are made of. It parses strings, it
 * refuses bad ones with reasons, and it hands back a value the caller stores.
 * ⛔ It does no I/O and it does not decide when to write.
 */

import type { Bps, Cents } from '../core/money.js';
import { formatCents, parseDollars } from '../core/money.js';
import {
  DEFAULT_POLICY,
  validatePolicy,
  type BankrollMode,
  type ModePolicy,
  type Policy,
} from '../core/capital/policy.js';
import { assessProfitFloor, type ProfitFloorReachability } from '../core/capital/reachability.js';
import { feeModel } from '../core/fees.js';
import { UNCONFIGURED_TAX_PROFILE, type TaxProfile } from '../core/tax/profile.js';
import { FILING_STATUSES, type FilingStatus } from '../core/tax/tables.js';

/** Re-exported so a screen needs one import, not three. */
export { FILING_STATUSES };
export type { FilingStatus, Policy, BankrollMode, TaxProfile };

// --- what the operator is looking at ---------------------------------------

export interface PolicyStatus {
  readonly storedVersion: string;
  readonly codeVersion: string;
  /**
   * ⚠️ The only thing that can detect the divergence. A stored policy older than
   * the code's keeps running the old numbers silently — a $100 floor once passed
   * 139 tests while the live fund still ran $8.
   */
  readonly diverged: boolean;
}

export function policyStatus(stored: Policy): PolicyStatus {
  return {
    storedVersion: stored.version,
    codeVersion: DEFAULT_POLICY.version,
    diverged: stored.version !== DEFAULT_POLICY.version,
  };
}

// --- parsing ---------------------------------------------------------------

/** A percentage as integer basis points. `40` -> 4000, `12.5` -> 1250. */
export function bpsFromPercent(text: string): Bps | undefined {
  const trimmed = text.trim().replace(/%$/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return undefined;
  const [whole, frac = ''] = trimmed.split('.') as [string, string?];
  const bps = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return bps > 10_000 ? undefined : bps;
}

/** Basis points rendered as a percentage, for putting back in the box. */
export function percentFromBps(bps: Bps): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0')}`;
}

function days(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const n = Number(trimmed);
  return n > 0 ? n : undefined;
}

// --- editing a mode's numbers ----------------------------------------------

/**
 * The three a small fund actually turns. Every other `ModePolicy` field stays
 * as stored — this is not a form over eighteen numbers, and widening it is a
 * decision rather than an oversight.
 */
export interface PolicyFields {
  readonly maxPerItemPercent: string;
  readonly minProfit: string;
  readonly maxHoldDays: string;
}

export interface PolicyEdit {
  readonly problems: readonly string[];
  /** Null when the input is bad, or when nothing actually changed. */
  readonly next: Policy | null;
  readonly changed: boolean;
  /**
   * ⚠️ What the two numbers MULTIPLY into, shown before it is saved.
   *
   * A profit floor and a per-item cap imply a required multiple neither one
   * states: a $100 floor against 40% of a $50 NAV demands 7.2x on every flip.
   * That combination is how a fund silently stops being able to buy anything,
   * so the consequence is on screen at the moment of the edit.
   */
  readonly reachability: ProfitFloorReachability;
}

export function policyFieldsFrom(policy: Policy, mode: BankrollMode): PolicyFields {
  const m = policy.modes[mode];
  return {
    maxPerItemPercent: percentFromBps(m.maxCapitalPerItemBps),
    minProfit: formatCents(m.minExpectedProfitCents).replace('$', ''),
    maxHoldDays: String(m.maxHoldDays),
  };
}

export function policyEdit(
  stored: Policy,
  mode: BankrollMode,
  fields: PolicyFields,
  navCents: Cents,
): PolicyEdit {
  const problems: string[] = [];

  const maxPerItemBps = bpsFromPercent(fields.maxPerItemPercent);
  if (maxPerItemBps === undefined || maxPerItemBps <= 0) {
    problems.push('Max per item must be a percentage above 0, like 40');
  }

  let minExpectedProfitCents: Cents | undefined;
  try {
    minExpectedProfitCents = parseDollars(fields.minProfit.trim());
  } catch {
    problems.push('Minimum profit must be an amount like 8.00');
  }

  const maxHoldDays = days(fields.maxHoldDays);
  if (maxHoldDays === undefined) problems.push('Max hold must be a whole number of days');

  const current = stored.modes[mode];
  if (problems.length > 0) {
    return { problems, next: null, changed: false, reachability: reach(navCents, current) };
  }

  const edited: ModePolicy = {
    ...current,
    maxCapitalPerItemBps: maxPerItemBps as Bps,
    minExpectedProfitCents: minExpectedProfitCents as Cents,
    maxHoldDays: maxHoldDays as number,
    // ⚠️ Kept consistent rather than left behind. `longHoldThresholdDays` above
    // the ceiling would describe a band nothing can ever fall into.
    longHoldThresholdDays: Math.min(current.longHoldThresholdDays, maxHoldDays as number),
    idealHoldDays: Math.min(current.idealHoldDays, maxHoldDays as number),
    penaltyHardDays: Math.min(current.penaltyHardDays, maxHoldDays as number),
  };

  const changed =
    edited.maxCapitalPerItemBps !== current.maxCapitalPerItemBps ||
    edited.minExpectedProfitCents !== current.minExpectedProfitCents ||
    edited.maxHoldDays !== current.maxHoldDays;

  // ⛔ Bump the version on every policy change. It is the ONLY thing that can
  // later detect a stored policy drifting from the code's.
  const next: Policy = {
    ...stored,
    version: changed ? `${stored.version}+edited` : stored.version,
    modes: { ...stored.modes, [mode]: edited },
  };

  // The engine's own validator, not a second opinion. It is exhaustive by
  // construction off the defaults' keys, so it catches a field this form has
  // never heard of.
  try {
    validatePolicy(next);
  } catch (err) {
    problems.push(err instanceof Error ? err.message : String(err));
    return { problems, next: null, changed: false, reachability: reach(navCents, current) };
  }

  return { problems, next: changed ? next : null, changed, reachability: reach(navCents, edited) };
}

function reach(navCents: Cents, policy: ModePolicy): ProfitFloorReachability {
  return assessProfitFloor(navCents, policy, feeModel(undefined));
}

// --- the tax profile -------------------------------------------------------

export interface TaxFields {
  readonly filingStatus: FilingStatus;
  readonly otherIncome: string;
  readonly w2Wages: string;
  readonly stateRatePercent: string;
  readonly stateRateBasis: string;
  readonly claimQbi: boolean;
  readonly stateAllowsQbi: boolean;
}

export interface TaxEdit {
  readonly problems: readonly string[];
  readonly next: TaxProfile | null;
}

/**
 * ⛔ **The repair path must not depend on the broken thing.**
 *
 * This reads the stored profile TOLERANTLY — an unconfigured or malformed one
 * still produces sensible boxes — because the one screen that can fix a bad
 * profile must not refuse to open against one. That failure shipped twice on
 * this project: `policy adopt-defaults` and `tax profile set` both validated the
 * stored value before replacing it.
 */
export function taxFieldsFrom(profile: TaxProfile | null | undefined): TaxFields {
  const p = profile ?? UNCONFIGURED_TAX_PROFILE;
  return {
    filingStatus: p.filingStatus ?? UNCONFIGURED_TAX_PROFILE.filingStatus,
    otherIncome: formatCents(p.expectedOtherIncomeCents ?? 0).replace('$', ''),
    w2Wages: formatCents(p.expectedW2WagesCents ?? 0).replace('$', ''),
    stateRatePercent: percentFromBps(p.stateIncomeTaxBps ?? 0),
    stateRateBasis: p.stateRateBasis ?? '',
    claimQbi: p.claimQbiDeduction ?? true,
    stateAllowsQbi: p.stateAllowsQbiDeduction ?? false,
  };
}

export function taxEdit(fields: TaxFields): TaxEdit {
  const problems: string[] = [];

  let otherIncomeCents = 0;
  let w2Cents = 0;
  try {
    otherIncomeCents = parseDollars(fields.otherIncome.trim() === '' ? '0' : fields.otherIncome);
  } catch {
    problems.push('Other income must be an amount like 45000');
  }
  try {
    w2Cents = parseDollars(fields.w2Wages.trim() === '' ? '0' : fields.w2Wages);
  } catch {
    problems.push('W-2 wages must be an amount like 45000');
  }

  const stateBps = bpsFromPercent(fields.stateRatePercent.trim() === '' ? '0' : fields.stateRatePercent);
  if (stateBps === undefined) problems.push('State + local rate must be a percentage, like 7.15');

  // ⛔ A non-zero rate REQUIRES a stated basis. A bare rate is unexplainable six
  // months later and a wrong one is invisible; the engine throws on it, and
  // catching it here means the operator gets a sentence instead of a stack.
  if (stateBps !== undefined && stateBps > 0 && fields.stateRateBasis.trim() === '') {
    problems.push('A non-zero state rate needs a note saying where it came from');
  }

  if (problems.length > 0) return { problems, next: null };

  return {
    problems,
    next: {
      configured: true,
      filingStatus: fields.filingStatus,
      expectedOtherIncomeCents: otherIncomeCents,
      expectedW2WagesCents: w2Cents,
      stateIncomeTaxBps: stateBps as Bps,
      stateRateBasis: fields.stateRateBasis.trim() === '' ? null : fields.stateRateBasis.trim(),
      itemizedDeductionCents: null,
      claimQbiDeduction: fields.claimQbi,
      stateAllowsQbiDeduction: fields.stateAllowsQbi,
    },
  };
}
