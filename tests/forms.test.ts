/**
 * The write screens, minus the pixels.
 *
 * ⛔ These exist because six screens shipped that **nothing could see**. The
 * arithmetic lived inside JSX, so a transposed field or a wrong readiness rule
 * would have reached the device untested. It is not a substitute for a
 * rendering test — it cannot see whether the price box is wired to `price` —
 * but everything after that point is here.
 */

import { describe, expect, it } from 'vitest';
import {
  MIN_ADJUSTMENT_REASON,
  adjustModel,
  centsOrNothing,
  countOrNothing,
  sellModel,
  spendModel,
} from '@/ui/forms.js';
import type { ItemRecord } from '@/core/capital/state.js';

const T0 = '2026-09-01T12:00:00.000Z';
const T7 = '2026-09-08T12:00:00.000Z';

const ITEM: ItemRecord = {
  itemId: 'pin-0001',
  name: 'pin',
  category: 'TOYS',
  acquiredAt: T0,
  landedCostCents: 1_000,
  bookValueCents: 1_000,
  expectedDaysToSale: 7,
  expectedResaleCents: 3_000,
  state: 'ACTIVE',
  listingLive: false,
  realizedProfitCents: 0,
};

describe('a half-typed number is not a number', () => {
  it('is undefined while the operator is still typing', () => {
    expect(centsOrNothing('')).toBeUndefined();
    expect(centsOrNothing('1.')).toBeUndefined();
    expect(centsOrNothing('-')).toBeUndefined();
    expect(centsOrNothing('abc')).toBeUndefined();
    // Three decimal places is not a cent amount, however it looks.
    expect(centsOrNothing('1.005')).toBeUndefined();
  });

  it('reads what it can, including the shapes people paste', () => {
    expect(centsOrNothing('12')).toBe(1_200);
    expect(centsOrNothing('12.3')).toBe(1_230);
    expect(centsOrNothing(' $1,234.56 ')).toBe(123_456);
    expect(centsOrNothing('-1.50')).toBe(-150);
  });

  it('takes whole counts only, and never a negative one', () => {
    expect(countOrNothing('50')).toBe(50);
    expect(countOrNothing('0')).toBe(0);
    expect(countOrNothing('')).toBeUndefined();
    expect(countOrNothing('-1')).toBeUndefined();
    expect(countOrNothing('1.5')).toBeUndefined();
  });
});

describe('sell', () => {
  const blank = { gross: '', fee: '', postage: '', packaging: '' };

  it('is not ready, and builds nothing, without a price', () => {
    const m = sellModel(ITEM, blank);
    expect(m.ready).toBe(false);
    expect(m.command(T7)).toBeNull();
    expect(m.netCents).toBeUndefined();
    expect(m.profitCents).toBeUndefined();
  });

  // ⚠️ Blank is zero here, not unknown. Someone who left postage empty sold
  // something with no postage, and refusing to show them a net they can read
  // off their payout screen would be pedantry.
  it('treats blank costs as zero rather than refusing to compute', () => {
    const m = sellModel(ITEM, { ...blank, gross: '30.00' });
    expect(m.netCents).toBe(3_000);
    expect(m.profitCents).toBe(2_000);
    expect(m.ready).toBe(true);
  });

  it('subtracts every cost from the gross', () => {
    const m = sellModel(ITEM, { gross: '30.00', fee: '4.38', postage: '5.00', packaging: '0.35' });
    expect(m.netCents).toBe(2_027);
    expect(m.profitCents).toBe(1_027);
  });

  it('reports a loss as a loss', () => {
    const m = sellModel(ITEM, { ...blank, gross: '4.00' });
    expect(m.profitCents).toBe(-600);
  });

  it('suggests what the marketplace would charge, without recording it', () => {
    const m = sellModel(ITEM, { ...blank, gross: '30.00' });
    // eBay: 13.25% + 40c, $5.00 postage, 35c packaging.
    expect(m.suggestion?.marketplaceFeeCents).toBe(438);
    // ⛔ The suggestion is NOT in the command. Nothing is recorded that the
    // operator did not put in a box.
    expect(m.command(T7)?.marketplaceFeeCents).toBe(0);
  });

  it('suggests against the marketplace the item was bought for', () => {
    const local = { ...ITEM, marketplace: 'LOCAL' };
    const m = sellModel(local, { ...blank, gross: '30.00' });
    expect(m.suggestion?.marketplaceFeeCents).toBe(0);
    expect(m.suggestion?.postageCents).toBe(0);
  });

  // ⛔ The one field the operator cannot get wrong, because they never touch it.
  it('derives the hold from the two timestamps', () => {
    const m = sellModel(ITEM, { ...blank, gross: '30.00' });
    expect(m.command(T7)?.daysToSale).toBe(7);
    expect(m.command(T0)?.daysToSale).toBe(0);
  });

  it('builds a command carrying exactly what was typed', () => {
    const m = sellModel(ITEM, { gross: '30.00', fee: '4.38', postage: '5.00', packaging: '0.35' });
    expect(m.command(T7)).toEqual({
      type: 'SALE',
      itemId: 'pin-0001',
      grossProceedsCents: 3_000,
      marketplaceFeeCents: 438,
      outboundShippingCents: 500,
      packagingCents: 35,
      daysToSale: 7,
      occurredAt: T7,
    });
  });
});

