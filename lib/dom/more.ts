// Loading more of a list that has no next page: "Show 10 more reviews" style buttons, and
// infinite scroll, including lists that scroll inside a panel (like Google's review dialog)
// rather than the page. Also opens "More" links that cut long reviews short. Runs in the page.
import { isVisible } from './list';
import { openDialog } from './dialog';

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
// A count may follow the label: "See more reviews (101,798)", "More reviews (52)"
const COUNT = String.raw`(\s*[(（]?[\d,.\s]+(件|개)?[)）]?)?`;
export const LOAD_MORE = new RegExp(
  `^((load|show|view|see)( \\d+)? more( reviews| results| products| items| listings| comments| jobs)?|more (reviews|results|products|listings|comments)|(see|view|show) all reviews|더\\s?보기|리뷰 더보기|もっと見る|クチコミをもっと見る|すべてのクチコミ|mehr laden|ver más|charger plus|afficher plus)${COUNT}$`,
  'i',
);
const EXPAND = /^(more|read more|see more|show more|…\s*more|더\s?보기|もっと見る|mehr|plus)$/i;

const enabled = (el: Element) => !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true';

/** Click a link or button without following a real link to another page. */
function safeClick(el: HTMLElement): boolean {
  const a = el.closest('a[href]');
  const href = a?.getAttribute('href') ?? '';
  // A real link would leave the page; "More" expanders are buttons, "#" or javascript: links
  if (a && href && !/^(#|javascript:)/i.test(href) && !a.getAttribute('role') && !a.hasAttribute('jsaction')) return false;
  if (a && /^javascript:/i.test(href)) {
    const cancel = (e: Event) => e.preventDefault();
    window.addEventListener('click', cancel, { once: true, capture: true });
    setTimeout(() => window.removeEventListener('click', cancel, true), 0);
  }
  el.click();
  return true;
}

/** Open "More" expanders that cut long reviews or posts short. Returns how many were opened. */
export function expandTruncated(max = 80): number {
  let n = 0;
  for (const el of Array.from(document.querySelectorAll('button, [role="button"], a, span[jsaction], span[tabindex]')) as HTMLElement[]) {
    if (n >= max) break;
    const label = clean(el.innerText || el.getAttribute('aria-label'));
    if (!EXPAND.test(label) && !/^see more of (this )?review/i.test(el.getAttribute('aria-label') ?? '')) continue;
    if (!isVisible(el) || !enabled(el) || el.dataset.gleanerExpanded) continue;
    // Only inside something that looks like a review or post, never menus or navigation
    if (el.closest('nav, header, footer, [role="menu"], [role="navigation"]')) continue;
    el.dataset.gleanerExpanded = '1';
    if (safeClick(el)) n++;
  }
  return n;
}

/** Scrollable boxes (inside `root`) that still have content below, biggest first. */
function scrollers(root: ParentNode = document.body): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of [...(root instanceof HTMLElement ? [root] : []), ...(Array.from(root.querySelectorAll('*')) as HTMLElement[])]) {
    if (el.clientHeight < 150 || el.scrollHeight <= el.clientHeight + 40) continue;
    const oy = getComputedStyle(el).overflowY;
    if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue;
    if (!isVisible(el)) continue;
    out.push(el);
  }
  return out.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
}

/**
 * Load more items on the current page: click a "Show more" button if there is one, else scroll
 * the page and any scrolling panel to the bottom. Says which it did, or "none" when there is
 * nothing left to load.
 */
/**
 * Where a person would scroll to load more: the middle of the list's scrolling box (inside an open
 * pop-up window if there is one), in CSS pixels from the top left of the visible area.
 */
