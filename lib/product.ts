// Product extraction that works on any store's product page, live or fetched.
// Order of trust: JSON-LD > microdata > Open Graph > known store layouts (Amazon) > page heuristics.
import { extractVariants, VARIANTS_KEY } from './variants';
import { jsonLd } from './dom/doc';
import { safeQueryAll } from './dom/selector';
import { blockText, pricesByCurrency, readDetails } from './dom/fields';

export type Product = Record<string, string>;

/** Standard column order for product data. */
export const PRODUCT_FIELDS = [
  'title', 'brand', 'price', 'compare_at_price', 'currency', 'availability', 'sku', 'gtin', 'mpn', 'asin',
  'rating', 'review_count', 'category', 'variants', 'image', 'images', 'description', 'url', 'source',
] as const;

const PRODUCT_LABELS: Record<string, string> = {
  title: 'title', brand: 'brand', price: 'price', compare_at_price: 'compare-at price', currency: 'currency',
  availability: 'availability', sku: 'sku', gtin: 'barcode (gtin)', mpn: 'mpn', asin: 'asin', rating: 'rating',
  review_count: 'reviews', category: 'category', variants: 'variants', image: 'image', images: 'all images',
  description: 'description', url: 'url', source: 'found via',
};
export const productLabel = (k: string) => PRODUCT_LABELS[k] ?? k.replace(/_/g, ' ');

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const first = (v: any) => (Array.isArray(v) ? v[0] : v);
const str = (v: any): string => {
  v = first(v);
  if (v == null) return '';
  if (typeof v === 'object') return clean(v.name ?? v['@id'] ?? v.url ?? v.value ?? '');
  return clean(v);
};
const abs = (u: string, base: string) => {
  try {
    return u ? new URL(u, base).href : '';
  } catch {
    return '';
  }
};
const isType = (n: any, t: string) => [].concat(n?.['@type'] ?? []).some((x: string) => String(x).toLowerCase() === t);

export const CURRENCY_SYMBOL: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₩': 'KRW', '₹': 'INR', '₱': 'PHP', '₫': 'VND', '฿': 'THB', 'R$': 'BRL', 'A$': 'AUD', 'C$': 'CAD', 'zł': 'PLN', '₺': 'TRY', '₽': 'RUB' };
// An amount: "12,000" / "1.234,56" (with thousands groups) or "9500" / "19.99" (without).
// Whole numbers only: never stop part-way through the digits, so "9500" can't read as "950".
const AMOUNT = String.raw`(?<![\d.,])(\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?!\d)`;
const PRICE_RE = new RegExp(
  String.raw`(R\$|A\$|C\$|US\$|[$€£¥₩₹₱₫฿₺₽]|zł|\b(?:USD|EUR|GBP|KRW|JPY|CAD|AUD|INR)(?![A-Za-z]))\s?${AMOUNT}|${AMOUNT}\s?(€|zł|kr|₫|\b(?:USD|EUR|GBP|KRW|JPY)\b)`,
);

/** "1.234,56 €" -> { amount: "1234.56", currency: "EUR" } */
export function parsePrice(text: string): { amount: string; currency: string } | null {
  const m = clean(text).match(PRICE_RE);
  if (!m) return null;
  const sym = (m[1] ?? m[4] ?? '').replace('US$', '$');
  let num = (m[2] ?? m[3] ?? '').replace(/\s/g, '');
  // Decide which separator is the decimal point
  const lastComma = num.lastIndexOf(',');
  const lastDot = num.lastIndexOf('.');
  if (lastComma > lastDot) num = /,\d{1,2}$/.test(num) ? num.replace(/\./g, '').replace(',', '.') : num.replace(/,/g, '');
  else num = num.replace(/,/g, '');
  const currency = CURRENCY_SYMBOL[sym] ?? (/^[A-Z]{3}$/.test(sym) ? sym : sym === 'kr' ? 'SEK' : '');
  return num ? { amount: num, currency } : null;
}

