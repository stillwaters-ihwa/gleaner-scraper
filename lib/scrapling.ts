// Gleaner's Scrapling engine (https://github.com/D4Vinci/Scrapling), run by the helper on this
// computer: whole-site crawls with Scrapling's Spider, and lists that find themselves again after
// a site's layout changes (Scrapling's adaptive selectors). See public/helper/scrapling_server.py.
//
// The background worker owns the engine (one Python process for the panel and scheduled monitors);
// pages ask it for the address and token, then talk to the engine directly on 127.0.0.1.
import { browser } from 'wxt/browser';

export interface EngineInfo {
  port: number;
  token: string;
  scrapling: string;
}
export interface ScraplingStatus {
  /** The helper answered (it's installed and allowed). */
  helper: boolean;
  installed: boolean;
  /** A Python 3.10+ to install Scrapling with. */
  python?: boolean;
  scrapling?: string;
  error?: string;
}

/** Remembered so lists only use the engine when Scrapling is there (no helper start on every run). */
export const READY_KEY = 'scraplingReady';

let cached: Promise<EngineInfo> | null = null;

/** The running engine, started by the background worker when needed. */
export function engine(): Promise<EngineInfo> {
  cached ??= browser.runtime.sendMessage({ type: 'scrapling:start' }).then((r: any) => {
    if (!r || r.error) throw new Error(r?.error ?? 'The Scrapling engine is not available.');
    return r as EngineInfo;
  });
  cached.catch(() => (cached = null));
  return cached;
}

async function api<T>(path: string, body?: unknown, retry = true): Promise<T> {
  const e = await engine();
  try {
    const res = await fetch(`http://127.0.0.1:${e.port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', 'x-gleaner-token': e.token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
    return data as T;
  } catch (err) {
    // The engine stopped (the browser closed the helper): start it again once
    if (retry && err instanceof TypeError) {
      cached = null;
      await browser.runtime.sendMessage({ type: 'scrapling:reset' }).catch(() => {});
      return api(path, body, false);
    }
    throw err;
  }
}

/** Whether Scrapling can be used now, without starting anything. */
export async function scraplingReady(): Promise<boolean> {
  // Scheduled monitors run in a page without storage access: the background worker answers there
  if (!browser.storage?.local) return !!(await browser.runtime.sendMessage({ type: 'scrapling:ready' }).catch(() => false));
  return !!(await browser.storage.local.get(READY_KEY))[READY_KEY];
}

// ---------- adaptive lists ----------

export interface Relocated {
  count: number;
  item_selector: string;
  found: { css: string; full_css: string; tag: string; text: string }[];
}

const keyOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** Remember where this list sits on the page (its items' structure), for finding it again later. */
export const rememberList = (html: string, url: string, selector: string, identifier: string) => api<{ saved: number }>('/adaptive/save', { html, url, key: keyOf(url), selector, identifier });

/** Find a remembered list again on a page whose layout changed. */
export const relocateList = (html: string, url: string, selector: string, identifier: string) => api<Relocated>('/adaptive/relocate', { html, url, key: keyOf(url), selector, identifier });

// ---------- site crawls ----------

export interface CrawlOptions {
  start_url: string;
  max_pages: number;
  max_depth: number;
  delay: number;
  concurrency: number;
  obey_robots: boolean;
  /** Continue the last crawl of this site from where it stopped. */
  resume: boolean;
  ua: string;
}
export interface CrawlStatus {
  id: string;
  pages: number;
  items: Record<string, string>[];
  cursor: number;
  done: boolean;
  stopped: boolean;
  error: string;
  seconds: number;
  robots_skipped: number;
}

export const startCrawl = (o: CrawlOptions) => api<{ id: string }>('/crawl/start', o);
export const crawlStatus = (id: string, cursor: number) => api<CrawlStatus>(`/crawl/status?id=${encodeURIComponent(id)}&cursor=${cursor}`);
export const stopCrawl = (id: string) => api('/crawl/stop', { id });

// ---------- setting up ----------

/** Whether the helper is there and Scrapling is installed (also remembered for list healing). */
export async function scraplingStatus(): Promise<ScraplingStatus> {
  const { askHelper, helperHello } = await import('./video/youtube');
  try {
    await helperHello();
  } catch (e) {
    await browser.storage.local.set({ [READY_KEY]: false });
    return { helper: false, installed: false, error: String((e as Error)?.message ?? e) };
  }
  const r = await askHelper<{ installed: boolean; python?: boolean; scrapling?: string; broken?: string }>({ type: 'scrapling-status' }).done;
  await browser.storage.local.set({ [READY_KEY]: r.installed });
  return { helper: true, installed: r.installed, python: r.python, scrapling: r.scrapling, error: r.broken };
}

/** Installs Scrapling into Gleaner's own Python environment (a few minutes the first time). */
export async function installScrapling(onStep: (stage: string) => void): Promise<ScraplingStatus> {
  const { askHelper } = await import('./video/youtube');
  await askHelper({ type: 'scrapling-install' }, (p: any) => onStep(p.stage ?? '')).done;
  return scraplingStatus();
}

/** Checks once a day (when the panel opens) whether Scrapling is there, so lists know to use it. */
export async function refreshScraplingReady(): Promise<void> {
  const KEY = 'scraplingCheckedAt';
  const at = Number((await browser.storage.local.get(KEY))[KEY] ?? 0);
  if (Date.now() - at < 24 * 3600 * 1000) return;
  await browser.storage.local.set({ [KEY]: Date.now() });
  await scraplingStatus().catch(() => {});
}
