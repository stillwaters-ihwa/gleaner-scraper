// Small pictures that stand for bigger ones: gallery thumbnails that swap the main picture,
// pictures that open a lightbox, and thumbnails that link to (or name in an attribute) their big
// file. The big version is found from the link or attribute when there is one, otherwise by
// opening the small picture the way a person would and seeing what bigger picture appears.
// Runs in the page.
import { isVisible } from './list';
import { openDialog } from './dialog';
import { imgSrc } from './doc';

// Attributes shops and gallery scripts use for the big picture
const BIG_ATTRS = ['data-zoom-image', 'data-large_image', 'data-large', 'data-large-src', 'data-full', 'data-full-src', 'data-fullsrc', 'data-hires', 'data-highres', 'data-big', 'data-zoom', 'data-zoom-src', 'data-magnify-src', 'data-image-large', 'data-src-large', 'data-original-src'];
const IMAGE_FILE = /\.(jpe?g|png|webp|avif|gif)([?#]|$)/i;
const CHROME = 'header, nav, footer, [role="banner"], [role="navigation"], [role="contentinfo"], form';

const abs = (u: string, base: string) => {
  try {
    return new URL(u, base).href;
  } catch {
    return '';
  }
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const side = (i: HTMLImageElement) => Math.max(i.naturalWidth, i.naturalHeight);
const shown = (i: HTMLImageElement) => i.currentSrc || i.src;

/** The big picture a thumbnail links to or names in an attribute, or ''. */
export function linkedBig(el: Element, base: string): string {
  let n: Element | null = el;
  for (let depth = 0; n && depth < 3; n = n.parentElement, depth++) {
    for (const a of BIG_ATTRS) {
      const v = n.getAttribute(a);
      if (v && !v.startsWith('data:')) return abs(v, base);
    }
  }
  const href = el.closest('a[href]')?.getAttribute('href') ?? '';
  return href && IMAGE_FILE.test(href) ? abs(href, base) : '';
}

/** A link that would take the browser to another page (not "#", not a picture file). */
function leavesPage(el: Element): boolean {
  const a = el.closest('a[href]');
  const href = a?.getAttribute('href') ?? '';
  if (!a || !href || /^(#|javascript:)/i.test(href) || IMAGE_FILE.test(href)) return false;
  return abs(href, location.href).split('#')[0] !== location.href.split('#')[0];
}

/** Small pictures worth opening: shown small, not icons, not in menus, not links to other pages. */
function isThumb(el: HTMLImageElement): boolean {
  if (!el.complete || !el.naturalWidth || !isVisible(el)) return false;
  const r = el.getBoundingClientRect();
  const long = Math.max(r.width, r.height);
  // Thumbnails are small: the main gallery picture (often 300-500 px on screen) isn't one
  if (long < 30 || long > 220 || Math.min(r.width, r.height) < 24) return false;
  if (side(el) >= 1200) return false; // already big
  if (el.closest(CHROME) || leavesPage(el) || linkedBig(el, location.href)) return false;
  return true;
}

/** Pictures shown now, at their current address. */
const snapshot = () => new Map((Array.from(document.images) as HTMLImageElement[]).map((i) => [i, shown(i)]));

/** Lightboxes that don't announce themselves as dialogs (Magnific, Fancybox, PhotoSwipe, Lightbox2...). */
const LIGHTBOX = '.mfp-wrap, .mfp-ready, .fancybox-container, .fancybox__container, .pswp--open, .lightbox, .lb-outerContainer, .glightbox-container, .lg-outer, [class*="lightbox" i][style*="block"], [class*="modal" i].show, [class*="modal" i].is-open';
const openLightbox = (): Element | null => openDialog() ?? (Array.from(document.querySelectorAll(LIGHTBOX)) as HTMLElement[]).find((e) => isVisible(e)) ?? null;

/** The gallery around a thumbnail: the nearest block that also holds a picture shown bigger. */
function galleryOf(thumb: HTMLImageElement): Element {
  const r = thumb.getBoundingClientRect();
  const want = Math.max(r.width, r.height) * 1.8;
  for (let el = thumb.parentElement, d = 0; el && el !== document.body && d < 8; el = el.parentElement, d++) {
    const big = (Array.from(el.querySelectorAll('img')) as HTMLImageElement[]).some((i) => {
      const b = i.getBoundingClientRect();
      return i !== thumb && Math.max(b.width, b.height) >= want;
    });
    if (big) return el;
  }
  return thumb.parentElement ?? document.body;
}

/** The biggest picture that appeared or changed since `before` in the thumbnail's own gallery (or a
 *  lightbox it opened), once it has loaded. Pictures elsewhere on the page don't count. */
async function bigger(thumb: HTMLImageElement, before: Map<HTMLImageElement, string>, ms: number, gallery: Element = document.body): Promise<string> {
  const need = Math.max(side(thumb) * 1.3, 400);
  const end = Date.now() + ms;
  let pending = false;
  while (Date.now() < end) {
    await wait(100);
    pending = false;
    let best: HTMLImageElement | null = null;
    for (const i of Array.from(document.images) as HTMLImageElement[]) {
      if (i === thumb || before.get(i) === shown(i) || !shown(i) || shown(i).startsWith('data:')) continue;
      if (!i.complete || !i.naturalWidth) {
        pending = true;
        continue;
      }
      const box = openLightbox();
      if (!gallery.contains(i) && !(box && box.contains(i))) continue;
      if (side(i) >= need && isVisible(i) && (!best || side(i) > side(best))) best = i;
    }
    if (best && !pending) return shown(best);
    if (best && Date.now() > end - 300) return shown(best);
  }
  return '';
}

/** Close a lightbox the click opened: Escape, then its close button. */
async function close(dialogBefore: Element | null) {
  const open = () => {
    const d = openLightbox();
    return d && d !== dialogBefore ? d : null;
  };
  for (const t of [document.activeElement ?? document.body, document]) t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
  await wait(250);
  const d = open();
  if (!d) return;
  const btn = (Array.from(d.querySelectorAll('button, [role="button"], a, .mfp-close, .fancybox-close, .pswp__button--close, .lb-close')) as HTMLElement[]).find((b) => /close|닫기|閉じる|schließen|fermer|cerrar/i.test(`${b.getAttribute('aria-label') ?? ''} ${b.title} ${b.className} ${b.innerText}`) || /^[×✕✖x]$/i.test(b.innerText.trim()));
  btn?.click();
  await wait(250);
}

/**
 * Open each small picture on the page and note the big one it shows. Stays on the page: links
 * to other pages are skipped, and any navigation the clicks would start is cancelled.
 */
export async function openThumbnails(max = 40, budgetMs = 60000): Promise<{ thumb: string; big: string }[]> {
  const start = Date.now();
  const at = { x: scrollX, y: scrollY };
  const out: { thumb: string; big: string }[] = [];
  const done = new Set<string>();
  // Bubble phase on window: the page's own gallery code runs first, then the link is stopped
  const stay = (e: Event) => {
    const a = (e.target as Element | null)?.closest?.('a[href]');
    if (e.type === 'submit' || (a && !/^javascript:/i.test(a.getAttribute('href') ?? ''))) e.preventDefault();
  };
  addEventListener('click', stay);
  addEventListener('submit', stay);
  try {
    // Only thumbnails in a strip of two or more next to a bigger picture: a gallery
    const all = (Array.from(document.images) as HTMLImageElement[]).filter(isThumb);
    const groups = new Map<Element, HTMLImageElement[]>();
    for (const t of all) {
      const g = galleryOf(t);
      groups.set(g, [...(groups.get(g) ?? []), t]);
    }
    const thumbs = [...groups.entries()].filter(([g, list]) => list.length >= 2 && g !== document.body).flatMap(([, list]) => list).slice(0, max);
    // Per gallery: after 3 thumbnails that showed nothing bigger, the rest of that gallery won't either
    const tries = new Map<Element, { n: number; hits: number }>();
    for (const el of thumbs) {
      if (Date.now() - start > budgetMs) break;
      const g = galleryOf(el);
      const t = tries.get(g) ?? { n: 0, hits: 0 };
      tries.set(g, t);
      if (t.n >= 3 && !t.hits) continue;
      t.n++;
      const found = out.length;
      // The same address the picture scan gives this picture
      const thumb = imgSrc(el, location.href, true);
      if (done.has(thumb) || !el.isConnected) continue;
      done.add(thumb);
      el.scrollIntoView({ block: 'center', inline: 'center' });
      await wait(60);
      const before = snapshot();
      const dialogBefore = openLightbox();
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const target = (document.elementFromPoint(x, y) as HTMLElement | null) ?? el;
      const hit = el.contains(target) || target.contains(el) ? target : el;
      const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
      // Hover first (some galleries swap on hover), then a full click
      hit.dispatchEvent(new MouseEvent('mouseover', opts));
      hit.dispatchEvent(new MouseEvent('mouseenter', { ...opts, bubbles: false }));
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup'] as const) hit.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, opts) : new MouseEvent(type, opts));
      hit.click();
      const big = await bigger(el, before, 1500, galleryOf(el));
      if (big && big !== thumb) out.push({ thumb, big });
      if (out.length > found) t.hits++;
      if (openLightbox() && openLightbox() !== dialogBefore) await close(dialogBefore);
    }
  } finally {
    removeEventListener('click', stay);
    removeEventListener('submit', stay);
    scrollTo(at.x, at.y);
  }
  return out;
}