describe('money out', () => {
  it('will not record an expense with no category', () => {
    // The engine would take 'OTHER', and a year of OTHER is a Schedule C
    // nobody can file.
    const m = spendModel({ kind: 'EXPENSE', amount: '4.50', category: null, itemId: null });
    expect(m.ready).toBe(false);
    expect(m.command(T0)).toBeNull();
  });

  it('needs no category for a payout, because a payout is not an expense', () => {
    const m = spendModel({ kind: 'PAYOUT', amount: '20.00', category: null, itemId: null });
    expect(m.ready).toBe(true);
    expect(m.command(T0)).toEqual({ type: 'OWNER_PAYOUT', amountCents: 2_000, occurredAt: T0 });
  });

  it('records an expense against the business by default', () => {
    const m = spendModel({ kind: 'EXPENSE', amount: '4.50', category: 'POSTAGE', itemId: null });
    const command = m.command(T0);
    expect(command).toEqual({
      type: 'BUSINESS_EXPENSE',
      amountCents: 450,
      category: 'POSTAGE',
      occurredAt: T0,
    });
    // ⚠️ Absent, not null. An itemId of null would be a claim about an item.
    expect(command !== null && 'itemId' in command).toBe(false);
  });

  it('attaches it to an item only when one was chosen', () => {
    const m = spendModel({
      kind: 'EXPENSE',
      amount: '4.50',
      category: 'POSTAGE',
      itemId: 'pin-0001',
    });
    expect(m.command(T0)).toMatchObject({ itemId: 'pin-0001' });
  });

  // ⛔ Switching to PAYOUT must not smuggle the expense's item along with it.
  it('drops the category and the item when the kind is a payout', () => {
    const m = spendModel({
      kind: 'PAYOUT',
      amount: '20.00',
      category: 'POSTAGE',
      itemId: 'pin-0001',
    });
    expect(m.command(T0)).toEqual({ type: 'OWNER_PAYOUT', amountCents: 2_000, occurredAt: T0 });
  });
});

describe('adjust', () => {
  const ok = { account: 'LIQUID' as const, amount: '-1.50', reason: 'miscounted the float' };

  it('refuses a reason that is not one', () => {
    expect(adjustModel({ ...ok, reason: '' }).ready).toBe(false);
    expect(adjustModel({ ...ok, reason: 'oops' }).ready).toBe(false);
    expect(adjustModel({ ...ok, reason: '        ' }).ready).toBe(false);
    // Exactly at the line.
    expect(adjustModel({ ...ok, reason: 'a'.repeat(MIN_ADJUSTMENT_REASON - 1) }).ready).toBe(false);
    expect(adjustModel({ ...ok, reason: 'a'.repeat(MIN_ADJUSTMENT_REASON) }).ready).toBe(true);
  });

  it('needs an account and an amount', () => {
    expect(adjustModel({ ...ok, account: null }).ready).toBe(false);
    expect(adjustModel({ ...ok, amount: '' }).ready).toBe(false);
  });

  it('carries a signed amount and a trimmed reason', () => {
    expect(adjustModel({ ...ok, reason: '  miscounted the float  ' }).command(T0)).toEqual({
      type: 'ADJUSTMENT',
      account: 'LIQUID',
      amountCents: -150,
      reason: 'miscounted the float',
      occurredAt: T0,
    });
  });

  it('builds nothing while it is not ready', () => {
    expect(adjustModel({ ...ok, reason: 'no' }).command(T0)).toBeNull();
  });
});
