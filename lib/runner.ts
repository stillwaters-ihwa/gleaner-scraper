// Runs a job over many URLs with limited concurrency, either by fetching the HTML
// (fast, no JavaScript) or by loading each URL in a background tab (slow, renders JavaScript).
import { call, sleep, withBackgroundTab } from './tab';

export type LoadMode = 'auto' | 'fetch' | 'tab';

export interface RunOptions {
  concurrency: number;
  delayMs: number;
  signal: AbortSignal;
  onProgress: (done: number, total: number, errors: number) => void;
}

export class NeedsBrowserError extends Error {}

export async function fetchDocument(url: string, signal?: AbortSignal): Promise<Document> {
  const res = await fetch(url, { signal, credentials: 'include', redirect: 'follow' });
  if (res.status === 403 || res.status === 429 || res.status === 503) throw new NeedsBrowserError(`HTTP ${res.status}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (type && !/html|xml|text\/plain/i.test(type)) throw new Error(`Not a web page (${type.split(';')[0]})`);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Make relative links resolve against the page, not the extension
  const base = doc.createElement('base');
  base.href = res.url || url;
  doc.head.prepend(base);
  return doc;
}

/** Page access for one URL that works the same in both load modes. */
export interface PageHandle {
  url: string;
  /** Run a document extractor (fetch mode) or the matching injected command (tab mode). */
  run<T>(docFn: (doc: Document, url: string) => T, command: string, ...args: any[]): Promise<T>;
}

/** A fetched page that is a bot check or an empty shell waiting for JavaScript. */
function needsBrowser(doc: Document): boolean {
  const title = doc.title.toLowerCase();
  if (/robot check|captcha|just a moment|attention required|access denied|verify you are human/.test(title)) return true;
  const text = (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const appRoot = doc.querySelector('#root:empty, #app:empty, #__next:empty, [ng-app], [data-reactroot]:empty');
  return text.length < 300 || (!!appRoot && text.length < 1500) || /enable javascript|javascript is (disabled|required)/i.test(text.slice(0, 600));
}

async function withTab<T>(url: string, fn: (p: PageHandle) => Promise<T>): Promise<T> {
  return withBackgroundTab(url, (tabId) => fn({ url, run: (_d, command, ...args) => call(tabId, command, ...args) }));
}

async function withFetched<T>(url: string, signal: AbortSignal, fn: (p: PageHandle) => Promise<T>, strict: boolean): Promise<T> {
  const doc = await fetchDocument(url, signal);
  if (strict && needsBrowser(doc)) throw new NeedsBrowserError('page needs JavaScript');
  const finalUrl = doc.querySelector('base')?.getAttribute('href') ?? url;
  return fn({ url: finalUrl, run: async (docFn) => docFn(doc, finalUrl) });
}

/**
 * Open one page and hand it to `fn`. "auto" reads the HTML first and switches to a
 * background tab when the site blocks that or the page is built by JavaScript.
 * Network hiccups are retried with backoff.
 */
export async function withPage<T>(url: string, mode: LoadMode, signal: AbortSignal, fn: (p: PageHandle) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3 && !signal.aborted; attempt++) {
    try {
      if (mode === 'tab') return await withTab(url, fn);
      if (mode === 'fetch') return await withFetched(url, signal, fn, false);
      try {
        return await withFetched(url, signal, fn, true);
      } catch (e) {
        if (e instanceof NeedsBrowserError || e instanceof TypeError) return await withTab(url, fn);
        throw e;
      }
    } catch (e: any) {
      lastError = e;
      // Retry only what is likely temporary
      if (signal.aborted || !/HTTP (5\d\d|429)|Failed to fetch|network|timed? ?out/i.test(String(e?.message ?? e))) throw e;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastError;
}

const RANGE = /\[(\d+)-(\d+)(?::(\d+))?\]/;
const MAX_RANGE = 5000;

/**
 * Expand one numeric range in a URL: page/[1-40], archive/[001-100] (zero padded),
 * results?offset=[0-200:20] (step of 20).
 */
export function expandRange(url: string): string[] {
  const m = url.match(RANGE);
  if (!m) return [url];
  const [, from, to, step] = m;
  const a = parseInt(from, 10);
  const b = parseInt(to, 10);
  const inc = Math.max(1, parseInt(step ?? '1', 10));
  const pad = from.length > 1 && from.startsWith('0') ? from.length : 0;
  const out: string[] = [];
  for (let n = a; a <= b ? n <= b : n >= b; n += a <= b ? inc : -inc) {
    out.push(url.replace(RANGE, pad ? String(n).padStart(pad, '0') : String(n)));
    if (out.length >= MAX_RANGE) break;
  }
  return out;
}

export function normalizeUrls(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.split(/[\s,]+/).flatMap((r) => expandRange(r.trim()))) {
    const t = raw.trim().replace(/^["']|["']$/g, '');
    if (!t) continue;
    try {
      const u = new URL(/^https?:\/\//i.test(t) ? t : 'https://' + t);
      if (u.hostname.includes('.')) out.add(u.href);
    } catch {
      /* not a URL */
    }
  }
  return [...out];
}

/** Run `work` for each item with a small worker pool. Results keep input order. */
export async function runPool<I, O>(items: I[], work: (item: I, i: number) => Promise<O>, opts: RunOptions): Promise<(O | Error)[]> {
  const results: (O | Error)[] = new Array(items.length);
  let next = 0;
  let done = 0;
  let errors = 0;
  opts.onProgress(0, items.length, 0);
  const worker = async () => {
    while (next < items.length && !opts.signal.aborted) {
      const i = next++;
      try {
        results[i] = await work(items[i], i);
      } catch (e: any) {
        errors++;
        results[i] = e instanceof Error ? e : new Error(String(e));
      }
      done++;
      opts.onProgress(done, items.length, errors);
      if (opts.delayMs) await sleep(opts.delayMs);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, items.length) }, worker));
  return results;
}
