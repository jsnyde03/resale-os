/**
 * The aisle screen's model.
 *
 * Two jobs. It has to parse what a person types on a phone without lying about
 * money, and it has to arrange the evaluator's answer so the ceiling and the
 * reason for it are the two things you see.
 *
 * It must not compute anything. The assertions against `evaluateOpportunity`
 * below are there to catch this file starting to do arithmetic of its own,
 * which is how a dashboard and a CLI come to disagree about whether to buy.
 */

import { describe, expect, it } from 'vitest';
import { evaluateForm, headline } from '@/screens/sourcing.js';
import { evaluateOpportunity } from '@/scoring/evaluate.js';
import { parseOpportunity } from '@/domain/opportunity.js';
import { Fund, WITH_JOB, T0 } from './helpers.js';
import { DEFAULT_POLICY } from '@/core/capital/policy.js';
import type { SourcingForm } from '@/screens/sourcing.js';

/** A fund with room to buy. */
const fund = (cents = 50_000) => Fund.withBankroll(cents, DEFAULT_POLICY, WITH_JOB).state;

/** A candidate that comfortably clears every gate. */
const GOOD: SourcingForm = {
  name: 'Lego set',
  category: 'TOYS',
  price: '12.00',
  resale: '60.00',
  sold90: '40',
  active: '10',
  comps: '58.00,61.00,60.00',
};

function ok(form: SourcingForm, state = fund()) {
  const r = evaluateForm(form, state);
  if (!r.ok) throw new Error(`expected ok, got: ${r.problems.map((p) => p.message).join('; ')}`);
  return r.verdict;
}

function problems(form: SourcingForm, state = fund()) {
  const r = evaluateForm(form, state);
  if (r.ok) throw new Error('expected problems, got a verdict');
  return r.problems;
}

describe('parsing what a person types', () => {
  it('reads dollars as integer cents', () => {
    // ⚠️ These specific values were MEASURED, not guessed. `12.99` was the first
    // choice and it proves nothing — `Number('12.99') * 100` is exactly 1299, so
    // a float implementation passes. `Math.floor(Number(x) * 100)` is wrong for
    // 0.29, 0.57, 1.13, 2.01 and 187 other amounts under $200.
    for (const [text, cents] of [
      ['0.29', 29],
      ['0.57', 57],
      ['1.13', 113],
      ['2.01', 201],
      ['12.99', 1_299],
    ] as const) {
      expect(ok({ ...GOOD, price: text }).asking.cents).toBe(cents);
    }
    expect(ok({ ...GOOD, price: '0.01' }).asking.cents).toBe(1);
    expect(ok({ ...GOOD, price: '7' }).asking.cents).toBe(700);
    expect(ok({ ...GOOD, price: '7.5' }).asking.cents).toBe(750);
    expect(ok({ ...GOOD, price: ' $12.00 ' }).asking.cents).toBe(1_200);
  });

  it('rejects what is not an amount, naming the field', () => {
    for (const bad of ['', 'twelve', '12.999', '-5', '1,200', '12.', '.5']) {
      const p = problems({ ...GOOD, price: bad });
      expect(p.some((x) => x.field === 'price')).toBe(true);
    }
  });

  it('reports every problem at once, not just the first', () => {
    // Someone in a shop should not fix one field to discover another.
    const p = problems({ ...GOOD, name: '  ', price: 'x', resale: '', sold90: 'many' });
    expect(p.map((x) => x.field).sort()).toEqual(['name', 'price', 'resale', 'sold90']);
  });

  it('treats comps as optional and tolerates spacing', () => {
    expect(ok({ ...GOOD, comps: '' }).name).toBe('Lego set');
    expect(ok({ ...GOOD, comps: undefined }).name).toBe('Lego set');
    expect(ok({ ...GOOD, comps: ' 58.00 , 61.00 ' }).name).toBe('Lego set');
    expect(problems({ ...GOOD, comps: '58.00,abc' }).some((p) => p.field === 'comps')).toBe(true);
  });

  it('accepts zero sold as an ANSWER, not a validation error', () => {
    // Nothing has sold in 90 days is the most useful thing the screen can tell
    // you. A form that refuses the input would hide it behind a red field.
    const v = ok({ ...GOOD, sold90: '0' });
    expect(v.buy).toBe(false);
    expect(v.failedGates.length).toBeGreaterThan(0);
  });

  it('normalises the category so TOYS and toys are one thing', () => {
    expect(ok({ ...GOOD, category: 'toys' }).name).toBe('Lego set');
  });
});

