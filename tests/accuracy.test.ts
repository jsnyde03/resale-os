import { describe, expect, it } from 'vitest';
import { Fund, T0, purchase, sale } from './helpers.js';
import { accuracyReport, accuracyVerdict, itemAccuracy } from '@/core/capital/accuracy.js';

/** A purchase carrying a prediction, as `buy --from-opp` produces. */
function predicted(id: string, days: number, expectedNet: number, price = 1_500) {
  return purchase({
    itemId: id,
    purchasePriceCents: price,
    expectedDaysToSale: days,
    expectedResaleCents: 3_900,
    expectedNetProceedsCents: expectedNet,
    expectedProfitCents: expectedNet - price,
    opportunityId: `opp-${id}`,
  });
}

describe('an item with a prediction and an outcome', () => {
  it('reports the error in both directions', () => {
    const fund = Fund.withBankroll(15_000)
      .do(predicted('i1', 8, 2_800))
      .do(sale({ itemId: 'i1', grossProceedsCents: 3_500, marketplaceFeeCents: 504, daysToSale: 12 }));

    const a = itemAccuracy(fund.item('i1'))!;
    expect(a.expectedDaysToSale).toBe(8);
    expect(a.actualDaysToSale).toBe(12);
    expect(a.daysErrorDays).toBe(4); // took longer than predicted
    expect(a.actualNetProceedsCents).toBe(2_996);
    expect(a.proceedsErrorCents).toBe(196); // netted more than predicted
  });

  it('is null while the item is still unsold', () => {
    const fund = Fund.withBankroll(15_000).do(predicted('i1', 8, 2_800));
    expect(itemAccuracy(fund.item('i1'))).toBeNull();
  });

  it('counts a passive recovery as an outcome', () => {
    const fund = Fund.withBankroll(15_000)
      .do(predicted('i1', 8, 2_800))
      .do({ type: 'CHARGE_OFF', itemId: 'i1', reason: 'STALE', occurredAt: T0 })
      .do({
        type: 'PASSIVE_RECOVERY',
        itemId: 'i1',
        grossProceedsCents: 1_000,
        occurredAt: T0,
      });
    // daysToSale is not set by a recovery, so there is no days comparison.
    expect(itemAccuracy(fund.item('i1'))).toBeNull();
  });
});

describe('a missing prediction is excluded, not counted as zero', () => {
  it('reports unpredicted sales separately rather than poisoning the average', () => {
    // Treating an absent expectation as 0 would manufacture a huge fake error.
    const fund = Fund.withBankroll(15_000)
      .do(predicted('scored', 8, 2_800))
      .do(sale({ itemId: 'scored', grossProceedsCents: 3_500, marketplaceFeeCents: 504, daysToSale: 8 }))
      .do(purchase({ itemId: 'unscored', purchasePriceCents: 1_500 }))
      .do(sale({ itemId: 'unscored', grossProceedsCents: 3_500, daysToSale: 40 }));

    const r = accuracyReport(fund.state);
    expect(r.n).toBe(1);
    expect(r.unpredictedN).toBe(1);
    // The 40-day unscored sale does not drag the median.
    expect(r.medianDaysErrorDays).toBe(0);
  });

  // ⚠️ "predictions", not "scored predictions". Since B59 a prediction can come
  // from the operator as well as from the scorer, and calling both "scored"
  // would misdescribe most of them.
  it('says so plainly when nothing carried a prediction', () => {
    const fund = Fund.withBankroll(15_000)
      .do(purchase({ itemId: 'i1', purchasePriceCents: 1_000 }))
      .do(sale({ itemId: 'i1', grossProceedsCents: 2_000, daysToSale: 5 }));
    const r = accuracyReport(fund.state);
    expect(r.n).toBe(0);
    expect(r.unpredictedN).toBe(1);
    expect(accuracyVerdict(r)).toMatch(/no predictions yet/);
  });

  it('names the kind when the report was narrowed to one', () => {
    const fund = Fund.withBankroll(15_000)
      .do(purchase({ itemId: 'i1', purchasePriceCents: 1_000 }))
      .do(sale({ itemId: 'i1', grossProceedsCents: 2_000, daysToSale: 5 }));
    expect(accuracyVerdict(accuracyReport(fund.state, 'SCORED'))).toMatch(/no scored predictions/);
    expect(accuracyVerdict(accuracyReport(fund.state, 'QUOTED'))).toMatch(/no priced predictions/);
  });
});

/**
 * B59: a prediction from the scorer and a prediction from the operator are
 * both worth measuring, and a single median over the two answers a question
 * nobody asked.
 */
