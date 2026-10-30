// Page screenshots. Full pages are scrolled through first, waiting for each part to settle, so
// pictures and lists that load as you scroll are in the picture; then the whole page is taken at
// full width in tiles and joined. Pages too tall for one picture are split with an overlap.
// Apps that scroll an inner panel instead of the page get that panel opened out.
// When the browser won't let the debugging interface onto a page ("Host access is restricted by
// policy" and similar), the page is scrolled one screen at a time and ordinary screenshots joined.
import { browser } from 'wxt/browser';
import { evaluate, release, send } from '../cdp';

export interface CaptureProgress {
  phase: 'loading' | 'capturing' | 'joining';
  /** 0 to 1 */
  done: number;
  seconds: number;
  detail: string;
}

export interface CaptureReport {
  url: string;
  title: string;
  mode: 'visible' | 'full page' | 'pdf file';
  /** For a PDF opened in the Studio: the original file. */
  source?: { name: string; bytes: number; sha256: string; pages: { w: number; h: number }[] };
  capturedAt: string;
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  /** CSS pixels */
  pageSize: { width: number; height: number };
  scrolled: 'page' | 'inner panel' | 'none';
  /** How the picture was taken: in tiles through the debugging interface, or screen by screen. */
  method?: 'debugger' | 'screen by screen';
  reachedBottom: boolean;
  stoppedEarly: boolean;
  scrollSteps: number;
  loadSeconds: number;
  parts: { width: number; height: number; overlapPx: number }[];
  userAgent: string;
}

export interface Capture {
  parts: Blob[];
  report: CaptureReport;
}

const MAX_SIDE = 32000; // device pixels: canvas limit with headroom
const MAX_PIXELS = 80e6;
const TILE = 4000; // CSS pixels per screenshot call
const OVERLAP = 160; // CSS pixels repeated between split parts

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toBlob = (b64: string) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' });

/** The visible part of the tab, as the person sees it. */
export async function captureVisible(tabId: number): Promise<Capture> {
  const tab = await browser.tabs.get(tabId);
  await browser.tabs.update(tabId, { active: true });
  const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId!, { format: 'png' });
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const info = await browser.scripting.executeScript({ target: { tabId }, func: () => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, ua: navigator.userAgent, title: document.title }) }).then((r) => r[0]?.result as any).catch(() => null);
  const report: CaptureReport = {
    url: tab.url ?? '',
    title: info?.title ?? tab.title ?? '',
    mode: 'visible',
    capturedAt: new Date().toISOString(),
    viewport: { width: info?.w ?? bmp.width, height: info?.h ?? bmp.height },
    devicePixelRatio: info?.dpr ?? 1,
    pageSize: { width: info?.w ?? bmp.width, height: info?.h ?? bmp.height },
    scrolled: 'none',
    reachedBottom: false,
    stoppedEarly: false,
    scrollSteps: 0,
    loadSeconds: 0,
    parts: [{ width: bmp.width, height: bmp.height, overlapPx: 0 }],
    userAgent: info?.ua ?? navigator.userAgent,
  };
  bmp.close();
  return { parts: [blob], report };
}

// Runs in the page: what scrolls (the page, or the biggest inner panel), and how far
const PROBE = `(() => {
  const doc = document.scrollingElement || document.documentElement;
  if (doc.scrollHeight > innerHeight * 1.05) return { mode: 'page', height: doc.scrollHeight };
  let best = null, area = 0;
  for (const el of document.querySelectorAll('body *')) {
    if (el.scrollHeight <= el.clientHeight + 100) continue;
    const oy = getComputedStyle(el).overflowY;
    if (!/auto|scroll|overlay/.test(oy)) continue;
    const r = el.getBoundingClientRect();
    const a = r.width * r.height;
    if (a > area && a > innerWidth * innerHeight * 0.3) { area = a; best = el; }
  }
  if (!best) return { mode: 'none', height: doc.scrollHeight };
  best.setAttribute('data-gleaner-scroller', '1');
  return { mode: 'inner panel', height: best.scrollHeight };
})()`;

const scrollerExpr = `(document.querySelector('[data-gleaner-scroller]') || document.scrollingElement || document.documentElement)`;

/**
 * The whole page. `shouldStop` ends the loading pass early and captures what has loaded
 * ("save up to here").
 */
export interface FullPageOptions {
  onProgress?: (p: CaptureProgress) => void;
  shouldStop?: () => boolean;
  maxSeconds?: number;
}

