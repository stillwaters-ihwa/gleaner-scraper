// Customer reviews: read them from product and place pages (Amazon review blocks, schema.org
// reviews, or review cards) and summarize them: rating spread, sentiment, and what people praise
// or complain about. Reviewer names are left out; the analysis doesn't need who wrote what.
import { compact, isType, isoDate, ldNodes, numStr, str, type Row } from './structured';
import { keywords, sentiment } from './sentiment';

export const REVIEW_COLUMNS = [
  ['rating', 'rating'],
  ['title', 'title'],
  ['text', 'review'],
  ['date', 'date'],
  ['verified', 'verified purchase'],
  ['helpful', 'found helpful'],
  ['variant', 'variant'],
  ['sentiment', 'sentiment'],
  ['sentiment_score', 'sentiment score'],
  ['photo_count', 'photos'],
  ['photos', 'photo links'],
  ['product', 'product'],
  ['url', 'page'],
  ['source', 'found via'],
  ['review_id', 'review id'],
] as const;

/** The full-size version of a review photo thumbnail (Google, Amazon, WordPress-style sizes). */
export function fullSizePhoto(u: string): string {
  if (/googleusercontent\.com\//.test(u)) return u.replace(/=[swh]\d+[^/?#]*$/, '') + '=s1600';
  if (/media-amazon\.com|images-amazon\.com|ssl-images-amazon/.test(u)) return u.replace(/\._[A-Z0-9_,]+?_?(?=\.\w+$)/i, '');
  return u.replace(/-\d{2,4}x\d{2,4}(?=\.(jpe?g|png|webp)$)/i, '');
}

/** Photos the reviewer attached: pictures in the review, not avatars, icons or star images. */
export function reviewPhotos(card: Element): string[] {
  const out = new Set<string>();
  const ok = (u: string) => /^https?:/.test(u) && !/avatar|profile|default-user|\/a\/|\/a-\/|sprite|icon|star|1x1|pixel|blank/i.test(u);
  for (const img of Array.from(card.querySelectorAll('img')) as HTMLImageElement[]) {
    if (img.closest('[class*="avatar" i], [class*="profile" i], [data-hook="genome-widget"]')) continue;
    const alt = img.alt ?? '';
    if (/profile|avatar|logo|flag/i.test(alt)) continue;
    const w = img.naturalWidth || img.width || Number(img.getAttribute('width')) || 0;
    const big = w >= 60 || /photo|image|picture|사진|写真/i.test(alt) || img.closest('[data-hook*="image" i], [class*="photo" i], [class*="media" i]');
    const u = img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src') || '';
    if (big && ok(u)) out.add(fullSizePhoto(u));
  }
  // Google Maps shows review photos as buttons with a background picture
  for (const el of Array.from(card.querySelectorAll('button[style*="background-image"], [role="button"][style*="background-image"], [aria-label*="photo" i][style*="background-image"]')) as HTMLElement[]) {
    const u = el.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1] ?? '';
    if (ok(u) && el.offsetWidth >= 60) out.add(fullSizePhoto(u));
  }
  return [...out].slice(0, 30);
}

const withPhotos = (r: Row, photos: string[]): Row => (photos.length ? { ...r, photos: photos.join(' | '), photo_count: String(photos.length) } : r);

function scored(r: Row): Row {
  const s = sentiment(`${r.title ?? ''}. ${r.text ?? ''}`);
  return { ...r, sentiment: s.label, sentiment_score: String(s.score) };
}

// "4.0 out of 5" / "4/5", and "5 stars" (Google Maps)
const ratingOf = (t: string) => {
  const m = t.match(/(\d(?:[.,]\d)?)\s*(?:out of|of|\/)\s*5/i) ?? t.match(/^\s*(\d(?:[.,]\d)?)\s*stars?\b/i);
  return numStr(m?.[1]?.replace(',', '.') ?? '');
};

