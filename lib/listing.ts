// Walk every page of a product listing in a tab without skipping pages, and without
// overwhelming the site: paced waits, a health check on every page, recovery from error
// pages, and a resume point when a site keeps failing. Each page is scrolled (and "Show more"
// pressed) until no new products arrive before moving to the next page. Works from the panel
// and monitors.
import { waitForListChange, type NextControl } from './paging';
import type { Product } from './product';
import type { FormPager, PageHealth } from './dom/health';
import { call, sleep, tabs, waitForLoad } from './tab';

export type Speed = 'gentle' | 'normal' | 'fast';

/** Pause between pages (random within the range) and a longer cool-down every few pages. */
export const SPEEDS: Record<Speed, { min: number; max: number; coolEvery: number; coolMs: number; label: string }> = {
  gentle: { min: 3000, max: 6000, coolEvery: 15, coolMs: 30000, label: 'Gentle: 3 to 6 s between pages, 30 s break every 15 pages' },
  normal: { min: 1000, max: 2000, coolEvery: 40, coolMs: 10000, label: 'Normal: 1 to 2 s between pages, 10 s break every 40 pages' },
  fast: { min: 600, max: 1200, coolEvery: 40, coolMs: 8000, label: 'Fast: under 1.2 s between pages. Only for sites that cope well' },
};

export interface CrawlOptions {
  /** 0 means every page until the last one. */
  maxPages: number;
  maxItems: number;
  speed?: Speed;
  /** Start from this page number (resume). */
  startPage?: number;
  /** Extra pause for slow sites, added to the speed setting (ms). */
  pauseMs?: number;
  signal: AbortSignal;
  status: (message: string) => void;
  progress: (items: number) => void;
  /**
   * A person is watching and can solve a bot check. The panel sets this; scheduled monitors
   * leave it off, because no one is there to click at run time.
   */
  interactive?: boolean;
  /** Called once when a bot check first appears, so the panel can raise a notification. */
  onBotCheck?: () => void;
}

export interface CrawlResult {
  cards: Product[];
  pages: number;
  /** Why the walk ended, in plain words. */
  stopped: string;
  /** Error pages that were recovered from. */
  recovered: number;
  /** Set when the site kept failing: run again from this page to continue. */
  resumeFrom?: number;
}

/** Safety limit for "all pages", so a pager that loops forever can't run forever. */
const ALL_PAGES_LIMIT = 2000;
const BACKOFF = [5000, 15000, 40000];
/** How long to wait for a person to solve a bot check, and how often to look again. */
const BOT_WAIT_MS = 5 * 60 * 1000;
const BOT_POLL_MS = 3000;

const PAGE_PARAM = /([?&](?:page|p|pg|pagenum|pagenumber|page_no|pageno|currentpage|curr_page|cur_page|paged)=)(\d+)/i;
const PAGE_PATH = /(\/page[/-])(\d+)(\/|$)/i;

/** The next page's address when the page number is in the URL, e.g. ?page=2 or /page/2/. */
export function nextPageUrl(url: string): string | null {
  if (PAGE_PARAM.test(url)) return url.replace(PAGE_PARAM, (_m, pre, n) => `${pre}${Number(n) + 1}`);
  if (PAGE_PATH.test(url)) return url.replace(PAGE_PATH, (_m, pre, n, post) => `${pre}${Number(n) + 1}${post}`);
  return null;
}

/** The address of page `n`, when the page number is in the URL. */
export function pageUrl(url: string, n: number): string | null {
  if (PAGE_PARAM.test(url)) return url.replace(PAGE_PARAM, (_m, pre) => `${pre}${n}`);
  if (PAGE_PATH.test(url)) return url.replace(PAGE_PATH, (_m, pre, _n, post) => `${pre}${n}${post}`);
  return null;
}

export type PagerInfo = { kind: NextControl['kind'] | 'url' | 'form'; label: string } | null;

/** What will move to the next page: a button on the page, the URL, or a pager form. */
export async function describePager(tabId: number): Promise<PagerInfo> {
  const next = await call<NextControl | null>(tabId, 'findNextControl');
  const form = await call<FormPager | null>(tabId, 'formPager');
  if (next) return { kind: next.kind, label: next.label + (form ? ' (can jump to any page number)' : '') };
  const url = await call<string>(tabId, 'location');
  if (nextPageUrl(url)) return { kind: 'url', label: 'the page number in the address' };
  return form ? { kind: 'form', label: 'the page number form' } : null;
}

const jitter = (min: number, max: number) => min + Math.random() * (max - min);

async function settle(tabId: number) {
  try {
    if ((await tabs.get(tabId)).status === 'loading') await waitForLoad(tabId);
  } catch {
    /* tab closed */
  }
  await sleep(900);
}

