// List detection and row extraction. Runs inside the live page (needs layout).
import { relativePath, safeQueryAll, stableClasses, uniqueSelector } from './selector';

export const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK', 'HEAD', 'TITLE', 'BR', 'HR', 'IFRAME', 'OPTION',
]);
const MIN_ITEMS = 3;

export type Row = Record<string, string>;

export interface ListCandidate {
  container: Element;
  items: Element[];
  itemSelector: string;
  score: number;
}

export function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) return false;
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0 && cs.display !== 'contents') return false;
  return true;
}

function hasContent(el: Element): boolean {
  if (el instanceof HTMLElement && el.innerText.trim().length > 0) return true;
  return !!el.querySelector('img[src], a[href], picture, video');
}

function mostCommonTag(children: Element[]): string {
  const counts = new Map<string, number>();
  for (const c of children) if (!SKIP_TAGS.has(c.tagName)) counts.set(c.tagName, (counts.get(c.tagName) ?? 0) + 1);
  let best = '';
  let max = 0;
  for (const [t, n] of counts) if (n > max) ((max = n), (best = t));
  return best;
}

/** Shape of an item's first link: /shop/item/123 -> /shop/item/N */
function linkShape(el: Element): string | null {
  const a = el.matches('a[href]') ? el : el.querySelector('a[href]');
  const href = a?.getAttribute('href');
  if (!href || href.startsWith('#') || href.startsWith('javascript:')) return null;
  try {
    const u = new URL(href, location.href);
    const segs = u.pathname.split('/').filter(Boolean).slice(0, 2);
    return u.host + '/' + segs.map((s) => (/\d/.test(s) ? 'N' : s)).join('/') + (segs.length ? '' : '');
  } catch {
    return null;
  }
}

function structureShape(el: Element): string {
  return Array.from(el.children)
    .map((c) => c.tagName)
    .join(',');
}

/** Keep items that look like siblings of each other (class, link pattern or structure). */
function similarItems(items: Element[]): { items: Element[]; commonClasses: string[] } {
  // Classes shared by every item
  const classSets = items.map((i) => new Set(stableClasses(i)));
  const common = [...classSets[0]].filter((c) => classSets.every((s) => s.has(c)));
  if (common.length) return { items, commonClasses: common.slice(0, 2) };

  // Dominant class shared by most items
  const classCount = new Map<string, number>();
  classSets.forEach((s) => s.forEach((c) => classCount.set(c, (classCount.get(c) ?? 0) + 1)));
  const topClass = [...classCount.entries()].sort((a, b) => b[1] - a[1])[0];
  const byClass = topClass && topClass[1] / items.length >= 0.6 ? items.filter((i) => i.classList.contains(topClass[0])) : [];

  // Dominant link pattern
  const shapes = items.map(linkShape);
  const shapeCount = new Map<string, number>();
  shapes.forEach((s) => s && shapeCount.set(s, (shapeCount.get(s) ?? 0) + 1));
  const topShape = [...shapeCount.entries()].sort((a, b) => b[1] - a[1])[0];
  const byLink = topShape && topShape[1] > 1 && topShape[1] / items.length >= 0.3 ? items.filter((_, i) => shapes[i] === topShape[0]) : [];

  if (byClass.length || byLink.length) {
    return byClass.length >= byLink.length
      ? { items: byClass, commonClasses: [topClass![0]] }
      : { items: byLink, commonClasses: [] };
  }

  // Structural fallback
  const st = items.map(structureShape);
  const stCount = new Map<string, number>();
  st.forEach((s) => stCount.set(s, (stCount.get(s) ?? 0) + 1));
  const topSt = [...stCount.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topSt && topSt[1] / items.length >= 0.5) return { items: items.filter((_, i) => st[i] === topSt[0]), commonClasses: [] };
  return { items: [], commonClasses: [] };
}

function buildItemSelector(container: Element, tag: string, classes: string[]): string {
  const cls = classes.map((c) => '.' + CSS.escape(c)).join('');
  return `${uniqueSelector(container)} > ${tag.toLowerCase()}${cls}`;
}

function countFields(item: Element): number {
  return extractItem(item).size;
}

function area(el: Element): number {
  const r = el.getBoundingClientRect();
  return r.width * r.height;
}

