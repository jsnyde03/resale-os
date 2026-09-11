/**
 * A scan, from barcode to a form.
 *
 * ⛔ **The claim under test is that a scan PROPOSES.** Two measurements force
 * that: two defensible keywords from one barcode ran 68% apart in median sold
 * price (B89), and `000000000000` resolves — with HTTP 200 — to "ORGANIC BLUE
 * CORN TORTILLA CHIPS", so a mis-scan succeeds wrongly rather than failing.
 */

import { describe, expect, it } from 'vitest';
import { applyScan, categoryBucket, scanOutcome } from '@/screens/scan.js';
import type { ProductResult } from '@/core/product.js';
import type { SourcingForm } from '@/screens/sourcing.js';

const hit = (over: Record<string, unknown> = {}): ProductResult => ({
  ok: true,
  identity: {
    barcode: '673419209366',
    title: 'LEGO Star Wars 75038 - Jedi Interceptor',
    brand: 'LEGO',
    category: 'Toys & Games > Toys > Building Toys > Interlocking',
    ...over,
  },
});

const blank: SourcingForm = { name: '', category: '', price: '', resale: '', sold90: '', active: '' };

describe('a scan shows what it found before anything is decided', () => {
  it('surfaces the title first — it is the only thing that catches a mis-scan', () => {
    const o = scanOutcome('673419209366', hit());
    expect(o.kind).toBe('IDENTIFIED');
    if (o.kind !== 'IDENTIFIED') return;
    expect(o.title).toBe('LEGO Star Wars 75038 - Jedi Interceptor');
  });

  it('⛔ proposes a keyword AND the other reading, rather than picking', () => {
    const o = scanOutcome('673419209366', hit());
    if (o.kind !== 'IDENTIFIED') return;
    expect(o.keyword).toBe('lego star wars 75038 jedi interceptor');
    expect(o.alternativeKeyword).toBe('lego 75038');
  });

  it('⛔ never proposes to fill the asking price', () => {
    const o = scanOutcome('673419209366', hit());
    if (o.kind !== 'IDENTIFIED') return;
    expect(o.fills).not.toContain('price');
    expect(o.fills).not.toContain('resale');
    expect(o.fills).toContain('name');
  });
});

describe('the category becomes a concentration BUCKET, not a taxonomy', () => {
  it('uses the brand, because the risk is "too much LEGO"', () => {
    const o = scanOutcome('x', hit());
    if (o.kind !== 'IDENTIFIED') return;
    expect(categoryBucket(o)).toBe('LEGO');
  });

  it('falls back to the path’s SECOND segment, never the first', () => {
    // The first is a top-level department every holding would share, which
    // would make CATEGORY_CONCENTRATION fire on everything at once.
    const o = scanOutcome('x', hit({ brand: null }));
    if (o.kind !== 'IDENTIFIED') return;
    expect(categoryBucket(o)).toBe('TOYS');
  });

  it('gives nothing rather than a guess when there is neither', () => {
    const o = scanOutcome('x', hit({ brand: null, category: null }));
    if (o.kind !== 'IDENTIFIED') return;
    expect(categoryBucket(o)).toBe('');
  });
});

describe('⛔ a scan fills blanks and never replaces a judgement', () => {
  it('fills an empty name and category', () => {
    const f = applyScan(blank, scanOutcome('x', hit()));
    expect(f.name).toBe('LEGO Star Wars 75038 - Jedi Interceptor');
    expect(f.category).toBe('LEGO');
  });

  it('leaves what the operator already typed', () => {
    const typed = { ...blank, name: 'the one with the broken box', category: 'GAMES' };
    const f = applyScan(typed, scanOutcome('x', hit()));
    expect(f.name).toBe('the one with the broken box');
    expect(f.category).toBe('GAMES');
  });

  it('and a failed scan changes nothing at all', () => {
    const typed = { ...blank, name: 'typed' };
    for (const reason of ['NOT_FOUND', 'OFFLINE', 'QUOTA_EXCEEDED', 'VENDOR'] as const) {
      expect(applyScan(typed, scanOutcome('x', { ok: false, reason, detail: '' }))).toEqual(typed);
    }
  });
});

describe('a barcode that resolves to nothing is NORMAL', () => {
  it('says what to do instead, in every case', () => {
    for (const reason of ['NOT_FOUND', 'OFFLINE', 'QUOTA_EXCEEDED', 'RATE_LIMITED', 'VENDOR'] as const) {
      const o = scanOutcome('x', { ok: false, reason, detail: '' });
      if (o.kind !== 'UNIDENTIFIED') throw new Error('expected UNIDENTIFIED');
      expect(o.message.toLowerCase(), reason).toContain('type the name');
    }
  });

  it('⚠️ offers a retry only where pressing again could work', () => {
    const retry = (reason: 'NOT_FOUND' | 'OFFLINE' | 'RATE_LIMITED' | 'QUOTA_EXCEEDED' | 'VENDOR') => {
      const o = scanOutcome('x', { ok: false, reason, detail: '' });
      return o.kind === 'UNIDENTIFIED' ? o.canRetry : null;
    };
    expect(retry('OFFLINE')).toBe(true);
    expect(retry('RATE_LIMITED')).toBe(true);
    // ⛔ A clearance SKU that is not in the database will not appear by asking
    // twice, and neither will an exhausted allowance.
    expect(retry('NOT_FOUND')).toBe(false);
    expect(retry('QUOTA_EXCEEDED')).toBe(false);
    expect(retry('VENDOR')).toBe(false);
  });
});
