// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableJavaScriptFileLoading":true,"disableJavaScriptEvaluation":true,"disableCSSFileLoading":true}}
// The Amazon reader on real Amazon pages saved by QA (skipped when they aren't on this computer).
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { extractProduct } from '@/lib/product';
import { extractVariants } from '@/lib/variants';

const DIR = process.env.GLEANER_AMAZON_HTML ?? path.join(process.env.LOCALAPPDATA ?? '', 'Temp/claude/C--Users-DANE-Documents-Scrape/fc45fc76-7fe9-4959-aaaa-3330a7eaf1ce/scratchpad/qa/amazon-product/data/html');
const have = fs.existsSync(path.join(DIR, 'variants.html'));
const URLS: Record<string, string> = {
  variants: 'https://www.amazon.com/dp/B07XLTPC5L',
  oos: 'https://www.amazon.com/dp/B07FZ8S74R',
  book: 'https://www.amazon.com/dp/0735211299',
  dead: 'https://www.amazon.com/dp/B00X4WHP5E',
  beauty: 'https://www.amazon.com/dp/B0XXXXXXXX',
  thirdparty: 'https://www.amazon.com/dp/B0YYYYYYYY',
  images: 'https://www.amazon.com/dp/B0ZZZZZZZZ',
  deal: 'https://www.amazon.com/dp/B0D1EAL001',
  deal2: 'https://www.amazon.com/dp/B0D1EAL002',
  L_goodmol: 'https://www.amazon.com/dp/B0G00DM0L0',
  L_lrp: 'https://www.amazon.com/dp/B075VX4QVM',
  L_ordinary: 'https://www.amazon.com/dp/B01MYEZPC8',
};
const read = (name: string) => {
  // Drop external scripts and stylesheets so the test DOM doesn't try to download them
  const html = fs.readFileSync(path.join(DIR, `${name}.html`), 'utf8').replace(/<script\b[^>]*\bsrc=[^>]*>\s*<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return { doc, p: extractProduct(doc, URLS[name]) };
};

describe.skipIf(!have)("Amazon reader on saved real pages", { timeout: 120000 }, () => {
  it('prints what it reads (for review)', () => {
    for (const name of Object.keys(URLS)) {
      const { p } = read(name);
      const pick = ['title', 'brand', 'author', 'price', 'compare_at_price', 'typical_price', 'currency', 'availability', 'gtin', 'mpn', 'manufacturer', 'bsr', 'bsr_category', 'sold_by', 'ships_from', 'error'];
      console.log(name, JSON.stringify(Object.fromEntries(pick.filter((k) => p[k]).map((k) => [k, String(p[k]).slice(0, 70)]))), '| images', (p.images ?? '').split(' | ').filter(Boolean).length, '| attrs', Object.keys(p).filter((k) => k.startsWith('attr_')).length, '| variants', p.variants ? p.variants.split(' | ').length : 0);
    }
  });

  it('gives no price for an unavailable product (not another product’s)', () => {
    const { p } = read('oos');
    expect(p.price).toBeUndefined();
    expect(p.availability).toBe('out of stock');
  });

  it('turns a dead link into an error, not a product', () => {
    expect(read('dead').p.error).toMatch(/not found/i);
  });

  it('never reports a "was" price that isn’t higher than the price', () => {
    for (const name of Object.keys(URLS)) {
      const { p } = read(name);
      if (p.compare_at_price) expect(Number(p.compare_at_price), name).toBeGreaterThan(Number(p.price));
    }
  });

  it('reads books by author, not as a brand', () => {
    const { p } = read('book');
    expect(p.author).toMatch(/James Clear/);
    expect(p.brand ?? '').not.toMatch(/Author|Format/);
  });

  it('reads all child products of a variant listing, each with its link and picture', () => {
    const { doc } = read('variants');
    const v = extractVariants(doc, URLS.variants);
    expect(v.length).toBeGreaterThan(30);
    expect(v.every((x) => /^https:\/\/www\.amazon\.com\/dp\/[A-Z0-9]{10}$/.test(x.url ?? ''))).toBe(true);
    expect(v.filter((x) => x.image).length / v.length).toBeGreaterThan(0.8);
    expect(Object.keys(v[0].options)).toEqual(expect.arrayContaining(['Color', 'Size']));
  });

  it('keeps only the shown variant’s gallery, at full size', () => {
    const { p } = read('variants');
    const imgs = (p.images ?? '').split(' | ').filter(Boolean);
    expect(imgs.length).toBeGreaterThan(3);
    expect(imgs.length).toBeLessThan(15);
    expect(imgs.every((u) => /_SL1500_|_AC_\.jpg|_SX|_SY/.test(u) || /\.jpg$/.test(u))).toBe(true);
  });
});
