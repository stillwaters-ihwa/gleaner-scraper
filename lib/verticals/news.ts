// News and content: read articles (headline, author, date, publisher, text), find the articles on
// a news section or blog page, and read RSS/Atom feeds. Each article gets a sentiment score.
import { Readability } from '@mozilla/readability';
import { absUrl, compact, firstImage, isoDate, isType, ldNodes, str, type Row } from './structured';
import { keywords, sentiment } from './sentiment';

export const ARTICLE_COLUMNS = [
  ['title', 'headline'],
  ['author', 'author'],
  ['published', 'published'],
  ['updated', 'updated'],
  ['publisher', 'publisher'],
  ['section', 'section'],
  ['tags', 'tags'],
  ['summary', 'summary'],
  ['sentiment', 'sentiment'],
  ['sentiment_score', 'sentiment score'],
  ['keywords', 'keywords'],
  ['word_count', 'words'],
  ['language', 'language'],
  ['image', 'image'],
  ['text', 'text'],
  ['url', 'url'],
  ['source', 'found via'],
] as const;

const ARTICLE = ['newsarticle', 'article', 'blogposting', 'reportagenewsarticle', 'analysisnewsarticle', 'opinionnewsarticle', 'scholarlyarticle', 'techarticle', 'liveblogposting', 'socialmediaposting'];
const meta = (doc: Document, ...names: string[]) => {
  for (const n of names) {
    const v = doc.querySelector(`meta[property="${n}"], meta[name="${n}"], meta[itemprop="${n}"]`)?.getAttribute('content');
    if (v?.trim()) return v.trim();
  }
  return '';
};
const authorsOf = (a: any) => str([].concat(a ?? []).map((x: any) => (typeof x === 'string' ? x : x?.name)).filter(Boolean));

/** One article page as a row, with clean text and a sentiment score. */
export function extractArticle(doc: Document, url: string, opts: { withText?: boolean } = {}): Row {
  const ld = ldNodes(doc).find((n) => isType(n, ARTICLE)) ?? {};
  const art = new Readability(doc.cloneNode(true) as Document).parse();
  const text = str(art?.textContent);
  const words = text ? text.split(' ').length : 0;
  const title = str(ld.headline ?? ld.name) || meta(doc, 'og:title', 'twitter:title') || str(art?.title) || str(doc.title);
  const summary = str(ld.description) || meta(doc, 'og:description', 'description', 'twitter:description') || str(art?.excerpt);
  const s = sentiment(`${title}. ${summary}. ${text.slice(0, 6000)}`);
  return compact({
    title,
    author: authorsOf(ld.author) || meta(doc, 'author', 'article:author', 'parsely-author', 'sailthru.author') || str(art?.byline),
    published: isoDate(ld.datePublished ?? meta(doc, 'article:published_time', 'datePublished', 'pubdate', 'parsely-pub-date', 'date', 'DC.date.issued') ?? doc.querySelector('time[datetime]')?.getAttribute('datetime')),
    updated: isoDate(ld.dateModified ?? meta(doc, 'article:modified_time', 'dateModified')),
    publisher: str(ld.publisher?.name ?? ld.publisher) || meta(doc, 'og:site_name', 'application-name') || str(art?.siteName),
    section: str(ld.articleSection) || meta(doc, 'article:section', 'parsely-section'),
    tags: str(ld.keywords) || [...doc.querySelectorAll('meta[property="article:tag"]')].map((m) => m.getAttribute('content')).filter(Boolean).join(', '),
    summary: summary.slice(0, 500),
    sentiment: s.label,
    sentiment_score: String(s.score),
    keywords: keywords([text || summary], 8).join(', '),
    word_count: String(words),
    language: str(art?.lang) || doc.documentElement.getAttribute('lang') || '',
    image: firstImage(ld.image, url) || absUrl(meta(doc, 'og:image'), url),
    text: opts.withText === false ? '' : text.slice(0, 20000),
    url: absUrl(ld.url ?? doc.querySelector('link[rel="canonical"]')?.getAttribute('href'), url) || url,
    source: ld['@type'] ? 'article data' : 'page text',
  });
}

