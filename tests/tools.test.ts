// Image naming and sizing, URL ranges, paging URLs, data clean-up, and "Label: value" reading.
import { describe, expect, it } from 'vitest';
import { fileNames, fullSizeUrl, sizeClass, type Measured } from '@/lib/imageTools';
import { expandRange, normalizeUrls } from '@/lib/runner';
import { nextPageUrl, pageUrl } from '@/lib/listing';
import { applyOp } from '@/lib/parser';
import { pairsFromText, pricesByCurrency } from '@/lib/dom/fields';
import { parsePrice } from '@/lib/product';

const img = (o: Partial<Measured>): Measured => ({ src: 'https://x.com/a.jpg', alt: '', width: 0, height: 0, page: '', bytes: 0, type: '', ext: 'jpg', size: '', hash: '', ...o });

describe('sizeClass', () => {
  it('sorts by the longest side', () => {
    expect(sizeClass(300, 120, 0)).toBe('S');
    expect(sizeClass(800, 800, 0)).toBe('M');
    expect(sizeClass(1200, 900, 0)).toBe('L');
    expect(sizeClass(2400, 2400, 0)).toBe('XL');
  });
  it('falls back to file size when pixels are unknown', () => {
    expect(sizeClass(0, 0, 30_000)).toBe('S');
    expect(sizeClass(0, 0, 2_000_000)).toBe('XL');
    expect(sizeClass(0, 0, 0)).toBe('');
  });
});

describe('fullSizeUrl', () => {
  it('removes Shopify size suffixes and width params', () => {
    expect(fullSizeUrl('https://cdn.shopify.com/s/files/1/x/products/shoe_300x300.jpg?v=1&width=300')).toBe('https://cdn.shopify.com/s/files/1/x/products/shoe.jpg?v=1');
  });
  it('removes WordPress thumbnail sizes', () => {
    expect(fullSizeUrl('https://s.com/wp-content/uploads/2024/01/cream-300x300.jpg')).toBe('https://s.com/wp-content/uploads/2024/01/cream.jpg');
  });
  it('removes Amazon size codes', () => {
    expect(fullSizeUrl('https://m.media-amazon.com/images/I/71abc._AC_SX300_.jpg')).toBe('https://m.media-amazon.com/images/I/71abc.jpg');
  });
  it('switches Cafe24 small images to big', () => {
    expect(fullSizeUrl('https://s.com/web/product/small/202401/a.jpg')).toBe('https://s.com/web/product/big/202401/a.jpg');
  });
  it('leaves other URLs alone', () => {
    expect(fullSizeUrl('https://example.com/a.jpg')).toBe('');
  });
});

describe('fileNames', () => {
  it('names by SKU and product, numbering several pictures of one product', () => {
    const list = [img({ sku: 'SKU-1', product: 'Cream' }), img({ sku: 'SKU-1', product: 'Cream' }), img({ sku: 'SKU-2', product: 'Toner' })];
    expect(fileNames(list, '{sku}_{name}')).toEqual(['SKU-1_Cream-1', 'SKU-1_Cream-2', 'SKU-2_Toner']);
  });
  it('falls back to the product name, alt text, then the original name', () => {
    const list = [img({ product: 'Cream' }), img({ alt: 'side view' }), img({ src: 'https://x.com/photo-7.png' }), img({ src: 'https://x.com/' })];
    expect(fileNames(list, '{sku}')).toEqual(['Cream', 'side_view', 'photo-7', 'image']);
  });
  it('does not name a file by its size alone', () => {
    expect(fileNames([img({ size: 'S', alt: 'other' })], '{brand}-{size}')).toEqual(['other']);
  });
  it('strips characters Windows does not allow', () => {
    expect(fileNames([img({ product: 'Cream: "Best" <50ml>' })], '{name}')).toEqual(['Cream_Best_50ml']);
  });
});

