// @vitest-environment happy-dom
// Product variants from Shopify, WooCommerce and schema.org data, and one row per variant.
import { describe, expect, it } from 'vitest';
import { expandVariants, extractVariants, shopifyFeedVariants, VARIANTS_KEY, withoutVariantData } from '@/lib/variants';
import { extractProduct } from '@/lib/product';

const page = (body: string) => {
  const doc = document.implementation.createHTMLDocument('p');
  doc.body.innerHTML = body;
  return doc;
};
const URL_ = 'https://shop.example.com/products/toner';

describe('reading variants', () => {
  it('reads the product JSON a Shopify theme embeds (prices in cents)', () => {
    const json = { title: 'Toner', options: ['Size', 'Scent'], variants: [
      { title: '100ml / Rose', option1: '100ml', option2: 'Rose', sku: 'T-100-R', price: 1800, compare_at_price: 2200, available: true, featured_image: { src: '//cdn.shopify.com/t-rose.jpg' }, barcode: '880100' },
      { title: '250ml / Plain', option1: '250ml', option2: 'Plain', sku: 'T-250-P', price: 3200, available: false, featured_image: null },
    ] };
    const v = extractVariants(page(`<h1>Toner</h1><script type="application/json" data-product-json>${JSON.stringify(json)}</script>`), URL_);
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({ name: '100ml / Rose', options: { Size: '100ml', Scent: 'Rose' }, sku: 'T-100-R', price: '18.00', compare_at: '22.00', available: true, image: 'https://cdn.shopify.com/t-rose.jpg', gtin: '880100' });
    expect(v[1]).toMatchObject({ price: '32.00', available: false });
  });

  it("reads WooCommerce's variation list", () => {
    const vars = [
      { attributes: { attribute_pa_color: 'red' }, sku: 'C-RED', display_price: 12, display_regular_price: 15, is_in_stock: true, image: { full_src: '/img/red.jpg' } },
      { attributes: { attribute_pa_color: 'blue' }, sku: 'C-BLUE', display_price: 12, display_regular_price: 12, is_in_stock: false, image: { full_src: '/img/blue.jpg' } },
    ];
    const v = extractVariants(page(`<form class="variations_form" data-product_variations='${JSON.stringify(vars)}'><label for="pa_color">Colour</label><select id="pa_color"></select></form>`), URL_);
    expect(v.map((x) => [x.name, x.options.Colour, x.price, x.compare_at, x.available, x.image])).toEqual([
      ['red', 'red', '12', '15', true, 'https://shop.example.com/img/red.jpg'],
      ['blue', 'blue', '12', '', false, 'https://shop.example.com/img/blue.jpg'],
    ]);
  });

  it('reads a schema.org product group', () => {
    const ld = { '@context': 'https://schema.org', '@type': 'ProductGroup', name: 'Cushion', variesBy: ['https://schema.org/color'], hasVariant: [
      { '@type': 'Product', name: 'Cushion 21 Light', color: '21 Light', sku: 'CU-21', image: 'https://cdn.example.com/21.jpg', offers: { price: '25.00', priceCurrency: 'USD', availability: 'https://schema.org/InStock' } },
      { '@type': 'Product', name: 'Cushion 23 Natural', color: '23 Natural', sku: 'CU-23', image: 'https://cdn.example.com/23.jpg', offers: { price: '25.00', priceCurrency: 'USD', availability: 'https://schema.org/OutOfStock' } },
    ] };
    const v = extractVariants(page(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`), URL_);
    expect(v.map((x) => [x.name, x.options.Color, x.sku, x.price, x.currency, x.available])).toEqual([
      ['Cushion 21 Light', '21 Light', 'CU-21', '25.00', 'USD', true],
      ['Cushion 23 Natural', '23 Natural', 'CU-23', '25.00', 'USD', false],
    ]);
  });

  it('ignores a single "Default Title" variant', () => {
    expect(shopifyFeedVariants({ variants: [{ title: 'Default Title', option1: 'Default Title', price: '9.00' }] })).toEqual([]);
  });

  it('keeps the variants on the product row, hidden until expanded', () => {
    const ld = { '@type': 'ProductGroup', name: 'Cushion', hasVariant: [{ '@type': 'Product', name: 'A', sku: 'A1', offers: { price: '1' } }, { '@type': 'Product', name: 'B', sku: 'B1', offers: { price: '2' } }] };
    const p = extractProduct(page(`<h1>Cushion</h1><script type="application/ld+json">${JSON.stringify(ld)}</script>`), URL_);
    expect(JSON.parse(p[VARIANTS_KEY])).toHaveLength(2);
    expect(withoutVariantData([p])[0][VARIANTS_KEY]).toBeUndefined();
  });
});

describe('one row per variant', () => {
  it('gives each variant its own row and keeps products without variants', () => {
    const rows = expandVariants([
      { title: 'Toner', price: '18', [VARIANTS_KEY]: JSON.stringify([{ name: 'Rose', options: { Scent: 'Rose' }, sku: 'R', price: '18', available: true, image: 'r.jpg' }, { name: '', options: { Scent: 'Plain' }, sku: 'P', price: '16', available: false }]) },
      { title: 'Serum', price: '24' },
    ]);
    expect(rows.map((r) => [r.title, r.variant ?? '', r.variant_options ?? '', r.variant_sku ?? '', r.variant_price ?? '', r.variant_available ?? '', r.variant_image ?? ''])).toEqual([
      ['Toner', 'Rose', 'Scent: Rose', 'R', '18', 'yes', 'r.jpg'],
      ['Toner', 'Plain', 'Scent: Plain', 'P', '16', 'no', ''],
      ['Serum', '', '', '', '', '', ''],
    ]);
    expect(rows.every((r) => !(VARIANTS_KEY in r))).toBe(true);
  });
});