/** Whether a link looks like an article (dated path or a long hyphenated slug), not a section or tag page. */
export function looksLikeArticle(href: string, origin: string): boolean {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return false;
  }
  if (u.origin !== origin || u.hash && u.pathname === '/') return false;
  const p = u.pathname;
  if (/\/(tag|tags|category|categories|author|authors|topic|topics|section|page|search|login|signup|subscribe|account|about|contact|privacy|terms|video|videos|gallery|live|podcasts?)(\/|$)/i.test(p)) return false;
  if (/\.(jpg|png|gif|pdf|xml|rss|zip|mp4)$/i.test(p)) return false;
  if (/\/(19|20)\d{2}\/\d{1,2}(\/\d{1,2})?\//.test(p)) return true; // /2026/10/15/slug
  const slug = p.split('/').filter(Boolean).pop() ?? '';
  return slug.split('-').length >= 4 && slug.length >= 20 || /\b(article|story|news|post|blog)s?\/[\w-]{12,}/i.test(p) || /\d{6,}/.test(slug) && slug.length > 10;
}

/** Article links on a news section, homepage or blog index, with their visible headline. */
export function articleLinks(doc: Document, url: string, max = 200): { url: string; title: string }[] {
  const origin = new URL(url).origin;
  const out = new Map<string, string>();
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    if (a.closest('nav, header, footer, [role="navigation"], aside')) continue;
    const href = absUrl(a.getAttribute('href'), url).split('#')[0];
    if (!href || out.has(href) || !looksLikeArticle(href, origin)) continue;
    const title = str(a.textContent) || str(a.getAttribute('aria-label')) || str(a.querySelector('img')?.getAttribute('alt'));
    if (title.length < 12) continue;
    out.set(href, title);
    if (out.size >= max) break;
  }
  return [...out.entries()].map(([u, title]) => ({ url: u, title }));
}

/** RSS/Atom feeds a page advertises. */
export function feedLinks(doc: Document, url: string): string[] {
  return Array.from(doc.querySelectorAll('link[rel="alternate"][type*="rss"], link[rel="alternate"][type*="atom"], link[rel="alternate"][type*="feed"]'))
    .map((l) => absUrl(l.getAttribute('href'), url))
    .filter(Boolean);
}

/** Items in an RSS or Atom feed. */
export function parseFeed(xml: string, feedUrl: string): Row[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error("That address isn't a readable RSS or Atom feed.");
  const channel = str(doc.querySelector('channel > title, feed > title')?.textContent);
  const items = Array.from(doc.querySelectorAll('item, entry'));
  const tag = (el: Element, ...names: string[]) => {
    for (const n of names) {
      const found = el.getElementsByTagName(n)[0];
      if (found?.textContent?.trim()) return found.textContent.trim();
    }
    return '';
  };
  return items.map((el) => {
    const link = el.querySelector('link[href]')?.getAttribute('href') || tag(el, 'link', 'guid');
    const title = tag(el, 'title');
    const desc = tag(el, 'description', 'summary', 'content:encoded', 'content');
    const plain = str(new DOMParser().parseFromString(`<body>${desc}</body>`, 'text/html').body.textContent);
    const s = sentiment(`${title}. ${plain}`);
    return compact({
      title,
      author: tag(el, 'dc:creator', 'author', 'name'),
      published: isoDate(tag(el, 'pubDate', 'published', 'updated', 'dc:date')),
      publisher: channel,
      tags: Array.from(el.getElementsByTagName('category')).map((c) => c.getAttribute('term') || c.textContent?.trim()).filter(Boolean).join(', '),
      summary: plain.slice(0, 500),
      sentiment: s.label,
      sentiment_score: String(s.score),
      image: absUrl(el.querySelector('enclosure[type^="image"]')?.getAttribute('url') ?? el.getElementsByTagName('media:content')[0]?.getAttribute('url') ?? el.getElementsByTagName('media:thumbnail')[0]?.getAttribute('url'), feedUrl),
      url: absUrl(link, feedUrl),
      source: 'feed',
    });
  });
}

/** Filters shared by feeds and article crawls. */
export function articleFilter(opts: { since?: string; minWords?: number; keyword?: string }) {
  const kw = opts.keyword?.trim().toLowerCase();
  return (r: Row) =>
    (!opts.since || !r.published || r.published >= opts.since) &&
    (!opts.minWords || !r.word_count || Number(r.word_count) >= opts.minWords) &&
    (!kw || `${r.title} ${r.summary} ${r.text ?? ''}`.toLowerCase().includes(kw));
}
