/**
 * The read-only view layer.
 *
 * Every number the dashboard shows is computed by `src/core` and read through
 * `src/db`. This file's whole job is to *assemble* them into plain objects a
 * screen can render — it does no arithmetic on money beyond what the pure
 * functions already returned.
 *
 * ⛔ **No new financial logic here, ever.** A second implementation of NAV, of
 * the tax reserve, or of what "deployable" means is the failure this layer
 * exists to prevent: two answers that agree until the day they do not. If a
 * screen needs a number that does not exist yet, it gets added to `src/core`
 * with tests, not computed here. `npm run lint:imports` enforces the other half
 * of this — `src/app` may not reach `src/db` or `node:sqlite` directly.
 *
 * Server components call these functions directly. There is deliberately no
 * HTTP API: a fetch hop would mean serialising these objects, re-parsing them,
 * and standing up an unauthenticated surface before the auth gate exists.
 */

import type { LedgerReader } from '../db/store.js';
import { computeMetrics } from '../core/capital/metrics.js';
import { assessProfitFloor } from '../core/capital/reachability.js';
import { accuracyReport, accuracyVerdict } from '../core/capital/accuracy.js';
import { feeModel } from '../core/fees.js';
import { profitReport, expenseBreakdown, expenseReversalDrift } from '../db/reporting.js';
import { reconcile } from '../db/replay.js';
import { backupStaleness } from '../db/backup.js';
import { incrementalReserve } from '../core/tax/annual.js';
import { taxTableWarnings, DEFAULT_TAX_TABLES } from '../core/tax/tables.js';
import { formatCents } from '../core/money.js';
import type { Cents, Bps } from '../core/money.js';
import type { BankrollMode } from '../core/capital/policy.js';

/**
 * Money crosses into React as cents plus a preformatted string.
 *
 * The screens never divide by 100. Formatting a signed cent value is exactly
 * the kind of "obvious" arithmetic that produces `-$0.00` and off-by-one
 * rounding in two places at once.
 */
export interface Money {
  readonly cents: Cents;
  readonly text: string;
}

export function money(cents: Cents): Money {
  // `formatCents` is the one implementation, in core, and it is tested there.
  return { cents, text: formatCents(cents) };
}

export interface HeadlineView {
  readonly nav: Money;
  readonly liquid: Money;
  readonly inventoryAtCost: Money;
  readonly earmarked: Money;
  readonly deployable: Money;
  readonly unencumberedCash: Money;
  readonly liquidFloor: Money;
  readonly taxReserve: Money;
  readonly operatingReserve: Money;
  readonly ownerPayable: Money;
  readonly mode: BankrollMode;
  readonly maxPerItem: Money;
  readonly maxHoldDays: number;
  readonly minExpectedProfit: Money;
  readonly activeItems: number;
  readonly eventCount: number;
  /** True while the fund is below the set-aside floor and everything compounds. */
  readonly setAsideSuppressed: boolean;
  readonly setAsideFloor: Money;
  readonly categoryExposure: readonly { category: string; amount: Money }[];
  readonly categoryCap: Money;
}

export function headlineView(store: LedgerReader): HeadlineView {
  const state = store.state();
  const m = computeMetrics(state);
  return {
    nav: money(m.navCents),
    liquid: money(m.liquidCents),
    inventoryAtCost: money(m.inventoryAtCostCents),
    earmarked: money(m.earmarkedCents),
    deployable: money(m.deployableCapitalCents),
    unencumberedCash: money(m.unencumberedCashCents),
    liquidFloor: money(m.minLiquidFloorCents),
    taxReserve: money(m.taxReserveCents),
    operatingReserve: money(m.operatingReserveCents),
    ownerPayable: money(m.ownerPayableCents),
    mode: m.mode,
    maxPerItem: money(m.maxCapitalPerItemCents),
    maxHoldDays: m.modePolicy.maxHoldDays,
    minExpectedProfit: money(m.modePolicy.minExpectedProfitCents),
    activeItems: m.activeItemCount,
    eventCount: state.eventCount,
    setAsideSuppressed: m.navCents < state.policy.allocation.setAsideMinNavCents,
    setAsideFloor: money(state.policy.allocation.setAsideMinNavCents),
    categoryExposure: Object.entries(m.categoryExposureCents)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, cents]) => ({ category, amount: money(cents) })),
    categoryCap: money(m.maxCategoryExposureCents),
  };
}

