import { describe, expect, it } from 'vitest';
import {
  EBAY_FEES,
  LOCAL_FEES,
  estimateNetProceeds,
  feeModel,
  grossNeededForNet,
} from '@/core/fees.js';

describe('eBay net proceeds', () => {
  it('turns a $32 gross sale into what the fund actually receives', () => {
    // This is the case that exposed the bug: $32 gross is NOT $32 of proceeds.
    const e = estimateNetProceeds(3_200, EBAY_FEES);
    expect(e.marketplaceFeeCents).toBe(464); // 13.25% of $32.00 + $0.40
    expect(e.postageCents).toBe(500);
    expect(e.packagingCents).toBe(35);
    expect(e.netCents).toBe(2_201);
  });

  it('makes a $15 item at $32 gross MISS the $8 minimum profit', () => {
    // The regression this module exists to prevent. Treating gross as net gave
    // $17.00 of profit and let the purchase through.
    const net = estimateNetProceeds(3_200, EBAY_FEES).netCents;
    expect(net - 1_500).toBe(701);
    expect(net - 1_500).toBeLessThan(800);
  });

  it('charges the fee on buyer-paid shipping too, because eBay does', () => {
    const without = estimateNetProceeds(3_000, EBAY_FEES);
    const with_ = estimateNetProceeds(3_000, EBAY_FEES, { buyerPaidShippingCents: 500 });
    expect(with_.marketplaceFeeCents).toBeGreaterThan(without.marketplaceFeeCents);
    // The buyer's $5 is income, so the net still rises — just by less than $5.
    expect(with_.netCents).toBeGreaterThan(without.netCents);
    expect(with_.netCents - without.netCents).toBeLessThan(500);
  });

  it('takes nothing on a local cash sale', () => {
    const e = estimateNetProceeds(3_200, LOCAL_FEES);
    expect(e.netCents).toBe(3_200);
    expect(e.marketplaceFeeCents).toBe(0);
  });

  it('defaults to eBay for an unknown marketplace rather than to zero fees', () => {
    // Defaulting to "free" would be the dangerous direction.
    expect(feeModel(undefined)).toBe(EBAY_FEES);
    expect(feeModel('NONSENSE')).toBe(EBAY_FEES);
    expect(feeModel('LOCAL')).toBe(LOCAL_FEES);
  });
});

describe('grossNeededForNet is the inverse', () => {
  it('round-trips: selling at the price it names clears the target', () => {
    for (const target of [800, 1_500, 2_300, 5_000]) {
      const gross = grossNeededForNet(target, EBAY_FEES);
      expect(estimateNetProceeds(gross, EBAY_FEES).netCents).toBeGreaterThanOrEqual(target);
    }
  });

  it('names the real listing price for a $20 item at a $8 minimum profit', () => {
    // The live $50-bankroll case: $20 landed, $8 profit target -> $28 net.
    const gross = grossNeededForNet(2_000 + 800, EBAY_FEES);
    expect(gross).toBe(3_891); // $38.91 - a 95% markup on a $20 item
    expect(estimateNetProceeds(gross, EBAY_FEES).netCents - 2_000).toBeGreaterThanOrEqual(800);
  });
});
