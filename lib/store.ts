// Store-level scraping for any e-commerce site: platform detection, product feeds,
// product URLs from sitemaps, and product pages loaded the cheapest way that works.
import { shopifyFeedVariants, VARIANTS_KEY } from './variants';
import { crawlSitemaps, robotsSitemaps } from './sitemap';
import { extractProduct, isAmazon, isBlockedPage, type Product } from './product';
import { fetchCatalogue } from './shopify';
import { call, sleep, withBackgroundTab } from './tab';

export type Platform = 'shopify' | 'woocommerce' | 'amazon' | 'bigcommerce' | 'magento' | 'prestashop' | 'wix' | 'squarespace' | 'opencart' | 'custom';

export interface StoreInfo {
  origin: string;
  platform: Platform;
  /** The platform exposes a public product feed we can page through. */
  feed: boolean;
  name: string;
}

export const PLATFORM_NAMES: Record<Platform, string> = {
  shopify: 'Shopify', woocommerce: 'WooCommerce', amazon: 'Amazon', bigcommerce: 'BigCommerce', magento: 'Magento (Adobe Commerce)',
  prestashop: 'PrestaShop', wix: 'Wix', squarespace: 'Squarespace', opencart: 'OpenCart', custom: 'Custom store',
};

export class BlockedError extends Error {}