function normalizeAvailability(v: string): string {
  const s = v.replace(/^https?:\/\/schema\.org\//i, '').toLowerCase();
  if (/instock|in stock|available|in_stock/.test(s) && !/unavailable|not available/.test(s)) return 'in stock';
  if (/outofstock|out of stock|sold ?out|unavailable|out_of_stock|currently unavailable/.test(s)) return 'out of stock';
  if (/preorder|pre-order/.test(s)) return 'preorder';
  if (/backorder/.test(s)) return 'backorder';
  if (/limited/.test(s)) return 'limited stock';
  return clean(v).slice(0, 60);
}

function imageList(v: any, base: string): string[] {
  const arr = Array.isArray(v) ? v : v ? [v] : [];
  return arr.map((x) => abs(typeof x === 'object' ? x.url ?? x.contentUrl ?? x['@id'] ?? '' : String(x), base)).filter(Boolean);
}

function fromJsonLd(doc: Document, url: string): Product {
  const nodes = jsonLd(doc);
  const group = nodes.find((n) => isType(n, 'productgroup'));
  const p = nodes.find((n) => isType(n, 'product')) ?? group;
  if (!p) return {};
  const offersRaw = p.offers ?? group?.hasVariant?.map((v: any) => v.offers).flat();
  const offers: any[] = [].concat(offersRaw?.offers ?? offersRaw ?? []).filter(Boolean);
  const offer = offers[0] ?? {};
  const prices = offers.map((o) => parseFloat(o.price ?? o.lowPrice)).filter((n) => !isNaN(n));
  const low = offer.lowPrice ?? (prices.length ? Math.min(...prices) : undefined);
  const variants: any[] = group?.hasVariant ?? p.hasVariant ?? [];
  const crumbs = nodes.find((n) => isType(n, 'breadcrumblist'));
  const list: any[] = crumbs?.itemListElement ?? [];
  const category = list.length ? list.map((i) => str(i.name ?? i.item?.name)).filter(Boolean).slice(0, -1).join(' > ') : str(p.category);
  const images = imageList(p.image, url);
  const spec = offer.priceSpecification;
  return {
    title: str(p.name),
    brand: str(p.brand),
    price: str(offer.price ?? low ?? spec?.price),
    compare_at_price: str(([] as any[]).concat(spec ?? []).find((s: any) => /list|strikethrough|msrp/i.test(str(s.priceType)))?.price),
    currency: str(offer.priceCurrency ?? spec?.priceCurrency),
    availability: normalizeAvailability(str(offer.availability)),
    sku: str(p.sku ?? offer.sku),
    gtin: str(p.gtin13 ?? p.gtin ?? p.gtin12 ?? p.gtin14 ?? p.gtin8 ?? offer.gtin13 ?? offer.gtin),
    mpn: str(p.mpn),
    rating: str(p.aggregateRating?.ratingValue),
    review_count: str(p.aggregateRating?.reviewCount ?? p.aggregateRating?.ratingCount),
    category,
    variants: variants.length ? variants.map((v) => [str(v.name), str(v.sku), str(first(v.offers)?.price)].filter(Boolean).join(' / ')).join(' | ') : offers.length > 1 ? `${offers.length} offers` : '',
    image: images[0] ?? '',
    images: images.join(' | '),
    description: clean(str(p.description)).slice(0, 5000),
    source: 'structured data',
  };
}

function fromMicrodata(doc: Document, url: string): Product {
  const scope = doc.querySelector('[itemtype*="schema.org/Product" i]');
  if (!scope) return {};
  const prop = (name: string) => {
    const el = scope.querySelector(`[itemprop="${name}"]`);
    if (!el) return '';
    return clean(el.getAttribute('content') ?? el.getAttribute('href') ?? el.getAttribute('src') ?? el.textContent);
  };
  return {
    title: prop('name'),
    brand: prop('brand'),
    price: prop('price') || prop('lowPrice'),
    currency: prop('priceCurrency'),
    availability: normalizeAvailability(prop('availability')),
    sku: prop('sku'),
    gtin: prop('gtin13') || prop('gtin'),
    mpn: prop('mpn'),
    rating: prop('ratingValue'),
    review_count: prop('reviewCount') || prop('ratingCount'),
    image: abs(prop('image'), url),
    description: prop('description').slice(0, 5000),
    source: 'microdata',
  };
}

function meta(doc: Document, ...names: string[]) {
  for (const n of names) {
    const v = clean(doc.querySelector(`meta[property="${n}"], meta[name="${n}"]`)?.getAttribute('content'));
    if (v) return v;
  }
  return '';
}

function fromOpenGraph(doc: Document, url: string): Product {
  const images = safeQueryAll(doc, 'meta[property="og:image"], meta[property="og:image:secure_url"]').map((m) => abs(m.getAttribute('content') ?? '', url));
  return {
    title: meta(doc, 'og:title', 'twitter:title'),
    brand: meta(doc, 'product:brand', 'og:brand'),
    price: meta(doc, 'product:price:amount', 'og:price:amount', 'product:sale_price:amount'),
    compare_at_price: meta(doc, 'product:original_price:amount'),
    currency: meta(doc, 'product:price:currency', 'og:price:currency'),
    availability: normalizeAvailability(meta(doc, 'product:availability', 'og:availability')),
    sku: meta(doc, 'product:retailer_item_id'),
    gtin: meta(doc, 'product:upc', 'product:ean'),
    image: images[0] ?? '',
    images: [...new Set(images)].join(' | '),
    description: meta(doc, 'og:description', 'description'),
    source: 'open graph',
  };
}

/** Amazon product pages (any marketplace). */
function fromAmazon(doc: Document, url: string): Product {
  const t = (sel: string) => clean(doc.querySelector(sel)?.textContent);
  const asin = url.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/)?.[1] ?? (doc.querySelector('#ASIN') as HTMLInputElement | null)?.value ?? '';
  const priceText =
    t('#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen') ||
    t('#corePrice_feature_div .a-offscreen') ||
    t('#corePriceDisplay_desktop_feature_div .a-price .a-offscreen') ||
    t('#price_inside_buybox') ||
    t('#priceblock_ourprice') ||
    t('.a-price .a-offscreen');
  const listText = t('#corePriceDisplay_desktop_feature_div .basisPrice .a-offscreen') || t('.a-text-price[data-a-strike] .a-offscreen');
  const price = parsePrice(priceText);
  const list = parsePrice(listText);
  const img = doc.querySelector('#landingImage, #imgBlkFront, #main-image') as HTMLImageElement | null;
  let images: string[] = [];
  try {
    images = Object.keys(JSON.parse(img?.getAttribute('data-a-dynamic-image') ?? '{}'));
  } catch {
    /* no dynamic image map */
  }
  const hires = img?.getAttribute('data-old-hires') || images[images.length - 1] || img?.getAttribute('src') || '';
  // Larger gallery images are listed in an inline script as "hiRes":"https://..."
  const scripts = safeQueryAll(doc, 'script').map((s) => s.textContent ?? '').join('\n');
  const gallery = [...scripts.matchAll(/"hiRes":"(https:[^"]+)"/g)].map((m) => m[1]);
  const all = [...new Set([hires, ...gallery].filter(Boolean))];
  const bullets = safeQueryAll(doc, '#feature-bullets li span.a-list-item').map((e) => clean(e.textContent)).filter(Boolean);
  const ratingText = clean(doc.querySelector('#acrPopover')?.getAttribute('title')) || t('#acrPopover .a-icon-alt');
  return {
    title: t('#productTitle'),
    brand: t('#bylineInfo').replace(/^(visit the|brand:)\s*/i, '').replace(/\s*store$/i, ''),
    price: price?.amount ?? '',
    compare_at_price: list?.amount ?? '',
    currency: price?.currency ?? '',
    availability: normalizeAvailability(t('#availability')),
    asin,
    sku: asin,
    rating: ratingText.match(/[\d.,]+/)?.[0]?.replace(',', '.') ?? '',
    review_count: t('#acrCustomerReviewText').replace(/[^\d]/g, ''),
    category: safeQueryAll(doc, '#wayfinding-breadcrumbs_feature_div li a').map((a) => clean(a.textContent)).join(' > '),
    image: all[0] ?? '',
    images: all.join(' | '),
    description: (bullets.join(' • ') || t('#productDescription')).slice(0, 5000),
    source: 'amazon page',
  };
}