describe('URL ranges and paging', () => {
  it('expands ranges, padding and steps', () => {
    expect(expandRange('https://s.com/page/[1-3]')).toEqual(['https://s.com/page/1', 'https://s.com/page/2', 'https://s.com/page/3']);
    expect(expandRange('https://s.com/a/[01-03]')).toEqual(['https://s.com/a/01', 'https://s.com/a/02', 'https://s.com/a/03']);
    expect(expandRange('https://s.com/?offset=[0-40:20]')).toEqual(['https://s.com/?offset=0', 'https://s.com/?offset=20', 'https://s.com/?offset=40']);
  });
  it('normalizes a pasted list and drops junk', () => {
    expect(normalizeUrls('s.com/a, https://s.com/a\nhello')).toEqual(['https://s.com/a']);
  });
  it('finds the next page and any page number in the URL', () => {
    expect(nextPageUrl('https://s.com/c?page=4&sort=new')).toBe('https://s.com/c?page=5&sort=new');
    expect(nextPageUrl('https://s.com/blog/page/2/')).toBe('https://s.com/blog/page/3/');
    expect(nextPageUrl('https://s.com/c')).toBeNull();
    expect(pageUrl('https://s.com/c?p=1', 30)).toBe('https://s.com/c?p=30');
  });
});

describe('data clean-up', () => {
  it('keeps only the number, extracts and replaces', () => {
    expect(applyOp(' $1,299.50 ', { kind: 'number' })).toBe('1299.5');
    expect(applyOp('SKU-100000', { kind: 'extract', pattern: String.raw`SKU-(\d+)` })).toBe('100000');
    expect(applyOp('a-b-c', { kind: 'replace', find: '-', replace: '/', regex: false })).toBe('a/b/c');
    expect(applyOp('heartleaf cleanser', { kind: 'case', to: 'title' })).toBe('Heartleaf Cleanser');
  });
  it('explains a bad pattern instead of crashing', () => {
    expect(() => applyOp('x', { kind: 'extract', pattern: '(' })).toThrow(/not a valid regular expression/);
  });
});

describe('reading product details from text', () => {
  it('reads several "Label: value" pairs on one line', () => {
    expect(pairsFromText('SKU: SKU10000-A PartNum : 11300000')).toEqual([
      ['SKU', 'SKU10000-A'],
      ['PartNum', '11300000'],
    ]);
  });
  it('does not read a time as a label', () => {
    expect(pairsFromText('Open 10:30 daily')).toEqual([]);
  });
  it('splits prices by currency', () => {
    expect(pricesByCurrency(['₩12,000 / $9.10'])).toEqual({ price_KRW: '12000', price_USD: '9.10' });
  });
  it('parses European and Korean price formats', () => {
    expect(parsePrice('1.234,56 €')).toEqual({ amount: '1234.56', currency: 'EUR' });
    expect(parsePrice('₩12,000')).toEqual({ amount: '12000', currency: 'KRW' });
  });
  it('reads prices of 1,000 and up written without separators in full', () => {
    // These used to be cut to their first three digits ("9500" -> "950")
    expect(parsePrice('$9500')).toEqual({ amount: '9500', currency: 'USD' });
    expect(parsePrice('$1299.99')).toEqual({ amount: '1299.99', currency: 'USD' });
    expect(parsePrice('KRW9500')).toEqual({ amount: '9500', currency: 'KRW' });
    expect(parsePrice('KRW 125000')).toEqual({ amount: '125000', currency: 'KRW' });
    expect(parsePrice('9500 €')).toEqual({ amount: '9500', currency: 'EUR' });
    expect(parsePrice('Now ₩1250000 only')).toEqual({ amount: '1250000', currency: 'KRW' });
  });
  it('still reads small and grouped prices', () => {
    expect(parsePrice('$9.10')).toEqual({ amount: '9.10', currency: 'USD' });
    expect(parsePrice('$1,299.99')).toEqual({ amount: '1299.99', currency: 'USD' });
    expect(parsePrice('19,99 €')).toEqual({ amount: '19.99', currency: 'EUR' });
    expect(parsePrice('£5')).toEqual({ amount: '5', currency: 'GBP' });
  });
});
