/**
 * A resolved product, and the keyword derived from it.
 *
 * ⛔ **The keyword is the dangerous part**, and B89 measured why: on LEGO set
 * 75038 the raw resolver title returned 96 sold at a $47.50 median, and the
 * set-number keyword returned 147 sold at $80.00. Same object, same scan,
 * medians 68% apart — and that median becomes the resale price.
 *
 * So these assert that the derivation PROPOSES and never imposes.
 */

import { describe, expect, it } from 'vitest';
import { keywordFor, type ProductIdentity } from '@/core/product.js';

const id = (over: Partial<ProductIdentity> = {}): ProductIdentity => ({
  barcode: '673419209366',
  title: 'LEGO Star Wars 75038 - Jedi Interceptor',
  brand: 'LEGO',
  category: 'Toys & Games > Toys > Building Toys',
  ...over,
});

describe('a title becomes a search, legibly', () => {
  it('lowercases and strips punctuation the vendor added', () => {
    expect(keywordFor(id()).keyword).toBe('lego star wars 75038 jedi interceptor');
  });

  it('⛔ strips trademark marks — no seller types ®, so they match nothing', () => {
    const k = keywordFor(id({ title: 'LEGO® Star Wars® Z-95 Headhunter Starfighter' }));
    expect(k.keyword).not.toContain('®');
    expect(k.keyword).toBe('lego star wars z-95 headhunter starfighter');
  });

  it('drops words every listing has and none of them narrows', () => {
    const k = keywordFor(id({ title: 'LEGO Star Wars X-Wing Interlocking Block Building Set' }));
    expect(k.keyword).toBe('lego star wars x-wing');
  });

  it('⛔ offers the model-number reading as an ALTERNATIVE, never applies it', () => {
    // The whole of B89 in one assertion. These two were 68% apart in median
    // price and nothing in the data says which is correct, so the operator
    // gets both and picks.
    const k = keywordFor(id());
    expect(k.from).toBe('title');
    expect(k.alternative).toBe('lego 75038');
    expect(k.keyword).not.toBe(k.alternative);
  });

  it('has no alternative when there is no model number to find', () => {
    // ⚠️ The control: "alternative" must mean something, not be always-present.
    expect(keywordFor(id({ title: 'Sharpie Permanent Markers Black' , brand: 'Sharpie' })).alternative)
      .toBeNull();
  });

  it('has no alternative when the vendor gave no brand', () => {
    expect(keywordFor(id({ brand: null })).alternative).toBeNull();
  });

  it('falls back to the raw title rather than to an empty search', () => {
    // A title made entirely of noise words cleans to nothing. An empty keyword
    // would search the whole market and return a confident irrelevance.
    const k = keywordFor(id({ title: 'Building Set', brand: null }));
    expect(k.keyword).not.toBe('');
    expect(k.keyword).toBe('building set');
  });
});
