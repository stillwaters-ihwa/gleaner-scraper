// Extractors that work on any Document, including ones parsed from fetched HTML (no layout).
import { linkedBig } from './bigImages';
import { Readability } from '@mozilla/readability';
import { safeQueryAll } from './selector';

export type Row = Record<string, string>;

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function abs(href: string | null | undefined, base: string): string {
  if (!href) return '';
  try {
    return new URL(href, base).href;
  } catch {
    return '';
  }
}

function meta(doc: Document, ...names: string[]): string {
  for (const n of names) {
    const el = doc.querySelector(`meta[property="${n}"], meta[name="${n}"], meta[itemprop="${n}"]`);
    const v = clean(el?.getAttribute('content'));
    if (v) return v;
  }
  return '';
}

/** Every JSON-LD node on the page, flattened through @graph and arrays. */
export function jsonLd(doc: Document): any[] {
  const nodes: any[] = [];
  const walk = (v: any) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      nodes.push(v);
      if (v['@graph']) walk(v['@graph']);
    }
  };
  for (const s of safeQueryAll(doc, 'script[type="application/ld+json"]')) {
    try {
      walk(JSON.parse(s.textContent || ''));
    } catch {
      /* invalid JSON-LD is common, skip it */
    }
  }
  return nodes;
}

const isType = (n: any, t: string) => [].concat(n?.['@type'] ?? []).some((x: string) => String(x).toLowerCase() === t);
const first = (v: any) => (Array.isArray(v) ? v[0] : v);
const str = (v: any): string => {
  v = first(v);
  if (v == null) return '';
  if (typeof v === 'object') return clean(v.name ?? v['@id'] ?? v.url ?? '');
  return clean(String(v));
};

/** Title, description, image, author, date and canonical URL. No selectors needed. */
export function pageMetadata(doc: Document, url: string): Row {
  const ld = jsonLd(doc);
  const article = ld.find((n) => isType(n, 'article') || isType(n, 'newsarticle') || isType(n, 'blogposting'));
  return {
    url,
    title: meta(doc, 'og:title', 'twitter:title') || clean(doc.title),
    description: meta(doc, 'og:description', 'description', 'twitter:description'),
    image: abs(meta(doc, 'og:image', 'twitter:image'), url),
    author: meta(doc, 'author', 'article:author') || str(article?.author),
    published: meta(doc, 'article:published_time', 'datePublished') || str(article?.datePublished),
    site_name: meta(doc, 'og:site_name'),
    canonical: abs(doc.querySelector('link[rel="canonical"]')?.getAttribute('href'), url),
    language: clean(doc.documentElement.getAttribute('lang')),
    h1: clean(doc.querySelector('h1')?.textContent),
  };
}

/** Product fields from JSON-LD, microdata and Open Graph product tags. */
export function productData(doc: Document): Row {
  const ld = jsonLd(doc);
  const p = ld.find((n) => isType(n, 'product'));
  const offer = first(p?.offers?.offers ?? p?.offers);
  const rating = p?.aggregateRating;
  const micro = (prop: string) => {
    const el = doc.querySelector(`[itemprop="${prop}"]`);
    return clean(el?.getAttribute('content') ?? el?.textContent);
  };
  return {
    product_name: str(p?.name) || micro('name'),
    sku: str(p?.sku) || micro('sku'),
    brand: str(p?.brand) || micro('brand'),
    price: str(offer?.price ?? offer?.lowPrice) || micro('price') || meta(doc, 'product:price:amount', 'og:price:amount'),
    currency: str(offer?.priceCurrency) || micro('priceCurrency') || meta(doc, 'product:price:currency', 'og:price:currency'),
    availability: str(offer?.availability).replace(/^https?:\/\/schema\.org\//, '') || micro('availability'),
    rating: str(rating?.ratingValue) || micro('ratingValue'),
    review_count: str(rating?.reviewCount ?? rating?.ratingCount) || micro('reviewCount'),
    product_image: str(p?.image),
  };
}

export interface CustomField {
  name: string;
  selector: string;
  attr: 'text' | 'href' | 'src' | 'html' | 'all';
}

export function customFields(doc: Document, fields: CustomField[], url: string): Row {
  const row: Row = {};
  for (const f of fields) {
    const els = safeQueryAll(doc, f.selector);
    const val = (el: Element) =>
      f.attr === 'href' ? abs(el.getAttribute('href'), url)
      : f.attr === 'src' ? abs(el.getAttribute('src') || el.getAttribute('data-src'), url)
      : f.attr === 'html' ? el.innerHTML.trim()
      : clean(el.textContent);
    row[f.name] = f.attr === 'all' ? els.map((e) => clean(e.textContent)).filter(Boolean).join(' | ') : els[0] ? val(els[0]) : '';
  }
  return row;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi;
const BAD_EMAIL = /\.(png|jpe?g|gif|webp|svg|css|js)$|@(example|domain|sentry|wixpress|email)\.|^(name|your|user)@/i;

/** The page's text with a space between separate elements (textContent runs them together). */
function spacedText(doc: Document): string {
  if (!doc.body) return '';
  const parts: string[] = [];
  const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const tag = n.parentElement?.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') continue;
    if (n.nodeValue?.trim()) parts.push(n.nodeValue);
  }
  return parts.join(' ');
}

export function findEmails(doc: Document): string[] {
  const found = new Set<string>();
  for (const a of safeQueryAll(doc, 'a[href^="mailto:"]')) {
    const e = decodeURIComponent(a.getAttribute('href')!.slice(7).split('?')[0]).trim();
    if (e) found.add(e.toLowerCase());
  }
  const text = spacedText(doc)
    .replace(/\s*[[(]\s*at\s*[\])]\s*/gi, '@')
    .replace(/\s*[[(]\s*dot\s*[\])]\s*/gi, '.');
  for (const m of text.match(EMAIL_RE) ?? []) found.add(m.toLowerCase());
  return [...found].filter((e) => !BAD_EMAIL.test(e));
}

const PHONE_RE = /(?:\+|00)\d[\d\s().-]{6,18}\d|\(\d{2,4}\)\s?\d{3,4}[\s.-]?\d{3,4}|\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b/g;

/** Phone numbers from tel: links and visible text. */
export function findPhones(doc: Document): string[] {
  const found = new Map<string, string>();
  const add = (raw: string) => {
    const t = raw.replace(/\s+/g, ' ').trim();
    const digits = t.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15 || /^(\d)\1+$/.test(digits) || /^(19|20)\d{2}[\s.-]?(19|20)\d{2}$/.test(t)) return;
    if (!found.has(digits)) found.set(digits, t);
  };
  for (const a of safeQueryAll(doc, 'a[href^="tel:"]')) add(decodeURIComponent(a.getAttribute('href')!.slice(4)));
  const text = spacedText(doc).replace(/\s+/g, ' ');
  for (const m of text.match(PHONE_RE) ?? []) add(m);
  return [...found.values()];
}