/** The whole page: through the debugging interface, or screen by screen when the browser refuses it. */
export async function captureFullPage(tabId: number, o: FullPageOptions = {}): Promise<Capture> {
  try {
    return await captureWithDebugger(tabId, o);
  } catch (e) {
    if (o.shouldStop?.() && /stopped/i.test(String((e as Error)?.message))) throw e;
    return captureScreenByScreen(tabId, o, String((e as Error)?.message ?? e));
  }
}

/** Joins pictures of the page (each at a CSS y position) into parts no bigger than a canvas can hold. */
async function joinTiles(tiles: { y: number; h: number; blob: Blob }[], width: number, height: number) {
  const first = await createImageBitmap(tiles[0].blob);
  const scale = first.width / width; // device pixels per CSS pixel, as captured
  first.close();
  const maxPartCss = Math.floor(Math.min(MAX_SIDE, MAX_PIXELS / (width * scale)) / scale);
  const parts: Blob[] = [];
  const partInfo: CaptureReport['parts'] = [];
  for (let start = 0; start < height; ) {
    const end = Math.min(height, start + maxPartCss);
    const canvas = new OffscreenCanvas(Math.round(width * scale), Math.round((end - start) * scale));
    const ctx = canvas.getContext('2d')!;
    for (const t of tiles) {
      if (t.y + t.h <= start || t.y >= end) continue;
      const bmp = await createImageBitmap(t.blob);
      ctx.drawImage(bmp, 0, Math.round((t.y - start) * scale));
      bmp.close();
    }
    parts.push(await canvas.convertToBlob({ type: 'image/png' }));
    partInfo.push({ width: canvas.width, height: canvas.height, overlapPx: start === 0 ? 0 : Math.round(OVERLAP * scale) });
    if (end >= height) break;
    start = end - OVERLAP;
  }
  return { parts, partInfo };
}

/** Runs a function in the page (no debugging interface needed). */
async function inPage<T>(tabId: number, func: (...a: any[]) => T, ...args: any[]): Promise<Awaited<T>> {
  const [r] = await browser.scripting.executeScript({ target: { tabId }, func: func as any, args });
  return r?.result as Awaited<T>;
}

/**
 * The whole page from ordinary screenshots: scroll down until everything has loaded, then from
 * the top take one screen at a time and join them. Fixed headers and buttons are hidden after the
 * first screen so they don't repeat down the picture. An app that scrolls an inner panel gets
 * that panel, screen by screen.
 */