export function storeOrigin(input: string): string {
  const t = input.trim();
  return new URL(/^https?:\/\//i.test(t) ? t : 'https://' + t).origin;
}

async function getJson(url: string, signal?: AbortSignal): Promise<any | null> {
  try {
    const res = await fetch(url, { signal, credentials: 'include', headers: { Accept: 'application/json' } });
    if (!res.ok || !/json/i.test(res.headers.get('content-type') ?? '')) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function detectPlatform(input: string, signal?: AbortSignal): Promise<StoreInfo> {
  const origin = storeOrigin(input);
  const host = new URL(origin).hostname;
  const name = host.replace(/^www\./, '');
  if (isAmazon(origin)) return { origin, platform: 'amazon', feed: false, name };

  const shop = await getJson(`${origin}/products.json?limit=1`, signal);
  if (Array.isArray(shop?.products)) return { origin, platform: 'shopify', feed: true, name };
  const woo = await getJson(`${origin}/wp-json/wc/store/v1/products?per_page=1`, signal);
  if (Array.isArray(woo)) return { origin, platform: 'woocommerce', feed: true, name };

  let html = '';
  try {
    html = await (await fetch(origin, { signal, credentials: 'include' })).text();
  } catch {
    /* unreachable home page: still allow other methods */
  }
  const has = (re: RegExp) => re.test(html);
  const platform: Platform = has(/cdn\.shopify\.com|Shopify\.theme/) ? 'shopify'
    : has(/wp-content\/plugins\/woocommerce|woocommerce-/) ? 'woocommerce'
    : has(/cdn\d*\.bigcommerce\.com|BigCommerce/) ? 'bigcommerce'
    : has(/Magento_|mage\/cookies|x-magento/i) ? 'magento'
    : has(/prestashop/i) ? 'prestashop'
    : has(/static\.wixstatic\.com|wix-bolt/) ? 'wix'
    : has(/static1\.squarespace\.com|Squarespace/) ? 'squarespace'
    : has(/catalog\/view\/theme|route=product/) ? 'opencart'
    : 'custom';
  return { origin, platform, feed: false, name };
}

// ---------- Feeds ----------

interface FeedOpts {
  signal: AbortSignal;
  maxProducts: number;
  onProgress: (products: number, page: number) => void;
}

const strip = (html: string) => {
  const d = new DOMParser().parseFromString(html ?? '', 'text/html');
  return (d.body.textContent ?? '').replace(/\s+/g, ' ').trim();
};

export async function shopifyProducts(origin: string, opts: FeedOpts): Promise<{ products: Product[]; raw: any[] }> {
  const raw = await fetchCatalogue(origin, {
    signal: opts.signal,
    maxPages: Math.ceil(opts.maxProducts / 250),
    onPage: (page, n) => opts.onProgress(n, page),
  });
  const products = raw.slice(0, opts.maxProducts).map((p): Product => {
    const v = p.variants?.[0] ?? {};
    const prices = (p.variants ?? []).map((x: any) => parseFloat(x.price)).filter((n: number) => !isNaN(n));
    return {
      title: p.title ?? '',
      brand: p.vendor ?? '',
      price: prices.length ? String(Math.min(...prices)) : v.price ?? '',
      compare_at_price: v.compare_at_price ?? '',
      currency: '',
      availability: (p.variants ?? []).some((x: any) => x.available) ? 'in stock' : p.variants?.length ? 'out of stock' : '',
      sku: v.sku ?? '',
      gtin: v.barcode ?? '',
      category: p.product_type ?? '',
      variants: (p.variants ?? []).length > 1 ? p.variants.map((x: any) => `${x.title} / ${x.price}`).join(' | ') : '',
      image: p.images?.[0]?.src ?? '',
      images: (p.images ?? []).map((i: any) => i.src).join(' | '),
      description: strip(p.body_html).slice(0, 5000),
      url: `${origin}/products/${p.handle}`,
      source: 'shopify feed',
      ...(shopifyFeedVariants(p).length ? { [VARIANTS_KEY]: JSON.stringify(shopifyFeedVariants(p)) } : {}),
    };
  });
  return { products, raw: raw.slice(0, opts.maxProducts) };
}

export async function wooProducts(origin: string, opts: FeedOpts): Promise<Product[]> {
  const out: Product[] = [];
  for (let page = 1; out.length < opts.maxProducts && !opts.signal.aborted; page++) {
    const res = await fetch(`${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`, { signal: opts.signal, credentials: 'include' });
    if (res.status === 400 || res.status === 404) break; // past the last page
    if (!res.ok) throw new Error(`Store returned HTTP ${res.status}`);
    const items: any[] = await res.json();
    if (!items.length) break;
    for (const p of items) {
      const minor = p.prices?.currency_minor_unit ?? 2;
      const money = (v: any) => (v == null || v === '' ? '' : (parseInt(v, 10) / 10 ** minor).toFixed(minor));
      const onSale = p.prices?.sale_price && p.prices.sale_price !== p.prices.regular_price;
      out.push({
        title: strip(p.name),
        brand: (p.brands ?? []).map((b: any) => b.name).join(', '),
        price: money(p.prices?.price),
        compare_at_price: onSale ? money(p.prices.regular_price) : '',
        currency: p.prices?.currency_code ?? '',
        availability: p.is_in_stock ? 'in stock' : 'out of stock',
        sku: p.sku ?? '',
        rating: p.average_rating && p.average_rating !== '0' ? p.average_rating : '',
        review_count: p.review_count ? String(p.review_count) : '',
        category: (p.categories ?? []).map((c: any) => strip(c.name)).join(' > '),
        variants: (p.variations ?? []).length ? `${p.variations.length} variations` : '',
        image: p.images?.[0]?.src ?? '',
        images: (p.images ?? []).map((i: any) => i.src).join(' | '),
        description: strip(p.short_description || p.description).slice(0, 5000),
        url: p.permalink ?? '',
        source: 'woocommerce feed',
      });
    }
    opts.onProgress(out.length, page);
    await sleep(300);
  }
  return out.slice(0, opts.maxProducts);
}

// ---------- Sitemap ----------

const PRODUCT_PATH = /\/(products?|p|dp|item|items|detail|details|goods|shop\/[^/]+)\/|[-_/]p[-_]?\d{3,}|\/\d{5,}\.html$|-\d{5,}(\.html)?$|\/[^/]+\.html$/i;
const NOT_PRODUCT = /\/(blog|news|blogs|pages|collections?|category|categories|tag|tags|brand|brands|search|cart|account|login|help|faq|about|contact|policies|policy)(\/|$)/i;

export async function productUrlsFromSitemap(origin: string, opts: { signal: AbortSignal; max: number; onProgress: (files: number, urls: number) => void }): Promise<string[]> {
  let start = await robotsSitemaps(origin, opts.signal).catch(() => [] as string[]);
  if (!start.length) start = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/product-sitemap.xml`, `${origin}/sitemap_products_1.xml`];
  const result = await crawlSitemaps(start, { signal: opts.signal, maxUrls: 50000, onProgress: (f, u) => opts.onProgress(f, u) });
  const fromProductFiles = result.entries.filter((e) => /product|item|goods/i.test(e.sitemap)).map((e) => e.url);
  const urls = fromProductFiles.length ? fromProductFiles : result.entries.map((e) => e.url).filter((u) => PRODUCT_PATH.test(new URL(u).pathname) && !NOT_PRODUCT.test(new URL(u).pathname));
  return [...new Set(urls)].slice(0, opts.max);
}

// ---------- Product pages ----------

export type ProductLoad = 'auto' | 'fetch' | 'tab';

async function viaFetch(url: string, signal: AbortSignal): Promise<{ product: Product; weak: boolean }> {
  const res = await fetch(url, { signal, credentials: 'include', redirect: 'follow' });
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (res.status === 403 || res.status === 429 || res.status === 503 || isBlockedPage(doc)) throw new BlockedError(`blocked (HTTP ${res.status})`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const product = extractProduct(doc, res.url || url);
  // Little found usually means the page builds itself with JavaScript
  const weak = !product.title || (!product.price && !product.image);
  return { product, weak };
}

async function viaTab(url: string): Promise<Product> {
  return withBackgroundTab(url, async (tabId) => {
    const p = await call<Product>(tabId, 'fullProduct');
    if (p?.error?.includes('bot check')) throw new BlockedError(p.error);
    return p;
  }, isAmazon(url) ? 1800 : 1200);
}

/** Load one product page. "auto" tries the fast fetch first and opens a real tab only when needed. */
export async function productFromUrl(url: string, mode: ProductLoad, signal: AbortSignal): Promise<Product> {
  if (mode === 'tab' || (mode === 'auto' && isAmazon(url))) return viaTab(url);
  if (mode === 'fetch') return (await viaFetch(url, signal)).product;
  try {
    const { product, weak } = await viaFetch(url, signal);
    return weak ? { ...(await viaTab(url)), url } : product;
  } catch (e) {
    if (signal.aborted) throw e;
    return viaTab(url);
  }
}

/** Fetch with retries for transient failures (timeouts, 429, 5xx). */
export async function withRetry<T>(fn: () => Promise<T>, signal: AbortSignal, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (signal.aborted || e instanceof BlockedError) throw e;
      await sleep(800 * 2 ** i);
    }
  }
  throw last;
}
