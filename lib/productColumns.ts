// Which columns a product table gets, in what order, and the wholesale extras.
import type { Column } from './db';
import { FIELD_LABELS, wholesaleColumns } from './dom/fields';
import type { Product } from './product';

const ORDER = [
  'new_since_last_run', 'title', 'brand', 'price', 'compare_at_price', 'currency', '@prices', 'availability', 'stock_status', 'stock_qty',
  'sku', 'part_number', 'gtin', 'mpn', 'asin', 'moq', 'qty_per_box', 'box', 'qty_per_carton', 'carton', 'box_price',
  'rating', 'review_count', 'category', 'variants', 'variant', 'variant_options', 'variant_sku', 'variant_price', 'variant_compare_at', 'variant_available', 'variant_image', 'variant_gtin', 'weight', 'volume', 'origin', 'expiry', 'image', 'images', 'description',
  '@attrs', 'url', 'source', 'error',
];

const BASE_LABELS: Record<string, string> = {
  title: 'title', brand: 'brand', price: 'price', compare_at_price: 'compare-at price', currency: 'currency',
  availability: 'availability', mpn: 'mpn', asin: 'asin', rating: 'rating', review_count: 'reviews', category: 'category',
  new_since_last_run: 'new since last run', variants: 'variants', variant: 'variant', variant_options: 'variant options', variant_sku: 'variant SKU', variant_price: 'variant price',
  variant_compare_at: 'variant compare-at price', variant_available: 'variant in stock', variant_image: 'variant image', variant_gtin: 'variant barcode',
  image: 'image', images: 'all images', description: 'description', url: 'url', source: 'found via', error: 'error',
};

export function productColumnLabel(key: string): string {
  if (BASE_LABELS[key]) return BASE_LABELS[key];
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  if (key.startsWith('price_')) return `price (${key.slice(6)})`;
  if (key.startsWith('attr_')) return key.slice(5).replace(/_/g, ' ');
  return key.replace(/_/g, ' ');
}

/** Share of products with a value for `key`. */
const fill = (products: Product[], key: string) => products.filter((p) => p[key]).length / Math.max(1, products.length);

export interface ColumnOptions {
  /** Keys chosen in the column planner; everything else is left out. */
  only?: string[];
  /** Extra "label: value" columns need at least this share of products (default 0.3). */
  attrThreshold?: number;
}

/** Columns for these products: standard ones first, then any extra details found often enough. */
export function productColumns(products: Product[], opts: ColumnOptions = {}): Column[] {
  const present = new Set<string>();
  for (const p of products) for (const [k, v] of Object.entries(p)) if (v) present.add(k);
  const prices = [...present].filter((k) => k.startsWith('price_')).sort();
  const attrs = [...present]
    .filter((k) => k.startsWith('attr_') && fill(products, k) >= (opts.attrThreshold ?? 0.3))
    .sort((a, b) => fill(products, b) - fill(products, a))
    .slice(0, 15);
  const keys: string[] = [];
  for (const k of ORDER) {
    if (k === '@prices') keys.push(...prices);
    else if (k === '@attrs') keys.push(...attrs);
    else if (present.has(k)) keys.push(k);
  }
  const chosen = opts.only ? keys.filter((k) => opts.only!.includes(k) || k === 'error') : keys;
  return chosen.map((key) => ({ key, label: productColumnLabel(key) }));
}

/** True when the products carry wholesale details (MOQ, box or carton quantities). */
export function looksWholesale(products: Product[]) {
  return products.some((p) => p.moq || p.qty_per_box || p.qty_per_carton);
}

/** Add "1 box = 48 ea", "1 carton = 240 ea" and the price of a full box to each product. */
export function addWholesale(products: Product[]): Product[] {
  return products.map((p) => {
    const unit = p.price || Object.entries(p).find(([k, v]) => k.startsWith('price_') && v)?.[1] || '';
    return { ...p, ...wholesaleColumns(p, unit) };
  });
}