/** Find repeating lists on the page, best first. */
export function findLists(limit = 8): ListCandidate[] {
  const raw: { container: Element; items: Element[]; itemSelector: string; m: Record<string, number> }[] = [];
  const all = document.body ? document.body.querySelectorAll('*') : [];
  for (const el of Array.from(all)) {
    if (el.children.length < MIN_ITEMS || SKIP_TAGS.has(el.tagName)) continue;
    const kids = Array.from(el.children);
    const tag = mostCommonTag(kids);
    if (!tag) continue;
    const sameTag = kids.filter((k) => k.tagName === tag);
    if (sameTag.length < MIN_ITEMS) continue;
    const visible = sameTag.filter((k) => isVisible(k) && hasContent(k));
    if (visible.length < MIN_ITEMS) continue;
    const { items, commonClasses } = similarItems(visible);
    if (items.length < MIN_ITEMS) continue;
    const itemSelector = buildItemSelector(el, tag, commonClasses);
    const sample = items.slice(0, 3);
    const r = el.getBoundingClientRect();
    const vis = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / Math.max(1, Math.min(r.height, innerHeight));
    raw.push({
      container: el,
      items,
      itemSelector,
      m: {
        count: Math.log(items.length),
        area: Math.log(1 + items.reduce((s, i) => s + area(i), 0)),
        fields: sample.reduce((s, i) => s + countFields(i), 0) / sample.length,
        viewport: vis,
      },
    });
  }
  if (!raw.length) return [];
  const weights: Record<string, number> = { count: 0.3, area: 0.3, fields: 0.2, viewport: 0.2 };
  const keys = Object.keys(weights);
  const min: Record<string, number> = {};
  const max: Record<string, number> = {};
  for (const k of keys) {
    min[k] = Math.min(...raw.map((r) => r.m[k]));
    max[k] = Math.max(...raw.map((r) => r.m[k]));
  }
  const scored = raw.map((r) => ({
    container: r.container,
    items: r.items,
    itemSelector: r.itemSelector,
    score: keys.reduce((s, k) => s + weights[k] * (max[k] === min[k] ? 1 : (r.m[k] - min[k]) / (max[k] - min[k])), 0),
  }));
  scored.sort((a, b) => b.score - a.score);
  // Drop candidates nested inside a better candidate's items (sub-lists of a card)
  const out: ListCandidate[] = [];
  for (const c of scored) {
    if (out.some((o) => o.items.some((i) => i.contains(c.container)))) continue;
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

/** Find the list that contains a clicked element. */
export function listFromElement(target: Element): ListCandidate | null {
  let cur: Element | null = target;
  while (cur && cur.parentElement && cur !== document.body) {
    const parent: Element = cur.parentElement;
    const tag = cur.tagName;
    const siblings = Array.from(parent.children).filter((c) => c.tagName === tag && isVisible(c) && hasContent(c));
    if (siblings.length >= 2) {
      const { items, commonClasses } = similarItems(siblings);
      if (items.length >= 2 && items.includes(cur)) {
        return { container: parent, items, itemSelector: buildItemSelector(parent, tag, commonClasses), score: 1 };
      }
    }
    cur = parent;
  }
  return null;
}

/** Direct text of an element, ignoring text that belongs to child elements. */
function ownText(el: Element): string {
  let t = '';
  for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) t += n.textContent;
  return t.replace(/\s+/g, ' ').trim();
}

function imageSrc(el: Element): string {
  if (el instanceof HTMLImageElement) {
    return el.currentSrc || el.src || el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('ec-data-src') || el.getAttribute('data-original') || '';
  }
  const src = el.getAttribute('src') || el.getAttribute('poster') || '';
  return src ? new URL(src, location.href).href : '';
}

/** Map of column key -> value for one list item. */
export function extractItem(item: Element): Map<string, string> {
  const out = new Map<string, string>();
  const put = (key: string, val: string) => {
    if (!val) return;
    let k = key;
    let n = 2;
    while (out.has(k)) k = `${key}#${n++}`;
    out.set(k, val);
  };
  const els = [item, ...Array.from(item.querySelectorAll('*'))];
  for (const el of els) {
    if (SKIP_TAGS.has(el.tagName) || el.closest('svg') && el.tagName !== 'svg') continue;
    const path = relativePath(item, el);
    const text = el instanceof HTMLElement ? ownText(el) : '';
    if (el instanceof HTMLAnchorElement && el.href && !el.getAttribute('href')!.startsWith('#') && !el.href.startsWith('javascript:')) {
      put(path + '@href', el.href);
    }
    if (el.tagName === 'IMG' || el.tagName === 'VIDEO' || el.tagName === 'SOURCE') {
      put(path + '@src', imageSrc(el));
      const alt = el.getAttribute('alt')?.trim();
      if (alt) put(path + '@alt', alt);
    }
    // Full titles often hide in the title attribute when the visible text is shortened
    const title = el.getAttribute('title')?.trim();
    if (title && title !== text) put(path + '@title', title);
    if (text && isVisible(el)) put(path + '@text', text);
  }
  return out;
}

export function extractItems(itemSelector: string, from = 0): { rows: Row[]; count: number } {
  const items = safeQueryAll(document, itemSelector).filter((i) => isVisible(i) && hasContent(i));
  const rows = items.slice(from).map((i) => Object.fromEntries(extractItem(i)));
  return { rows, count: items.length };
}

export function itemsSignature(itemSelector: string): string {
  const items = safeQueryAll(document, itemSelector);
  const t = (el?: Element) => (el instanceof HTMLElement ? el.innerText.slice(0, 80) : '');
  return `${items.length}|${t(items[0])}|${t(items[items.length - 1])}|${location.href}`;
}