async function captureScreenByScreen(tabId: number, o: FullPageOptions, why: string): Promise<Capture> {
  console.info('Gleaner: whole page screen by screen, since the debugging interface was refused:', why);
  const t0 = Date.now();
  const secs = () => Math.round((Date.now() - t0) / 100) / 10;
  const tab = await browser.tabs.get(tabId);
  await browser.tabs.update(tabId, { active: true });
  const env = await inPage(tabId, () => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, ua: navigator.userAgent, title: document.title, x: scrollX, y: scrollY }));
  // What scrolls: the page, or the biggest inner panel
  const probe = await inPage(tabId, () => {
    const doc = document.scrollingElement || document.documentElement;
    if (doc.scrollHeight > innerHeight * 1.05) return { mode: 'page' as const, rect: null };
    let best: Element | null = null;
    let area = 0;
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (el.scrollHeight <= el.clientHeight + 100) continue;
      if (!/auto|scroll|overlay/.test(getComputedStyle(el).overflowY)) continue;
      const r = el.getBoundingClientRect();
      const a = r.width * r.height;
      if (a > area && a > innerWidth * innerHeight * 0.3) ((area = a), (best = el));
    }
    if (!best) return { mode: 'none' as const, rect: null };
    best.setAttribute('data-gleaner-scroller', '1');
    const r = best.getBoundingClientRect();
    return { mode: 'inner panel' as const, rect: { x: Math.max(0, r.left), y: Math.max(0, r.top), w: Math.min(r.width, innerWidth), h: Math.min(r.height, innerHeight) } };
  });
  const scroll = (to: number | 'step' | 'top') =>
    inPage(tabId, (t: number | string) => {
      const s = (document.querySelector('[data-gleaner-scroller]') as HTMLElement | null) ?? ((document.scrollingElement || document.documentElement) as HTMLElement);
      const view = s === document.scrollingElement || s === document.documentElement ? innerHeight : s.clientHeight;
      s.scrollTop = t === 'top' ? 0 : t === 'step' ? s.scrollTop + Math.max(240, view * 0.8) : (t as number);
      return { top: s.scrollTop, height: s.scrollHeight, view };
    }, to);

  // 1. Loading pass, as with the debugger
  let steps = 0;
  let reachedBottom = probe.mode === 'none';
  let stoppedEarly = false;
  let stableAtBottom = 0;
  const limit = (o.maxSeconds ?? 60) * 1000;
  while (probe.mode !== 'none' && !reachedBottom) {
    if (o.shouldStop?.() || Date.now() - t0 > limit) {
      stoppedEarly = true;
      break;
    }
    const st = await scroll('step');
    steps++;
    let last = st.height;
    let stable = 0;
    const until = Date.now() + 4000;
    await sleep(350);
    while (Date.now() < until && stable < 3) {
      await sleep(150);
      const h = (await scroll(st.top)).height;
      stable = h === last ? stable + 1 : 0;
      last = h;
    }
    stableAtBottom = st.top + st.view >= last - 4 ? stableAtBottom + 1 : 0;
    reachedBottom = stableAtBottom >= 2;
    o.onProgress?.({ phase: 'loading', done: Math.min(0.95, (st.top + st.view) / Math.max(last, 1)), seconds: secs(), detail: `Loading the page: ${Math.round(st.top + st.view).toLocaleString()} of ${last.toLocaleString()}px` });
    if (steps > 480) break;
  }
  const loadSeconds = secs();
  const at = await inPage(tabId, () => {
    const s = (document.querySelector('[data-gleaner-scroller]') as HTMLElement | null) ?? ((document.scrollingElement || document.documentElement) as HTMLElement);
    const view = s === document.scrollingElement || s === document.documentElement ? innerHeight : s.clientHeight;
    return { height: s.scrollHeight, loadedTo: s.scrollTop + view };
  });
  // Stopped early: the picture ends where loading got to
  const end = stoppedEarly ? Math.min(at.height, Math.ceil(at.loadedTo)) : at.height;
  await scroll('top');
  await sleep(500);

  // 2. One screen at a time
  const area = probe.rect ?? { x: 0, y: 0, w: env.w, h: env.h };
  const height = probe.mode === 'none' ? env.h : Math.min(end, 200000);
  const tiles: { y: number; h: number; blob: Blob }[] = [];
  let lastShot = 0;
  const shoot = async (): Promise<Blob> => {
    // The browser allows about two screenshots a second
    await sleep(Math.max(0, 600 - (Date.now() - lastShot)));
    for (let tries = 0; ; tries++) {
      try {
        lastShot = Date.now();
        const url = await browser.tabs.captureVisibleTab(tab.windowId!, { format: 'png' });
        return await (await fetch(url)).blob();
      } catch (e) {
        if (tries >= 3 || !/MAX_CAPTURE|quota|per second/i.test(String((e as Error)?.message))) throw e;
        await sleep(1000);
      }
    }
  };
  try {
    for (let y = 0, n = 0; y < height; n++) {
      const st = await scroll(y);
      await sleep(250);
      const full = await createImageBitmap(await shoot());
      const k = full.width / env.w;
      // Keep only the scrolling area of the window
      const c = new OffscreenCanvas(Math.round(area.w * k), Math.round(area.h * k));
      c.getContext('2d')!.drawImage(full, Math.round(area.x * k), Math.round(area.y * k), c.width, c.height, 0, 0, c.width, c.height);
      full.close();
      tiles.push({ y: st.top, h: area.h, blob: await c.convertToBlob({ type: 'image/png' }) });
      o.onProgress?.({ phase: 'capturing', done: Math.min(0.99, (st.top + area.h) / height), seconds: secs(), detail: `Taking the picture: ${Math.round(Math.min(1, (st.top + area.h) / height) * 100)}%` });
      if (n === 0 && probe.mode === 'page') {
        // Fixed and sticky bars stay in the first screen only
        await inPage(tabId, () => {
          const hidden: [HTMLElement, string][] = [];
          for (const el of Array.from(document.querySelectorAll('body *')) as HTMLElement[]) {
            const pos = getComputedStyle(el).position;
            if (pos !== 'fixed' && pos !== 'sticky') continue;
            hidden.push([el, el.style.visibility]);
            el.style.setProperty('visibility', 'hidden', 'important');
          }
          (window as any).__gleanerUnhide = () => hidden.forEach(([el, v]) => (v ? (el.style.visibility = v) : el.style.removeProperty('visibility')));
        });
      }
      if (st.top + area.h >= height - 1 || o.shouldStop?.()) break;
      y = st.top + area.h - 40; // a small overlap, drawn over by the next screen
    }
  } finally {
    await inPage(tabId, (x: number, y: number) => {
      (window as any).__gleanerUnhide?.();
      document.querySelector('[data-gleaner-scroller]')?.removeAttribute('data-gleaner-scroller');
      scrollTo(x, y);
    }, env.x, env.y).catch(() => {});
  }

  o.onProgress?.({ phase: 'joining', done: 1, seconds: secs(), detail: 'Putting the picture together' });
  const last = tiles[tiles.length - 1];
  const total = Math.min(height, last.y + last.h);
  const { parts, partInfo } = await joinTiles(tiles, Math.round(area.w), Math.round(total));
  return {
    parts,
    report: {
      url: tab.url ?? '',
      title: env.title || tab.title || '',
      mode: 'full page',
      method: 'screen by screen',
      capturedAt: new Date().toISOString(),
      viewport: { width: env.w, height: env.h },
      devicePixelRatio: env.dpr,
      pageSize: { width: Math.round(area.w), height: Math.round(total) },
      scrolled: probe.mode,
      reachedBottom,
      stoppedEarly,
      scrollSteps: steps,
      loadSeconds,
      parts: partInfo,
      userAgent: env.ua,
    },
  };
}

