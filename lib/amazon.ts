// Amazon product pages, read the way Amazon lays them out: prices only from the buy box (never from
// carousels, comparison tables or other sellers' widgets), the full product-details tables (UPC,
// model, manufacturer, Best Sellers Rank, item form...), variants from the twister data, the
// gallery of the shown variant in order, seller and fulfilment, and Amazon's error pages.
import type { Product } from './product';
import type { Variant } from './variants';

const clean = (s: unknown) => String(s ?? '').replace(/[‎‏‪-‮]/g, '').replace(/\s+/g, ' ').trim();
const q = (doc: Document | Element, sel: string) => doc.querySelector(sel);
const qa = (doc: Document | Element, sel: string) => Array.from(doc.querySelectorAll(sel));

/** Text without scripts and styles (Amazon puts inline JSON inside some blocks). */
export function plainText(el: Element | null | undefined): string {
  if (!el) return '';
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('script, style, noscript').forEach((n) => n.remove());
  return clean(copy.textContent);
}

const CURRENCY: Record<string, string> = { $: 'USD', '£': 'GBP', '€': 'EUR', '¥': 'JPY', '₹': 'INR', 'C$': 'CAD', 'A$': 'AUD', 'R$': 'BRL', 'S$': 'SGD', 'MX$': 'MXN', 'AED': 'AED' };
/** "$1,299.99" / "1.299,99 €" / "￥1,280" into amount and currency. */
export function amazonMoney(text: string): { amount: string; currency: string } | null {
  const t = clean(text);
  const m = t.match(/(MX\$|C\$|A\$|R\$|S\$|AED|SAR|[$£€¥₹￥])?\s?(\d[\d.,\s]*\d|\d)\s?(€|AED|SAR)?/);
  if (!m) return null;
  let n = m[2].replace(/\s/g, '');
  // 1.299,99 (European) vs 1,299.99
  if (/,\d{2}$/.test(n) && !/\.\d{2}$/.test(n)) n = n.replace(/\./g, '').replace(',', '.');
  else n = n.replace(/,/g, '');
  const sym = (m[1] ?? m[3] ?? '').replace('￥', '¥');
  return { amount: String(Number(n)), currency: CURRENCY[sym] ?? sym };
}

/** The buy box: the only place a product's own price lives. */
const BUY_BOX = '#corePriceDisplay_desktop_feature_div, #corePrice_desktop, #corePrice_feature_div, #apex_desktop, #apex_offerDisplay_desktop, #buybox, #price';

export function isAmazonErrorPage(doc: Document): 'not found' | 'error' | null {
  const title = clean(doc.title);
  if (/^page not found/i.test(title) || q(doc, 'img[alt*="Dogs of Amazon" i], a[href*="/ref=cs_404_logo"]')) return 'not found';
  if (/sorry! something went wrong/i.test(title) || /sorry! something went wrong/i.test(clean(q(doc, 'h1, h4')?.textContent))) return 'error';
  return null;
}

/** Label → value pairs from every product-details table Amazon uses. */
export function amazonDetails(doc: Document): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (label: string, value: string) => {
    const l = clean(label).replace(/\s*:\s*$/, '');
    const v = clean(value);
    if (!l || !v || l.length > 60 || /customer reviews/i.test(l) || out[l]) return;
    out[l] = v.slice(0, 500);
  };
  for (const tr of qa(doc, 'table.voyager-ns-desktop-table tr, #productDetails_techSpec_section_1 tr, #productDetails_techSpec_section_2 tr, #productDetails_detailBullets_sections1 tr, #prodDetails table tr, #productOverview_feature_div tr, #technicalSpecifications_section_1 tr')) {
    const th = tr.querySelector('th, td.a-span3, .voyager-ns-desktop-table-label');
    const td = th ? (th.nextElementSibling ?? tr.querySelector('td:last-child, .voyager-ns-desktop-table-value')) : null;
    if (th && td && th !== td) put(plainText(th), plainText(td));
  }
  for (const li of qa(doc, '#detailBullets_feature_div li .a-list-item, #detailBulletsWrapper_feature_div li .a-list-item')) {
    const label = plainText(li.querySelector('.a-text-bold'));
    if (!label) continue;
    put(label, plainText(li).slice(label.length));
  }
  // Books
  for (const c of qa(doc, '#rpi-attribute-values .rpi-attribute-content, [id^="rpi-attribute-"]')) {
    const label = plainText(c.querySelector('.rpi-attribute-label'));
    const value = plainText(c.querySelector('.rpi-attribute-value'));
    if (label && value) put(label, value);
  }
  return out;
}

