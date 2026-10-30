// Product variants (colour, size, scent...): each one's own price, SKU, stock and picture.
// Read from the data shops publish on product pages: schema.org product groups and offers,
// WooCommerce's variation list, and the product JSON Shopify themes embed. Also turns one
// product row into one row per variant.
import type { Product } from './product';

export interface Variant {
  name: string;
  /** Option name to value, e.g. { Color: 'Red', Size: 'M' } */
  options: Record<string, string>;
  sku?: string;
  price?: string;
  compare_at?: string;
  currency?: string;
  available?: boolean;
  image?: string;
  gtin?: string;
}

const str = (v: unknown): string => (v == null ? '' : typeof v === 'object' ? str((v as any).name ?? (v as any)['@id'] ?? '') : String(v).trim());
const abs = (u: string, base: string) => {
  if (!u) return '';
  try {
    return new URL(u.startsWith('//') ? 'https:' + u : u, base).href;
  } catch {
    return '';
  }
};
const firstOf = (v: any) => (Array.isArray(v) ? v[0] : v);
const inStock = (v: unknown) => (v == null ? undefined : /instock|in_stock|in stock|limitedavailability|preorder|true/i.test(String(v)) && !/outofstock|out of stock|soldout|false/i.test(String(v)));

function jsonLdNodes(doc: Document): any[] {
  const out: any[] = [];
  const walk = (n: any, d = 0) => {
    if (!n || typeof n !== 'object' || d > 6) return;
    if (Array.isArray(n)) return n.forEach((x) => walk(x, d + 1));
    if (n['@type']) out.push(n);
    if (n['@graph']) walk(n['@graph'], d + 1);
  };
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      walk(JSON.parse((s.textContent ?? '').trim()));
    } catch {
      /* broken block */
    }
  }
  return out;
}
const isType = (n: any, t: string) => [].concat(n?.['@type'] ?? []).some((x) => String(x).toLowerCase().replace(/^https?:\/\/schema\.org\//, '') === t);

/** schema.org: a ProductGroup's hasVariant, or a Product with several offers that name their SKU. */
function fromSchema(doc: Document, url: string): Variant[] {
  const nodes = jsonLdNodes(doc);
  const group = nodes.find((n) => isType(n, 'productgroup'));
  const varied: string[] = [].concat(group?.variesBy ?? []).map((v: string) => String(v).replace(/^https?:\/\/schema\.org\//, ''));
  const list: any[] = group?.hasVariant ?? nodes.find((n) => isType(n, 'product') && n.hasVariant)?.hasVariant ?? [];
  if (list.length) {
    return list.map((v) => {
      const o = firstOf(v.offers) ?? {};
      const options: Record<string, string> = {};
      for (const k of ['color', 'size', 'material', 'pattern', ...varied.map((x) => x.toLowerCase())]) if (v[k] && typeof v[k] !== 'object') options[k[0].toUpperCase() + k.slice(1)] = str(v[k]);
      for (const p of [].concat(v.additionalProperty ?? [])) if ((p as any)?.name && (p as any)?.value) options[str((p as any).name)] = str((p as any).value);
      return {
        name: str(v.name),
        options,
        sku: str(v.sku ?? o.sku),
        price: str(o.price ?? o.lowPrice),
        currency: str(o.priceCurrency),
        available: inStock(o.availability),
        image: abs(str(firstOf(v.image)?.url ?? firstOf(v.image)), url),
        gtin: str(v.gtin13 ?? v.gtin ?? v.gtin12 ?? v.gtin14),
      };
    });
  }
  const product = nodes.find((n) => isType(n, 'product'));
  const offers: any[] = [].concat(product?.offers?.offers ?? product?.offers ?? []).filter((o: any) => o && o.sku && o.sku !== product.sku);
  if (offers.length < 2) return [];
  return offers.map((o) => ({ name: str(o.name ?? o.itemOffered?.name ?? o.sku), options: {}, sku: str(o.sku), price: str(o.price), currency: str(o.priceCurrency), available: inStock(o.availability), image: abs(str(firstOf(o.image)), url) }));
}

/** WooCommerce variable products: the variation list on the add-to-cart form. */
function fromWoo(doc: Document, url: string): Variant[] {
  const form = doc.querySelector('form.variations_form[data-product_variations]');
  if (!form) return [];
  let list: any[] = [];
  try {
    list = JSON.parse(form.getAttribute('data-product_variations') ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const label = (k: string) => {
    const name = k.replace(/^attribute_(pa_)?/, '');
    const el = form.querySelector(`label[for="${CSS.escape(k.replace(/^attribute_/, ''))}"]`);
    return str(el?.textContent) || name.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  };
  return list.map((v) => {
    const options: Record<string, string> = {};
    for (const [k, val] of Object.entries(v.attributes ?? {})) options[label(k)] = str(val) || 'Any';
    return {
      name: Object.values(options).join(' / '),
      options,
      sku: str(v.sku),
      price: str(v.display_price),
      compare_at: v.display_regular_price && v.display_regular_price !== v.display_price ? str(v.display_regular_price) : '',
      available: v.is_in_stock === undefined ? undefined : !!v.is_in_stock,
      image: abs(str(v.image?.full_src ?? v.image?.src ?? v.image?.url), url),
      gtin: str(v.global_unique_id ?? v.gtin),
    };
  });
}

/** Shopify themes: the product JSON embedded in the page (prices are in cents there). */
function fromShopifyJson(doc: Document, url: string): Variant[] {
  for (const s of Array.from(doc.querySelectorAll('script[type="application/json"], script[data-product-json], script#ProductJson-product-template'))) {
    const text = s.textContent ?? '';
    if (!text.includes('"variants"')) continue;
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      continue;
    }
    const product = data?.variants ? data : data?.product?.variants ? data.product : null;
    if (!product || !Array.isArray(product.variants) || !product.variants.length || product.variants[0].price == null) continue;
    const names: string[] = (product.options ?? []).map((o: any) => (typeof o === 'string' ? o : o?.name)).filter(Boolean);
    const cents = typeof product.variants[0].price === 'number';
    const money = (n: any) => (n == null || n === '' ? '' : cents ? (Number(n) / 100).toFixed(2) : String(n));
    return product.variants.map((v: any) => {
      const options: Record<string, string> = {};
      [v.option1, v.option2, v.option3].forEach((val, i) => val && val !== 'Default Title' && (options[names[i] ?? `Option ${i + 1}`] = String(val)));
      return {
        name: v.title === 'Default Title' ? '' : str(v.title ?? v.name),
        options,
        sku: str(v.sku),
        price: money(v.price),
        compare_at: v.compare_at_price ? money(v.compare_at_price) : '',
        available: v.available,
        image: abs(str(v.featured_image?.src ?? v.featured_media?.preview_image?.src), url),
        gtin: str(v.barcode),
      };
    });
  }
  return [];
}

/** Every variant the product page publishes, from the richest source found. */
export function extractVariants(doc: Document, url: string): Variant[] {
  for (const read of [fromShopifyJson, fromWoo, fromSchema]) {
    const list = read(doc, url).filter((v) => v.name || v.sku || Object.keys(v.options).length);
    if (list.length > 1) return list.slice(0, 300);
  }
  return [];
}

/** Variants from Shopify's products.json feed (prices already in shop currency). */
export function shopifyFeedVariants(p: any): Variant[] {
  const imageById = new Map<number, string>((p.images ?? []).map((i: any) => [i.id, i.src]));
  const names: string[] = (p.options ?? []).map((o: any) => o?.name ?? o).filter(Boolean);
  const list = (p.variants ?? []).map((v: any): Variant => {
    const options: Record<string, string> = {};
    [v.option1, v.option2, v.option3].forEach((val: string, i: number) => val && val !== 'Default Title' && (options[names[i] ?? `Option ${i + 1}`] = String(val)));
    return {
      name: v.title === 'Default Title' ? '' : str(v.title),
      options,
      sku: str(v.sku),
      price: str(v.price),
      compare_at: str(v.compare_at_price),
      available: v.available,
      image: str(v.featured_image?.src ?? (v.image_id ? imageById.get(v.image_id) : '')),
      gtin: str(v.barcode),
    };
  });
  return list.length > 1 ? list : [];
}

/** Product rows keep their variants as JSON in this field (not shown as a column). */
export const VARIANTS_KEY = '_variants';

export const VARIANT_COLUMNS: [string, string][] = [
  ['variant', 'variant'],
  ['variant_options', 'variant options'],
  ['variant_sku', 'variant SKU'],
  ['variant_price', 'variant price'],
  ['variant_compare_at', 'variant compare-at price'],
  ['variant_available', 'variant in stock'],
  ['variant_image', 'variant image'],
  ['variant_gtin', 'variant barcode'],
];

/** One row per variant (products without variants stay as one row); drops the hidden JSON field. */
export function expandVariants(products: Product[]): Product[] {
  const out: Product[] = [];
  for (const p of products) {
    const { [VARIANTS_KEY]: raw, ...rest } = p;
    let list: Variant[] = [];
    try {
      list = raw ? JSON.parse(raw) : [];
    } catch {
      list = [];
    }
    if (!list.length) {
      out.push(rest);
      continue;
    }
    for (const v of list) {
      out.push({
        ...rest,
        variant: v.name || Object.values(v.options).join(' / '),
        variant_options: Object.entries(v.options).map(([k, val]) => `${k}: ${val}`).join('; '),
        variant_sku: v.sku ?? '',
        variant_price: v.price ?? '',
        variant_compare_at: v.compare_at ?? '',
        variant_available: v.available === undefined ? '' : v.available ? 'yes' : 'no',
        variant_image: v.image ?? '',
        variant_gtin: v.gtin ?? '',
      });
    }
  }
  return out;
}

/** Removes the hidden variants field from rows that are kept one per product. */
export const withoutVariantData = (products: Product[]) => products.map(({ [VARIANTS_KEY]: _v, ...rest }) => rest);