async function captureWithDebugger(tabId: number, o: FullPageOptions): Promise<Capture> {
  // Test builds can act like a site where the browser refuses the debugging interface
  if (import.meta.env.MODE === 'e2e' && (await browser.storage.local.get('e2eNoDebugger')).e2eNoDebugger) throw new Error('Host access is restricted by policy.');
  const t0 = Date.now();
  const secs = () => Math.round((Date.now() - t0) / 100) / 10;
  const tab = await browser.tabs.get(tabId);
  try {
    await send(tabId, 'Page.enable');
    const env = await evaluate<{ w: number; h: number; dpr: number; ua: string; title: string }>(tabId, '({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, ua: navigator.userAgent, title: document.title })');
    const probe = await evaluate<{ mode: 'page' | 'inner panel' | 'none'; height: number }>(tabId, PROBE);

    // 1. Loading pass: scroll down in steps until the bottom stays put
    let steps = 0;
    let reachedBottom = probe.mode === 'none';
    let stoppedEarly = false;
    let stableAtBottom = 0;
    const limit = (o.maxSeconds ?? 60) * 1000;
    while (probe.mode !== 'none' && !reachedBottom) {
      if (o.shouldStop?.()) {
        stoppedEarly = true;
        break;
      }
      if (Date.now() - t0 > limit) {
        stoppedEarly = true;
        break;
      }
      const s = await evaluate<{ top: number; height: number; view: number }>(tabId, `(() => { const s = ${scrollerExpr}; const view = s === document.scrollingElement || s === document.documentElement ? innerHeight : s.clientHeight; s.scrollTop = s.scrollTop + Math.max(240, view * 0.8); return { top: s.scrollTop, height: s.scrollHeight, view }; })()`);
      steps++;
      // Let new content arrive: wait until the height stops changing (or 4 s)
      let last = s.height;
      let stable = 0;
      const until = Date.now() + 4000;
      await sleep(350);
      while (Date.now() < until && stable < 3) {
        await sleep(150);
        const h = await evaluate<number>(tabId, `${scrollerExpr}.scrollHeight`);
        stable = h === last ? stable + 1 : 0;
        last = h;
      }
      const atBottom = s.top + s.view >= last - 4;
      stableAtBottom = atBottom ? stableAtBottom + 1 : 0;
      reachedBottom = stableAtBottom >= 2;
      o.onProgress?.({ phase: 'loading', done: Math.min(0.95, (s.top + s.view) / Math.max(last, 1)), seconds: secs(), detail: `Loading the page: ${Math.round(s.top + s.view).toLocaleString()} of ${last.toLocaleString()}px` });
      if (steps > 480) break;
    }
    const loadSeconds = secs();
    const loadedTo = await evaluate<number>(tabId, `(() => { const s = ${scrollerExpr}; const view = s === document.scrollingElement || s === document.documentElement ? innerHeight : s.clientHeight; return s.scrollTop + view; })()`);
    await evaluate(tabId, `${scrollerExpr}.scrollTop = 0`);
    await sleep(500);

    // An inner panel: open it out so the whole thing is part of the page for the picture
    if (probe.mode === 'inner panel') {
      await evaluate(tabId, `(() => {
        const keep = [];
        let el = document.querySelector('[data-gleaner-scroller]');
        while (el && el !== document.documentElement) {
          keep.push([el, el.getAttribute('style')]);
          el.style.setProperty('height', 'auto', 'important');
          el.style.setProperty('max-height', 'none', 'important');
          el.style.setProperty('overflow', 'visible', 'important');
          el = el.parentElement;
        }
        document.documentElement.style.setProperty('overflow', 'visible', 'important');
        window.__gleanerRestore = () => { for (const [e, s] of keep) s === null ? e.removeAttribute('style') : e.setAttribute('style', s); document.documentElement.style.removeProperty('overflow'); };
      })()`);
      await sleep(400);
    }

    // 2. Picture in tiles
    const metrics = await send<{ cssContentSize: { width: number; height: number } }>(tabId, 'Page.getLayoutMetrics');
    const width = Math.ceil(Math.min(metrics.cssContentSize.width, env.w));
    let height = Math.ceil(metrics.cssContentSize.height);
    if (stoppedEarly && probe.mode === 'page') height = Math.min(height, Math.ceil(loadedTo));
    const dpr = env.dpr;
    const tiles: { y: number; h: number; blob: Blob }[] = [];
    for (let y = 0; y < height; y += TILE) {
      const h = Math.min(TILE, height - y);
      const shot = await send<{ data: string }>(tabId, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true, clip: { x: 0, y, width, height: h, scale: 1 } });
      tiles.push({ y, h, blob: toBlob(shot.data) });
      o.onProgress?.({ phase: 'capturing', done: Math.min(0.99, (y + h) / height), seconds: secs(), detail: `Taking the picture: ${Math.round(((y + h) / height) * 100)}%` });
    }
    if (probe.mode === 'inner panel') await evaluate(tabId, 'window.__gleanerRestore?.()').catch(() => {});
    await evaluate(tabId, `document.querySelector('[data-gleaner-scroller]')?.removeAttribute('data-gleaner-scroller')`).catch(() => {});

    // 3. Join tiles into parts no bigger than a canvas can hold
    o.onProgress?.({ phase: 'joining', done: 1, seconds: secs(), detail: 'Putting the picture together' });
    const { parts, partInfo } = await joinTiles(tiles, width, height);
    return {
      parts,
      report: {
        url: tab.url ?? '',
        title: env.title || tab.title || '',
        mode: 'full page',
        method: 'debugger',
        capturedAt: new Date().toISOString(),
        viewport: { width: env.w, height: env.h },
        devicePixelRatio: dpr,
        pageSize: { width, height },
        scrolled: probe.mode === 'none' ? 'none' : probe.mode,
        reachedBottom,
        stoppedEarly,
        scrollSteps: steps,
        loadSeconds,
        parts: partInfo,
        userAgent: env.ua,
      },
    };
  } finally {
    await release(tabId);
  }
}

