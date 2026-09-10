/**
 * Which verdicts the system can actually produce.
 *
 * ⛔ **`recommend()` has four outcomes and the evaluator can only reach two.**
 * Measured 2026-09-10 during Gate 5's phase after-scan: 15,360 evaluations
 * across NAV, price, gross, sold, active, hassle and comps returned **BUY and
 * REJECT only**. `WATCH` and `PASS` never occurred, and no test had ever
 * asserted either — the same shape as the SCORED/QUOTED miss, a class asserted
 * in only some of its directions.
 *
 * ⚡ **The mechanism, and it is not a coincidence.** Every score threshold
 * `recommend()` checks — buy score, risk, confidence — is ALSO a capital gate in
 * `assessPurchase`, reading the identical field from the identical `ModePolicy`.
 * And `recommend()` short-circuits to REJECT the moment any gate fails. So the
 * WATCH/PASS branch needs every gate to pass *while* a score falls short, which
 * those two facts make impossible.
 *
 * ⚠️ **This file does not assert that dead code stays dead.** It asserts the
 * INVARIANT that makes it dead. If a threshold is ever removed from the gates
 * and left in the recommender — or the reverse — these fail, and the WATCH/PASS
 * branch has to be reviewed rather than silently coming alive with a reason
 * string nobody has ever read.
 */

import { describe, expect, it } from 'vitest';
import { evaluateOpportunity } from '@/scoring/evaluate.js';
import { parseOpportunity } from '@/domain/opportunity.js';
import { RECOMMENDATIONS } from '@/scoring/recommend.js';
import { CONSTRAINT_CODES } from '@/core/capital/constraints.js';
import { DEFAULT_POLICY } from '@/core/capital/policy.js';
import { Fund, WITH_JOB } from './helpers.js';

const state = (cents: number) => Fund.withBankroll(cents, DEFAULT_POLICY, WITH_JOB).state;

function evaluate(
  navCents: number,
  o: { price: number; gross: number; sold: number; active: number; hassle: number; comps: number[] },
) {
  return evaluateOpportunity(
    parseOpportunity({
      opportunityId: 'reach',
      name: 'reach',
      category: 'TOOLS',
      askingPriceCents: o.price,
      expectedGrossCents: o.gross,
      soldLast90Days: o.sold > 0 ? o.sold : null,
      activeListings: o.active,
      operatorDaysEstimate: o.sold > 0 ? null : 7,
      compPricesCents: o.comps,
      hassleBps: o.hassle,
    }),
    state(navCents),
  );
}

const TIGHT_COMPS = [4_000, 4_100, 3_900, 4_050, 4_020, 3_980, 4_010, 4_030];

describe('the verdicts the evaluator can actually reach', () => {
  it('produces only BUY and REJECT, across the input space', () => {
    const produced = new Set<string>();
    let n = 0;
    for (const nav of [5_000, 50_000, 200_000, 1_000_000]) {
      for (const price of [500, 1_500, 5_000, 15_000]) {
        for (const gross of [1_500, 4_000, 12_000, 40_000]) {
          for (const sold of [0, 5, 30, 80]) {
            for (const active of [0, 1, 20]) {
              for (const comps of [[], TIGHT_COMPS]) {
                n++;
                produced.add(
                  evaluate(nav, { price, gross, sold, active, hassle: 2_000, comps }).result
                    .recommendation,
                );
              }
            }
          }
        }
      }
    }
    // ⚠️ A sweep that evaluated nothing would satisfy every assertion below.
    expect(n).toBeGreaterThan(1_000);
    expect([...produced].sort()).toEqual(['BUY', 'REJECT']);
  });

  it('keeps WATCH and PASS declared, because stored rows still carry them', () => {
    // ⛔ They are NOT deleted. `opportunities.recommendation` has a CHECK
    // constraint naming all four, and rows scored under older rules may hold
    // them. Removing the members would make a historical row unreadable — which
    // is a worse defect than an unreachable branch.
    expect(RECOMMENDATIONS).toContain('WATCH');
    expect(RECOMMENDATIONS).toContain('PASS');
  });

  it('gates every score threshold the recommender also checks — which is WHY they are unreachable', () => {
    // ⚡ The actual invariant. The recommender's three shortfall conditions are
    // buy score, risk and confidence; each has a gate with the same threshold,
    // and a failed gate short-circuits to REJECT before any score is weighed.
    for (const code of ['BUY_SCORE_TOO_LOW', 'RISK_SCORE_TOO_HIGH', 'CONFIDENCE_TOO_LOW']) {
      expect(CONSTRAINT_CODES).toContain(code);
    }

    // And each one really does fire, rather than merely being declared — a code
    // nothing can produce would satisfy the check above while proving nothing.
    const fired = new Set<string>();
    for (const nav of [5_000, 200_000]) {
      for (const hassle of [2_000, 9_999]) {
        for (const sold of [0, 3, 40]) {
          for (const comps of [[], TIGHT_COMPS]) {
            for (const gross of [1_500, 12_000]) {
              for (const f of evaluate(nav, { price: 5_000, gross, sold, active: 30, hassle, comps })
                .gates.failures) {
                fired.add(f.code);
              }
            }
          }
        }
      }
    }
    expect(fired).toContain('BUY_SCORE_TOO_LOW');
    expect(fired).toContain('CONFIDENCE_TOO_LOW');
  });
});

describe('the buy score reports when it was NOT capped', () => {
  it('says NONE, and that is the ordinary case nothing asserted', () => {
    // ⛔ `BuyScoreCap` is NONE | VELOCITY | CONFIDENCE. Both caps were tested
    // and the uncapped case never was — so a change that always applied a cap
    // would have passed. `recommend()` branches on `boundBy === 'NONE'` to
    // decide whether to tell the operator what held the score down, so a wrong
    // NONE is a wrong sentence in front of a person holding the object.
    const good = evaluate(200_000, {
      price: 1_000,
      gross: 4_000,
      sold: 60,
      active: 1,
      hassle: 0,
      comps: TIGHT_COMPS,
    });
    expect(good.buy.boundBy).toBe('NONE');
    expect(good.buy.score).toBeLessThanOrEqual(100);
  });
});
