/**
 * The drop screen: what is coming, what it would pay, and what the fund must
 * reach by the date.
 *
 * ⛔ **The claims worth pinning are about HONESTY and REACHABILITY**, not about
 * arithmetic the evaluator already owns: an analogy has to be able to REACH the
 * evaluator, "nobody has looked yet" is not "nothing has sold", a drop that has
 * happened is never judged, and a capital refusal here carries a deadline.
 */

import { describe, expect, it } from 'vitest';
import { evaluateOpportunity } from '@/scoring/evaluate.js';
import { parseOpportunity, type OpportunityInput } from '@/domain/opportunity.js';
import { computeMetrics } from '@/core/capital/metrics.js';
import type { Drop } from '@/core/drop.js';
import {
  dropAsOpportunity,
  dropsScreen,
  whenText,
  type DropCandidate,
  type DropEvidence,
} from '@/screens/drops.js';
import { Fund } from './helpers.js';

const NOW = new Date('2026-09-11T12:00:00.000Z');

/** ⏳ D3: the bankroll is $75 once the contribution lands. */
const fund = () => Fund.withBankroll(7_500);

const drop = (over: Partial<Drop> = {}): Drop => ({
  dropId: 'd1',
  name: 'LEGO UCS Something 2026',
  retailer: 'LEGO Store',
  // 20 days out from NOW, counted on a calendar rather than from the code.
  dropDate: '2026-10-01',
  msrpCents: 2_500,
  comparable: { keyword: 'lego ucs something 2025', why: "last year's UCS set, same piece count" },
  ...over,
});

const evidence = (over: Partial<DropEvidence> = {}): DropEvidence => ({
  comparableCompPricesCents: [5_900, 6_000, 6_100, 6_050, 5_950, 6_000, 6_200, 5_980],
  comparableCompMedianAgeDays: 20,
  comparableSoldLast90Days: 90,
  comparableActiveListings: 15,
  category: 'TOYS',
  ...over,
});

const screenOf = (candidates: readonly DropCandidate[], now: Date = NOW) => {
  const f = fund();
  return dropsScreen(
    candidates,
    f.state,
    computeMetrics(f.state).navCents,
    now,
    evaluateOpportunity,
  );
};

describe('⛔ the analogy has to REACH the evaluator, or the cap changes nothing', () => {
  // The measured case, 2026-09-11: a thin-but-tidy predecessor set with weak
  // demand scores 49.54% unflagged and 41.75% flagged, against a BOOTSTRAP
  // floor of 45%. Every number in this gate rests on the flag being carried.
  const thin = {
    opportunityId: 'opp-thin',
    name: 'thing',
    category: 'TOYS',
    askingPriceCents: 2_500,
    expectedGrossCents: 6_000,
    soldLast90Days: 3,
    activeListings: 9,
    compPricesCents: [5_900, 6_000, 6_100],
    compMedianAgeDays: 20,
  };

  it('carries the flag from the OPPORTUNITY through to the confidence score', () => {
    const state = fund().state;
    const plain = evaluateOpportunity(parseOpportunity(thin), state);
    const analogy = evaluateOpportunity(
      parseOpportunity({ ...thin, evidenceIsAnalogous: true }),
      state,
    );
    expect(analogy.confidence.confidenceBps).toBeLessThan(plain.confidence.confidenceBps);
    expect(analogy.confidence.comp.analogous).toBe(true);
  });

  it('⛔ and the difference lands on opposite sides of the confidence floor', () => {
    const state = fund().state;
    const floor = computeMetrics(state).modePolicy.minConfidenceBps;
    const plain = evaluateOpportunity(parseOpportunity(thin), state);
    const analogy = evaluateOpportunity(
      parseOpportunity({ ...thin, evidenceIsAnalogous: true }),
      state,
    );
    expect(plain.confidence.confidenceBps).toBeGreaterThanOrEqual(floor);
    expect(analogy.confidence.confidenceBps).toBeLessThan(floor);
  });

  it('⚠️ an unflagged opportunity scores EXACTLY as it did before the field existed', () => {
    // The field defaults to false, so every caller in the app keeps its score.
    const state = fund().state;
    const withField = evaluateOpportunity(
      parseOpportunity({ ...thin, evidenceIsAnalogous: false }),
      state,
    );
    const without = evaluateOpportunity(parseOpportunity(thin), state);
    expect(withField.confidence.confidenceBps).toBe(without.confidence.confidenceBps);
  });

  it('⛔ caps the DEMAND half too, not only the comps (Jason, 2026-09-11)', () => {
    // A drop's sold and active counts are the predecessor's as surely as its
    // prices are, and 90 sales in 90 days saturates the demand term at 100%.
    const state = fund().state;
    const strong = { ...thin, soldLast90Days: 90, activeListings: 15 };
    const plain = evaluateOpportunity(parseOpportunity(strong), state);
    const analogy = evaluateOpportunity(
      parseOpportunity({ ...strong, evidenceIsAnalogous: true }),
      state,
    );
    expect(plain.confidence.demandBps).toBe(10_000);
    expect(analogy.confidence.demandBps).toBe(5_000);
  });
});

