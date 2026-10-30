// Product cards on listing pages (search results, category grids). Runs in the live page.
import { parsePrice, wholesalePriceRules, type Product } from '../product';
import { blockText, pricesByCurrency, readDetails } from './fields';
import { findLists, isVisible } from './list';
import { safeQueryAll, uniqueSelector } from './selector';
import { openDialog } from './dialog';

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const text = (el: Element | null | undefined) => (el instanceof HTMLElement ? clean(el.innerText) : clean(el?.textContent));

function bestImage(item: Element): string {
  const imgs = safeQueryAll(item, 'img').filter((i) => !/sprite|icon|logo|badge|flag|cart|wish|star|rating/i.test((i.getAttribute('src') ?? '') + ' ' + (i as HTMLElement).className));
  let best: HTMLImageElement | null = null;
  let area = 0;
  for (const i of imgs as HTMLImageElement[]) {
    const r = i.getBoundingClientRect();
    const a = Math.max(r.width * r.height, i.naturalWidth * i.naturalHeight * 0.01);
    if (a > area) ((area = a), (best = i));
  }
  if (!best) return '';
  const srcset = best.getAttribute('srcset');
  if (srcset) {
    const last = srcset.split(',').pop()?.trim().split(/\s+/)[0];
    if (last) return new URL(last, location.href).href;
  }
  return best.currentSrc || best.src || best.getAttribute('data-src') || best.getAttribute('ec-data-src') || best.getAttribute('data-original') || '';
}