describe('predictions are counted by where they came from', () => {
  /** Sold, with an expectation, and no opportunity behind it. */
  function quoted(itemId: string) {
    return purchase({
      itemId,
      purchasePriceCents: 1_000,
      expectedResaleCents: 3_000,
      expectedNetProceedsCents: 2_400,
      expectedProfitCents: 1_400,
    });
  }

  it('calls an expectation with no opportunity behind it QUOTED', () => {
    const fund = Fund.withBankroll(50_000)
      .do(quoted('q1'))
      .do(sale({ itemId: 'q1', grossProceedsCents: 3_000, daysToSale: 7 }));
    const r = accuracyReport(fund.state);
    expect(r.items[0]?.source).toBe('QUOTED');
    expect(r.quotedN).toBe(1);
    expect(r.scoredN).toBe(0);
    expect(r.n).toBe(1);
  });

  it('calls one that came through the scorer SCORED', () => {
    const fund = Fund.withBankroll(50_000)
      .do({ ...quoted('s1'), opportunityId: 'opp-1' })
      .do(sale({ itemId: 's1', grossProceedsCents: 3_000, daysToSale: 7 }));
    const r = accuracyReport(fund.state);
    expect(r.items[0]?.source).toBe('SCORED');
    expect(r.scoredN).toBe(1);
    expect(r.quotedN).toBe(0);
  });

  it('leaves an item with no expectation sourceless, and excluded', () => {
    const fund = Fund.withBankroll(50_000)
      .do(purchase({ itemId: 'n1', purchasePriceCents: 1_000 }))
      .do(sale({ itemId: 'n1', grossProceedsCents: 3_000, daysToSale: 7 }));
    const r = accuracyReport(fund.state);
    expect(r.items[0]?.source).toBeNull();
    expect(r.n).toBe(0);
    expect(r.unpredictedN).toBe(1);
  });

  // ⛔ The point of the split: a filtered report measures one population and
  // still says how big the other one is.
  it('narrows the statistics without hiding what it left out', () => {
    const fund = Fund.withBankroll(50_000)
      .do(quoted('q1'))
      .do(sale({ itemId: 'q1', grossProceedsCents: 3_000, daysToSale: 7 }))
      .do({ ...quoted('s1'), opportunityId: 'opp-1' })
      .do(sale({ itemId: 's1', grossProceedsCents: 3_000, daysToSale: 7 }));

    const all = accuracyReport(fund.state);
    expect(all.n).toBe(2);
    expect(all.only).toBeNull();

    const scored = accuracyReport(fund.state, 'SCORED');
    expect(scored.n).toBe(1);
    expect(scored.only).toBe('SCORED');
    // The counts still describe the whole population.
    expect(scored.quotedN).toBe(1);
    expect(scored.scoredN).toBe(1);
  });
});

describe('the report detects a systematic bias', () => {
  function runWith(actualDays: number, actualGross: number) {
    const fund = Fund.withBankroll(50_000);
    for (let i = 0; i < 8; i += 1) {
      fund
        .do(predicted(`i${i}`, 10, 2_800))
        .do(
          sale({
            itemId: `i${i}`,
            grossProceedsCents: actualGross,
            marketplaceFeeCents: 504,
            daysToSale: actualDays,
            occurredAt: T0,
          }),
        );
    }
    return accuracyReport(fund.state);
  }

  it('names optimistic hold times', () => {
    const r = runWith(25, 3_500); // predicted 10, took 25
    expect(r.daysRatioBps).toBe(25_000);
    expect(r.onTimeBps).toBe(0);
    expect(accuracyVerdict(r)).toMatch(/LONG.*optimistic/);
  });

  it('names pessimistic hold times', () => {
    const r = runWith(5, 3_500);
    expect(r.daysRatioBps).toBe(5_000);
    expect(accuracyVerdict(r)).toMatch(/short.*pessimistic/);
  });

  it('says the estimates are fine when they are', () => {
    const r = runWith(10, 3_872); // net ~2800, days exactly as predicted
    expect(r.onTimeBps).toBe(10_000);
    expect(accuracyVerdict(r)).toMatch(/about right/);
  });

  it('refuses to read a trend from too few sales', () => {
    const fund = Fund.withBankroll(50_000)
      .do(predicted('i1', 10, 2_800))
      .do(sale({ itemId: 'i1', grossProceedsCents: 9_000, daysToSale: 60 }));
    const r = accuracyReport(fund.state);
    expect(r.n).toBe(1);
    // One wild miss must not read as a finding.
    expect(accuracyVerdict(r)).toMatch(/too few to read a trend/);
  });
});

describe('profit realisation', () => {
  it('reports actual against expected across the predicted set', () => {
    const fund = Fund.withBankroll(50_000);
    for (let i = 0; i < 6; i += 1) {
      fund
        .do(predicted(`i${i}`, 10, 2_800)) // expects 1300 profit each
        .do(sale({ itemId: `i${i}`, grossProceedsCents: 2_500, daysToSale: 10 }));
    }
    const r = accuracyReport(fund.state);
    expect(r.totalExpectedProfitCents).toBe(6 * 1_300);
    expect(r.totalActualProfitCents).toBe(6 * 1_000);
    expect(r.profitRealisationBps).toBe(7_692); // ~77% of estimate
    expect(accuracyVerdict(r)).toMatch(/optimistic/);
  });
});