/**
 * The warning that a profit floor and a per-item cap have multiplied into a
 * constraint neither one states. `status` prints it; the dashboard shows it for
 * the same reason — otherwise the operator meets it as a wall of rejections.
 */
export interface ReachabilityView {
  readonly reachable: boolean;
  readonly minProfit: Money;
  readonly maxPerItem: Money;
  readonly grossNeeded: Money;
  readonly requiredMultiple: number;
  readonly impliedBankroll: Money;
  readonly impliedMaxPerItem: Money;
}

export function reachabilityView(store: LedgerReader): ReachabilityView {
  const m = computeMetrics(store.state());
  const r = assessProfitFloor(m.navCents, m.modePolicy, feeModel(undefined));
  return {
    reachable: r.reachable,
    minProfit: money(r.minProfitCents),
    maxPerItem: money(r.maxPerItemCents),
    grossNeeded: money(r.grossNeededCents),
    requiredMultiple: r.requiredMultipleBps / 10_000,
    impliedBankroll: money(r.impliedBankrollCents),
    impliedMaxPerItem: money(r.impliedMaxPerItemCents),
  };
}

export interface ProfitView {
  readonly itemProfit: Money;
  readonly businessExpenses: Money;
  readonly operatingProfit: Money;
  readonly taxReserve: Money;
  readonly ownerDistributable: Money;
  readonly ownerPaid: Money;
  readonly ownerPayable: Money;
  readonly soldItems: number;
  readonly chargedOffItems: number;
  readonly chargeOff: Money;
  readonly recovery: Money;
  readonly realisedRoi: Bps;
  readonly expenses: readonly {
    category: string;
    scope: string;
    capitalized: boolean;
    total: Money;
    n: number;
  }[];
}

export function profitView(store: LedgerReader): ProfitView {
  const r = profitReport(store.db);
  return {
    itemProfit: money(r.itemProfitCents),
    businessExpenses: money(r.businessExpenseCents),
    operatingProfit: money(r.operatingProfitCents),
    taxReserve: money(r.taxReserveCents),
    ownerDistributable: money(r.ownerDistributableCents),
    ownerPaid: money(r.ownerPaidCents),
    ownerPayable: money(r.ownerPayableCents),
    soldItems: r.soldItems,
    chargedOffItems: r.chargedOffItems,
    chargeOff: money(r.chargeOffCents),
    recovery: money(r.recoveryCents),
    realisedRoi: r.realisedRoiBps,
    expenses: expenseBreakdown(store.db).map((line) => ({
      category: line.category,
      scope: line.scope,
      capitalized: line.capitalized === 1,
      total: money(line.totalCents),
      n: line.n,
    })),
  };
}

export interface TaxView {
  readonly year: number;
  readonly businessIncomeYtd: Money;
  readonly reservedSoFar: Money;
  readonly reserveOnHand: Money;
  readonly selfEmployment: Money;
  readonly federalIncome: Money;
  readonly stateIncome: Money;
  readonly total: Money;
  /** Income tax abstains without a profile, and every consumer must say so. */
  readonly incomeTaxAbstained: boolean;
  /**
   * Severity is carried through deliberately. An ACCEPTED acceptance is
   * informational; flattening these to strings would render "accepted" as an
   * alarm and "not IRS-verified" as a footnote.
   */
  readonly warnings: readonly { code: string; severity: 'warn' | 'info'; message: string }[];
}

export function taxView(store: LedgerReader): TaxView {
  const state = store.state();
  const m = computeMetrics(state);
  const breakdown = incrementalReserve(
    state.ytdNetBusinessIncomeCents,
    0,
    state.taxProfile,
    state.taxTables,
  );
  return {
    year: state.taxYear,
    businessIncomeYtd: money(state.ytdNetBusinessIncomeCents),
    reservedSoFar: money(state.ytdTaxReservedCents),
    reserveOnHand: money(m.taxReserveCents),
    selfEmployment: money(breakdown.selfEmploymentCents),
    federalIncome: money(breakdown.federalIncomeCents),
    stateIncome: money(breakdown.stateIncomeCents),
    total: money(breakdown.totalCents),
    incomeTaxAbstained: !state.taxProfile.configured,
    warnings: taxTableWarnings(DEFAULT_TAX_TABLES, state.taxYear, store.taxTablesAcceptance()),
  };
}