function amazonReviews(doc: Document, url: string, product: string): Row[] {
  return Array.from(doc.querySelectorAll('[data-hook="review"], li[id^="customer_review"], div[id^="customer_review"]')).map((el) => {
    const q = (sel: string) => str(el.querySelector(sel)?.textContent);
    const date = q('[data-hook="review-date"]');
    return withPhotos(scored(
      compact({
        rating: ratingOf(q('[data-hook="review-star-rating"], [data-hook="cmps-review-star-rating"], i[class*="a-star-"]')) || (el.querySelector('i[class*="a-star-"]')?.className.match(/a-star-(\d)/)?.[1] ?? ''),
        title: q('[data-hook="review-title"] > span:not(.a-letter-space):last-child, [data-hook="review-title"]').replace(/^\d(\.\d)? out of 5 stars\s*/i, ''),
        text: q('[data-hook="review-body"]'),
        // "Reviewed in the United States on March 3, 2024"
        date: isoDate(date.replace(/^.*\bon\s+/i, '')),
        verified: el.querySelector('[data-hook="avp-badge"], [data-hook="avp-badge-linkless"]') ? 'yes' : '',
        helpful: q('[data-hook="helpful-vote-statement"]').match(/([\d,]+|One)/)?.[1]?.replace('One', '1').replace(/,/g, '') ?? '',
        variant: q('[data-hook="format-strip"]'),
        product,
        url,
        source: 'Amazon reviews',
        review_id: el.id.replace(/^customer_review(_foreign)?-/, ''),
      }),
    ), reviewPhotos(el));
  });
}

function ldReviews(doc: Document, url: string): Row[] {
  const nodes = ldNodes(doc);
  const product = str(nodes.find((n) => isType(n, ['product', 'hotel', 'restaurant', 'localbusiness', 'book', 'softwareapplication', 'movie']))?.name);
  const reviews: any[] = [];
  for (const n of nodes) {
    if (isType(n, ['review'])) reviews.push(n);
    for (const r of [].concat(n.review ?? n.reviews ?? [])) if (r && typeof r === 'object') reviews.push(r);
  }
  const ldPhoto = (x: any) => (typeof x === 'string' ? x : str(x?.contentUrl ?? x?.url));
  return [...new Set(reviews)].map((r) =>
    withPhotos(scored(
      compact({
        rating: numStr(r.reviewRating?.ratingValue ?? r.reviewRating),
        title: str(r.name ?? r.headline),
        text: str(r.reviewBody ?? r.description).slice(0, 4000),
        date: isoDate(r.datePublished ?? r.dateCreated),
        product: product || str(r.itemReviewed?.name),
        url,
        source: 'review data',
      }),
    ), [].concat(r.image ?? [], r.associatedMedia ?? []).map(ldPhoto).filter((u: string) => /^https?:/.test(u))),
  );
}

/** Review cards on any site (live pages only): rating stars plus a block of text. */
function cardReviews(doc: Document, url: string, product: string): Row[] {
  if (typeof (globalThis as any).__gleanerFindLists !== 'function') return [];
  const lists: { items: Element[] }[] = (globalThis as any).__gleanerFindLists(8);
  for (const l of lists) {
    const rows = l.items.map((item) => {
      const text = (item as HTMLElement).innerText ?? '';
      const label = Array.from(item.querySelectorAll('[aria-label], [title]')).map((e) => e.getAttribute('aria-label') ?? e.getAttribute('title') ?? '').find((s) => /of 5|out of 5|stars?/i.test(s)) ?? '';
      const stars = item.querySelectorAll('[class*="star" i][class*="full" i], [class*="star" i][class*="fill" i], [class*="star" i].on, [class*="star" i].active').length;
      const rating = ratingOf(label) || ratingOf(text) || (stars >= 1 && stars <= 5 ? String(stars) : '');
      const body = Array.from(item.querySelectorAll('p, [class*="content" i], [class*="body" i], [class*="text" i]')).map((e) => str(e.textContent)).sort((a, b) => b.length - a.length)[0] ?? '';
      const title = str(item.querySelector('h3, h4, [class*="title" i], strong')?.textContent);
      const date = text.match(/\b(\d{4}[.-]\d{1,2}[.-]\d{1,2}|\w+ \d{1,2}, \d{4}|\d{1,2} \w+ \d{4})\b/)?.[1] ?? '';
      return withPhotos(scored(compact({ rating, title: title === body ? '' : title, text: body.slice(0, 4000), date: isoDate(date.replace(/\./g, '-')), verified: /verified/i.test(text) ? 'yes' : '', product, url, source: 'review cards', review_id: item.getAttribute('data-review-id') ?? item.querySelector('[data-review-id]')?.getAttribute('data-review-id') ?? '' })), reviewPhotos(item));
    });
    const good = rows.filter((r) => r.rating && (r.text?.length ?? 0) >= 15);
    if (good.length >= Math.max(3, rows.length * 0.5)) return good;
  }
  return [];
}