/** Collect product cards from this page and every page after it. */
export async function crawlListing(tabId: number, opts: CrawlOptions): Promise<CrawlResult> {
  const speed = SPEEDS[opts.speed ?? 'normal'];
  const grid = await call<{ itemSelector: string; count: number } | null>(tabId, 'findProductList');
  if (!grid) throw new Error("Couldn't find a product grid on this page. Open a search or category page, or use the List extractor and pick the list by hand.");
  let itemSelector = grid.itemSelector;
  // Amazon's result cards keep one address on every page. Never trade it for another list on
  // the page (a sponsored carousel): when the cards are missing, they are still being drawn.
  const fixedGrid = /s-search-result/.test(itemSelector);
  const firstCount = grid.count;
  /** Wait up to `ms` for the grid's items to appear; true once they do. */
  const waitForCards = async (ms: number) => {
    const until = Date.now() + ms;
    while (Date.now() < until && !opts.signal.aborted) {
      const h = await call<PageHealth>(tabId, 'pageHealth', itemSelector).catch(() => null);
      if (h && h.items > 0) return true;
      if (h?.reason === 'bot check') return false;
      await sleep(700);
    }
    return false;
  };
  /** Another list found on a later page is only the product grid when it's about as big as page 1's. */
  const refind = async (): Promise<boolean> => {
    if (fixedGrid) return waitForCards(15000);
    const again = await call<{ itemSelector: string; count: number } | null>(tabId, 'findProductList').catch(() => null);
    if (!again || again.count < Math.max(3, firstCount * 0.4)) return false;
    itemSelector = again.itemSelector;
    return true;
  };
  const listingUrl = await call<string>(tabId, 'location');
  // Remember how this site pages, from a healthy page, for recovery later
  const form = await call<FormPager | null>(tabId, 'formPager');

  let slowdown = 1;
  let recovered = 0;
  let botNotified = false;

  /**
   * A bot check (CAPTCHA, "verify you are human", Cloudflare) blocks the page. Gleaner does not
   * try to defeat it. When a person is watching, bring the page to the front and wait for them
   * to solve it, then carry on. When no one is there (a scheduled run), give up at once.
   */
  const clearBotCheck = async (n: number): Promise<boolean> => {
    if (!botNotified) {
      botNotified = true;
      opts.onBotCheck?.();
    }
    if (!opts.interactive) {
      opts.status(`Page ${n} showed a bot check. Scheduled runs can't solve one, so Gleaner stopped.`);
      return false;
    }
    await tabs.show(tabId).catch(() => {});
    const until = Date.now() + BOT_WAIT_MS;
    while (Date.now() < until && !opts.signal.aborted) {
      const left = Math.ceil((until - Date.now()) / 1000);
      opts.status(`Page ${n} needs a human: solve the check in the open tab. Waiting ${left > 90 ? `${Math.ceil(left / 60)} min` : `${left} s`}.`);
      await sleep(BOT_POLL_MS);
      const h = await healthy().catch(() => null);
      if (h?.ok) {
        slowdown = Math.min(3, slowdown * 1.5); // ease off after a block
        return true;
      }
    }
    return false;
  };

  /** Load page `n` directly: URL, pager form, or (last resort) back then next. */
  const jumpTo = async (n: number): Promise<boolean> => {
    const byUrl = pageUrl(listingUrl, n);
    if (byUrl) {
      await call(tabId, 'gotoUrl', byUrl);
      await settle(tabId);
      return true;
    }
    if (form) {
      // Start again from the listing itself, then submit its pager form for page n
      await call(tabId, 'gotoUrl', listingUrl);
      await settle(tabId);
      if (await call<boolean>(tabId, 'formGoto', n)) {
        await settle(tabId);
        return true;
      }
    }
    return false;
  };

  const healthy = () => call<PageHealth>(tabId, 'pageHealth', itemSelector);

  /** The page that should be page `n` is broken: wait, retry, and confirm it's back. */
  const recover = async (n: number, reason: string): Promise<boolean> => {
    // A bot check is never solved by waiting and retrying: it needs a person (see clearBotCheck).
    if (reason === 'bot check') return clearBotCheck(n);
    for (let attempt = 0; attempt < BACKOFF.length && !opts.signal.aborted; attempt++) {
      const wait = BACKOFF[attempt];
      opts.status(`Page ${n} showed an error. Waiting ${wait / 1000} s, then retrying (${attempt + 1} of ${BACKOFF.length}).`);
      await sleep(wait);
      const jumped = await jumpTo(n).catch(() => false);
      if (!jumped) {
        // No direct way to page n: go back to the last good page and press next again
        await call(tabId, 'goBack').catch(() => {});
        await settle(tabId);
        const next = await call<NextControl | null>(tabId, 'findNextControl').catch(() => null);
        // Only a real pager control: a "See more" link elsewhere on the page leads somewhere else
        if (next && next.kind !== 'load-more') {
          await call(tabId, 'clickNext', next.selector).catch(() => {});
          await settle(tabId);
        }
      }
      const h = await healthy().catch(() => null);
      if (h?.ok) {
        recovered++;
        slowdown = Math.min(3, slowdown * 1.5); // the site is struggling: slow down for the rest of the run
        return true;
      }
    }
    return false;
  };

  const limit = opts.maxPages > 0 ? opts.maxPages : ALL_PAGES_LIMIT;
  const seen = new Set<string>();
  const cards: Product[] = [];
  /** Adds new products from what the page shows now; returns how many were new. */
  const collect = async (): Promise<number> => {
    let here = await call<Product[]>(tabId, 'extractCards', itemSelector).catch(() => [] as Product[]);
    if (!here.length && (await refind())) {
      // The grid's address can differ on later pages (a banner shifts it), or it is still loading
      here = await call<Product[]>(tabId, 'extractCards', itemSelector).catch(() => [] as Product[]);
    }
    let n = 0;
    for (const c of here) {
      const k = c.url || c.title;
      if (!k) continue;
      if (!seen.has(k)) {
        seen.add(k);
        cards.push(c);
        n++;
      } else if (!c.sponsored) {
        // The same product as an ad and as a normal result: keep the normal result
        const i = cards.findIndex((x) => (x.url || x.title) === k);
        if (i >= 0 && cards[i].sponsored) cards[i] = c;
      }
    }
    return n;
  };
  /** Scroll this page (and press "Show more") until no new products arrive. Returns how many came.
   *  On a page with a pager, one short look is enough: those pages rarely grow when scrolled. */
  const loadAllHere = async (paged = false): Promise<number> => {
    let got = 0;
    for (let round = 0, misses = 0; round < 300 && misses < 2 && cards.length < opts.maxItems && !opts.signal.aborted; round++) {
      const before = await call<string>(tabId, 'signature', itemSelector).catch(() => '');
      const r = await call<{ how: string; label?: string }>(tabId, 'loadMore').catch(() => ({ how: 'none', label: '' }));
      if (r.how === 'none') break;
      opts.status(`Page ${page}: ${r.how === 'clicked' ? `clicked "${r.label}"` : 'scrolling'} to load more products, ${cards.length} so far`);
      const changed = await waitForListChange(tabId, itemSelector, before, opts.signal, paged ? 1500 : misses ? 8000 : 5000);
      const n = changed ? await collect() : 0;
      got += n;
      opts.progress(cards.length);
      misses = n ? 0 : misses + 1;
      // A page whose products don't grow when scrolled: one look is enough
      if (!changed && round === 0) break;
    }
    return got;
  };
  let emptyPages = 0;
  // This page was reached only by changing the page number in the address
  let viaAddress = false;
  let page = Math.max(1, opts.startPage ?? 1);
  let pagesRead = 0;
  let stopped = 'Reached the last page';
  let resumeFrom: number | undefined;

  if (page > 1) {
    opts.status(`Going to page ${page}`);
    if (!(await jumpTo(page))) {
      // Click through to the start page without reading the pages before it
      for (let p = 1; p < page && !opts.signal.aborted; p++) {
        const next = await call<NextControl | null>(tabId, 'findNextControl');
        if (!next || !(await call<boolean>(tabId, 'clickNext', next.selector))) throw new Error(`Couldn't reach page ${page}: this listing has fewer pages.`);
        await settle(tabId);
        await sleep(jitter(speed.min, speed.max));
      }
    }
  }

  while (!opts.signal.aborted) {
    // Guardrail: never read an error page as if it were the next page
    const h = await healthy().catch(() => null);
    if (!h?.ok) {
      if (h?.reason === 'no products' && (await refind())) {
        /* the grid is back */
      } else if (h?.reason === 'no products' && fixedGrid && pagesRead) {
        if (viaAddress) pagesRead--;
        stopped = `Page ${page - 1} was the last page`;
        break;
      } else if (!(await recover(page, h?.reason ?? 'error page'))) {
        resumeFrom = page;
        stopped =
          h?.reason === 'bot check'
            ? `A bot check on page ${page} wasn't solved in time, so Gleaner stopped and saved what it had`
            : `The site kept failing on page ${page}, so Gleaner stopped and saved what it had`;
        break;
      }
    }

    pagesRead++;
    let added = await collect();
    opts.progress(cards.length);
    // Everything this page can show, before moving on
    if (cards.length < opts.maxItems) {
      const pager = await call<NextControl | null>(tabId, 'findNextControl').catch(() => null);
      added += await loadAllHere(!!pager && pager.kind !== 'load-more');
    }
    opts.status(`Page ${page}${opts.maxPages > 0 ? ` of ${(opts.startPage ?? 1) - 1 + opts.maxPages}` : ''}: ${cards.length} products so far${recovered ? `, ${recovered} error ${recovered === 1 ? 'page' : 'pages'} recovered` : ''}`);

    // A page with nothing new usually means the end; a second one in a row makes sure
    emptyPages = pagesRead > 1 && added === 0 ? emptyPages + 1 : 0;
    if (emptyPages >= 2 || (emptyPages && viaAddress)) {
      if (viaAddress) pagesRead--; // the repeat past the end isn't a page
      stopped = viaAddress ? `Page ${page - 1} was the last page` : `Pages ${page - 1} and ${page} had no new products, so that was the last page`;
      break;
    }
    if (cards.length >= opts.maxItems) {
      stopped = `Reached the ${opts.maxItems} product limit`;
      break;
    }
    if (pagesRead >= limit) {
      stopped = opts.maxPages > 0 ? `Reached the ${opts.maxPages} page limit` : `Stopped at ${ALL_PAGES_LIMIT} pages`;
      break;
    }

    // Pace before asking the site for the next page
    await sleep(jitter(speed.min, speed.max) * slowdown + (opts.pauseMs ?? 0));
    if (pagesRead % speed.coolEvery === 0) {
      opts.status(`Short break after ${pagesRead} pages, so the site isn't overloaded`);
      await sleep(speed.coolMs);
    }

    // The pager says this is the last page: don't make up later page numbers
    if (await call<boolean>(tabId, 'pagerAtEnd').catch(() => false)) {
      stopped = `Reached the last page (${page})`;
      break;
    }
    const before = await call<string>(tabId, 'signature', itemSelector).catch(() => '');
    const beforeCards = await call<string>(tabId, 'cardsSignature', itemSelector).catch(() => '');
    const beforeUrl = await call<string>(tabId, 'location').catch(() => '');
    // The list changed, or (after clicking the pager) the address did: a new page whose grid sits elsewhere
    const arrived = async (ms: number, byClick = true) => {
      if (await waitForListChange(tabId, itemSelector, before, opts.signal, ms)) {
        if (!fixedGrid) return true;
        // Amazon changes the address first and draws the new cards a moment later
        const until = Date.now() + 15000;
        while (Date.now() < until && !opts.signal.aborted) {
          const now = await call<string>(tabId, 'cardsSignature', itemSelector).catch(() => '');
          if (now && now !== beforeCards && !now.startsWith('0|')) return true;
          await sleep(600);
        }
        return true; // the health check at the top of the loop decides what this page is
      }
      const now = await call<string>(tabId, 'location').catch(() => beforeUrl);
      return byClick && !!now && now !== beforeUrl;
    };
    let moved = false;
    viaAddress = false;
    const next = await call<NextControl | null>(tabId, 'findNextControl').catch(() => null);
    if (next && next.kind !== 'load-more' && (await call<boolean>(tabId, 'clickNext', next.selector).catch(() => false))) moved = await arrived(30000);
    if (!moved) {
      // The next page's number in the pager, then in the address
      const num = await call<NextControl | null>(tabId, 'findPageNumber', page + 1).catch(() => null);
      if (num && num.selector !== next?.selector && (await call<boolean>(tabId, 'clickNext', num.selector).catch(() => false))) moved = await arrived(30000);
    }
    if (!moved) {
      const url = nextPageUrl(beforeUrl) ?? pageUrl(listingUrl, page + 1);
      if (url && url !== beforeUrl) {
        await call(tabId, 'gotoUrl', url);
        // Past the last page a site may just show it again: only new products count
        moved = await arrived(30000, false);
        viaAddress = moved;
      }
    }
    if (!moved) {
      // Nothing changed: the end of the listing, unless the click landed on an error page
      const after = await healthy().catch(() => null);
      if (after && !after.ok && after.reason !== 'no products' && (next || form)) {
        page++;
        continue; // the health check at the top of the loop recovers this page
      }
      stopped = pagesRead === 1 ? (cards.length > (grid.count ?? 0) ? `Scrolled to the end of the list: ${cards.length} products` : 'This listing has only one page') : `Reached the last page (${page})`;
      break;
    }
    page++;
  }
  if (opts.signal.aborted) stopped = `Stopped after page ${page}`;
  await call(tabId, 'clear').catch(() => {});
  return { cards: cards.slice(0, opts.maxItems), pages: pagesRead, stopped, recovered, resumeFrom };
}