const pick = (d: Record<string, string>, re: RegExp) => Object.entries(d).find(([k]) => re.test(k))?.[1] ?? '';

/** The gallery of the variant shown: hi-res pictures in order (large when there is no hi-res). */
export function amazonGallery(doc: Document): string[] {
  const scripts = qa(doc, 'script').map((s) => s.textContent ?? '');
  for (const s of scripts) {
    // 'colorImages': { 'initial': A.$.parseJSON('[...]') } or a plain array literal
    const m = s.match(/'initial'\s*:\s*A\.\$\.parseJSON\('((?:\\'|[^'])*)'\)/) ?? s.match(/'colorImages'\s*:\s*\{\s*'initial'\s*:\s*(\[[\s\S]*?\])\s*\}\s*[,;]/);
    if (!m) continue;
    try {
      const list = JSON.parse(m[1].replace(/\\'/g, "'")) as { hiRes?: string | null; large?: string }[];
      const urls = list.map((x) => x.hiRes || x.large || '').filter(Boolean);
      if (urls.length) return [...new Set(urls)];
    } catch {
      /* unexpected format */
    }
  }
  const img = q(doc, '#landingImage, #imgBlkFront, #main-image') as HTMLImageElement | null;
  let dyn: string[] = [];
  try {
    dyn = Object.keys(JSON.parse(img?.getAttribute('data-a-dynamic-image') ?? '{}'));
  } catch {
    /* none */
  }
  return [...new Set([img?.getAttribute('data-old-hires') || dyn[dyn.length - 1] || img?.getAttribute('src') || ''].filter(Boolean))];
}

/** A JSON value that follows `"key" :` in Amazon's inline scripts. */
function scriptJson(doc: Document, key: string): any {
  const re = new RegExp(`"${key}"\\s*:\\s*`);
  for (const s of qa(doc, 'script')) {
    const text = s.textContent ?? '';
    const m = re.exec(text);
    if (!m) continue;
    // Read one balanced JSON value from there
    const start = m.index + m[0].length;
    const open = text[start];
    if (open !== '{' && open !== '[' && open !== '"') continue;
    if (open === '"') return JSON.parse(text.slice(start, text.indexOf('"', start + 1) + 1));
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (c === '\\') i++;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close && --depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  return undefined;
}

/** Every child product (colour, size...) with its option values, link and picture. */
export function amazonVariants(doc: Document, url: string): Variant[] {
  const values = scriptJson(doc, 'dimensionValuesDisplayData') as Record<string, string[]> | undefined;
  if (!values || Object.keys(values).length < 2) return [];
  const dims = (scriptJson(doc, 'dimensions') as string[] | undefined) ?? [];
  const labels = (scriptJson(doc, 'variationDisplayLabels') as Record<string, string> | undefined) ?? {};
  const pictures = (scriptJson(doc, 'colorImages') as Record<string, { hiRes?: string | null; large?: string }[]> | undefined) ?? {};
  const current = (scriptJson(doc, 'currentAsin') as string | undefined) ?? url.match(/\/dp\/([A-Z0-9]{10})/)?.[1] ?? '';
  const origin = (() => {
    try {
      return new URL(url).origin;
    } catch {
      return 'https://www.amazon.com';
    }
  })();
  // Swatch prices shown on the page, by child ASIN
  const swatchPrice: Record<string, string> = {};
  for (const li of qa(doc, '#twister [data-asin], [id^="inline-twister-row"] [data-asin], #twister li[data-defaultasin], [id^="inline-twister-row"] li[data-defaultasin]')) {
    const asin = li.getAttribute('data-asin') || li.getAttribute('data-defaultasin') || '';
    const p = amazonMoney(plainText(li.querySelector('.a-price .a-offscreen, .twisterSwatchPrice, .a-color-price')));
    if (asin && p) swatchPrice[asin] = p.amount;
  }
  // Keys keep the page's escaped slashes ("Black\/Grey"); match them against plain values
  const byName = new Map(Object.entries(pictures).map(([k, v]) => [k.replace(/\\\//g, '/'), v]));
  const keys = [...byName.keys()];
  const pictureFor = (vals: string[]) => {
    const key = keys.filter((k) => vals.filter((v) => k.includes(v)).join(' ') === k).sort((a, b) => b.length - a.length)[0];
    const first = key ? byName.get(key)?.[0] : undefined;
    return first?.hiRes || first?.large || '';
  };
  const ownPrice = amazonMoney(plainText(q(doc, `${BUY_BOX.split(',')[0]} .priceToPay .a-offscreen`)))?.amount ?? '';
  return Object.entries(values)
    .map(([asin, vals]): Variant => {
      const options: Record<string, string> = {};
      vals.forEach((v, i) => (options[labels[dims[i]] ?? dims[i]?.replace(/_name$/, '').replace(/_/g, ' ') ?? `Option ${i + 1}`] = v));
      return {
        name: vals.join(' / '),
        options,
        sku: asin,
        price: asin === current ? ownPrice : swatchPrice[asin] ?? '',
        image: pictureFor(vals),
        url: `${origin}/dp/${asin}`,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** Everything about an Amazon product from its page. */
export function amazonProduct(doc: Document, url: string): Product {
  const err = isAmazonErrorPage(doc);
  if (err === 'not found') return { url, error: 'Page not found (the product link is dead)' };
  if (err === 'error') return { url, error: "Amazon showed its \"Something went wrong\" page (it's busy or limiting requests)" };
  const t = (sel: string) => plainText(q(doc, sel));
  const asin = url.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/)?.[1] ?? (q(doc, '#ASIN, input[name="ASIN"]') as HTMLInputElement | null)?.value ?? '';
  if (!t('#productTitle') && !t('#title')) return { url, asin, error: "This isn't a product page (no product title)" };

  // Availability, without the inline script Amazon puts in the block
  const availabilityText = t('#availability span') || t('#availability') || t('#outOfStock');
  const unavailable = !!q(doc, '#outOfStock') || /currently unavailable|out of stock|no disponible|nicht verfügbar|en rupture/i.test(availabilityText);

  // Price: only inside the buy box; none when the product can't be bought
  const box = BUY_BOX.split(',').map((s) => q(doc, s.trim())).filter(Boolean) as Element[];
  const inBox = (sel: string) => {
    for (const b of box) {
      const v = plainText(b.querySelector(sel));
      if (v) return v;
    }
    return '';
  };
  const price = unavailable ? null : amazonMoney(inBox('.priceToPay .a-offscreen') || inBox('.apexPriceToPay .a-offscreen') || inBox('.a-price:not(.a-text-price) .a-offscreen') || t('#price_inside_buybox') || t('#priceblock_ourprice') || t('#priceblock_dealprice'));
  // "List Price" / "List:" only (never the Subscribe & Save one-time price), and only when higher
  let list: ReturnType<typeof amazonMoney> = null;
  for (const b of box) {
    for (const el of qa(b, '.basisPrice .a-offscreen, .a-text-price[data-a-strike] .a-offscreen')) {
      const wrap = el.closest('.basisPrice, .a-section, tr, div');
      const label = plainText(wrap);
      if (/one-time|typical price|subscribe/i.test(label) || el.closest('.apex-basisprice-value')) continue;
      list = amazonMoney(plainText(el));
      if (list) break;
    }
    if (list) break;
  }
  if (list && price && !(Number(list.amount) > Number(price.amount))) list = null;
  const typical = (() => {
    for (const b of box) {
      const m = plainText(b).match(/Typical price:?\s*([$£€¥₹][\d.,]+)/i);
      if (m) return amazonMoney(m[1])?.amount ?? '';
    }
    return '';
  })();

  const details = amazonDetails(doc);
  // Brand, or author for books
  const byline = q(doc, '#bylineInfo');
  const authors = qa(doc, '#bylineInfo .author a.a-link-normal, #bylineInfo .author .contributorNameID').map((a) => plainText(a)).filter(Boolean);
  let brand = authors.length ? '' : plainText(byline).replace(/^(visit the|brand:)\s*/i, '').replace(/\s*store$/i, '');
  if (!brand) brand = clean(q(doc, '#logoByLine, #brandteaser img')?.getAttribute('alt')) || t('#visitStoreLink').replace(/^(visit the|brand:)\s*/i, '').replace(/\s*store$/i, '') || pick(details, /^(brand( name)?|manufacturer)$/i);

  const gallery = amazonGallery(doc);
  const bullets = qa(doc, '#feature-bullets li span.a-list-item, #productFactsDesktopExpander li span.a-list-item, #productFactsDesktop_feature_div li span.a-list-item').map((e) => plainText(e)).filter((s) => s && !/^see more product details/i.test(s));
  const description = [t('#productDescription'), plainText(q(doc, '#bookDescription_feature_div .a-expander-content')) || t('#bookDescription_feature_div')].filter(Boolean).join('\n\n');
  const ratingText = clean(q(doc, '#acrPopover')?.getAttribute('title')) || t('#acrPopover .a-icon-alt');
  const rank = pick(details, /best sellers rank/i);
  const sellerLink = q(doc, '#sellerProfileTriggerId') as HTMLAnchorElement | null;
  const unit = inBox('.pricePerUnit') || inBox('.a-price.a-text-price[data-a-size="mini"] .a-offscreen');
  const stockMatch = availabilityText.match(/only (\d+) left/i);
  // Sellers often type the brand into the part number; that isn't one
  const mpn = pick(details, /^(manufacturer part number|part number|item model number|model number)$/i);
  const realMpn = mpn && ![brand, pick(details, /^manufacturer$/i)].some((b) => b && b.toLowerCase() === mpn.toLowerCase()) ? mpn : '';

  const p: Product = {
    title: t('#productTitle') || t('#title'),
    brand,
    author: [...new Set(authors)].join(', '),
    price: price?.amount ?? '',
    compare_at_price: list?.amount ?? '',
    typical_price: typical && price && Number(typical) > Number(price.amount) ? typical : '',
    currency: price?.currency || list?.currency || '',
    availability: unavailable ? 'out of stock' : /in stock|only \d+ left|usually ships|available to ship|ships within/i.test(availabilityText) ? 'in stock' : /pre-?order/i.test(availabilityText) ? 'preorder' : availabilityText.slice(0, 80),
    availability_text: availabilityText.slice(0, 200),
    stock_qty: stockMatch?.[1] ?? '',
    asin,
    sku: asin,
    parent_asin: (scriptJson(doc, 'parentAsin') as string | undefined) ?? '',
    gtin: pick(details, /^(upc|ean|gtin|isbn-13|global trade identification number)$/i).split(/[\s,]+/)[0] ?? '',
    mpn: realMpn,
    manufacturer: pick(details, /^manufacturer$/i),
    best_sellers_rank: rank.replace(/\(see top 100.*?\)/i, '').replace(/\s+#/g, ' | #').trim(),
    bsr: rank.match(/#([\d,]+)/)?.[1]?.replace(/,/g, '') ?? '',
    bsr_category: rank.match(/#[\d,]+\s+in\s+([^(#|]+)/)?.[1]?.trim() ?? '',
    date_first_available: pick(details, /^date first available$/i),
    dimensions: pick(details, /dimensions/i),
    item_weight: pick(details, /^item weight$/i),
    country_of_origin: pick(details, /^country of origin$/i),
    bought_past_month: t('#social-proofing-faceout-title-tk_bought').match(/[\d.,]+[KkMm]?\+?/)?.[0] ?? '',
    sold_by: t('[offer-display-feature-name="desktop-merchant-info"] .offer-display-feature-text') || t('#merchantInfoFeature_feature_div .offer-display-feature-text') || t('#sellerProfileTriggerId'),
    seller_id: sellerLink?.href.match(/seller=([A-Z0-9]+)/)?.[1] ?? ((q(doc, '#merchantID') as HTMLInputElement | null)?.value ?? ''),
    ships_from: t('[offer-display-feature-name="desktop-fulfiller-info"] .offer-display-feature-text') || t('#fulfillerInfoFeature_feature_div .offer-display-feature-text'),
    unit_price: unit,
    savings: inBox('.savingsPercentage'),
    coupon: t('#promoPriceBlockMessage_feature_div .couponLabelText, #promoPriceBlockMessage_feature_div label') || (q(doc, '.newCouponBadge') ? 'yes' : ''),
    deal: t('#dealBadge_feature_div'),
    badge: t('#acBadge_feature_div .ac-badge-text-primary, #acBadge_feature_div'),
    rating: ratingText.match(/[\d.,]+/)?.[0]?.replace(',', '.') ?? '',
    review_count: t('#acrCustomerReviewText').replace(/[^\d]/g, ''),
    category: qa(doc, '#wayfinding-breadcrumbs_feature_div li a').map((a) => plainText(a)).join(' > '),
    image: gallery[0] ?? '',
    images: gallery.join(' | '),
    bullets: bullets.join(' • ').slice(0, 5000),
    description: (description || bullets.join(' • ')).slice(0, 5000),
    source: 'amazon page',
  };
  // Every other detail, as its own column
  const known = /^(upc|ean|gtin|isbn-13|global trade identification number|manufacturer part number|part number|item model number|model number|manufacturer|best sellers rank|date first available|item weight|country of origin|asin|customer reviews|brand( name)?)$|dimensions/i;
  for (const [k, v] of Object.entries(details)) if (!known.test(k)) p[`attr_${k.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '').slice(0, 40)}`] = v;
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== ''));
}
