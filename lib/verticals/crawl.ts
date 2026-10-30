// Walk the pages of an industry search (job board results, property search, directory listings,
// review pages) in a tab: read each page, move to the next, and stop when nothing new appears.
// Uses the same pacing, page checks and bot-check pause as the store crawler.
import { SPEEDS, nextPageUrl, type Speed } from '../listing';
import type { NextControl } from '../paging';
import type { PageHealth } from '../dom/health';
import { call, sleep, tabs, waitForLoad } from '../tab';
import { VERTICALS, type VerticalKind } from './index';
import type { Row } from './structured';

export interface VerticalCrawlOptions {
  maxPages: number;
  maxItems: number;
  speed: Speed;
  signal: AbortSignal;
  status: (m: string) => void;
  progress: (n: number) => void;
  interactive?: boolean;
  onBotCheck?: () => void;
  /** Real mouse-wheel scrolling at a point, for lists that ignore scrolling by scripts (Google reviews). */
  wheel?: (x: number, y: number) => Promise<boolean>;
  /** Items earlier runs already have: loading stops once a round brings only these (newest-first lists). */
  known?: Set<string> | null;
}

const jitter = (a: number, b: number) => a + Math.random() * (b - a);
const BOT_WAIT_MS = 5 * 60 * 1000;

async function settle(tabId: number) {
  try {
    if ((await tabs.get(tabId)).status === 'loading') await waitForLoad(tabId);
  } catch {
    /* mid-navigation */
  }
  await sleep(900);
}

