/**
 * The aisle screen's last mile: what the lookup computes has to reach the boxes.
 *
 * ⛔ **B97.** `fillFromMarket` computed the resale median and returned it, and the
 * screen copied back every field EXCEPT that one — so "What it sells for" stayed
 * blank after every lookup, while the model's own tests stayed green and the
 * device lane passed 56/56. The lane cannot render and the model cannot see its
 * caller, so nothing looked at the one place the value was lost. This file does.
 *
 * ⚠️ **The two sides come from different places**, which is what makes it a
 * control rather than a restatement: the fields the lookup fills come from
 * RUNNING the model, and the wiring comes from READING the screen. The same
 * shape as `ci-scope.test.ts`.
 *
 * ⛔ Line endings are normalised before any matching. A CRLF checkout has broken
 * source-matching checks on this portfolio before, and silently.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COMP_CONDITION_WORDS,
  fillFromMarket,
  type SourcingForm,
} from '@/screens/sourcing.js';
import type { CompCondition } from '@/core/market.js';

const SCREEN = readFileSync('mobile/app/sourcing.tsx', 'utf8').replace(/\r\n/g, '\n');

/** The screen's setter for each form field the lookup can fill. */
const SETTER: Readonly<Partial<Record<keyof SourcingForm, string>>> = {
  sold90: 'setSold',
  active: 'setActive',
  comps: 'setComps',
  resale: 'setResale',
};

const blank: SourcingForm = {
  name: 'thing',
  category: 'TOYS',
  price: '',
  resale: '',
  sold90: '',
  active: '',
};

const reading = (compCondition: CompCondition) => ({
  ok: true as const,
  reading: {
    sold90: { value: 90, isFloor: false },
    active: { value: 15, isFloor: false },
    compPricesCents: [5_900, 6_000, 6_100],
    compMedianAgeDays: 20,
    provenance: {
      keyword: 'lego 75192',
      compCondition,
      categoryId: '183447',
      categoryName: 'LEGO (R) Building Toys',
      soldItemsSeen: 40,
      activeItemsSeen: 200,
      soldAfter: '2026-06-13',
      fetchedAt: '2026-09-11T12:00:00.000Z',
    },
    quota: { monthlyLimit: 100, monthlyRemaining: 86, resetAt: null },
  },
});

const filledBy = (compCondition: CompCondition) => {
  const { status } = fillFromMarket(blank, reading(compCondition));
  if (status.kind !== 'FILLED') throw new Error('expected a filled status');
  return status;
};

describe('⛔ every field the lookup fills reaches its box (B97)', () => {
  it('the model fills all four on a known condition — so the check below has four to check', () => {
    // ⚠️ Without this, a model that stopped filling `resale` would shrink the
    // loop below and the wiring check would pass by checking less.
    expect([...filledBy('new').filled].sort()).toEqual(['active', 'comps', 'resale', 'sold90']);
  });

  it('the screen copies every one of them back from the lookup', () => {
    for (const field of filledBy('new').filled) {
      const setter = SETTER[field];
      // A new fillable field with no mapping here fails, rather than going unchecked.
      expect(setter, `no setter mapped for "${field}"`).toBeDefined();
      expect(SCREEN, `the screen never copies "${field}"`).toContain(
        `${setter}(out.form.${field}`,
      );
    }
  });
});

describe('⛔ the condition is chosen before the prices are fetched (B96)', () => {
  it('Condition renders above the lookup button', () => {
    const condition = SCREEN.indexOf('label="Condition"');
    const lookup = SCREEN.indexOf("'Look up the market'");
    expect(condition).toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(-1);
    expect(condition).toBeLessThan(lookup);
  });

  it('⚠️ and below the scan button, because a scan returns on a fresh screen', () => {
    // A condition chosen before scanning is lost when the scan pushes a new
    // screen, so above the scan button would be a trap of its own.
    expect(SCREEN.indexOf("label=\"Scan a barcode\"")).toBeLessThan(
      SCREEN.indexOf('label="Condition"'),
    );
  });
});

describe('the prices say which condition they came from (B96)', () => {
  it('names the condition on the Measured line, for every condition', () => {
    for (const c of ['new', 'used', 'any'] as const) {
      expect(filledBy(c).measured).toContain(COMP_CONDITION_WORDS[c]);
    }
  });

  it('⛔ and the screen warns when every condition is mixed', () => {
    expect(SCREEN).toContain("fill.provenance.compCondition === 'any'");
  });
});