function productLink(item: Element): string {
  const links = safeQueryAll(item, 'a[href]') as HTMLAnchorElement[];
  if (item instanceof HTMLAnchorElement) links.unshift(item);
  const good = links.filter((a) => a.href.startsWith('http') && !/#|javascript:|add-to-cart|addtocart|wishlist|cart\b|login|signin|review/i.test(a.getAttribute('href') ?? ''));
  // The product's own page: the link around the picture or name, a product-like path; not the
  // seller's other products, a brand or a category (Domeggook cards link to both)
  const score = (a: HTMLAnchorElement) =>
    (a.querySelector('img') ? 3 : 0) +
    (a.closest('h1, h2, h3, h4, [class*="title" i], [class*="name" i]') || a.querySelector('h2, h3, h4, [class*="title" i], [class*="name" i]') ? 3 : 0) +
    (/\/(dp|gp\/product|product|products|p|item|detail|goods)\b/i.test(a.pathname) ? 2 : 0) +
    (/\/\d{5,}(\.html)?$/.test(a.pathname) ? 2 : 0) -
    (/list|search|seller|shop|store|brand|categor|[?&](sw|q|keyword)=/i.test(a.pathname + a.search) ? 4 : 0);
  return good.map((a, i) => ({ a, s: score(a) - i * 0.01 })).sort((x, y) => y.s - x.s)[0]?.a.href ?? '';
}

const BADGE = /^(sponsored|ad|new|sale|hot|best( ?seller)?|cpnp|limited|exclusive|free shipping|in stock|out of stock|sold out|log ?in|sign ?in|add to (cart|bag|basket)|wishlist|quick ?view|compare|bar ?code.*|\d+% off|save.*|-?\d+%|only \d+ left.*)$/i;

/** The product name: the most title-like text in the card, not badges, prices or buttons. */
function cardTitle(item: Element): string {
  const amazonH2 = item.querySelector('h2');
  if (item.hasAttribute('data-asin') && amazonH2) {
    const t = clean(amazonH2.getAttribute('aria-label') || text(amazonH2));
    return t.replace(/^sponsored( ad)?\s*[-–:]?\s*/i, '');
  }
  let best = '';
  let bestScore = -Infinity;
  const consider = (t: string, bonus: number) => {
    t = clean(t);
    if (t.length < 4 || t.length > 220 || BADGE.test(t) || parsePrice(t)?.amount && t.length < 25 || !/\p{L}{2}/u.test(t)) return;
    const shouting = t === t.toUpperCase() && t.length < 12;
    const score = Math.min(t.length, 120) + bonus - (shouting ? 80 : 0);
    if (score > bestScore) ((bestScore = score), (best = t));
  };
  for (const el of safeQueryAll(item, 'h1, h2, h3, h4, h5, h6, [class*="title" i], [class*="name" i], a[href], p, span, div, strong')) {
    if (el.querySelector('h1, h2, h3, h4, p, li, img') || /brand|price|badge|label|tag|button|btn|rating|review|vendor|desc|summary|excerpt|short/i.test((el as HTMLElement).className + '')) continue;
    if (parsePrice(text(el)) && text(el).length > 30) continue;
    const titleish = /^H[1-6]$/.test(el.tagName) || /title|name/i.test((el as HTMLElement).className + '') ? 60 : 0;
    // A sentence (a description) is less likely the name than a short label
    const sentence = el.tagName === 'P' || /[.!?]\s/.test(text(el)) ? -50 : 0;
    const linked = el.closest('a[href]') ? 20 : 0;
    consider(text(el), titleish + linked + sentence);
  }
  for (const a of safeQueryAll(item, 'a[title], img[alt]')) consider(a.getAttribute('title') || a.getAttribute('alt') || '', 10);
  return best;
}

/** Elements holding a crossed-out "was" price. Class matches avoid substrings like "bold". */
export const STRUCK = 'del, s, strike, [data-a-strike], .a-text-price, [class*="old-price" i], [class*="price-old" i], [class*="oldprice" i], [class*="was-price" i], [class*="price-was" i], [class*="compare" i], [class*="regular-price" i], [class*="price--regular" i], [class*="original" i], [class*="strike" i], [class*="crossed" i], [class*="list-price" i], [class*="retail" i]';

function cardPrices(item: Element) {
  let price: ReturnType<typeof parsePrice> = null;
  let compare: ReturnType<typeof parsePrice> = null;
  // Skip unit prices like "($7.99/Fl Oz)"
  const priced = safeQueryAll(item, '.a-price .a-offscreen, [class*="price" i], [data-price], del, s, ins').filter((el) => !/\/\s*(fl ?oz|oz|count|ounce|lb|kg|g|ml|l|unit|item|each|100 ?(g|ml))\b/i.test(el.parentElement?.closest('span, div')?.textContent ?? ''));
  for (const el of priced.length ? priced : [item]) {
    const p = parsePrice(el.getAttribute('data-price') ? `$${el.getAttribute('data-price')}` : text(el) || el.textContent || '');
    if (!p) continue;
    const struck = !!el.closest(STRUCK);
    if (struck) compare ??= p;
    else price ??= p;
  }
  return { price, compare };
}

/** An Amazon search result card: its own price, list price, review count and badges. */
function amazonCard(item: Element, base: Product): Product {
  const money = (el: Element | null) => parsePrice(clean(el?.textContent));
  // The price to pay is the first price that isn't struck through or a per-unit price "($1.25/Fl Oz)"
  // (unit and list prices are both drawn as .a-text-price)
  const prices = safeQueryAll(item, '.a-price').filter((p) => !p.closest('[data-a-strike="true"], .a-text-price'));
  const price = money(prices[0]?.querySelector('.a-offscreen') ?? null);
  const listEl = item.querySelector('.a-price[data-a-strike="true"] .a-offscreen');
  const list = money(listEl);
  const unitEl = safeQueryAll(item, '.a-price.a-text-price').find((p) => !p.matches('[data-a-strike="true"]') && /\/\s*\p{L}/u.test(clean(p.parentElement?.textContent)));
  // Review count: "108,570 ratings" on the link to the reviews (not the star rating's label)
  const countEl = item.querySelector('a[href*="#customerReviews"] [aria-label], [aria-label$=" ratings" i], [aria-label$=" rating" i], a[href*="#customerReviews"] .s-underline-text, a[href*="#customerReviews"] span:not(.a-icon-alt)');
  const countText = countEl?.getAttribute('aria-label') || text(countEl);
  const count = /out of 5/i.test(countText) ? '' : (countText.match(/[\d.,]+\s*[KkMm]?/)?.[0] ?? '');
  const k = /k/i.test(count) ? 1e3 : /m/i.test(count) ? 1e6 : 1;
  const all = text(item);
  const sponsored = !!item.querySelector('.puis-sponsored-label-text, .s-sponsored-label-text, [aria-label="Sponsored" i], [data-component-type="sp-sponsored-result"]') || /^sponsored\b/i.test(clean(item.querySelector('h2')?.getAttribute('aria-label')));
  // The second half of the name Amazon shows under the brand line
  const h2s = safeQueryAll(item, 'h2').map((h) => clean(h.getAttribute('aria-label') || text(h)).replace(/^sponsored( ad)?\s*[-–:]?\s*/i, ''));
  return {
    ...base,
    title: h2s.sort((a, b) => b.length - a.length)[0] || base.title,
    price: price?.amount ?? '',
    compare_at_price: list && price && parseFloat(list.amount) > parseFloat(price.amount) ? list.amount : '',
    currency: price?.currency || list?.currency || base.currency,
    unit_price: unitEl ? `${clean(unitEl.querySelector('.a-offscreen')?.textContent)}${clean(unitEl.parentElement?.textContent).replace(/^\(/, '').replace(/\)$/, '').split(clean(unitEl.textContent)).pop()?.replace(/^[^/]*?(?=\/)/, '') ?? ''}` : '',
    review_count: count ? String(Math.round(parseFloat(count.replace(/,/g, '')) * k)) : '',
    sponsored: sponsored ? 'yes' : '',
    bought_past_month: all.match(/([\d.,]+[KkMm]?\+?) bought in past month/i)?.[1] ?? '',
    coupon: all.match(/(Save [^ ]+ with coupon|\$[\d.]+ off coupon[^.]*)/i)?.[1] ?? '',
    badge: clean(item.querySelector('.a-badge-text, [data-a-badge-type] .a-badge-label-inner')?.textContent),
    prime: item.querySelector('.a-icon-prime, [aria-label="Amazon Prime" i]') ? 'yes' : '',
    delivery: text(item.querySelector('[data-cy="delivery-recipe"]')).replace(/\{[^}]*\}|\(function[\s\S]*$/g, '').trim().slice(0, 120),
  };
}

/** Normalize one card into product fields. */
export function cardProduct(item: Element): Product {
  const t = text(item);
  const { price, compare } = cardPrices(item);
  const ratingEl = item.querySelector('[aria-label*="out of 5" i], [title*="out of 5" i], .a-icon-alt, [class*="rating" i]');
  const ratingText = ratingEl?.getAttribute('aria-label') || ratingEl?.getAttribute('title') || text(ratingEl);
  const reviews = item.querySelector('[aria-label*="ratings" i], [aria-label*="reviews" i], [class*="review" i] , [class*="count" i]');
  const data = (n: string) => item.getAttribute(n) || item.querySelector(`[${n}]`)?.getAttribute(n) || '';
  const asin = item.getAttribute('data-asin') || '';
  const base: Product = {
    title: cardTitle(item),
    brand: asin
      ? text(item.querySelector('[data-cy="title-recipe"] h2 + div .a-size-base-plus, [data-cy="title-recipe"] > .a-row .a-size-base-plus')).slice(0, 80)
      : text(item.querySelector('[class*="brand" i]')).slice(0, 80) || (t.match(/^\[([^\]]{2,40})\]/)?.[1] ?? ''),
    price: price?.amount ?? '',
    // A "was" price is only real when it's higher than the price (not a per-unit price)
    compare_at_price: compare && price && parseFloat(compare.amount) > parseFloat(price.amount) ? compare.amount : '',
    currency: price?.currency ?? compare?.currency ?? '',
    availability: /out of stock|sold out|unavailable/i.test(t) ? 'out of stock' : '',
    sku: data('data-sku') || data('data-product-sku') || data('data-prodcd') || asin,
    gtin: t.match(/\b(?:EAN|UPC|GTIN|Bar ?code|JAN)[.:#\s]+(\d{8,14})\b/i)?.[1] ?? '',
    asin,
    rating: ratingText.match(/(\d+(?:[.,]\d)?)\s*(?:out of|\/|von|sur|de)\s*5/i)?.[1]?.replace(',', '.') ?? '',
    review_count: (reviews?.getAttribute('aria-label') || text(reviews)).match(/\(?([\d.,]+)\)?/)?.[1]?.replace(/[.,]/g, '') ?? '',
    image: bestImage(item),
    // Amazon result links are often tracking redirects; the ASIN gives a clean product URL
    url: asin && /amazon\./i.test(location.hostname) ? `${location.origin}/dp/${asin}` : productLink(item),
    source: 'listing page',
  };
  if (asin) return amazonCard(item, base); // Amazon cards: their extra text is noise

  // "SKU: ... PartNum : ...", stock, MOQ, box quantities, and each price currency
  // Keep the card's line breaks: "Label: value" pairs are read one line at a time
  const lines = item instanceof HTMLElement ? item.innerText : blockText(item);
  const { fields } = readDetails(item, lines);
  for (const [k, v] of Object.entries(fields)) if (v && !base[k]) base[k] = v;
  if (fields.sku) base.sku = fields.sku;
  if (fields.stock_status && !base.availability) base.availability = fields.stock_status;
  const priceTexts = safeQueryAll(item, '[class*="price" i], [data-price], del, s, ins, strong, b, em').map((e) => text(e));
  const prices = pricesByCurrency([...priceTexts, ...lines.split(/\n+/)]);
  // Several currencies (e.g. KRW and USD): keep each one in its own column
  if (Object.keys(prices).length > 1) Object.assign(base, prices);
  return wholesalePriceRules(base, lines);
}

export const AMAZON_RESULTS = '[data-component-type="s-search-result"][data-asin]:not([data-asin=""])';

/** The pager shows its Next control switched off: this is the last page. */
export function pagerAtEnd(): boolean {
  if (document.querySelector('.s-pagination-next.s-pagination-disabled, span.s-pagination-next[aria-disabled="true"]')) return true;
  const PAGER = 'nav, [class*="pagination" i], [class*="pager" i], [role="navigation"]';
  return safeQueryAll(document, `${PAGER} a, ${PAGER} button, ${PAGER} span, ${PAGER} li`).some((el) => {
    const l = clean((el as HTMLElement).innerText || el.getAttribute('aria-label'));
    const off = (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true' || /\bdisabled\b/i.test(el.className + '');
    return off && isVisible(el) && /^(next|next page|›|»|>)$/i.test(l);
  });
}

/** Find the product grid on this page. */
export function findProductList(): { itemSelector: string; count: number } | null {
  const amazon = safeQueryAll(document, AMAZON_RESULTS);
  if (amazon.length) return { itemSelector: AMAZON_RESULTS, count: amazon.length };
  // Pick the best list whose items look like products (price or product link)
  // Shop platforms' own product grids first (WooCommerce, PrestaShop, Cafe24, Magento, Shopify themes)
  for (const sel of ['ul.products > li.product', '.products .product-miniature', '.xans-product-normalpackage .prdList > li', '.prdList > li[id^="anchorBoxId_"]', 'li.product-item', '.product-grid .grid__item']) {
    const items = safeQueryAll(document, sel).filter(isVisible);
    if (items.length >= 3) return { itemSelector: sel, count: items.length };
  }
  const lists = findLists(10);
  // A price slot counts even when it says "Log in to see the price" (wholesale sites)
  const priceSlot = (i: Element) => !!cardPrices(i).price || safeQueryAll(i, '[class*="price" i]').some((e) => /log ?in|sign ?in|price|로그인|가격/i.test(e.textContent ?? ''));
  const sameSite = (u: string) => {
    try {
      return !!u && new URL(u).hostname === location.hostname;
    } catch {
      return false;
    }
  };
  const score = (items: Element[]) => {
    const sample = items.slice(0, 8);
    const priced = sample.filter(priceSlot).length;
    const linked = sample.filter((i) => sameSite(productLink(i))).length;
    const imaged = sample.filter((i) => i.querySelector('img')).length;
    // Lists in the header, menus, mini-cart or banners aren't the catalogue
    const chrome = items[0]?.closest('header, footer, nav, aside, [class*="cart" i], [class*="minicart" i], [class*="banner" i], [class*="usp" i]') ? 0.3 : 1;
    // Bigger lists are likelier to be the grid: a 3-item promo strip loses to a 24-card grid
    return ((priced * 2 + linked + imaged) / sample.length) * chrome * Math.log2(Math.max(2, items.length));
  };
  const ranked = lists.map((l) => ({ l, s: score(l.items) })).filter((x) => x.s >= 1.2).sort((a, b) => b.s - a.s || b.l.score - a.l.score);
  const best = ranked[0]?.l;
  return best ? { itemSelector: best.itemSelector, count: best.items.length } : null;
}

export function extractCards(itemSelector: string): Product[] {
  return safeQueryAll(document, itemSelector)
    .filter(isVisible)
    .map(cardProduct)
    .filter((p) => p.title || p.url);
}

/**
 * The control that leads to the next page: rel=next, a "Next" button, or the page number
 * after the current one in a numbered pager.
 */
export function findNextControl(): { selector: string; label: string; kind: 'next' | 'number' | 'load-more' } | null {
  const isOn = (el: Element) => isVisible(el) && !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true' && !/\bdisabled\b/.test(el.className + ' ' + (el.parentElement?.className ?? ''));
  const label = (el: Element) => clean((el as HTMLElement).innerText || el.getAttribute('aria-label') || el.getAttribute('title'));
  // Arrows inside photo carousels and sliders say "Next" too, but they aren't pagination
  const inCarousel = (el: Element) => !!el.closest('g-scrolling-carousel, [aria-roledescription="carousel" i], [class*="carousel" i], [class*="swiper" i], [class*="slick" i], [class*="slider" i], [class*="gallery" i]');
  // With a pop-up window open, only its own controls count: the page behind has its own "Next"
  const root: Element | Document = openDialog() ?? document;
  const clickables = safeQueryAll(root, 'a, button, [role="button"], [role="link"], input[type="button"], input[type="submit"]').filter((el) => isOn(el) && !inCarousel(el));

  const rel = root.querySelector('a[rel~="next"]');
  if (rel && isOn(rel) && !inCarousel(rel)) return { selector: uniqueSelector(rel), label: label(rel) || 'Next', kind: 'next' };

  // 1. A button that says "Next" in words (most reliable, one page at a time)
  const NEXT_WORDS = /^(next|next page|next ›|next »|next >|older posts|weiter|nächste|suivant|siguiente|próxima|avanti|volgende|下一页|다음)$/i;
  const byWords = clickables.find((el) => NEXT_WORDS.test(label(el)) || /^(go to )?(the )?next( search)?( page| results)?$/i.test(el.getAttribute('aria-label') ?? ''));
  if (byWords) return { selector: uniqueSelector(byWords), label: label(byWords) || 'Next', kind: 'next' };

  // 2. Numbered pager: the number right after the current page. Preferred over arrow symbols,
  //    because "»" often jumps a block of pages or to the last page, which would skip pages.
  const current = safeQueryAll(root, '[aria-current="page"], .active > a, .active > span, li.active, .current, [class*="current" i], .selected')
    .map((el) => ({ el, n: parseInt(label(el), 10) }))
    .find((x) => !isNaN(x.n) && x.n < 100000);
  if (current) {
    const scope = current.el.parentElement?.closest('nav, ul, ol, [class*="pagination" i], [class*="pager" i], [class*="paging" i]') ?? document.body;
    const nextNum = (safeQueryAll(scope, 'a, button, [role="button"], [page], [data-page]').filter(isOn) as HTMLElement[]).find(
      (el) => parseInt(label(el), 10) === current.n + 1,
    );
    if (nextNum) return { selector: uniqueSelector(nextNum), label: `page ${current.n + 1}`, kind: 'number' };
  }

  // 3. Single-step arrows, then a "next" class. Double arrows last: they may jump ahead.
  const ARROW = /^(›|>|→|〉|＞|›››)$/;
  const byArrow = clickables.find((el) => ARROW.test(label(el)));
  if (byArrow) return { selector: uniqueSelector(byArrow), label: label(byArrow), kind: 'next' };
  const byClass = clickables.find((el) => /(^|[-_\s])(next|pagination-next|s-pagination-next)([-_\s]|$)/i.test(el.className + ' ' + el.id) && !/last|end/i.test(el.className));
  if (byClass) return { selector: uniqueSelector(byClass), label: label(byClass) || 'Next', kind: 'next' };
  const double = clickables.find((el) => /^(»|>>)$/.test(label(el)) && !/last|end/i.test((el.getAttribute('aria-label') ?? '') + el.className));
  if (double) return { selector: uniqueSelector(double), label: label(double), kind: 'next' };

  const here = new URL(location.href);
  const curPage = Number(here.searchParams.get('page') ?? here.searchParams.get('p') ?? here.searchParams.get('paged') ?? here.searchParams.get('curr_page') ?? 1) || 1;
  const toNext = (safeQueryAll(root, 'a[href]') as HTMLAnchorElement[]).find((a) => {
    if (!isOn(a) || inCarousel(a) || a.closest('header, nav[class*="menu" i], footer')) return false;
    try {
      const u = new URL(a.href, location.href);
      const n = Number(u.searchParams.get('page') ?? u.searchParams.get('p') ?? u.searchParams.get('paged') ?? u.searchParams.get('curr_page'));
      return u.origin === here.origin && u.pathname === here.pathname && n === curPage + 1;
    } catch {
      return false;
    }
  });
  if (toNext) return { selector: uniqueSelector(toNext), label: label(toNext) || `page ${curPage + 1}`, kind: 'next' };

  const MORE = /^(load|show|view|see)( \d+)? more\b|more (products|results|items|reviews|listings|jobs)|mehr laden|ver más|charger plus|더\s?보기/i;
  const more = clickables.find((el) => MORE.test(label(el)));
  // A "See more" link to this page with a page number is a pager (PrestaShop), not a load-more button
  const moreLink = more?.closest('a[href]') as HTMLAnchorElement | null;
  if (more && moreLink) {
    try {
      const u = new URL(moreLink.href, location.href);
      if (u.origin === location.origin && u.pathname === location.pathname && /[?&](page|p|pg|paged|curr_page)=\d+/i.test(u.search)) return { selector: uniqueSelector(more), label: label(more), kind: 'next' };
    } catch {
      /* not a link */
    }
  }
  if (more) return { selector: uniqueSelector(more), label: label(more), kind: 'load-more' };
  return null;
}

/** The link or button for page `n` in a numbered pager ("1 2 3 … 13"), or null. */
export function findPageNumber(n: number): { selector: string; label: string; kind: 'number' } | null {
  const root: Element | Document = openDialog() ?? document;
  const label = (el: Element) => clean((el as HTMLElement).innerText || el.getAttribute('aria-label') || el.getAttribute('title'));
  const PAGER = 'nav, ul, ol, [class*="pagination" i], [class*="pager" i], [class*="paging" i], [role="navigation"]';
  const hit = (safeQueryAll(root, 'a, button, [role="button"], [role="link"], [data-page], [page]') as HTMLElement[]).find((el) => {
    if (!isVisible(el) || (el as HTMLButtonElement).disabled || !el.closest(PAGER)) return false;
    const t = label(el);
    return t === String(n) || new RegExp('^(go to )?page ' + n + '$', 'i').test(el.getAttribute('aria-label') ?? '');
  });
  return hit ? { selector: uniqueSelector(hit), label: 'page ' + n, kind: 'number' } : null;
}