/** The page as one MHTML file (the page and its pictures and styles, as the browser saves it). */
export async function captureMhtml(tabId: number): Promise<string> {
  try {
    const r = await send<{ data: string }>(tabId, 'Page.captureSnapshot', { format: 'mhtml' });
    return r.data;
  } catch {
    // The browser's own "save page" (no debugging interface)
    const blob = (await browser.pageCapture.saveAsMHTML({ tabId })) as Blob | undefined;
    if (!blob) throw new Error("The page couldn't be saved as MHTML");
    return blob.text();
  } finally {
    await release(tabId);
  }
}

/** A picture of one part of the visible window (CSS pixels from its top left), cropped from a window screenshot. */
export async function captureViewArea(tabId: number, rect: { x: number; y: number; width: number; height: number }): Promise<Blob> {
  const shot = await captureVisible(tabId);
  const bmp = await createImageBitmap(shot.parts[0]);
  const k = bmp.width / shot.report.viewport.width;
  const x = Math.max(0, Math.floor(rect.x * k));
  const y = Math.max(0, Math.floor(rect.y * k));
  const w = Math.max(1, Math.min(bmp.width - x, Math.ceil(rect.width * k)));
  const h = Math.max(1, Math.min(bmp.height - y, Math.ceil(rect.height * k)));
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d')!.drawImage(bmp, x, y, w, h, 0, 0, w, h);
  bmp.close();
  return c.convertToBlob({ type: 'image/png' });
}

/**
 * A picture of one element (found by its selector, measured at the moment of capture, since the
 * page can move when the debugger connects), or of a fixed area of the page as a fallback.
 */
export async function captureArea(tabId: number, rect: { x: number; y: number; width: number; height: number }, selector?: string): Promise<Blob> {
  try {
    if (selector) {
      const live = await evaluate<{ x: number; y: number; width: number; height: number } | null>(tabId, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; })()`).catch(() => null);
      if (live && live.width > 0) rect = live;
      await sleep(150);
    }
    const shot = await send<{ data: string }>(tabId, 'Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: Math.max(1, rect.width), height: Math.max(1, rect.height), scale: 1 } });
    return toBlob(shot.data);
  } finally {
    await release(tabId);
  }
}
