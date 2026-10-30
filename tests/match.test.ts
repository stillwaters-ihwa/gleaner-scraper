import { describe, expect, it } from 'vitest';
import { bestMatch, groupId, matchKeys, normalizeGtin, productKey, sizeOf, titleTokens } from '@/lib/match';

describe('normalizeGtin', () => {
  it('lines up EAN-13 with a leading zero and UPC-12', () => {
    expect(normalizeGtin('0036000291452')).toBe(normalizeGtin('036000291452'));
  });
  it('rejects codes that are too short or too long', () => {
    expect(normalizeGtin('123')).toBe('');
    expect(normalizeGtin('123456789012345')).toBe('');
  });
  it('ignores spaces and dashes', () => {
    expect(normalizeGtin('8809-6407-30191')).toBe('8809640730191');
  });
});

describe('titleTokens', () => {
  it('drops brand prefixes, sizes and filler words', () => {
    expect(titleTokens('[ANUA] Heartleaf Pore Control Cleanser 150ml #1')).toEqual(['heartleaf', 'pore', 'control', 'cleanser']);
  });
  it('keeps Korean words', () => {
    expect(titleTokens('어성초 클렌저 150ml')).toEqual(['어성초', '클렌저']);
  });
});

describe('sizeOf', () => {
  it('converts to a common unit', () => {
    expect(sizeOf('Toner 1L')).toBe('1000ml');
    expect(sizeOf('Toner 1000 ml')).toBe('1000ml');
    expect(sizeOf('Cream 0.5kg')).toBe('500g');
  });
  it('reads multipacks', () => {
    expect(sizeOf('Mask 2 x 25ml')).toBe('25ml+x2');
    expect(sizeOf('Sheet mask set of 10')).toBe('x10');
  });
  it('is empty when the title has no size', () => {
    expect(sizeOf('Heartleaf Pore Control Cleanser')).toBe('');
  });
});

describe('matchKeys', () => {
  const ref = productKey({ title: 'Heartleaf Pore Control Cleanser 150ml', brand: 'ANUA', sku: 'ANUA-HC-150' });

  it('matches on barcode first', () => {
    const a = productKey({ title: 'x', gtin: '8809640730191' });
    const b = productKey({ title: 'something else', gtin: '8809640730191' });
    expect(matchKeys(a, b)).toEqual({ by: 'gtin', score: 1 });
  });
  it('matches SKUs regardless of case and punctuation', () => {
    const page = productKey({ title: 'Whatever', sku: 'anua hc 150' });
    expect(matchKeys(ref, page)?.by).toBe('sku');
  });
  it('matches by title with a score when there is no shared id', () => {
    const page = productKey({ title: 'ANUA Heartleaf Pore Control Cleanser 150ml Tube', brand: 'Anua' });
    const m = matchKeys(productKey({ title: 'Heartleaf Pore Control Cleanser 150ml', brand: 'ANUA' }), page);
    expect(m?.by).toBe('title');
    expect(m!.score).toBeGreaterThanOrEqual(0.6);
  });
  it('does not match another brand with the same product name', () => {
    const page = productKey({ title: 'Heartleaf Pore Control Cleanser 150ml', brand: 'Medicube' });
    expect(matchKeys(productKey({ title: 'Heartleaf Pore Control Cleanser 150ml', brand: 'ANUA' }), page)).toBeNull();
  });
  it('does not match the same product in another size', () => {
    const big = productKey({ title: 'Heartleaf Pore Control Cleanser 300ml', brand: 'ANUA' });
    expect(matchKeys(productKey({ title: 'Heartleaf Pore Control Cleanser 150ml', brand: 'ANUA' }), big)).toBeNull();
  });
  it('still matches by SKU across sizes in the title (the SKU decides)', () => {
    const page = productKey({ title: 'Heartleaf Cleanser 300ml', sku: 'ANUA-HC-150' });
    expect(matchKeys(ref, page)?.by).toBe('sku');
  });
  it('ignores very short SKUs that are likely not real identifiers', () => {
    const a = productKey({ title: 'Cream', sku: 'A1' });
    const b = productKey({ title: 'Totally different serum', sku: 'A1' });
    expect(matchKeys(a, b)).toBeNull();
  });
});

describe('bestMatch', () => {
  it('prefers an identifier match over a stronger title match', () => {
    const target = productKey({ title: 'Heartleaf Cleanser 150ml', sku: 'ANUA-HC-150' });
    const best = bestMatch(target, [
      { title: 'Heartleaf Cleanser 150ml' },
      { title: 'Gift box', sku: 'ANUA-HC-150' },
    ]);
    expect(best?.match.by).toBe('sku');
  });
  it('returns null when nothing is close', () => {
    expect(bestMatch(productKey({ title: 'Heartleaf Cleanser' }), [{ title: 'Sunscreen SPF50' }])).toBeNull();
  });
});

describe('groupId', () => {
  it('uses the strongest identifier available', () => {
    expect(groupId(productKey({ title: 'x', gtin: '8809640730191', sku: 'ABCD' }))).toBe('g:8809640730191');
    expect(groupId(productKey({ title: 'x', sku: 'ABCD-1' }))).toBe('s:ABCD1');
    expect(groupId(productKey({ title: 'Heartleaf Cleanser', brand: 'ANUA' }))).toBe('t:anua heartleaf cleanser');
  });
});