describe('it reports the evaluator, it does not second-guess it', () => {
  it('matches evaluateOpportunity field for field', () => {
    const state = fund();
    const v = ok(GOOD, state);
    const direct = evaluateOpportunity(
      parseOpportunity({
        opportunityId: 'aisle-lego-set',
        name: 'Lego set',
        category: 'TOYS',
        source: 'MANUAL',
        sourceUrl: null,
        askingPriceCents: 1_200,
        inboundShippingCents: 0,
        salesTaxCents: 0,
        acquisitionTravelCents: 0,
        expectedGrossCents: 6_000,
        marketplace: 'EBAY',
        postageCents: null,
        soldLast90Days: 40,
        activeListings: 10,
        operatorDaysEstimate: null,
        compPricesCents: [5_800, 6_100, 6_000],
        compMedianAgeDays: 45,
        hassleBps: 2_000,
      }),
      state,
    );
    expect(v.maxPrice.cents).toBe(direct.price.maxPriceCents);
    expect(v.boundBy).toBe(direct.price.boundBy);
    expect(v.buyScore).toBe(direct.result.buyScore);
    expect(v.riskScore).toBe(direct.result.riskScore);
    expect(v.confidenceBps).toBe(direct.result.confidenceBps);
    expect(v.expectedProfit.cents).toBe(direct.economics.expectedProfitCents);
    expect(v.expectedDaysToSale).toBe(direct.economics.velocity.expectedDaysToSale);
    expect(v.recommendation).toBe(direct.result.recommendation);
    expect(v.reasons).toEqual(direct.result.reasons);
  });

  it('carries the policy version, because a score means nothing without it', () => {
    expect(ok(GOOD).policyVersion).toBe(DEFAULT_POLICY.version);
  });

  it('never derives the hold time from a typed field', () => {
    // 90 * (active + 1) / sold90 = 90 * 11 / 40 ≈ 25.
    const v = ok(GOOD);
    expect(v.expectedDaysToSale).toBe(Math.round((90 * (10 + 1)) / 40));
    expect(v.velocityIsEstimate).toBe(false);
  });
});

describe('the ceiling, and the reason for it', () => {
  it('names which limit binds', () => {
    const v = ok(GOOD);
    expect(['ROI', 'PROFIT', 'PER_ITEM', 'DEPLOYABLE', 'CATEGORY']).toContain(v.boundBy);
    // The reason is prose an operator can act on, not the enum.
    expect(v.boundReason).not.toBe(v.boundBy);
    expect(v.boundReason.length).toBeGreaterThan(20);
  });

  it('binds on the per-item cap when the fund is small', () => {
    // 40% of a $50 fund is $20, well under what the ROI floor would allow on a
    // $60 resale. The cap is the thing to argue with, so it must be named.
    const v = ok({ ...GOOD, price: '5.00' }, fund(5_000));
    expect(v.maxPrice.cents).toBeLessThanOrEqual(2_000);
    expect(v.boundBy).toBe('PER_ITEM');
    expect(v.boundReason).toContain('per-item cap');
  });

  it('flags an asking price above the ceiling', () => {
    const v = ok({ ...GOOD, price: '55.00' });
    expect(v.overPriced).toBe(true);
    expect(v.asking.cents).toBeGreaterThan(v.maxPrice.cents);
  });

  it('is not over-priced when the tag is under the ceiling', () => {
    const v = ok(GOOD);
    expect(v.overPriced).toBe(false);
  });
});