export const SOCIAL_NETWORKS: { name: string; re: RegExp }[] = [
  { name: 'x', re: /^https?:\/\/(www\.)?(twitter|x)\.com\/(?!intent|share|home|search|hashtag)[A-Za-z0-9_]{1,30}\/?$/i },
  { name: 'instagram', re: /^https?:\/\/(www\.)?instagram\.com\/(?!p\/|explore|accounts)[A-Za-z0-9_.]+\/?/i },
  { name: 'facebook', re: /^https?:\/\/(www\.|m\.)?facebook\.com\/(?!sharer|share|dialog|plugins|tr\b)[^?#]+/i },
  { name: 'linkedin', re: /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/(company|in|school)\/[^?#]+/i },
  { name: 'youtube', re: /^https?:\/\/(www\.)?youtube\.com\/(@|c\/|channel\/|user\/)[^?#]+/i },
  { name: 'tiktok', re: /^https?:\/\/(www\.)?tiktok\.com\/@[^?#/]+/i },
  { name: 'pinterest', re: /^https?:\/\/([a-z]{2}\.)?pinterest\.[a-z.]+\/(?!pin\/)[^?#/]+\/?$/i },
  { name: 'threads', re: /^https?:\/\/(www\.)?threads\.(net|com)\/@[^?#/]+/i },
  { name: 'github', re: /^https?:\/\/(www\.)?github\.com\/[A-Za-z0-9-]+\/?$/i },
  { name: 'discord', re: /^https?:\/\/(www\.)?(discord\.gg|discord\.com\/invite)\/[^?#/]+/i },
  { name: 'telegram', re: /^https?:\/\/(www\.)?t\.me\/[^?#/]+/i },
  { name: 'whatsapp', re: /^https?:\/\/(wa\.me\/\d+|(api|chat)\.whatsapp\.com\/[^?#]+|(www\.)?whatsapp\.com\/(channel|send)[^#]*)/i },
  { name: 'kakaotalk', re: /^https?:\/\/(pf\.kakao\.com|open\.kakao\.com)\/[^?#]+/i },
  { name: 'line', re: /^https?:\/\/(line\.me\/(R\/)?ti\/p|lin\.ee)\/[^?#]+/i },
  { name: 'naver_blog', re: /^https?:\/\/(m\.)?blog\.naver\.com\/[^?#/]+/i },
  { name: 'snapchat', re: /^https?:\/\/(www\.)?snapchat\.com\/add\/[^?#/]+/i },
  { name: 'reddit', re: /^https?:\/\/(www\.)?reddit\.com\/(r|user|u)\/[^?#/]+/i },
  { name: 'twitch', re: /^https?:\/\/(www\.)?twitch\.tv\/[A-Za-z0-9_]{3,}\/?$/i },
  { name: 'tumblr', re: /^https?:\/\/[\w-]+\.tumblr\.com\/?$/i },
  { name: 'patreon', re: /^https?:\/\/(www\.)?patreon\.com\/(?!login|join|signup)[^?#/]+/i },
];

export function findSocials(doc: Document, url: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of safeQueryAll(doc, 'a[href]')) {
    const href = abs(a.getAttribute('href'), url);
    for (const n of SOCIAL_NETWORKS) if (!out[n.name] && n.re.test(href)) out[n.name] = href.replace(/\/$/, '');
  }
  return out;
}

const DEEP_LINK = /contact|about|impressum|imprint|team|support|kontakt|contacto|legal|company/i;

/** Same-site links worth following when hunting for contact details. */
export function contactLinks(doc: Document, url: string, max = 5): string[] {
  const origin = new URL(url).origin;
  const out = new Set<string>();
  for (const a of safeQueryAll(doc, 'a[href]')) {
    const href = abs(a.getAttribute('href'), url).split('#')[0];
    if (!href.startsWith(origin) || href === url) continue;
    if (DEEP_LINK.test(href) || DEEP_LINK.test(a.textContent ?? '')) out.add(href);
    if (out.size >= max) break;
  }
  return [...out];
}

/** Clean article text using Mozilla Readability. Clones the document so the page is untouched. */
export function readableText(doc: Document, url: string): Row {
  const clone = doc.cloneNode(true) as Document;
  const art = new Readability(clone).parse();
  const text = clean(art?.textContent ?? doc.body?.textContent);
  return {
    url,
    title: clean(art?.title) || clean(doc.title),
    byline: clean(art?.byline),
    site_name: clean(art?.siteName),
    excerpt: clean(art?.excerpt),
    language: clean(art?.lang) || clean(doc.documentElement.getAttribute('lang')),
    word_count: String(text ? text.split(' ').length : 0),
    text,
  };
}

export interface ImageInfo {
  src: string;
  alt: string;
  width: number;
  height: number;
  page: string;
  /** Product the picture belongs to, when Gleaner can tell (card or product page). */
  product?: string;
  sku?: string;
  brand?: string;
  part?: string;
  /** A bigger version found for a small picture (its link, a zoom attribute, or what opening it shows). */
  big?: string;
  /** The product variant this picture shows (colour, size...). */
  variant?: string;
}

function bestSrcset(srcset: string, base: string): string {
  let best = '';
  let bestW = 0;
  for (const part of srcset.split(',')) {
    const [u, d] = part.trim().split(/\s+/);
    const w = parseFloat(d) || 1;
    if (u && w >= bestW) ((bestW = w), (best = u));
  }
  return abs(best, base);
}

/** The real picture address, preferring lazy-load attributes over a placeholder src. */
function lazyOrSrc(el: Element): string | null {
  const lazy = el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('ec-data-src') || el.getAttribute('data-original') || el.getAttribute('data-lazy') || el.getAttribute('data-echo') || el.getAttribute('data-zoom-image');
  const src = el.getAttribute('src');
  // Placeholders: data: pixels, "blank"/"loading"/"spacer" gifs
  if (lazy && (!src || /^data:|blank|spacer|loading|lazy|placeholder|transparent|1x1/i.test(src))) return lazy;
  return src || lazy;
}

/** The URL an <img> really shows: the biggest srcset entry, lazy-load attributes, or src. */
export function imgSrc(el: HTMLImageElement, url: string, live = false): string {
  const srcset = el.getAttribute('srcset') || el.getAttribute('data-srcset');
  const src = srcset ? bestSrcset(srcset, url) : abs(lazyOrSrc(el), url);
  // Live pages report a lazy-load placeholder as currentSrc; the real address is in the lazy attribute then
  const placeholder = !el.currentSrc || /^data:|blank|spacer|placeholder|transparent|1x1/i.test(el.currentSrc);
  return live && !srcset && !placeholder && src === abs(el.getAttribute('src'), url) ? el.currentSrc : src;
}

/** Images referenced by a document. Sizes are only known on a live page. */
export function findImages(doc: Document, url: string, live = false): ImageInfo[] {
  const seen = new Map<string, ImageInfo>();
  const add = (src: string, alt = '', w = 0, h = 0, big = '') => {
    if (!src || src.startsWith('data:') && src.length < 200) return;
    if (!seen.has(src)) seen.set(src, { src, alt: clean(alt), width: w, height: h, page: url, ...(big && big !== src ? { big } : {}) });
  };
  for (const img of safeQueryAll(doc, 'img')) {
    const el = img as HTMLImageElement;
    add(imgSrc(el, url, live), el.alt, live ? el.naturalWidth : 0, live ? el.naturalHeight : 0, linkedBig(el, url));
  }
  for (const s of safeQueryAll(doc, 'picture source[srcset]')) add(bestSrcset(s.getAttribute('srcset')!, url));
  add(abs(meta(doc, 'og:image'), url), 'og:image');
  if (live) {
    for (const el of safeQueryAll(doc, '*')) {
      const bg = getComputedStyle(el).backgroundImage;
      const m = bg && bg !== 'none' ? bg.match(/url\(["']?([^"')]+)["']?\)/) : null;
      if (m) add(abs(m[1], url));
    }
  }
  return [...seen.values()];
}