describe('a drop is judged AT MSRP, on evidence that is never its own', () => {
  it('⛔ prices the opportunity at the announced price, not at the ceiling', () => {
    const input = dropAsOpportunity(drop(), evidence());
    expect(input.askingPriceCents).toBe(2_500);
  });

  it('⛔ declares the evidence analogous, always', () => {
    // There is no such thing as a drop with comps of its own. If this can ever
    // be false, the cap is optional and the gate is decoration.
    expect(dropAsOpportunity(drop(), evidence()).evidenceIsAnalogous).toBe(true);
  });

  it('estimates resale from the comparable MEDIAN', () => {
    // Median, not mean: one outlier in a small predecessor set would set the
    // price of everything downstream.
    const input = dropAsOpportunity(drop(), evidence({ comparableCompPricesCents: [1_000, 2_000, 90_000] }));
    expect(input.expectedGrossCents).toBe(2_000);
  });

  it('⚡ treats a retail drop as SEALED, because it is', () => {
    expect(dropAsOpportunity(drop(), evidence()).conditionConfidenceBps).toBe(9_500);
  });
});

describe('⛔ four states, because collapsing any two of them lies', () => {
  it('"nothing comparable has sold" is not a refusal', () => {
    const screen = screenOf([{ drop: drop({ comparable: null }), evidence: null }]);
    const row = screen.rows[0]!;
    expect(row.status.kind).toBe('NO_COMPARABLE');
    expect(row.line).toContain('no honest price');
    expect(row.line.toLowerCase()).not.toContain('pass');
  });

  it('⚠️ "nobody has looked yet" is a different state, and it names the search', () => {
    const screen = screenOf([{ drop: drop(), evidence: null }]);
    const row = screen.rows[0]!;
    expect(row.status.kind).toBe('NOT_VALUED');
    expect(row.line).toContain('lego ucs something 2025');
  });

  it('⛔ an EMPTY comp set is not a market reading', () => {
    // A median over nothing is 0, which prices the drop at zero and then
    // refuses it — a confident verdict produced from no evidence at all.
    const screen = screenOf([
      { drop: drop(), evidence: evidence({ comparableCompPricesCents: [] }) },
    ]);
    expect(screen.rows[0]!.status.kind).toBe('NOT_VALUED');
  });

  it('⛔ a drop that has happened is KEPT and never judged', () => {
    const screen = screenOf([{ drop: drop({ dropDate: '2026-09-01' }), evidence: evidence() }]);
    const row = screen.rows[0]!;
    expect(row.status.kind).toBe('PASSED');
    expect(row.timing.passed).toBe(true);
  });

  it('⚠️ a drop happening TODAY is judged, not filed as history', () => {
    // The worst day in the calendar to get wrong, and it was wrong once.
    const screen = screenOf([{ drop: drop({ dropDate: '2026-09-11' }), evidence: evidence() }]);
    expect(screen.rows[0]!.status.kind).toBe('JUDGED');
    expect(whenText(screen.rows[0]!.timing)).toBe('TODAY');
  });
});

