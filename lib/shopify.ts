// Export a Shopify store's public catalogue (/products.json) in Shopify's product-import CSV layout.
import type { Column } from './db';
import { sleep } from './tab';

export const SHOPIFY_COLUMNS = [
  'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Type', 'Tags', 'Published',
  'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value', 'Option3 Name', 'Option3 Value',
  'Variant SKU', 'Variant Grams', 'Variant Inventory Tracker', 'Variant Inventory Policy', 'Variant Fulfillment Service',
  'Variant Price', 'Variant Compare At Price', 'Variant Requires Shipping', 'Variant Taxable', 'Variant Barcode',
  'Image Src', 'Image Position', 'Image Alt Text', 'Gift Card', 'Variant Image', 'Variant Weight Unit', 'Status',
  'Product URL',
];

export const shopifyColumns: Column[] = SHOPIFY_COLUMNS.map((c) => ({ key: c, label: c }));

export function storeOrigin(input: string): string {
  const u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : 'https://' + input.trim());
  return u.origin;
}

interface Opts {
  signal: AbortSignal;
  maxPages: number;
  onPage: (page: number, products: number) => void;
}

export async function fetchCatalogue(origin: string, opts: Opts): Promise<any[]> {
  const products: any[] = [];
  for (let page = 1; page <= opts.maxPages && !opts.signal.aborted; page++) {
    const res = await fetch(`${origin}/products.json?limit=250&page=${page}`, { signal: opts.signal });
    if (res.status === 404 && page === 1) throw new Error("This store doesn't expose /products.json. It may not be a Shopify store, or the feed is disabled.");
    if (res.status === 429) {
      await sleep(3000);
      page--;
      continue;
    }
    if (!res.ok) throw new Error(`Store returned HTTP ${res.status}`);
    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.products)) throw new Error("The store's response wasn't a Shopify product feed.");
    if (!data.products.length) break;
    products.push(...data.products);
    opts.onPage(page, products.length);
    await sleep(400);
  }
  return products;
}

/** One row per variant, plus extra rows for additional images, like Shopify's own export. */
export function toImportRows(products: any[], origin: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  for (const p of products) {
    const images: any[] = p.images ?? [];
    const imageById = new Map(images.map((i) => [i.id, i.src]));
    const options: any[] = p.options ?? [];
    const variants: any[] = p.variants?.length ? p.variants : [{}];
    variants.forEach((v, vi) => {
      const r: Record<string, string> = { Handle: p.handle };
      if (vi === 0) {
        Object.assign(r, {
          Title: p.title ?? '',
          'Body (HTML)': p.body_html ?? '',
          Vendor: p.vendor ?? '',
          Type: p.product_type ?? '',
          Tags: Array.isArray(p.tags) ? p.tags.join(', ') : p.tags ?? '',
          Published: p.published_at ? 'TRUE' : 'FALSE',
          'Gift Card': 'FALSE',
          Status: 'active',
          'Product URL': `${origin}/products/${p.handle}`,
          'Image Src': images[0]?.src ?? '',
          'Image Position': images[0] ? '1' : '',
          'Image Alt Text': images[0]?.alt ?? '',
        });
      }
      options.forEach((o, oi) => {
        if (oi > 2) return;
        if (vi === 0) r[`Option${oi + 1} Name`] = o.name ?? '';
        r[`Option${oi + 1} Value`] = v[`option${oi + 1}`] ?? '';
      });
      Object.assign(r, {
        'Variant SKU': v.sku ?? '',
        'Variant Grams': v.grams != null ? String(v.grams) : '',
        'Variant Inventory Tracker': 'shopify',
        'Variant Inventory Policy': 'deny',
        'Variant Fulfillment Service': 'manual',
        'Variant Price': v.price ?? '',
        'Variant Compare At Price': v.compare_at_price ?? '',
        'Variant Requires Shipping': v.requires_shipping === false ? 'FALSE' : 'TRUE',
        'Variant Taxable': v.taxable === false ? 'FALSE' : 'TRUE',
        'Variant Barcode': v.barcode ?? '',
        'Variant Image': v.featured_image?.src ?? (v.image_id ? imageById.get(v.image_id) ?? '' : ''),
        'Variant Weight Unit': 'g',
      });
      rows.push(r);
    });
    images.slice(1).forEach((img, i) => {
      rows.push({ Handle: p.handle, 'Image Src': img.src, 'Image Position': String(i + 2), 'Image Alt Text': img.alt ?? '' });
    });
  }
  return rows;
}