/** Whether a colour is the gold/amber of a filled star (not the grey of an empty one). */
function isGold(color: string): boolean {
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return /gold|orange|yellow|#f[a-f0-9]{1}[b-f]/i.test(color);
  const [r, g, b] = m.slice(1).map(Number);
  return r > 190 && g > 110 && b < 120 && r - b > 100;
}

/** Rating from a row of star icons: how many are filled. Null when it isn't a star row. */
function starRowRating(row: Element): number | null {
  const icons = Array.from(row.children).filter((k) => k.tagName.toLowerCase() === 'svg' || /star/i.test(String((k as HTMLElement).className ?? '')));
  if (icons.length < 5 || icons.length > 6) return null;
  const sizes = new Set(icons.map((k) => Math.round(k.getBoundingClientRect().width)));
  if (sizes.size > 2 || [...sizes].some((w) => w > 40)) return null;
  let filled = 0;
  for (const k of icons) {
    const shape = k.querySelector('path, polygon, use') ?? k;
    const style = getComputedStyle(shape as Element);
    const fill = style.fill && style.fill !== 'none' ? style.fill : style.color;
    if (isGold(fill) || /full|filled|active|\bon\b/i.test(String((k as HTMLElement).className ?? ''))) filled++;
  }
  return filled;
}

/**
 * Reviews shown as cards with a row of star icons and no text rating (Google Search and Maps
 * review panels, many review widgets). Live pages only: it needs the stars' colours.
 */
function starRowReviews(doc: Document, url: string): Row[] {
  if (typeof getComputedStyle !== 'function' || !doc.body?.getBoundingClientRect) return [];
  const rows: { row: Element; rating: number }[] = [];
  for (const el of Array.from(doc.querySelectorAll('div, span'))) {
    if (el.children.length < 5 || el.children.length > 6) continue;
    const rating = starRowRating(el);
    if (rating !== null && rating >= 0 && (el as HTMLElement).offsetParent !== null) rows.push({ row: el, rating });
  }
  if (rows.length < 2) return [];
  const all = rows.map((r) => r.row);
  const owner = /\(owner\)|response from the owner|owner response|사장님|オーナー/i;
  const title = str(doc.querySelector('[role="dialog"] [role="heading"], [role="dialog"] h2, h1')?.textContent) || str(doc.title).split(' - ')[0];
  const out: Row[] = [];
  for (const { row, rating } of rows) {
    // The card: the biggest box around this star row that holds no other star row
    let card: Element = row;
    while (card.parentElement && card.parentElement !== doc.body && all.filter((r) => card.parentElement!.contains(r)).length === 1) card = card.parentElement;
    const blocks = Array.from(card.querySelectorAll('div, span, p')).filter((b) => {
      if (b.contains(row) || row.contains(b)) return false;
      if (Array.from(b.children).some((c) => !/^(BR|B|I|EM|STRONG|SPAN|A)$/.test(c.tagName))) return false;
      // Leave out the owner's reply and its header
      const box = b.closest('div');
      return !(box && owner.test(box.parentElement?.textContent?.slice(0, 120) ?? '') && !box.parentElement?.contains(row));
    });
    const texts = blocks.map((b) => ({ b, t: str((b as HTMLElement).innerText ?? b.textContent) }));
    const date = texts.find((x) => x.t.length < 40 && /\b(ago|yesterday|today|edited)\b|\b\d{4}\b|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|전|前/.test(x.t))?.t ?? '';
    // Not the review: the reviewer's own line ("Local Guide · 12 reviews · 5 photos") and buttons
    const meta = /^(local guide\b|\d+ reviews?\b|\d+ photos?\b|more|report review|like|share|helpful|hover to react|new\b)|\b\d+ (reviews?|photos?)$/i;
    const body = texts.filter((x) => x.t.length >= 15 && x.t !== date && !meta.test(x.t) && !owner.test(x.t)).sort((a, b) => b.t.length - a.t.length)[0]?.t ?? '';
    const review_id = card.getAttribute('data-review-id') ?? card.getAttribute('data-id') ?? card.querySelector('[data-review-id]')?.getAttribute('data-review-id') ?? '';
    out.push(withPhotos(scored(compact({ rating: String(rating), text: body.replace(/\s*…?\s*more$/i, '').slice(0, 4000), date: isoDate(date) || date, product: title, url, source: 'review cards (stars)', review_id })), reviewPhotos(card)));
  }
  return out.filter((r) => Number(r.rating) > 0);
}

