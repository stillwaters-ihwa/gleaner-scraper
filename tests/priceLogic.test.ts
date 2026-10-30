import { describe, expect, it } from 'vitest';
import { appendHistory, lowestNow, normalizeCurrency, parseSourceUrls, priceAlerts, readSource, type Tracker, type TrackerRef, type TrackerSource } from '@/lib/priceLogic';

const ref: TrackerRef = { title: 'ANUA Heartleaf Pore Control Cleanser 150ml', brand: 'ANUA', sku: 'ANUA-HC-150', gtin: '', mpn: '', yourPrice: 16, map: 12, currency: 'USD' };

function tracker(sources: Partial<TrackerSource>[], over: Partial<Tracker> = {}): Tracker {
  return {
    id: 't',
    name: 'Cleanser',
    ref,
    sources: sources.map((s, i) => ({ id: String(i), url: `https://s${i}.com/p`, store: `s${i}.com`, matched: true, comparable: true, lastCurrency: 'USD', ...s })),
    every: 'day',
    paused: false,
    evidence: true,
    createdAt: 0,
    updatedAt: 0,
    history: [],
    ...over,
  };
}

describe('normalizeCurrency', () => {
  it('turns symbols and codes into ISO codes', () => {
    expect(normalizeCurrency('$')).toBe('USD');
    expect(normalizeCurrency('US$')).toBe('USD');
    expect(normalizeCurrency('usd')).toBe('USD');
    expect(normalizeCurrency('₩')).toBe('KRW');
    expect(normalizeCurrency('dollars')).toBe('');
    expect(normalizeCurrency('')).toBe('');
  });
});

describe('readSource', () => {
  it('reads a matching page priced in your currency', () => {
    const r = readSource(ref, { title: 'ANUA Heartleaf Pore Control Cleanser 150ml', sku: 'ANUA-HC-150', price: '15.00', currency: 'USD', availability: 'in stock' });
    expect(r).toMatchObject({ price: 15, currency: 'USD', comparable: true, matched: true, matchBy: 'sku', inStock: true });
    expect(r.error).toBeUndefined();
  });

  it('picks the USD price from a page showing KRW and USD', () => {
    const r = readSource(ref, { title: 'ANUA Heartleaf Pore Control Cleanser 150ml', sku: 'ANUA-HC-150', price: '12000', currency: 'KRW', price_KRW: '12000', price_USD: '9.10' });
    expect(r).toMatchObject({ price: 9.1, currency: 'USD', comparable: true });
  });

  it('does not compare a page priced only in another currency', () => {
    const r = readSource(ref, { title: 'ANUA Heartleaf Pore Control Cleanser 150ml', sku: 'ANUA-HC-150', price: '9500', currency: 'KRW' });
    expect(r).toMatchObject({ price: 9500, currency: 'KRW', comparable: false });
    expect(r.error).toMatch(/KRW, not USD/);
  });

  it('treats a page without a currency as yours', () => {
    const r = readSource(ref, { title: 'ANUA Heartleaf Pore Control Cleanser 150ml', sku: 'ANUA-HC-150', price: '11' });
    expect(r).toMatchObject({ price: 11, comparable: true });
  });

  it('does not match another size, unless you confirm it', () => {
    const page = { title: 'ANUA Heartleaf Pore Control Cleanser 300ml', brand: 'ANUA', price: '20', currency: 'USD' };
    const loose = { ...ref, sku: '' };
    expect(readSource(loose, page).matched).toBe(false);
    expect(readSource(loose, page, 'confirmed').matched).toBe(true);
  });

  it('respects a rejected page even when it matches', () => {
    const r = readSource(ref, { title: 'ANUA Heartleaf Pore Control Cleanser 150ml', sku: 'ANUA-HC-150', price: '9', currency: 'USD' }, 'rejected');
    expect(r.matched).toBe(false);
    expect(r.error).toMatch(/different product/);
  });

  it('reports a page that could not be read', () => {
    expect(readSource(ref, null)).toMatchObject({ matched: false, price: null, error: 'Could not read the page' });
    expect(readSource(ref, { error: 'bot check' })).toMatchObject({ matched: false, error: 'bot check' });
  });

  it('reports a matched page with no price', () => {
    expect(readSource(ref, { title: 'ANUA Heartleaf Pore Control Cleanser 150ml', sku: 'ANUA-HC-150' }).error).toBe('No price found on the page');
  });
});

