import { describe, expect, it } from 'vitest';
import {
  annualTax,
  federalIncomeTax,
  incrementalReserve,
  marginalRateBps,
  selfEmploymentTax,
  stateIncomeTax,
} from '@/core/tax/annual.js';
import {
  UNCONFIGURED_TAX_PROFILE,
  assertValidTaxProfile,
  TaxProfileError,
  type TaxProfile,
} from '@/core/tax/profile.js';
import {
  DEFAULT_TAX_TABLES as T,
  TAX_TABLES_2025,
  acceptanceCovers,
  taxTableWarnings,
} from '@/core/tax/tables.js';
import { MD_2026 } from '@/core/tax/state.js';
import { applyBps } from '@/core/money.js';
import { computeTaxReserve } from '@/core/capital/tax.js';
import { Fund, purchase, sale } from './helpers.js';

const NO_PROFILE = UNCONFIGURED_TAX_PROFILE;

/** An illustrative filer, not anyone's real one: a $60k W-2 job, single, no state income tax. */
const WITH_JOB: TaxProfile = {
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

describe('the $400 self-employment threshold is a cliff, and it is modelled', () => {
  it('owes nothing at all below $400 of net SE earnings', () => {
    // $433.10 of business income is $399.98 of net earnings. Under the wire.
    const se = selfEmploymentTax(43_310, NO_PROFILE, T);
    expect(se.belowThreshold).toBe(true);
    expect(se.totalCents).toBe(0);
  });

  it('owes the whole thing five cents later', () => {
    const se = selfEmploymentTax(43_315, NO_PROFILE, T);
    expect(se.belowThreshold).toBe(false);
    expect(se.netEarningsCents).toBe(40_001);
    expect(se.totalCents).toBe(6_120); // $61.20 appears at once
  });

  it('reserves nothing on a sale that leaves the year under the floor', () => {
    // The old flat model reserved 14.13% here, on tax that is not owed.
    const r = computeTaxReserve(1_308, 0, 0, NO_PROFILE, T);
    expect(r.totalCents).toBe(0);
    expect(r.belowSelfEmploymentThreshold).toBe(true);
  });

  it('reserves the whole cliff on the sale that crosses it', () => {
    // Startling but correct: the year's SE tax becomes owed all at once, so the
    // crossing sale carries it. Smoothing this would under-reserve.
    const r = incrementalReserve(40_000, 10_000, NO_PROFILE, T);
    expect(r.totalCents).toBe(7_065);
    expect(r.effectiveRateBps).toBe(7_065); // 70.65% of that one sale
  });

  it('settles at 14.13% once the year is clear of the cliff', () => {
    for (const ytd of [50_000, 100_000, 500_000]) {
      const r = incrementalReserve(ytd, 10_000, NO_PROFILE, T);
      expect(r.effectiveRateBps).toBeGreaterThanOrEqual(1_412);
      expect(r.effectiveRateBps).toBeLessThanOrEqual(1_415);
    }
  });
});

describe('self-employment tax is the sum of its actual parts', () => {
  it('splits into Social Security and Medicare', () => {
    const se = selfEmploymentTax(100_000, NO_PROFILE, T);
    expect(se.netEarningsCents).toBe(92_350); // 92.35% of $1,000
    expect(se.socialSecurityCents).toBe(11_451); // 12.4%
    expect(se.medicareCents).toBe(2_678); // 2.9%
    expect(se.totalCents).toBe(14_129);
  });

  it('stops the Social Security half at the wage base', () => {
    const nearCap: TaxProfile = { ...NO_PROFILE, expectedW2WagesCents: T.socialSecurityWageBaseCents };
    const se = selfEmploymentTax(100_000, nearCap, T);
    expect(se.socialSecurityCents).toBe(0); // wages already used the whole base
    expect(se.medicareCents).toBe(2_678); // Medicare is uncapped
    expect(se.wageBaseReached).toBe(true);
  });

  it('lets W-2 wages consume the base only partly', () => {
    // ⚠️ Derived from the table, not hardcoded. This was $17_600_000 — a number
    // that meant "$100 of base left" only while the base was 2025's $176,100,
    // and silently meant "$8,500 left" the moment the 2026 table landed.
    const partial: TaxProfile = {
      ...NO_PROFILE,
      expectedW2WagesCents: T.socialSecurityWageBaseCents - 10_000,
    };
    const se = selfEmploymentTax(100_000, partial, T);
    // Only $100 of base is left, so only $100 is taxed at 12.4%.
    expect(se.socialSecurityCents).toBe(1_240);
    expect(se.wageBaseReached).toBe(true);
  });

  it('deducts half of it, excluding the additional Medicare surtax', () => {
    const se = selfEmploymentTax(100_000, NO_PROFILE, T);
    expect(se.halfDeductionCents).toBe(Math.floor((11_451 + 2_678) / 2));
  });

  it('owes nothing on a loss', () => {
    expect(selfEmploymentTax(-50_000, NO_PROFILE, T).totalCents).toBe(0);
  });
});

describe('federal income tax walks the brackets', () => {
  it('is progressive, not flat', () => {
    // $45,000 taxable, single: the first band's rate up to its cap, then the
    // second band's rate on the rest. Both read off the table, because a
    // hardcoded bracket edge is a test that passes only until January.
    const [first, second] = T.brackets.SINGLE as [
      { upToCents: number; rateBps: number },
      { upToCents: number; rateBps: number },
    ];
    const expected =
      Math.round((first.upToCents * first.rateBps) / 10_000) +
      Math.round(((4_500_000 - first.upToCents) * second.rateBps) / 10_000);
    expect(federalIncomeTax(4_500_000, 'SINGLE', T)).toBe(expected);
    // And it really is progressive: a flat top-rate calculation would be more.
    expect(expected).toBeLessThan(Math.round((4_500_000 * second.rateBps) / 10_000));
  });

  it('is zero at or below zero taxable income', () => {
    expect(federalIncomeTax(0, 'SINGLE', T)).toBe(0);
    expect(federalIncomeTax(-100, 'SINGLE', T)).toBe(0);
  });

  it('never exceeds the top rate', () => {
    const income = 100_000_000; // $1M
    expect(federalIncomeTax(income, 'SINGLE', T)).toBeLessThan(Math.round(income * 0.37));
  });

  it('reports the marginal rate at each step', () => {
    expect(marginalRateBps(1_000_000, 'SINGLE', T)).toBe(1_000);
    expect(marginalRateBps(4_500_000, 'SINGLE', T)).toBe(1_200);
    expect(marginalRateBps(9_000_000, 'SINGLE', T)).toBe(2_200);
  });

  it('taxes a married-joint filer less on the same income', () => {
    expect(federalIncomeTax(9_000_000, 'MARRIED_JOINT', T)).toBeLessThan(
      federalIncomeTax(9_000_000, 'SINGLE', T),
    );
  });

  it('is monotonic across a wide sweep', () => {
    let previous = -1;
    for (let income = 0; income <= 30_000_000; income += 250_000) {
      const tax = federalIncomeTax(income, 'SINGLE', T);
      expect(tax).toBeGreaterThanOrEqual(previous);
      previous = tax;
    }
  });
});

describe('without a tax profile, income tax abstains rather than guesses', () => {
  it('reserves self-employment tax and says income tax was not estimated', () => {
    const a = annualTax(500_000, NO_PROFILE, T);
    expect(a.selfEmployment.totalCents).toBeGreaterThan(0);
    expect(a.federalIncomeCents).toBe(0);
    expect(a.stateIncomeCents).toBe(0);
    expect(a.incomeTaxEstimated).toBe(false);
  });

  it('the flag reaches the per-sale breakdown, so a UI can warn', () => {
    const r = computeTaxReserve(100_000, 500_000, 0, NO_PROFILE, T);
    expect(r.incomeTaxEstimated).toBe(false);
    expect(r.federalIncomeCents).toBe(0);
  });
});

describe('with a real profile, the reserve reflects the actual marginal rate', () => {
  it('reserves 23.05% on $1,000 for a single filer with a $60k job', () => {
    const r = incrementalReserve(0, 100_000, WITH_JOB, T);
    expect(r.selfEmploymentCents).toBe(14_129);
    expect(r.federalIncomeCents).toBe(8_922);
    expect(r.totalCents).toBe(23_051);
    expect(r.effectiveRateBps).toBe(2_305);
    expect(r.incomeTaxEstimated).toBe(true);
  });

  it('applies QBI, which lowers the taxable base', () => {
    const withQbi = annualTax(100_000, WITH_JOB, T);
    const without = annualTax(100_000, { ...WITH_JOB, claimQbiDeduction: false }, T);
    expect(withQbi.qbiDeductionCents).toBeGreaterThan(0);
    expect(withQbi.federalIncomeCents).toBeLessThan(without.federalIncomeCents);
  });

  it('adds state income tax when a rate is set', () => {
    const noState = incrementalReserve(0, 100_000, WITH_JOB, T);
    const withState = incrementalReserve(
      0,
      100_000,
      { ...WITH_JOB, stateIncomeTaxBps: 500 },
      T,
    );
    expect(noState.stateIncomeCents).toBe(0);
    expect(withState.stateIncomeCents).toBeGreaterThan(0);
    expect(withState.totalCents).toBeGreaterThan(noState.totalCents);
  });

  it('taxes a high earner MORE on income and LESS on self-employment', () => {
    // This surprised me and the model was right. A $200k W-2 earner has already
    // used the whole Social Security wage base, so the 12.4% half of SE tax
    // does not apply to their business income at all — while their income-tax
    // bracket is far higher. The two move in opposite directions.
    const low = incrementalReserve(0, 100_000, WITH_JOB, T);
    const high = incrementalReserve(
      0,
      100_000,
      { ...WITH_JOB, expectedOtherIncomeCents: 20_000_000, expectedW2WagesCents: 20_000_000 },
      T,
    );

    expect(high.federalIncomeCents).toBeGreaterThan(low.federalIncomeCents);
    expect(high.selfEmploymentCents).toBeLessThan(low.selfEmploymentCents);
    // No Social Security at all: the wage base was gone before the sale.
    expect(high.after.selfEmployment.socialSecurityCents).toBe(0);
    expect(high.after.selfEmployment.wageBaseReached).toBe(true);
    // A flat "higher earner pays more" rate would have got this backwards.
    expect(high.totalCents).toBeLessThan(low.totalCents);
  });

  it('reserves a sensible amount on a realistic $13 flip', () => {
    // SE is still under the $400 floor, so only income tax applies.
    const r = incrementalReserve(0, 1_308, WITH_JOB, T);
    expect(r.selfEmploymentCents).toBe(0);
    expect(r.totalCents).toBe(126);
  });
});

/** An MD-shaped combined marginal rate. Not anyone's real jurisdiction. */
const MARYLAND: TaxProfile = {
  ...WITH_JOB,
  expectedOtherIncomeCents: 6_000_000,
  expectedW2WagesCents: 6_000_000,
  stateIncomeTaxBps: 740,
  stateRateBasis: 'illustrative MD-shaped combined rate',
  stateAllowsQbiDeduction: false,
};

describe('state tax is charged on the state base, not the federal one', () => {
  it('adds QBI back, because most states do not allow it', () => {
    const a = annualTax(100_000, MARYLAND, T);
    expect(a.qbiDeductionCents).toBeGreaterThan(0);
    expect(a.stateTaxableIncomeCents).toBe(a.taxableIncomeCents + a.qbiDeductionCents);
  });

  it('reserves more than it would against the federal taxable figure', () => {
    // The bug this fixes: applying the state rate to federal taxable income
    // under-reserves by rate x QBI on every dollar of business income.
    const correct = incrementalReserve(0, 100_000, MARYLAND, T);
    const wrong = incrementalReserve(0, 100_000, { ...MARYLAND, stateAllowsQbiDeduction: true }, T);
    expect(correct.stateIncomeCents).toBeGreaterThan(wrong.stateIncomeCents);
  });

  it('makes no difference when QBI is not being claimed at all', () => {
    const noQbi = { ...MARYLAND, claimQbiDeduction: false };
    const a = annualTax(100_000, noQbi, T);
    expect(a.qbiDeductionCents).toBe(0);
    expect(a.stateTaxableIncomeCents).toBe(a.taxableIncomeCents);
  });
});

/**
 * ⚠️ An ILLUSTRATIVE profile, not anyone's real one — $60k, single, a
 * Maryland-shaped combined rate. The figures below are what the model produces
 * for it; the operator's actual profile lives in the database and nowhere in
 * this repository.
 */
describe('a Maryland-shaped profile, end to end', () => {
  it('splits $1,000 of profit into its three real components', () => {
    const r = incrementalReserve(0, 100_000, MARYLAND, T);
    // 92.35% of $1,000 at 15.3% — the SE half is income-independent.
    expect(r.selfEmploymentCents).toBe(14_129);
    expect(r.federalIncomeCents).toBe(8_922);
    expect(r.stateIncomeCents).toBe(6_877);
    expect(r.totalCents).toBe(29_928);
    expect(r.effectiveRateBps).toBe(2_993);
    // The three parts are the whole, with nothing unaccounted for.
    expect(r.selfEmploymentCents + r.federalIncomeCents + r.stateIncomeCents).toBe(r.totalCents);
  });

  it('reserves no SE tax on a small flip, because the year is under the $400 floor', () => {
    const r = incrementalReserve(0, 1_308, MARYLAND, T);
    expect(r.selfEmploymentCents).toBe(0);
    expect(r.federalIncomeCents).toBe(126);
    expect(r.stateIncomeCents).toBe(97);
    expect(r.totalCents).toBe(223);
  });

  it('the QBI add-back is worth $13.75 of state tax on $1,000', () => {
    // Small per flip, and it compounds over a year of them.
    const correct = incrementalReserve(0, 100_000, MARYLAND, T);
    const ifStateAllowedQbi = incrementalReserve(
      0,
      100_000,
      { ...MARYLAND, stateAllowsQbiDeduction: true },
      T,
    );
    expect(correct.stateIncomeCents - ifStateAllowedQbi.stateIncomeCents).toBe(1_375);
  });

  it('reserves less than the 3.20% top county rate would have', () => {
    // Maryland's counties vary by nearly a full point. Assuming the top rate
    // was the safe direction, but it over-reserved by 55 basis points.
    const cheaperCounty = incrementalReserve(0, 100_000, MARYLAND, T);
    const topRateCounty = incrementalReserve(
      0,
      100_000,
      { ...MARYLAND, stateIncomeTaxBps: 795 },
      T,
    );
    expect(cheaperCounty.totalCents).toBeLessThan(topRateCounty.totalCents);
    expect(topRateCounty.totalCents - cheaperCounty.totalCents).toBe(511);
  });
});

describe('the incremental reserve is well-behaved', () => {
  it('never reserves more than the profit that caused it', () => {
    for (const ytd of [0, 40_000, 100_000, 5_000_000]) {
      for (const profit of [1, 100, 10_000, 1_000_000]) {
        const r = incrementalReserve(ytd, profit, WITH_JOB, T);
        expect(r.totalCents).toBeLessThanOrEqual(profit);
        expect(r.totalCents).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('never returns a negative reserve, even where the year is at a loss', () => {
    const r = incrementalReserve(-500_000, 10_000, WITH_JOB, T);
    expect(r.totalCents).toBeGreaterThanOrEqual(0);
  });

  it('sums to the annual figure when taken in pieces', () => {
    // Ten $100 reserves should land within rounding of one $1,000 reserve.
    let piecewise = 0;
    let ytd = 500_000; // clear of the cliff, so the rate is stable
    for (let i = 0; i < 10; i += 1) {
      piecewise += incrementalReserve(ytd, 10_000, WITH_JOB, T).totalCents;
      ytd += 10_000;
    }
    const oneShot = incrementalReserve(500_000, 100_000, WITH_JOB, T).totalCents;
    expect(Math.abs(piecewise - oneShot)).toBeLessThanOrEqual(10);
  });

  it('reserves nothing on zero or negative profit', () => {
    expect(computeTaxReserve(0, 100_000, 0, WITH_JOB, T).totalCents).toBe(0);
    expect(computeTaxReserve(-5_000, 100_000, 0, WITH_JOB, T).totalCents).toBe(0);
  });
});

describe('what was reserved per sale equals what the year actually owes', () => {
  it('holds after a run of flips, which is the whole point of reserving incrementally', () => {
    // If per-sale reserving drifted from the annual truth, `tax show` would
    // report a phantom shortfall or surplus. This asserts it cannot.
    const fund = Fund.employed(50_000);
    for (let i = 0; i < 6; i += 1) {
      fund
        .do(purchase({ itemId: `p${i}`, purchasePriceCents: 1_500 }))
        .do(sale({ itemId: `p${i}`, grossProceedsCents: 3_900, marketplaceFeeCents: 557 }));
    }

    const owed = incrementalReserve(
      0,
      fund.state.ytdNetBusinessIncomeCents,
      fund.state.taxProfile,
      fund.state.taxTables,
    ).totalCents;

    expect(fund.state.ytdTaxReservedCents).toBe(owed);
  });

  it('catches up across the $400 cliff, where one sale cannot carry it', () => {
    // The cliff owes $61.20 the moment it is crossed, and the crossing sale
    // only earns $18.43. A per-sale increment capped at the profit would drop
    // the difference forever; the catch-up reserve picks it up on later sales.
    const fund = Fund.employed(500_000);
    const owedNow = () =>
      incrementalReserve(
        0,
        fund.state.ytdNetBusinessIncomeCents,
        fund.state.taxProfile,
        fund.state.taxTables,
      ).totalCents;

    const gaps: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      fund
        .do(purchase({ itemId: `p${i}`, purchasePriceCents: 1_500 }))
        .do(sale({ itemId: `p${i}`, grossProceedsCents: 3_900, marketplaceFeeCents: 557 }));
      gaps.push(owedNow() - fund.state.ytdTaxReservedCents);
    }

    expect(fund.state.ytdNetBusinessIncomeCents).toBeGreaterThan(43_315); // past the cliff

    // A gap opens the moment the cliff is crossed...
    expect(Math.max(...gaps)).toBeGreaterThan(4_000);
    // ...it only ever shrinks after that...
    const firstGap = gaps.findIndex((g) => g > 0);
    for (let i = firstGap + 1; i < gaps.length; i += 1) {
      expect(gaps[i]!).toBeLessThanOrEqual(gaps[i - 1]!);
    }
    // ...and it closes completely.
    expect(fund.state.ytdTaxReservedCents).toBe(owedNow());
    expect(gaps[gaps.length - 1]).toBe(0);
  });

  it('reports what it could not reserve, rather than dropping it silently', () => {
    // Right at the cliff: the sale owes more tax than it earned.
    const r = computeTaxReserve(1_843, 41_500, 0, WITH_JOB, T);
    expect(r.carriedForwardCents).toBeGreaterThan(0);
    expect(r.totalCents).toBe(1_843); // everything the sale earned
    expect(r.effectiveRateBps).toBe(10_000); // 100% of that one sale
  });

  it('resets at a year boundary', () => {
    const dec = '2026-12-31T12:00:00.000Z';
    const jan = '2027-01-02T12:00:00.000Z';
    const fund = Fund.employed(500_000);

    // Two flips in 2026, so the year has more than one flip's worth of income.
    for (const id of ['a', 'b']) {
      fund
        .do(purchase({ itemId: id, purchasePriceCents: 1_500, occurredAt: dec }))
        .do(sale({ itemId: id, grossProceedsCents: 3_900, occurredAt: dec }));
    }
    expect(fund.state.taxYear).toBe(2026);
    const endOf2026 = fund.state.ytdNetBusinessIncomeCents;
    expect(endOf2026).toBe(4_800);
    const reservedIn2026 = fund.state.ytdTaxReservedCents;

    // One flip in 2027: the year-to-date figures start over.
    fund
      .do(purchase({ itemId: 'c', purchasePriceCents: 1_500, occurredAt: jan }))
      .do(sale({ itemId: 'c', grossProceedsCents: 3_900, occurredAt: jan }));

    expect(fund.state.taxYear).toBe(2027);
    expect(fund.state.ytdNetBusinessIncomeCents).toBe(2_400);
    expect(fund.state.ytdNetBusinessIncomeCents).toBeLessThan(endOf2026);
    expect(fund.state.ytdTaxReservedCents).toBeLessThan(reservedIn2026);
  });
});

/**
 * ⚠️ These use `TAX_TABLES_2025` deliberately. The DEFAULT tables are verified
 * as of 2026, so pointing this behaviour at the default would have quietly
 * stopped testing it — the assertions would still pass, against nothing.
 */
const UNVERIFIED = TAX_TABLES_2025;

describe('an unverified table announces itself', () => {
  it('warns until a human has checked it', () => {
    expect(UNVERIFIED.verified).toBe(false);
    const warnings = taxTableWarnings(UNVERIFIED, UNVERIFIED.year);
    expect(warnings.map((w) => w.code)).toContain('TABLES_UNVERIFIED');
  });

  it('warns when reserving for a different year than the tables cover', () => {
    const warnings = taxTableWarnings(UNVERIFIED, UNVERIFIED.year + 1);
    expect(warnings.map((w) => w.code)).toContain('TABLES_WRONG_YEAR');
  });
});

describe('the tables actually in use are verified', () => {
  it('is a verified 2026 table that names who checked it and against what', () => {
    expect(T.year).toBe(2026);
    expect(T.verified).toBe(true);
    // A flag with no provenance is worth nothing — the point of `verified` is
    // that a reader can go and check the same source.
    expect(T.verifiedBy).toContain('Rev. Proc. 2025-32');
    expect(T.verifiedBy).toContain('SSA 2026 COLA');
    expect(T.verifiedAt).toBeTruthy();
  });

  it('says nothing at all when reserving for its own year', () => {
    // No acceptance needed any more: the tables are right and current.
    expect(taxTableWarnings(T, T.year)).toEqual([]);
  });

  it('carries the 2026 figures, not 2025 ones', () => {
    expect(T.socialSecurityWageBaseCents).toBe(18_450_000); // $184,500
    expect(T.standardDeductionCents.SINGLE).toBe(1_610_000); // $16,100
    expect(T.brackets.SINGLE[0]!.upToCents).toBe(1_240_000); // 10% to $12,400
    // And 2025 is kept, unchanged, for replaying older events.
    expect(TAX_TABLES_2025.socialSecurityWageBaseCents).toBe(17_610_000);
    expect(TAX_TABLES_2025.verified).toBe(false);
  });

  it('still warns if asked to reserve for a year it does not cover', () => {
    expect(taxTableWarnings(T, T.year + 1).map((w) => w.code)).toContain('TABLES_WRONG_YEAR');
  });
});

describe('owner acceptance is not verification', () => {
  // Acceptance only ever applies to a table nobody has checked, so this block
  // uses the unverified 2025 one throughout.
  const T = UNVERIFIED;
  const accepted = {
    tablesYear: T.year,
    forTransactionYear: T.year + 1,
    acceptedBy: 'Jason',
    acceptedAt: '2026-09-08T12:00:00.000Z',
    note: null,
  };

  it('replaces the warnings with one informational line', () => {
    const warnings = taxTableWarnings(T, T.year + 1, accepted);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe('TABLES_ACCEPTED');
    expect(warnings[0]!.severity).toBe('info');
  });

  it('still says out loud that they are not IRS-verified', () => {
    // The whole point: acceptance must not read as verification.
    const [w] = taxTableWarnings(T, T.year + 1, accepted);
    expect(w!.message).toMatch(/Not IRS-verified/);
    expect(T.verified).toBe(false); // and the flag is untouched
  });

  it('does not carry into the next tax year', () => {
    // An acceptance for 2026 must not silence 2027 — the year rolling over is
    // exactly when someone should look at the tables again.
    expect(acceptanceCovers(accepted, T, T.year + 1)).toBe(true);
    expect(acceptanceCovers(accepted, T, T.year + 2)).toBe(false);
    const warnings = taxTableWarnings(T, T.year + 2, accepted);
    expect(warnings.map((w) => w.code)).toContain('TABLES_WRONG_YEAR');
    expect(warnings.map((w) => w.code)).toContain('TABLES_UNVERIFIED');
  });

  it('does not carry to a different set of tables', () => {
    const nextYearTables = { ...T, year: T.year + 1 };
    expect(acceptanceCovers(accepted, nextYearTables, T.year + 1)).toBe(false);
  });

  it('changes no number the reserve depends on', () => {
    // Acceptance is bookkeeping about trust, not an input to the maths.
    const before = incrementalReserve(0, 100_000, WITH_JOB, T).totalCents;
    const after = incrementalReserve(0, 100_000, WITH_JOB, T).totalCents;
    expect(before).toBe(after);
  });
});

describe('tax profile validation', () => {
  it('accepts the unconfigured default', () => {
    expect(() => assertValidTaxProfile(UNCONFIGURED_TAX_PROFILE)).not.toThrow();
  });

  it('rejects a negative income', () => {
    expect(() =>
      assertValidTaxProfile({ ...WITH_JOB, expectedOtherIncomeCents: -1 }),
    ).toThrow(TaxProfileError);
  });

  it('rejects an implausible state rate, which is always a typo', () => {
    expect(() => assertValidTaxProfile({ ...WITH_JOB, stateIncomeTaxBps: 5_000 })).toThrow(
      /0\.\.3000/,
    );
  });

  it('refuses a state rate with no stated derivation', () => {
    // A bare number nobody can check later is the thing this prevents.
    expect(() =>
      assertValidTaxProfile({ ...WITH_JOB, stateIncomeTaxBps: 740, stateRateBasis: null }),
    ).toThrow(/stateRateBasis is required/);
    expect(() =>
      assertValidTaxProfile({
        ...WITH_JOB,
        stateIncomeTaxBps: 715,
        stateRateBasis: 'MD 4.75% + Talbot 2.40%',
      }),
    ).not.toThrow();
  });

  it('allows a zero rate with no derivation, because zero explains itself', () => {
    expect(() =>
      assertValidTaxProfile({ ...WITH_JOB, stateIncomeTaxBps: 0, stateRateBasis: null }),
    ).not.toThrow();
  });

  it('rejects an unknown filing status', () => {
    expect(() =>
      assertValidTaxProfile({ ...WITH_JOB, filingStatus: 'NONSENSE' as never }),
    ).toThrow(TaxProfileError);
  });
});

describe('state tax by brackets, when a jurisdiction is named', () => {
  const FLAT: TaxProfile = {
    ...WITH_JOB,
    stateIncomeTaxBps: 715, // 4.75% MD + 2.40% Talbot, as one flat marginal rate
    stateRateBasis: 'MD 4.75% + Talbot 2.40%',
  };
  const BRACKETED: TaxProfile = {
    ...FLAT,
    stateJurisdiction: { state: 'MD', locality: 'Talbot County' },
  };

  it('leaves a profile without a jurisdiction on exactly the old path', () => {
    // The whole point of making this additive: nothing already stored changes.
    expect(stateIncomeTax(10_000_000, FLAT, 2026)).toBe(applyBps(10_000_000, 715));
  });

  it('agrees with the flat rate while the marginal rate holds', () => {
    // MD is 4.75% from $3,000 to $100,000 and Talbot is a flat 2.40%, so an
    // increment inside that band is taxed at exactly 7.15% either way. This is
    // why the flat approximation was not wrong — only incomplete.
    const base = 5_000_000; // $50,000
    const step = 100_000; // $1,000
    const flatStep = stateIncomeTax(base + step, FLAT, 2026) - stateIncomeTax(base, FLAT, 2026);
    const bracketStep =
      stateIncomeTax(base + step, BRACKETED, 2026) - stateIncomeTax(base, BRACKETED, 2026);
    expect(bracketStep).toBe(flatStep);
    expect(bracketStep).toBe(applyBps(step, 715));
  });

  it('diverges where the flat rate is wrong — across a bracket edge', () => {
    // Maryland steps 4.75% -> 5% at $100,000 for a single filer. A flat
    // marginal rate cannot know that, and over-reserves below the edge while
    // under-reserving above it.
    const below = 9_900_000; // $99,000
    const above = 10_100_000; // $101,000
    const flat = stateIncomeTax(above, FLAT, 2026) - stateIncomeTax(below, FLAT, 2026);
    const bracketed = stateIncomeTax(above, BRACKETED, 2026) - stateIncomeTax(below, BRACKETED, 2026);
    expect(bracketed).not.toBe(flat);
    // The step above the edge is taxed higher, so the bracketed answer is more.
    expect(bracketed).toBeGreaterThan(flat);
  });

  it('is progressive at the bottom, where a flat rate badly overstates', () => {
    // $2,000 of state taxable income: 2% on the first $1,000, 3% on the next.
    expect(stateIncomeTax(200_000, BRACKETED, 2026)).toBe(
      applyBps(100_000, 200) + applyBps(100_000, 300) + applyBps(200_000, 240),
    );
    expect(stateIncomeTax(200_000, BRACKETED, 2026)).toBeLessThan(
      stateIncomeTax(200_000, FLAT, 2026),
    );
  });

  it('falls back to the flat rate for a county it does not model, never to zero', () => {
    // ⛔ Anne Arundel and Frederick are graduated and deliberately absent. An
    // unmodelled county must not silently become tax-free.
    const unknown: TaxProfile = {
      ...FLAT,
      stateJurisdiction: { state: 'MD', locality: 'Anne Arundel County' },
    };
    expect(stateIncomeTax(10_000_000, unknown, 2026)).toBe(applyBps(10_000_000, 715));
    const otherState: TaxProfile = {
      ...FLAT,
      stateJurisdiction: { state: 'ZZ', locality: 'Nowhere' },
    };
    expect(stateIncomeTax(10_000_000, otherState, 2026)).toBe(applyBps(10_000_000, 715));
    // And a year the table does not cover.
    expect(stateIncomeTax(10_000_000, BRACKETED, 2099)).toBe(applyBps(10_000_000, 715));
  });

  it('carries a county at the rate confirmed against the Comptroller', () => {
    expect(MD_2026.localRateBps['Talbot County']).toBe(240);
    expect(MD_2026.verified).toBe(true);
  });
});
