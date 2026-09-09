import { describe, expect, it } from 'vitest';
import {
  assessProfitFloor,
  bankrollForProfitFloor,
  PLAUSIBLE_MULTIPLE_BPS,
} from '@/core/capital/reachability.js';
import { EBAY_FEES, LOCAL_FEES, estimateNetProceeds } from '@/core/fees.js';
import { DEFAULT_POLICY } from '@/core/capital/policy.js';

const BOOTSTRAP = DEFAULT_POLICY.modes.BOOTSTRAP;

/** Floors are passed explicitly so these tests do not move when a default does. */
const withFloor = (cents: number) => ({ ...BOOTSTRAP, minExpectedProfitCents: cents });

describe('the shipped $8 floor at the live $50 bankroll', () => {
  const r = assessProfitFloor(5_000, BOOTSTRAP, EBAY_FEES);

  it('caps a single item at $20 and asks for a 1.95x', () => {
    expect(r.maxPerItemCents).toBe(2_000);
    expect(r.minProfitCents).toBe(800);
    expect(r.grossNeededCents).toBe(3_891);
    expect(r.requiredMultipleBps).toBe(19_455);
  });

  it('is reachable, which is what makes the fund able to start at all', () => {
    expect(r.reachable).toBe(true);
  });
});

describe('a floor that does not fit its bankroll is caught', () => {
  // A $100-per-flip floor at $50 was considered and rejected on 2026-09-08.
  // The module exists so that pairing is a number rather than a mystery.
  const r = assessProfitFloor(5_000, withFloor(10_000), EBAY_FEES);

  it('reports the multiple every flip would have to hit', () => {
    expect(r.grossNeededCents).toBe(14_496);
    expect(r.requiredMultipleBps).toBe(72_480); // 7.2x
    expect(r.reachable).toBe(false);
  });

  it('names the bankroll that floor would actually imply', () => {
    // At a 3x flip: landed $66, and $66 is 40% of $165.
    expect(r.impliedMaxPerItemCents).toBe(6_600);
    expect(r.impliedBankrollCents).toBe(16_500);
  });

  it('and the number it names really does clear the floor', () => {
    // The claim is checked, not asserted: buy at the implied landed cost, sell
    // at 3x, and confirm the profit clears $100.
    const landed = r.impliedMaxPerItemCents;
    const gross = Math.round((landed * PLAUSIBLE_MULTIPLE_BPS) / 10_000);
    const profit = estimateNetProceeds(gross, EBAY_FEES).netCents - landed;
    expect(profit).toBeGreaterThanOrEqual(10_000);
  });
});

describe('the implied bankroll moves with the multiple you believe in', () => {
  it('a 2x flip needs a much larger fund than a 3x one', () => {
    const at3x = bankrollForProfitFloor(10_000, 4_000, EBAY_FEES, 30_000)!;
    const at2x = bankrollForProfitFloor(10_000, 4_000, EBAY_FEES, 20_000)!;
    expect(at3x.bankrollCents).toBe(16_500);
    expect(at2x.bankrollCents).toBe(35_970);
    expect(at2x.bankrollCents).toBeGreaterThan(at3x.bankrollCents);
  });

  it('each of those really does clear the floor when sold at its multiple', () => {
    for (const multiple of [20_000, 25_000, 30_000, 50_000]) {
      const solved = bankrollForProfitFloor(10_000, 4_000, EBAY_FEES, multiple)!;
      const gross = Math.round((solved.landedCents * multiple) / 10_000);
      const profit = estimateNetProceeds(gross, EBAY_FEES).netCents - solved.landedCents;
      expect(profit).toBeGreaterThanOrEqual(10_000);
    }
  });

  it('says no bankroll helps when the multiple cannot beat the fee rate', () => {
    // At 1.1x on eBay every item loses ground, so scale never rescues it.
    expect(bankrollForProfitFloor(10_000, 4_000, EBAY_FEES, 11_000)).toBeNull();
  });

  it('needs a smaller fund on a local cash sale, because nothing is taken', () => {
    const ebay = bankrollForProfitFloor(10_000, 4_000, EBAY_FEES, 30_000)!;
    const local = bankrollForProfitFloor(10_000, 4_000, LOCAL_FEES, 30_000)!;
    expect(local.bankrollCents).toBeLessThan(ebay.bankrollCents);
  });
});

describe('a floor becomes reachable as the fund grows', () => {
  it('flips to reachable at exactly the bankroll it named', () => {
    const policy = withFloor(10_000);
    const r = assessProfitFloor(5_000, policy, EBAY_FEES);
    expect(assessProfitFloor(r.impliedBankrollCents - 1_000, policy, EBAY_FEES).reachable)
      .toBe(false);
    expect(assessProfitFloor(r.impliedBankrollCents, policy, EBAY_FEES).reachable).toBe(true);
  });

  it('the required multiple falls monotonically as NAV rises', () => {
    let previous = Number.MAX_SAFE_INTEGER;
    for (let nav = 5_000; nav <= 100_000; nav += 2_500) {
      const r = assessProfitFloor(nav, withFloor(10_000), EBAY_FEES);
      expect(r.requiredMultipleBps).toBeLessThanOrEqual(previous);
      previous = r.requiredMultipleBps;
    }
  });

  it('handles a zero bankroll without dividing by zero', () => {
    const r = assessProfitFloor(0, BOOTSTRAP, EBAY_FEES);
    expect(r.maxPerItemCents).toBe(0);
    expect(r.reachable).toBe(false);
  });
});