describe('the one line you read while holding the thing', () => {
  it('says buy, with the ceiling', () => {
    const v = ok(GOOD);
    expect(v.buy).toBe(true);
    expect(headline(v)).toBe(`Buy it — up to ${v.maxPrice.text}`);
  });

  it('says too expensive only when price is the WHOLE problem', () => {
    // The distinction is the whole value: one is "haggle", the other is "put it
    // down". Determined by re-running the evaluator at the ceiling.
    const v = ok({ ...GOOD, price: '55.00' });
    expect(v.overPriced).toBe(true);
    expect(v.priceFixable).toBe(true);
    expect(headline(v)).toContain('Too expensive');
    expect(headline(v)).toContain(v.maxPrice.text);
    expect(v.primaryReason).toContain('Ceiling set by');
  });

  it('says walk away for an over-priced item that ALSO fails on its own merits', () => {
    // ⚠️ Found by looking at the running screen: a $12 item with 286% ROI read
    // "Ceiling set by the per-item cap" when the real reason was a 25-day hold
    // against a 21-day ceiling. Sending someone to haggle over that is wrong.
    const v = ok({ ...GOOD, price: '55.00', sold90: '3', active: '40' });
    expect(v.overPriced).toBe(true);
    expect(v.priceFixable).toBe(false);
    expect(headline(v)).toBe('Walk away');
    // And the explanation is the failing gate, not the price ceiling.
    expect(v.primaryReason).not.toContain('Ceiling set by');
    expect(v.primaryReason).toBe(v.failedGates[0]?.message);
  });

  it('explains a buy by its ceiling', () => {
    const v = ok(GOOD, fund(200_000));
    expect(v.buy).toBe(true);
    expect(v.primaryReason).toContain('Ceiling set by');
  });

  it('says walk away when the item itself fails', () => {
    const v = ok({ ...GOOD, sold90: '0', price: '1.00' });
    expect(v.buy).toBe(false);
    expect(headline(v)).toBe('Walk away');
  });

  it('gives a headline reason for every stop', () => {
    const v = ok({ ...GOOD, sold90: '0' });
    expect(v.reasons.length).toBeGreaterThan(0);
    expect(v.reasons[0]).toBeTruthy();
  });
});

describe('the screen names the FIX, not just the failing gate', () => {
  // ⚡ B70. `HOLD_TOO_LONG` refuses most real candidates and the screen used to
  // name it without naming the way out. The hold is derived, so it inverts.
  it('inverts the hold formula against the listings actually entered', () => {
    const slow = ok({ ...GOOD, sold90: '4', active: '10' });
    expect(slow.failedGates.map((g) => g.code)).toContain('HOLD_TOO_LONG');
    // ⚠️ This fixture is a $500 fund, so the mode is GROWTH and the ceiling is
    // 60 days, not BOOTSTRAP's 21. The ceiling comes from the MODE, which is
    // derived from the bankroll — the number an operator needs changes as the
    // fund grows, and that is the point of deriving it rather than printing a
    // constant. 90 * (10 + 1) / 60 = 16.5 -> 17.
    expect(slow.holdFix.againstActiveListings).toBe(10);
    expect(slow.holdFix.ceilingDays).toBe(60);
    expect(slow.holdFix.soldNeededIn90Days).toBe(17);
  });

  it('follows the MODE, so the number a $50 fund needs is not the number a $500 fund needs', () => {
    const bootstrap = evaluateForm({ ...GOOD, sold90: '4', active: '10' }, fund(5_000));
    if (!bootstrap.ok) throw new Error('expected a verdict');
    // BOOTSTRAP's 21-day ceiling: 90 * 11 / 21 = 47.14 -> 48.
    expect(bootstrap.verdict.holdFix.ceilingDays).toBe(21);
    expect(bootstrap.verdict.holdFix.soldNeededIn90Days).toBe(48);
  });

  it('is the number that actually clears the gate, not an approximation', () => {
    // ⛔ Measured, not asserted: buying at exactly that many sales must pass the
    // hold gate, and one fewer must not. A rounding error either way makes the
    // screen tell someone to walk away from a buy, or to buy a refusal.
    for (const active of [0, 1, 5, 10, 25]) {
      const needed = ok({ ...GOOD, sold90: '1', active: String(active) }).holdFix.soldNeededIn90Days;
      const at = ok({ ...GOOD, sold90: String(needed), active: String(active) });
      const below = ok({ ...GOOD, sold90: String(needed - 1), active: String(active) });
      expect(at.failedGates.map((g) => g.code)).not.toContain('HOLD_TOO_LONG');
      expect(below.failedGates.map((g) => g.code)).toContain('HOLD_TOO_LONG');
    }
  });
});