/** Every review on a page. */
export function extractReviews(doc: Document, url: string): Row[] {
  const product = str(doc.querySelector('#productTitle, [data-hook="product-link"]')?.textContent) || str(doc.querySelector('meta[property="og:title"]')?.getAttribute('content')) || str(doc.querySelector('h1')?.textContent);
  const amazon = amazonReviews(doc, url, product);
  if (amazon.length) return amazon;
  const ld = ldReviews(doc, url).filter((r) => r.text || r.title);
  if (ld.length >= 2) return ld;
  const stars = starRowReviews(doc, url);
  if (stars.length >= 2) return stars;
  const cards = cardReviews(doc, url, product);
  return cards.length > ld.length ? cards : ld;
}

/** Link to the next page of reviews on Amazon, or any "Next" reviews link. */
export function nextReviewsUrl(doc: Document, url: string): string {
  const a = doc.querySelector('li.a-last a, a[data-hook="see-all-reviews-link-foot"], a[aria-label*="next page" i]') as HTMLAnchorElement | null;
  if (!a?.getAttribute('href')) return '';
  try {
    return new URL(a.getAttribute('href')!, url).href;
  } catch {
    return '';
  }
}

export interface ReviewSummary {
  count: number;
  average: number;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  positive: number;
  neutral: number;
  negative: number;
  praise: string[];
  complaints: string[];
  verified: number;
}

/** What a set of reviews says, overall and in its own words. */
export function summarizeReviews(rows: Row[]): ReviewSummary {
  const dist = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  let sum = 0;
  let rated = 0;
  for (const r of rows) {
    const n = Math.round(Number(r.rating));
    if (n >= 1 && n <= 5) {
      dist[String(n) as '1']++;
      sum += Number(r.rating);
      rated++;
    }
  }
  const text = (r: Row) => `${r.title ?? ''}. ${r.text ?? ''}`;
  const good = rows.filter((r) => Number(r.rating) >= 4 || (!r.rating && r.sentiment === 'positive'));
  const bad = rows.filter((r) => (Number(r.rating) > 0 && Number(r.rating) <= 2) || (!r.rating && r.sentiment === 'negative'));
  // Words that come up in good reviews but not in bad ones, and the reverse
  const goodWords = keywords(good.map(text), 30);
  const badWords = keywords(bad.map(text), 30);
  return {
    count: rows.length,
    average: rated ? Math.round((sum / rated) * 100) / 100 : 0,
    distribution: dist,
    positive: rows.filter((r) => r.sentiment === 'positive').length,
    neutral: rows.filter((r) => r.sentiment === 'neutral').length,
    negative: rows.filter((r) => r.sentiment === 'negative').length,
    praise: goodWords.filter((w) => !badWords.includes(w)).slice(0, 10),
    complaints: badWords.filter((w) => !goodWords.includes(w)).slice(0, 10),
    verified: rows.filter((r) => r.verified === 'yes').length,
  };
}