/** Every item across the pages of a search, starting from the page open in the tab. */
export async function crawlVertical(tabId: number, kind: VerticalKind, o: VerticalCrawlOptions): Promise<{ rows: Row[]; pages: number; loads: number; stopped: string }> {
  const v = VERTICALS[kind];
  const speed = SPEEDS[o.speed];
  const seen = new Set<string>();
  const rows: Row[] = [];
  let pages = 0;
  // Pages reached by Next or the address; loading more in place (scrolling, "Show more") isn't a new page
  let navPages = 1;
  let loads = 0;
  let stopped = 'Reached the last page';
  let notified = false;
  // Rounds of loading in place that brought nothing new; a slow list gets a second chance
  let idle = 0;

  const healthy = () => call<PageHealth>(tabId, 'pageHealth').catch(() => null);
  const waitForHuman = async (): Promise<boolean> => {
    if (!notified) ((notified = true), o.onBotCheck?.());
    if (!o.interactive) return false;
    await tabs.show(tabId).catch(() => {});
    const until = Date.now() + BOT_WAIT_MS;
    while (Date.now() < until && !o.signal.aborted) {
      o.status(`Page ${pages + 1} needs a human: solve the check in the open tab. Waiting ${Math.ceil((until - Date.now()) / 60000)} min.`);
      await sleep(3000);
      if ((await healthy())?.ok) return true;
    }
    return false;
  };

  while (!o.signal.aborted) {
    const h = await healthy();
    if (h?.reason === 'bot check' && !(await waitForHuman())) {
      stopped = `A bot check on page ${pages + 1} wasn't solved, so Gleaner stopped and saved what it had`;
      break;
    }
    // Open "More" on cut-off reviews before reading them
    if (kind === 'reviews' && (await call<number>(tabId, 'expandTruncated').catch(() => 0))) await sleep(900);
    const found = (await call<Row[]>(tabId, 'vertical', kind).catch(() => [])) ?? [];
    pages++;
    let added = 0;
    for (const r of found) {
      const k = v.key(r);
      if (k && !seen.has(k)) {
        seen.add(k);
        rows.push(r);
        added++;
      }
    }
    o.progress(rows.length);
    // Newest first: once a whole round is items from the last run, the rest are older still
    if (o.known?.size && pages > 1 && added && (await call<boolean>(tabId, 'newestFirst').catch(() => false))) {
      // Only what this round added: lists that grow in place show the earlier items too
      const fresh = rows.slice(-added).filter((r) => !o.known!.has(v.key(r))).length;
      if (fresh === 0) {
        stopped = `Reached the ${v.label} you already have from the last run`;
        break;
      }
    }
    o.status(loads ? `Loaded more ${loads} times: ${rows.length} ${v.label} so far` : `Page ${navPages}: ${rows.length} ${v.label} so far`);
    if (pages === 1 && !found.length) {
      stopped = `No ${v.label} found on this page`;
      break;
    }
    idle = pages > 1 && added === 0 ? idle + 1 : 0;
    if (idle && (!loads || idle >= 3)) {
      stopped = loads ? `Loading more brought nothing new, so all ${rows.length} were read` : `Page ${navPages} had nothing new, so that was the last page`;
      break;
    }
    if (rows.length >= o.maxItems) {
      stopped = `Reached the ${o.maxItems} item limit`;
      break;
    }
    if (loads >= 2000) {
      stopped = 'Loaded more 2,000 times; stopping there';
      break;
    }
    await sleep(jitter(speed.min, speed.max));

    // Move on: a Next button or page number, the page number in the address, or (for lists that
    // grow in place) a "Show more" button or scrolling, inside a panel if that's where the list is
    const before = await call<string>(tabId, 'verticalSignature', kind).catch(() => '');
    const changed = async (tries: number) => {
      for (let i = 0; i < tries && !o.signal.aborted; i++) {
        await settle(tabId);
        const now = await call<string>(tabId, 'verticalSignature', kind).catch(() => '');
        if (now && now !== before) return true;
        if ((await healthy())?.reason === 'bot check') return true; // let the loop handle it
      }
      return false;
    };
    let moved = false;
    let how: 'page' | 'load' = 'page';
    const mayPage = navPages < o.maxPages;
    const next = await call<NextControl | null>(tabId, 'findNextControl').catch(() => null);
    if (next && (mayPage || next.kind === 'load-more') && (await call<boolean>(tabId, 'clickNext', next.selector).catch(() => false))) {
      moved = await changed(next.kind === 'load-more' ? 10 : 14);
      if (next.kind === 'load-more') how = 'load';
    }
    if (!moved && mayPage) {
      const url = nextPageUrl(await call<string>(tabId, 'location').catch(() => ''));
      if (url && (await call<boolean>(tabId, 'gotoUrl', url).catch(() => false))) moved = await changed(14);
    }
    // Infinite scroll and "Show N more": a few tries, since new items can take a moment to arrive
    for (let attempt = 0; !moved && attempt < 3 && !o.signal.aborted; attempt++) {
      const r = await call<{ how: string; label?: string }>(tabId, 'loadMore').catch(() => ({ how: 'none', label: '' }));
      if (r.how === 'none' && attempt > 0) break;
      if (r.how !== 'none') o.status(`${r.how === 'clicked' ? `Clicked "${r.label}"` : 'Scrolled'} to load more: ${rows.length} ${v.label} so far`);
      moved = await changed(6);
      if (moved) how = 'load';
    }
    // Some lists (Google's review window) only load when a person scrolls: scroll for real
    for (let attempt = 0; !moved && o.wheel && attempt < 3 && !o.signal.aborted; attempt++) {
      const at = await call<{ x: number; y: number } | null>(tabId, 'scrollPoint').catch(() => null);
      if (!at || !(await o.wheel(at.x, at.y))) break;
      o.status(`Scrolling the list to load more: ${rows.length} ${v.label} so far`);
      moved = await changed(8);
      if (moved) how = 'load';
    }
    if (!moved && kind === 'reviews' && (await call<boolean>(tabId, 'limitedView').catch(() => false))) {
      stopped = `Google shows only a few reviews when you aren't signed in (${rows.length} read). Sign in to Google in this browser, or open the place's reviews from Google Search, and run again`;
      break;
    }
    if (!moved) {
      stopped = !mayPage && next && next.kind !== 'load-more' ? `Reached the ${o.maxPages} page limit` : pages === 1 ? 'Everything on this page was read; there was no next page or more to load' : loads ? `Reached the end: all ${rows.length} ${v.label} loaded` : `Reached the last page (${navPages})`;
      break;
    }
    if (how === 'load') loads++;
    else navPages++;
  }
  if (o.signal.aborted) stopped = `Stopped after page ${pages}`;
  return { rows: rows.slice(0, o.maxItems), pages: navPages, loads, stopped };
}
