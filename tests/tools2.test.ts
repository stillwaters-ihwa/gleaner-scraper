// @vitest-environment happy-dom
// Website and domain tools, email checks, data converters, and PDF/OCR layout logic.
import { describe, expect, it } from 'vitest';
import { detectTech } from '@/lib/web/tech';
import { domainOf, rootDomain } from '@/lib/web/domain';
import { emailBasics } from '@/lib/web/email';
import { flatten, formatJson, htmlTables, htmlToMarkdown, jsonToRows, mergeTables, pageLinks, parseJson, tableRows } from '@/lib/convert';
import { invoiceFields, linesOf, tableFromBoxes, type Box } from '@/lib/documents';

const doc = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('technology checker', () => {
  it('finds platforms, frameworks, analytics and the server from code and headers', () => {
    const html = `<html><head><meta name="generator" content="WordPress 6.6.2"><script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234"></script>
      <script src="/wp-content/plugins/woocommerce/assets/js/frontend/woocommerce.min.js"></script><script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
      <script src="https://static.klaviyo.com/onsite/js/klaviyo.js"></script><script src="https://js.stripe.com/v3"></script></head><body></body></html>`;
    const found = detectTech(html, { server: 'nginx/1.25.3', 'cf-ray': '8a1b2c3d4e5f-ICN' });
    const names = found.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['WordPress', 'WooCommerce', 'jQuery', 'Google Tag Manager', 'Klaviyo', 'Stripe', 'Cloudflare', 'Nginx']));
    expect(found.find((t) => t.name === 'WordPress')?.version).toBe('6.6.2');
    expect(found.find((t) => t.name === 'jQuery')?.version).toBe('3.7.1');
    expect(found.find((t) => t.name === 'Nginx')?.version).toBe('1.25.3');
    expect(names).not.toContain('Shopify');
  });
  it('recognises Shopify and Cafe24 stores', () => {
    expect(detectTech('<script src="https://cdn.shopify.com/s/files/1/x.js"></script>').map((t) => t.name)).toContain('Shopify');
    expect(detectTech('<link href="//img.echosting.cafe24.com/skin/base/ec-base.css">').map((t) => t.name)).toContain('Cafe24');
  });
});

describe('domains', () => {
  it('normalises input and finds the registrable domain', () => {
    expect(domainOf('https://www.Shop.Example.com/path?q=1')).toBe('shop.example.com');
    expect(domainOf('example.co.kr')).toBe('example.co.kr');
    expect(rootDomain('shop.example.co.kr')).toBe('example.co.kr');
    expect(rootDomain('blog.example.com')).toBe('example.com');
    expect(domainOf('')).toBe('');
  });
});

describe('email checker', () => {
  it('checks format, throwaway, role and free addresses, and typos', () => {
    expect(emailBasics('Jane.Doe@Company.com')).toMatchObject({ email: 'jane.doe@company.com', format: 'ok', domain: 'company.com', disposable: '', role_address: '', free_provider: '' });
    expect(emailBasics('info@company.com').role_address).toBe('yes');
    expect(emailBasics('x@mailinator.com').disposable).toBe('yes');
    expect(emailBasics('me@naver.com').free_provider).toBe('yes');
    expect(emailBasics('me@gmial.com').suggestion).toBe('me@gmail.com');
    for (const bad of ['plainaddress', 'a@b', 'a..b@c.com', '.a@b.com', 'a@b.c', 'a@-b.com']) expect(emailBasics(bad).format).toBe('bad');
  });
});

describe('HTML to Markdown', () => {
  it('converts headings, links, lists and tables, with absolute links', () => {
    const { markdown } = htmlToMarkdown('<h2>Routine</h2><p>Use <a href="/toner">toner</a> then <strong>serum</strong>.</p><ul><li>Cleanse</li><li>Tone</li></ul><table><thead><tr><th>Step</th><th>Product</th></tr></thead><tbody><tr><td>1</td><td>Cleanser</td></tr></tbody></table><script>x()</script>', { baseUrl: 'https://shop.example.com/blog/' });
    expect(markdown).toContain('## Routine');
    expect(markdown).toContain('[toner](https://shop.example.com/toner)');
    expect(markdown).toContain('**serum**');
    expect(markdown).toMatch(/-\s+Cleanse/);
    expect(markdown).toContain('| Step | Product |');
    expect(markdown).not.toContain('x()');
  });
});

describe('HTML tables', () => {
  it('expands colspan and rowspan into a grid', () => {
    const [t] = htmlTables(doc('<table><thead><tr><th>Size</th><th colspan="2">Price</th></tr></thead><tbody><tr><td rowspan="2">50ml</td><td>$10</td><td>₩13,000</td></tr><tr><td>$11</td><td>₩14,000</td></tr></tbody></table>'));
    expect(t.headers).toEqual(['Size', 'Price', 'Price 2']);
    expect(t.rows).toEqual([
      ['50ml', '$10', '₩13,000'],
      ['50ml', '$11', '₩14,000'],
    ]);
    expect(tableRows(t)[1]).toEqual({ Size: '50ml', Price: '$11', 'Price 2': '₩14,000' });
  });
  it('names columns when a table has no header row', () => {
    expect(htmlTables(doc('<table><tr><td>a</td><td>b</td></tr></table>'))[0].headers).toEqual(['column 1', 'column 2']);
  });
});