/**
 * Whether the book can be trusted right now: the hash chain, the independent
 * replay, the expense-drift control and the backup's staleness.
 *
 * ⚠️ This belongs on the dashboard rather than behind a subcommand. A number is
 * only worth reading if the ledger under it verifies, and "nobody ran `verify`"
 * is how that goes unnoticed.
 */
export interface IntegrityView {
  readonly chainOk: boolean;
  readonly chainBrokenAt?: string;
  readonly replayOk: boolean;
  readonly replayDifferences: readonly string[];
  readonly expenseDriftOk: boolean;
  readonly expenseDrift: readonly { eventId: string; ledger: Money; table: Money }[];
  readonly backupConfigured: boolean;
  readonly backupLastSuccessAt: string | null;
  readonly backupEventsBehind: number;
  readonly backupStale: boolean;
  readonly backupLastError: string | null;
  readonly ok: boolean;
}

export function integrityView(store: LedgerReader): IntegrityView {
  const chain = store.verifyChain();
  const recon = reconcile(store);
  const drift = expenseReversalDrift(store.db);
  const settings = store.backupSettings();
  const backup = store.backupState();
  const { behind, stale } = backupStaleness(backup, store.state().eventCount);
  const configured = settings.directory !== '';
  return {
    chainOk: chain.ok,
    ...(chain.brokenAt !== undefined ? { chainBrokenAt: chain.brokenAt } : {}),
    replayOk: recon.ok,
    replayDifferences: recon.differences,
    expenseDriftOk: drift.length === 0,
    expenseDrift: drift.map((d) => ({
      eventId: d.eventId,
      ledger: money(d.ledgerCents),
      table: money(d.tableCents),
    })),
    backupConfigured: configured,
    backupLastSuccessAt: backup.lastSuccessAt,
    backupEventsBehind: behind,
    backupStale: stale,
    backupLastError: backup.lastError ?? null,
    // Deliberately does NOT include backup staleness: a stale backup is a risk
    // to the future, not evidence the present numbers are wrong.
    ok: chain.ok && recon.ok && drift.length === 0,
  };
}

export interface AccuracyView {
  readonly n: number;
  /** Sold or recovered items that carried no prediction. Not a failure — a gap. */
  readonly unpredictedN: number;
  readonly verdict: string;
  readonly medianDaysError: number;
  /** Above 10000 = slower than predicted. */
  readonly daysRatioBps: Bps;
  readonly onTimeBps: Bps;
  readonly medianProceedsError: Money;
  readonly proceedsMetBps: Bps;
  readonly totalExpectedProfit: Money;
  readonly totalActualProfit: Money;
  /** Actual over expected. Below 10000 = the fund earns less than it predicts. */
  readonly profitRealisationBps: Bps;
  /**
   * ⚠️ False until there are enough sales to mean anything. The engine's own
   * verdict says so in words; this is the same fact as a boolean so a screen
   * can refuse to draw a trend rather than drawing a misleading one.
   */
  readonly readable: boolean;
}

export function accuracyView(store: LedgerReader): AccuracyView {
  const report = accuracyReport(store.state());
  return {
    n: report.n,
    unpredictedN: report.unpredictedN,
    verdict: accuracyVerdict(report),
    medianDaysError: report.medianDaysErrorDays,
    daysRatioBps: report.daysRatioBps,
    onTimeBps: report.onTimeBps,
    medianProceedsError: money(report.medianProceedsErrorCents),
    proceedsMetBps: report.proceedsMetBps,
    totalExpectedProfit: money(report.totalExpectedProfitCents),
    totalActualProfit: money(report.totalActualProfitCents),
    profitRealisationBps: report.profitRealisationBps,
    // Matches `accuracyVerdict`'s own threshold: below five, it refuses to
    // read a trend, and so must anything drawing one.
    readable: report.n >= 5,
  };
}

/** Everything the primary screen needs, in one pass over the ledger. */
export interface DashboardView {
  readonly headline: HeadlineView;
  readonly reachability: ReachabilityView;
  readonly profit: ProfitView;
  readonly tax: TaxView;
  readonly integrity: IntegrityView;
  readonly accuracy: AccuracyView;
}

export function dashboardView(store: LedgerReader): DashboardView {
  return {
    headline: headlineView(store),
    reachability: reachabilityView(store),
    profit: profitView(store),
    tax: taxView(store),
    integrity: integrityView(store),
    accuracy: accuracyView(store),
  };
}