const PRICE_HINT = '[itemprop="price"], [class*="price" i], [id*="price" i], [data-price], [class*="Price"]';

/** Last resort: read the page layout like a person would. */
function fromHeuristics(doc: Document, url: string): Product {
  const title = clean(doc.querySelector('h1')?.textContent) || clean(doc.title.split(/\s[|–-]\s/)[0]);
  let price: ReturnType<typeof parsePrice> = null;
  let compare: ReturnType<typeof parsePrice> = null;
  for (const el of safeQueryAll(doc, PRICE_HINT)) {
    if (el.closest('del, s, strike, [class*="old-price" i], [class*="price-old" i], [class*="was-price" i], [class*="compare" i], [class*="regular-price" i], [class*="original" i], [class*="strike" i], [class*="list-price" i]')) {
      compare ??= parsePrice(el.textContent ?? '');
      continue;
    }
    if (el.closest('header, footer, nav, [class*="cart" i], [class*="related" i], [class*="recommend" i]')) continue;
    const p = parsePrice(el.getAttribute('content') ? `${el.getAttribute('content')} ${doc.querySelector('[itemprop="priceCurrency"]')?.getAttribute('content') ?? ''}` : el.textContent ?? '');
    if (p) {
      price = p;
      break;
    }
  }
  // Look for images near the product title first, so related products don't leak in
  const h1 = doc.querySelector('h1');
  let root: Element | Document = doc;
  for (let el = h1?.parentElement; el && el !== doc.body; el = el.parentElement) {
    if (el.querySelector('img')) {
      root = el;
      break;
    }
  }
  const scoped = root === doc ? [] : safeQueryAll(root as Element, 'img');
  const imgs = (scoped.length ? scoped : safeQueryAll(doc, '[class*="gallery" i] img, [class*="product" i] img, [class*="zoom" i] img, [id*="product" i] img, main img'))
    .filter((i) => !i.closest('[class*="related" i], [class*="recommend" i], [class*="upsell" i], [class*="cross-sell" i], [class*="similar" i], aside, footer, nav'))
    .map((i) => abs(i.getAttribute('data-zoom-image') || i.getAttribute('data-large') || i.getAttribute('data-src') || i.getAttribute('src') || '', url))
    .filter((s) => s && !/sprite|logo|icon|placeholder|blank|loading|pixel/i.test(s));
  const desc = doc.querySelector('[class*="description" i], [id*="description" i], [itemprop="description"]');
  const brand = doc.querySelector('[class*="brand" i]:not(body):not(html)');
  const text = clean(doc.body?.textContent).slice(0, 20000);
  return {
    title,
    brand: clean(brand?.textContent).slice(0, 80),
    price: price?.amount ?? '',
    compare_at_price: compare && price && parseFloat(compare.amount) > parseFloat(price.amount) ? compare.amount : '',
    currency: price?.currency ?? '',
    availability: /out of stock|sold out/i.test(text) ? 'out of stock' : /in stock|add to (cart|bag|basket)/i.test(text) ? 'in stock' : '',
    sku: text.match(/\b(?:SKU|Item (?:No|number)|Product code|Model)[.:#\s]+([A-Z0-9][A-Z0-9-_.]{2,30})/i)?.[1] ?? '',
    gtin: text.match(/\b(?:EAN|UPC|GTIN|Bar ?code|JAN)[.:#\s]+(\d{8,14})\b/i)?.[1] ?? '',
    image: imgs[0] ?? '',
    images: [...new Set(imgs)].slice(0, 20).join(' | '),
    description: clean(desc?.textContent).slice(0, 5000) || meta(doc, 'description'),
    source: 'page layout',
  };
}

/** Fill gaps in `base` from each next source, without overwriting values already found. */
function merge(...parts: Product[]): Product {
  const out: Product = {};
  const sources: string[] = [];
  for (const p of parts) {
    let used = false;
    for (const [k, v] of Object.entries(p)) {
      if (k === 'source' || !v) continue;
      if (!out[k]) ((out[k] = v), (used = true));
    }
    if (used && p.source) sources.push(p.source);
  }
  out.source = sources.join(', ');
  return out;
}

export function isAmazon(url: string) {
  return /(^|\.)amazon\.[a-z.]+$/i.test(new URL(url).hostname);
}

/** True when the page is a bot check rather than the real page. */
export function isBlockedPage(doc: Document): boolean {
  const t = doc.title.toLowerCase();
  return (
    /robot check|captcha|are you a human|access denied|attention required|just a moment|verify you are human|pardon our interruption/.test(t) ||
    !!doc.querySelector('form[action*="validateCaptcha"], #captchacharacters, iframe[src*="captcha"], #challenge-form, .cf-browser-verification')
  );
}

/** Everything we can find about the product on this page. */
export function extractProduct(doc: Document, url: string): Product {
  if (isBlockedPage(doc)) return { url, error: 'The site showed a bot check (CAPTCHA) instead of the page' };
  const parts = [fromJsonLd(doc, url), fromMicrodata(doc, url)];
  if (isAmazon(url)) parts.unshift(fromAmazon(doc, url));
  parts.push(fromOpenGraph(doc, url), fromHeuristics(doc, url));
  const p = merge(...parts);
  if (p.currency && /^[^A-Z]/.test(p.currency)) p.currency = CURRENCY_SYMBOL[p.currency] ?? p.currency;
  if (p.price) p.price = parsePrice(`$${p.price}`)?.amount ?? p.price;

  // Details from the product's own area: SKU, PartNum, stock, MOQ, box quantities, other currencies
  if (!isAmazon(url)) {
    const area = productArea(doc);
    const text = blockText(area);
    const { fields } = readDetails(area, text);
    for (const [k, v] of Object.entries(fields)) if (v && !p[k]) p[k] = v;
    if (fields.stock_status && !p.availability) p.availability = fields.stock_status;
    const prices = pricesByCurrency(text.split(/\n+/).slice(0, 80));
    if (Object.keys(prices).length > 1) Object.assign(p, prices);
  }
  // Every variant with its own price, SKU and picture, for "one row per variant"
  const variants = extractVariants(doc, url);
  if (variants.length) {
    p[VARIANTS_KEY] = JSON.stringify(variants);
    if (!p.variants) p.variants = variants.map((v) => [v.name || Object.values(v.options).join(' / '), v.price].filter(Boolean).join(' / ')).join(' | ');
  }
  p.url = url;
  return p;
}

/** The part of the page about this product: the nearest block around the title that has details. */
function productArea(doc: Document): Element {
  const h1 = doc.querySelector('h1');
  for (let el = h1?.parentElement; el && el !== doc.body; el = el.parentElement) {
    const len = (el.textContent ?? '').length;
    if (len > 300 && len < 20000) return el;
  }
  return doc.querySelector('main, [role="main"], #content, .product') ?? doc.body;
}

// ---------- Shopify import layout for any store ----------

/** Convert standard product rows to Shopify's product-import CSV columns. */
export function toShopifyRows(products: Product[]): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const used = new Set<string>();
  for (const p of products) {
    if (!p.title) continue;
    let handle = p.title.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'product';
    let n = 2;
    const base = handle;
    while (used.has(handle)) handle = `${base}-${n++}`;
    used.add(handle);
    const images = (p.images || p.image || '').split(' | ').filter(Boolean);
    rows.push({
      Handle: handle,
      Title: p.title,
      'Body (HTML)': p.description ? `<p>${p.description.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!)}</p>` : '',
      Vendor: p.brand ?? '',
      Type: (p.category ?? '').split(' > ').pop() ?? '',
      Tags: p.category ? p.category.split(' > ').join(', ') : '',
      Published: 'TRUE',
      'Option1 Name': 'Title',
      'Option1 Value': 'Default Title',
      'Variant SKU': p.sku ?? '',
      'Variant Inventory Tracker': 'shopify',
      'Variant Inventory Policy': 'deny',
      'Variant Fulfillment Service': 'manual',
      'Variant Price': p.price ?? '',
      'Variant Compare At Price': p.compare_at_price ?? '',
      'Variant Requires Shipping': 'TRUE',
      'Variant Taxable': 'TRUE',
      'Variant Barcode': p.gtin ?? '',
      'Image Src': images[0] ?? '',
      'Image Position': images[0] ? '1' : '',
      'Gift Card': 'FALSE',
      'Variant Weight Unit': 'g',
      Status: 'draft',
      'Product URL': p.url ?? '',
    });
    images.slice(1).forEach((src, i) => rows.push({ Handle: handle, 'Image Src': src, 'Image Position': String(i + 2) }));
  }
  return rows;
}