describe('JSON tools', () => {
  it('says where broken JSON breaks', () => {
    const r = parseJson('{\n  "a": 1,\n  "b": \n}');
    expect(r.ok).toBe(false);
    expect(r.line).toBe(4);
  });
  it('formats with sorted keys and flattens nested data into rows', () => {
    expect(formatJson({ b: 1, a: { d: 2, c: 3 } }, { indent: 2, sortKeys: true })).toBe('{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}');
    expect(flatten({ a: { b: 1 }, tags: ['x', 'y'], items: [{ n: 1 }] })).toEqual({ 'a.b': '1', tags: 'x, y', 'items.0.n': '1' });
    expect(jsonToRows({ data: { products: [{ id: 1, name: 'Toner' }, { id: 2, name: 'Serum' }] } })).toEqual([
      { id: '1', name: 'Toner' },
      { id: '2', name: 'Serum' },
    ]);
  });
});

describe('merging files', () => {
  it('lines up columns by name, adds the source file, and drops duplicates', () => {
    const m = mergeTables(
      [
        { name: 'a.csv', rows: [{ SKU: '1', 'Product Name': 'Toner' }, { SKU: '2', 'Product Name': 'Serum' }] },
        { name: 'b.xlsx', rows: [{ sku: '2', product_name: 'Serum' }, { sku: '3', product_name: 'Cream', price: '9' }] },
      ],
      { dedupe: true, sourceColumn: true },
    );
    expect(m.headers).toEqual(['SKU', 'Product Name', 'price', 'source file']);
    expect(m.duplicates).toBe(1);
    expect(m.rows.map((r) => r.SKU)).toEqual(['1', '2', '3']);
    expect(m.rows[2]).toEqual({ SKU: '3', 'Product Name': 'Cream', price: '9', 'source file': 'b.xlsx' });
  });
});

describe('link extractor', () => {
  it('classifies links and drops duplicates and page anchors', () => {
    const links = pageLinks(doc('<a href="/about">About</a><a href="/about#team">Team</a><a href="https://x.com/brand">X</a><a href="mailto:hi@shop.com">Mail</a><a href="tel:+8210">Call</a><a href="/files/catalog.pdf">Catalog</a><a href="#top">Top</a><a href="javascript:void(0)">JS</a>'), 'https://shop.com/');
    expect(links.map((l) => [l.url, l.type])).toEqual([
      ['https://shop.com/about', 'internal'],
      ['https://x.com/brand', 'external'],
      ['mailto:hi@shop.com', 'email'],
      ['tel:+8210', 'phone'],
      ['https://shop.com/files/catalog.pdf', 'file'],
    ]);
  });
});

describe('tables from positioned text (PDF and OCR)', () => {
  // A small price list laid out in columns, as pdf.js or OCR would report it
  const w = (text: string, x: number, y: number): Box => ({ text, x0: x, x1: x + text.length * 6, y0: y, y1: y + 10 });
  const boxes = [
    w('Price', 10, 0), w('list', 46, 0),
    w('Product', 10, 20), w('Size', 150, 20), w('Price', 230, 20),
    w('Heartleaf', 10, 40), w('Toner', 68, 40), w('250ml', 150, 40), w('$18.00', 230, 40),
    w('Snail', 10, 60), w('Essence', 44, 60), w('100ml', 150, 60), w('$21.50', 230, 60),
    w('Sun', 10, 80), w('Cream', 34, 80), w('$15.00', 230, 80),
  ];
  it('groups text into lines', () => {
    expect(linesOf(boxes).map((l) => l.map((b) => b.text).join(' '))).toEqual(['Price list', 'Product Size Price', 'Heartleaf Toner 250ml $18.00', 'Snail Essence 100ml $21.50', 'Sun Cream $15.00']);
  });
  it('finds the columns, keeps empty cells, and skips the title line', () => {
    expect(tableFromBoxes(boxes)).toEqual([
      ['Product', 'Size', 'Price'],
      ['Heartleaf Toner', '250ml', '$18.00'],
      ['Snail Essence', '100ml', '$21.50'],
      ['Sun Cream', '', '$15.00'],
    ]);
  });
});

describe('invoice fields', () => {
  it('reads number, dates and labelled amounts', () => {
    const text = `Glow Supply Co.
      123 Market St
      INVOICE
      Invoice No: INV-2026-0417
      Invoice Date: 2026-10-01
      Due Date: Oct 31, 2026
      PO Number: PO-8812
      Item  Qty  Amount
      Toner  10  $180.00
      Subtotal  $180.00
      Tax  $14.40
      Shipping  $12.00
      Total  $206.40
      Amount Due  $206.40`;
    expect(invoiceFields(text)).toEqual({
      vendor: 'Glow Supply Co.',
      invoice_number: 'INV-2026-0417',
      invoice_date: '2026-10-01',
      due_date: 'Oct 31, 2026',
      po_number: 'PO-8812',
      currency: 'USD',
      subtotal: '180.00',
      tax: '14.40',
      shipping: '12.00',
      total: '206.40',
      amount_due: '206.40',
    });
  });
});

describe('JSON error locations', () => {
  it('names the problem and its line for common mistakes', () => {
    expect(parseJson('{"a": 1,}')).toMatchObject({ ok: false, error: 'Trailing comma before }', line: 1, column: 9 });
    expect(parseJson("{'a': 1}")).toMatchObject({ ok: false, error: 'Expected a "quoted" key', line: 1 });
    expect(parseJson('[1, 2\n3]')).toMatchObject({ ok: false, error: 'Expected , or ] after a value', line: 2, column: 1 });
    expect(parseJson('{"a": "x}')).toMatchObject({ ok: false, error: 'A string is never closed' });
    expect(parseJson('{"a": 1} x')).toMatchObject({ ok: false, error: 'Extra text after the end' });
    expect(parseJson('[1,2]')).toEqual({ ok: true, value: [1, 2] });
  });
});