export function scrollPoint(): { x: number; y: number } | null {
  const dialog = openDialog();
  const box = scrollers(dialog ?? document.body)[0];
  const r = (box ?? dialog ?? document.documentElement).getBoundingClientRect();
  const x = Math.round(Math.min(Math.max(r.left + r.width / 2, 5), innerWidth - 5));
  const y = Math.round(Math.min(Math.max(r.top + Math.min(r.height, innerHeight) / 2, 5), innerHeight - 5));
  return box || dialog ? { x, y } : null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Scroll a box to its end so the list notices. Lists like Google's reviews only load when the box
 * moves near its end; a box already sitting at the end (because opened "More" texts made the
 * reviews taller after the last scroll) doesn't move, so it steps back a little first.
 */
async function toEnd(el: HTMLElement | Element): Promise<boolean> {
  const max = () => el.scrollHeight - el.clientHeight;
  const before = el.scrollTop;
  if (max() - el.scrollTop < 300) {
    el.scrollTop = Math.max(0, max() - 600);
    await wait(150);
  }
  el.scrollTop = el.scrollHeight;
  el.dispatchEvent(new Event('scroll', { bubbles: true }));
  // Opened texts can still be growing: follow the end once more
  await wait(200);
  if (max() - el.scrollTop > 300) el.scrollTop = el.scrollHeight;
  return el.scrollTop !== before || max() > 0;
}

/** Google Maps when signed out: a "limited view" with a few reviews and a sign-in prompt for more. */
export function limitedView(): boolean {
  const text = document.body?.innerText ?? '';
  if (/limited view of Google Maps|Sign-?in to get the best of Google Maps/i.test(text)) return true;
  const d = openDialog();
  return !!d?.querySelector('a[href*="accounts.google.com/ServiceLogin"], a[href*="accounts.google.com/signin"]') && /reviews/i.test(d.innerText);
}

export async function loadMore(): Promise<{ how: 'clicked' | 'scrolled' | 'none'; label?: string }> {
  // A pop-up window's list loads inside the window; the page behind it is left alone
  const dialog = openDialog();
  const root: ParentNode = dialog ?? document;
  const buttons = (Array.from(root.querySelectorAll('button, [role="button"], a, input[type="button"]')) as HTMLElement[]).filter((el) => {
    const label = clean(el.innerText || el.getAttribute('aria-label') || (el as HTMLInputElement).value);
    return LOAD_MORE.test(label) && isVisible(el) && enabled(el) && !el.closest('nav, header, footer, [role="menu"]');
  });
  if (buttons.length) {
    const el = buttons[buttons.length - 1]; // the one under the list, if several
    el.scrollIntoView({ block: 'center' });
    if (safeClick(el)) return { how: 'clicked', label: clean(el.innerText || el.getAttribute('aria-label')) };
  }
  let moved = false;
  // Panels first (a dialog's list), then the page itself
  for (const el of scrollers(dialog ?? document.body).slice(0, 4)) if (await toEnd(el)) moved = true;
  if (dialog) return { how: moved ? 'scrolled' : 'none' };
  const doc = document.scrollingElement ?? document.documentElement;
  if (doc.scrollHeight > doc.clientHeight + 40 && (await toEnd(doc))) moved = true;
  return { how: moved ? 'scrolled' : 'none' };
}

/** Whether the list is sorted newest first (a chosen "Newest" sort option, or the address says so). */
export function newestFirst(): boolean {
  const NEWEST = /^(newest|newest first|most recent|recent|latest|date \(newest\)|最新|新しい順|최신순|neueste)$/i;
  if (/[?&](sort|sortby|order|orderby)=[^&]*(newest|recent|latest|date_desc|new)/i.test(location.search)) return true;
  const root: ParentNode = openDialog() ?? document;
  for (const el of Array.from(root.querySelectorAll('[aria-checked="true"], [aria-selected="true"], [aria-pressed="true"], [aria-current="true"], .selected, .active')) as HTMLElement[]) {
    if (NEWEST.test(clean(el.innerText || el.getAttribute('aria-label'))) && isVisible(el)) return true;
  }
  for (const sel of Array.from(root.querySelectorAll('select')) as HTMLSelectElement[]) if (NEWEST.test(clean(sel.selectedOptions[0]?.text))) return true;
  return false;
}