describe('⚡ a capital refusal here carries a DATE', () => {
  // $220 MSRP against a $75 bankroll: the fund cannot take it today, and the
  // question is whether it could by the drop date.
  const expensive = drop({ msrpCents: 22_000, dropDate: '2026-12-01' });
  const rich = evidence({ comparableCompPricesCents: [48_000, 50_000, 52_000, 50_500, 49_500, 50_000] });

  it('says what the bankroll must REACH, and by when', () => {
    const screen = screenOf([{ drop: expensive, evidence: rich }]);
    const status = screen.rows[0]!.status;
    expect(status.kind).toBe('JUDGED');
    if (status.kind !== 'JUDGED') return;
    expect(status.verdict.buyAtMsrp).toBe(false);
    expect(status.verdict.shortfall).not.toBeNull();
    expect(status.verdict.shortfall!.shortfallCents).toBeGreaterThan(0);
    expect(screen.rows[0]!.line).toContain('2026-12-01');
  });

  it('⛔ and the SAME shortfall is unreachable when the date is close', () => {
    // Identical money, different deadline. A shortfall you can grow into and
    // one you cannot are the same number and opposite answers.
    const soon = screenOf([{ drop: { ...expensive, dropDate: '2026-09-14' }, evidence: rich }]);
    const status = soon.rows[0]!.status;
    if (status.kind !== 'JUDGED') throw new Error('expected a judged drop');
    expect(status.verdict.shortfall!.reachable).toBe(false);
    expect(soon.rows[0]!.line).toContain('not enough time');
  });

  it('⛔ a refusal always says WHY, and never shows the header as the reason', () => {
    // `reasons[0]` is "Rejected on 4 capital rules:" — a colon, not a reason.
    // A slow-moving drop the fund could afford is refused on the gates, and its
    // ceiling sits ABOVE MSRP, so the ceiling explains nothing here.
    const screen = screenOf([
      {
        drop: drop(),
        evidence: evidence({ comparableSoldLast90Days: 3, comparableActiveListings: 40 }),
      },
    ]);
    const status = screen.rows[0]!.status;
    if (status.kind !== 'JUDGED') throw new Error('expected a judged drop');
    expect(status.verdict.buyAtMsrp).toBe(false);
    expect(status.verdict.failedGates.length).toBeGreaterThan(0);
    expect(status.verdict.primaryReason).not.toMatch(/:$/);
    expect(status.verdict.primaryReason).not.toBe(status.verdict.reasons[0]);
    expect(screen.rows[0]!.line).toContain(status.verdict.primaryReason);
  });

  it('⛔ carries the abstentions through, because 6.6 applies to every screen that judges', () => {
    // A gate that did not get to look is neither a pass nor a failure, and a
    // screen that silently drops them makes "absent" and "forgotten" the same
    // thing again — one screen over from where B66 was fixed.
    //
    // ⚠️ **The abstention is INJECTED, and the first version of this test was
    // vacuous without it.** Only one gate can abstain today — sell-through,
    // when the hold came from an operator's estimate — and a drop always
    // supplies the comparable's counts, so a real evaluation of a real drop
    // abstains on nothing. Comparing `[]` to `[]` passed with the wiring
    // deleted; planting is what showed it.
    const f = fund();
    const abstaining = (input: OpportunityInput, at: typeof f.state) => {
      const real = evaluateOpportunity(input, at);
      return {
        ...real,
        gates: {
          ...real.gates,
          abstentions: [{ code: 'SELL_THROUGH_TOO_LOW' as const, because: 'no comps to take a ratio from' }],
        },
      };
    };
    const screen = dropsScreen(
      [{ drop: drop(), evidence: evidence() }],
      f.state,
      computeMetrics(f.state).navCents,
      NOW,
      abstaining,
    );
    const status = screen.rows[0]!.status;
    if (status.kind !== 'JUDGED') throw new Error('expected a judged drop');
    expect(status.verdict.abstentions).toEqual([
      { code: 'SELL_THROUGH_TOO_LOW', because: 'no comps to take a ratio from' },
    ]);
  });

  it('⚠️ no shortfall is reported when no bankroll fixes it', () => {
    // Worth less than it costs. That is not a capital problem, and dressing it
    // as one would have the operator saving up for something never worth buying.
    const screen = screenOf([
      { drop: drop({ msrpCents: 9_000 }), evidence: evidence({ comparableCompPricesCents: [9_100, 9_200, 9_150] }) },
    ]);
    const status = screen.rows[0]!.status;
    if (status.kind !== 'JUDGED') throw new Error('expected a judged drop');
    expect(status.verdict.shortfall).toBeNull();
    expect(status.verdict.notWorthMsrp).toBe(true);
    expect(screen.rows[0]!.line).toContain('worth');
  });
});

describe('the list is ordered by the deadline, and says plainly when nothing is a buy', () => {
  it('⛔ soonest first, and everything that has happened last', () => {
    const screen = screenOf([
      { drop: drop({ dropId: 'far', name: 'Far', dropDate: '2026-11-01' }), evidence: evidence() },
      { drop: drop({ dropId: 'gone', name: 'Gone', dropDate: '2026-09-02' }), evidence: evidence() },
      { drop: drop({ dropId: 'soon', name: 'Soon', dropDate: '2026-09-20' }), evidence: evidence() },
    ]);
    expect(screen.rows.map((r) => r.name)).toEqual(['Soon', 'Far', 'Gone']);
  });

  it('⚠️ "none of them is a buy" is stated, not implied by a list of refusals', () => {
    const screen = screenOf([
      { drop: drop({ msrpCents: 9_000 }), evidence: evidence({ comparableCompPricesCents: [9_100, 9_200] }) },
    ]);
    expect(screen.headline).toContain('none a buy at MSRP');
  });

  it('an empty calendar says so', () => {
    expect(screenOf([]).headline).toBe('Nothing coming.');
  });
});