describe('priceAlerts', () => {
  it('flags a MAP violation and a price under yours', () => {
    const t = tracker([{ lastPrice: 10 }]);
    const a = priceAlerts(t, new Map());
    expect(a?.violations).toHaveLength(1);
    expect(a?.message).toBe('1 below MAP, 1 under your price');
    expect(a?.detail).toBe('s0.com: USD 10 (MAP 12)');
  });

  it('never compares a page in another currency with your MAP', () => {
    const t = tracker([{ lastPrice: 9500, lastCurrency: 'KRW', comparable: false }]);
    expect(priceAlerts(t, new Map())).toBeNull();
  });

  it('ignores rejected and unmatched pages', () => {
    const t = tracker([
      { lastPrice: 5, decision: 'rejected', matched: false },
      { lastPrice: 5, matched: false },
    ]);
    expect(priceAlerts(t, new Map())).toBeNull();
  });

  it('counts a drop only against the same currency', () => {
    const before = new Map([
      ['0', { id: '0', url: '', store: 's0.com', lastPrice: 15, lastCurrency: 'USD' } as TrackerSource],
      ['1', { id: '1', url: '', store: 's1.com', lastPrice: 20000, lastCurrency: 'KRW' } as TrackerSource],
    ]);
    const t = tracker([{ lastPrice: 14 }, { lastPrice: 14 }], { ref: { ...ref, map: null, yourPrice: null } });
    expect(priceAlerts(t, before)?.message).toBe('1 price drop');
  });

  it('reports a restock', () => {
    const before = new Map([['0', { id: '0', url: '', store: 's0.com', lastPrice: 15, lastInStock: false, lastCurrency: 'USD' } as TrackerSource]]);
    const t = tracker([{ lastPrice: 15, lastInStock: true }], { ref: { ...ref, map: null, yourPrice: null } });
    const a = priceAlerts(t, before);
    expect(a?.message).toBe('1 back in stock');
    expect(a?.detail).toBe('s0.com is back in stock');
  });

  it('is quiet when nothing changed', () => {
    const before = new Map([['0', { id: '0', url: '', store: 's0.com', lastPrice: 15, lastCurrency: 'USD', lastInStock: true } as TrackerSource]]);
    expect(priceAlerts(tracker([{ lastPrice: 15, lastInStock: true }], { ref: { ...ref, map: 12, yourPrice: 14 } }), before)).toBeNull();
  });
});

describe('appendHistory', () => {
  it('keeps the newest readings per store, so one store cannot push out another', () => {
    const t = tracker([{}, {}]);
    appendHistory(t, [{ s: '1', t: 0, price: 1, inStock: true }]);
    for (let i = 1; i <= 10; i++) appendHistory(t, [{ s: '0', t: i, price: i, inStock: true }], 4);
    expect(t.history.filter((p) => p.s === '0').map((p) => p.t)).toEqual([7, 8, 9, 10]);
    expect(t.history.filter((p) => p.s === '1')).toHaveLength(1);
  });
});

describe('lowestNow', () => {
  it('only considers comparable, matched prices', () => {
    const t = tracker([{ lastPrice: 14 }, { lastPrice: 3, comparable: false }, { lastPrice: 2, matched: false }, { lastPrice: 13 }]);
    expect(lowestNow(t)).toEqual({ store: 's3.com', price: 13, currency: 'USD' });
  });
});

describe('parseSourceUrls', () => {
  it('accepts one URL per line, including local test hosts', () => {
    expect(parseSourceUrls('https://a.com/p\nhttp://localhost:8770/store-a/product\n\nnot a url\nb.com/x\nhttps://a.com/p')).toEqual([
      'https://a.com/p',
      'http://localhost:8770/store-a/product',
      'https://b.com/x',
    ]);
  });
});
