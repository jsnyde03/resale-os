/**
 * How good the estimates actually were.
 *
 * ⚠️ **This is the instrument for risk R1**, the highest-ranked risk in
 * `docs/ASSUMPTIONS_AND_RISKS.md`: *the ledger will be exactly right about
 * numbers the operator guessed.* Every gate, score and reserve is downstream of
 * `expectedDaysToSale` and `expectedNetProceeds`. If those run optimistic, the
 * whole apparatus is precise and wrong, and nothing else in the system would
 * notice.
 *
 * So: predictions are stored at purchase, outcomes at sale, and the difference
 * is reported. The direction of the error matters more than its size — a system
 * that is *consistently* 30% slow can be corrected; one that is randomly wrong
 * cannot.
 *
 * ⚠️ **Only items with a real prediction count.** An unscored purchase has no
 * expectation, and treating a missing prediction as a zero would manufacture a
 * huge fake error and poison the average.
 *
 * Pure.
 */

import { median, roundHalfAwayFromZero } from '../math.js';
import { toBps, type Bps, type Cents } from '../money.js';
import type { FundState, ItemRecord } from './state.js';

export interface ItemAccuracy {
  readonly itemId: string;
  readonly name: string;
  readonly category: string;
  readonly expectedDaysToSale: number;
  readonly actualDaysToSale: number;
  /** actual - expected. Positive means it took longer than predicted. */
  readonly daysErrorDays: number;
  readonly expectedNetProceedsCents: Cents | null;
  readonly actualNetProceedsCents: Cents;
  /** actual - expected. Negative means it fetched less than predicted. */
  readonly proceedsErrorCents: Cents | null;
  readonly expectedProfitCents: Cents | null;
  readonly actualProfitCents: Cents;
  readonly profitErrorCents: Cents | null;
}

export interface AccuracyReport {
  /** Items with both a prediction and an outcome. */
  readonly n: number;
  /** Sold or recovered items that carried no prediction to compare against. */
  readonly unpredictedN: number;

  readonly medianDaysErrorDays: number;
  /** Share of items that sold no later than predicted. */
  readonly onTimeBps: Bps;
  /** Median actual days over median expected days. Above 10000 = slower than predicted. */
  readonly daysRatioBps: Bps;

  readonly medianProceedsErrorCents: Cents;
  /** Share of items that netted at least what was predicted. */
  readonly proceedsMetBps: Bps;

  readonly totalExpectedProfitCents: Cents;
  readonly totalActualProfitCents: Cents;
  /** Actual over expected, across every predicted item. */
  readonly profitRealisationBps: Bps;

  readonly items: readonly ItemAccuracy[];
}

/** States where an outcome actually exists to compare a prediction against. */
function hasOutcome(item: ItemRecord): boolean {
  return (
    (item.state === 'SOLD' || item.state === 'PASSIVE_RECOVERY') &&
    item.actualNetProceedsCents !== undefined &&
    item.daysToSale !== undefined
  );
}

export function itemAccuracy(item: ItemRecord): ItemAccuracy | null {
  if (!hasOutcome(item)) return null;

  const actualDays = item.daysToSale as number;
  const actualNet = item.actualNetProceedsCents as Cents;
  const expectedNet = item.expectedNetProceedsCents ?? null;
  const expectedProfit = item.expectedProfitCents ?? null;

  return {
    itemId: item.itemId,
    name: item.name,
    category: item.category,
    expectedDaysToSale: item.expectedDaysToSale,
    actualDaysToSale: actualDays,
    daysErrorDays: actualDays - item.expectedDaysToSale,
    expectedNetProceedsCents: expectedNet,
    actualNetProceedsCents: actualNet,
    proceedsErrorCents: expectedNet === null ? null : actualNet - expectedNet,
    expectedProfitCents: expectedProfit,
    actualProfitCents: item.realizedProfitCents,
    profitErrorCents: expectedProfit === null ? null : item.realizedProfitCents - expectedProfit,
  };
}

export function accuracyReport(state: FundState): AccuracyReport {
  const all = Object.values(state.items).map(itemAccuracy).filter((a): a is ItemAccuracy => a !== null);

  // An item with no expected proceeds had no prediction worth scoring. Days are
  // always predicted (the purchase demands a hold time), but proceeds are only
  // predicted when the purchase came through the scorer.
  const predicted = all.filter((a) => a.expectedNetProceedsCents !== null);
  const unpredictedN = all.length - predicted.length;

  if (predicted.length === 0) {
    return {
      n: 0,
      unpredictedN,
      medianDaysErrorDays: 0,
      onTimeBps: 0,
      daysRatioBps: 0,
      medianProceedsErrorCents: 0,
      proceedsMetBps: 0,
      totalExpectedProfitCents: 0,
      totalActualProfitCents: 0,
      profitRealisationBps: 0,
      items: all,
    };
  }

  const onTime = predicted.filter((a) => a.daysErrorDays <= 0).length;
  const proceedsMet = predicted.filter((a) => (a.proceedsErrorCents ?? 0) >= 0).length;

  const medianExpectedDays = median(predicted.map((a) => a.expectedDaysToSale));
  const medianActualDays = median(predicted.map((a) => a.actualDaysToSale));

  const totalExpectedProfitCents = predicted.reduce(
    (acc, a) => acc + (a.expectedProfitCents ?? 0),
    0,
  );
  const totalActualProfitCents = predicted.reduce((acc, a) => acc + a.actualProfitCents, 0);

  return {
    n: predicted.length,
    unpredictedN,
    medianDaysErrorDays: median(predicted.map((a) => a.daysErrorDays)),
    onTimeBps: toBps(onTime, predicted.length),
    daysRatioBps:
      medianExpectedDays <= 0 ? 0 : roundHalfAwayFromZero((medianActualDays / medianExpectedDays) * 10_000),
    medianProceedsErrorCents: roundHalfAwayFromZero(
      median(predicted.map((a) => a.proceedsErrorCents ?? 0)),
    ),
    proceedsMetBps: toBps(proceedsMet, predicted.length),
    totalExpectedProfitCents,
    totalActualProfitCents,
    profitRealisationBps:
      totalExpectedProfitCents === 0
        ? 0
        : toBps(totalActualProfitCents, totalExpectedProfitCents),
    items: all,
  };
}

/**
 * A plain-English read on the bias, with the sample size attached — because a
 * ratio from three sales is a rumour, not a finding.
 */
export function accuracyVerdict(report: AccuracyReport): string {
  if (report.n === 0) {
    return report.unpredictedN > 0
      ? `no scored predictions yet (${report.unpredictedN} sold without one)`
      : 'no sales yet';
  }
  if (report.n < 5) {
    return `only ${report.n} scored sale${report.n === 1 ? '' : 's'} — too few to read a trend`;
  }

  const slowBy = report.daysRatioBps - 10_000;
  const speed =
    Math.abs(slowBy) < 1_500
      ? 'hold times are about right'
      : slowBy > 0
        ? `hold times run ${(slowBy / 100).toFixed(0)}% LONG — the estimates are optimistic`
        : `hold times run ${(-slowBy / 100).toFixed(0)}% short — the estimates are pessimistic`;

  const realisation = report.profitRealisationBps;
  const money =
    Math.abs(realisation - 10_000) < 1_000
      ? 'profit lands close to the estimate'
      : realisation < 10_000
        ? `profit realises at ${(realisation / 100).toFixed(0)}% of estimate — optimistic`
        : `profit realises at ${(realisation / 100).toFixed(0)}% of estimate — conservative`;

  return `${speed}; ${money} (n=${report.n})`;
}
