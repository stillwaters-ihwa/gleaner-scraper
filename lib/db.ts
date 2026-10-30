// Datasets live in IndexedDB so large scrapes don't hit chrome.storage limits.
import { openDB, type DBSchema } from 'idb';
import type { Monitor } from './monitor';
import type { Tracker } from './prices';

export interface Column {
  key: string;
  label: string;
}

export interface Dataset {
  id: string;
  name: string;
  tool: string;
  source: string;
  createdAt: number;
  updatedAt: number;
  columns: Column[];
  rows: Record<string, string>[];
  /** How the run ended, shown after it finishes (e.g. where to resume). */
  note?: string;
}

/** A saved List extractor setup, offered again on pages whose URL matches `urlPattern`. */
export interface ListRecipe {
  kind: 'list';
  /** URL with `*` wildcards, e.g. https://example.com/search* */
  urlPattern: string;
  /** Page the recipe was made on, opened when it runs from somewhere else. */
  startUrl: string;
  itemSelector: string;
  /** The name Scrapling remembers this list under (the first item selector), kept when the list is found again. */
  adaptiveId?: string;
  /** Columns that were switched off, by key. */
  excluded: string[];
  /** Columns that were kept, for display. */
  columns: Column[];
  paging: 'none' | 'next' | 'scroll';
  next: { selector: string; label: string; kind: string } | null;
  maxPages: number;
  delay: number;
}

/** A saved Page extractor setup. */
export interface PageRecipe {
  kind: 'page';
  useMeta: boolean;
  useProduct: boolean;
  fields: { name: string; selector: string; attr: 'text' | 'href' | 'src' | 'html' | 'all' }[];
  load: { mode: 'auto' | 'fetch' | 'tab'; concurrency: number; delay: number };
  /** URLs that were in the box when it was saved, if any. */
  urls: string[];
}

export type Recipe = (ListRecipe | PageRecipe) & { id: string; name: string; createdAt: number; updatedAt: number };

interface Schema extends DBSchema {
  datasets: { key: string; value: Dataset; indexes: { updatedAt: number } };
  recipes: { key: string; value: Recipe; indexes: { updatedAt: number } };
  monitors: { key: string; value: Monitor; indexes: { updatedAt: number } };
  trackers: { key: string; value: Tracker; indexes: { updatedAt: number } };
  shots: { key: string; value: Shot };
  captures: { key: string; value: CaptureRecord; indexes: { createdAt: number } };
}

/** A page capture kept for Capture Studio and the recent-captures list. */
export interface CaptureRecord {
  id: string;
  createdAt: number;
  url: string;
  title: string;
  /** The untouched pictures, in order (tall pages are split). */
  parts: Blob[];
  report: import('./capture/shot').CaptureReport;
  mhtml?: string;
  /** For a PDF opened in the Studio: the original file, kept untouched. */
  sourcePdf?: Blob;
  /** What the Studio should offer first. */
  intent?: 'png' | 'pdf';
  /** Edits made in the Studio, so they come back when it is reopened. */
  edits?: unknown;
}

/** A screenshot kept as MAP-violation evidence. */
export interface Shot {
  id: string;
  trackerId: string;
  sourceId: string;
  store: string;
  url: string;
  price: number | null;
  map: number | null;
  at: number;
  /** JPEG data URL. */
  dataUrl: string;
}

export const dbp = openDB<Schema>('gleaner', 5, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) db.createObjectStore('datasets', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
    if (oldVersion < 2) db.createObjectStore('recipes', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
    if (oldVersion < 3) db.createObjectStore('monitors', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
    if (oldVersion < 4) {
      db.createObjectStore('trackers', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      db.createObjectStore('shots', { keyPath: 'id' });
    }
    if (oldVersion < 5) db.createObjectStore('captures', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
  },
});

// Page captures: the newest 10 from the last 7 days are kept
const KEEP_CAPTURES = 10;
const KEEP_CAPTURE_MS = 7 * 24 * 3600 * 1000;
export async function saveCapture(c: CaptureRecord) {
  const db = await dbp;
  await db.put('captures', c);
  const all = (await db.getAllFromIndex('captures', 'createdAt')).reverse();
  const tx = db.transaction('captures', 'readwrite');
  await Promise.all(all.filter((x, i) => i >= KEEP_CAPTURES || Date.now() - x.createdAt > KEEP_CAPTURE_MS).filter((x) => x.id !== c.id).map((x) => tx.store.delete(x.id)));
  await tx.done;
}
export const getCapture = (id: string) => dbp.then((db) => db.get('captures', id));
export const deleteCapture = (id: string) => dbp.then((db) => db.delete('captures', id));
export async function listCaptures(): Promise<Omit<CaptureRecord, 'parts' | 'mhtml'>[]> {
  const all = await (await dbp).getAllFromIndex('captures', 'createdAt');
  return all.reverse().map(({ parts, mhtml, ...rest }) => rest);
}

export const saveShot = (s: Shot) => dbp.then((db) => db.put('shots', s));
export const getShot = (id: string) => dbp.then((db) => db.get('shots', id));
export async function deleteShotsFor(trackerId: string) {
  const db = await dbp;
  const all = await db.getAll('shots');
  const tx = db.transaction('shots', 'readwrite');
  await Promise.all(all.filter((s) => s.trackerId === trackerId).map((s) => tx.store.delete(s.id)));
  await tx.done;
}

// Scheduled monitors write from the offscreen document, so changes are also broadcast to other extension pages.
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('gleaner-db') : null;
type Store = 'datasets' | 'recipes' | 'monitors' | 'trackers';
const listeners: Record<Store, Set<() => void>> = { datasets: new Set(), recipes: new Set(), monitors: new Set(), trackers: new Set() };
channel?.addEventListener('message', (e) => listeners[e.data as Store]?.forEach((f) => f()));

export function onStoreChanged(store: Store, fn: () => void) {
  listeners[store].add(fn);
  return () => {
    listeners[store].delete(fn);
  };
}
export function notifyStore(store: Store) {
  listeners[store].forEach((f) => f());
  channel?.postMessage(store);
}

export const onDatasetsChanged = (fn: () => void) => onStoreChanged('datasets', fn);
const notify = () => notifyStore('datasets');

export async function listDatasets(): Promise<Omit<Dataset, 'rows'>[] & { rowCount?: number }[]> {
  const all = await (await dbp).getAllFromIndex('datasets', 'updatedAt');
  return all.reverse().map(({ rows, ...rest }) => ({ ...rest, rowCount: rows.length })) as any;
}

export async function getDataset(id: string) {
  return (await dbp).get('datasets', id);
}

export async function saveDataset(ds: Dataset) {
  ds.updatedAt = Date.now();
  await (await dbp).put('datasets', ds);
  notify();
  return ds;
}

export async function deleteDataset(id: string) {
  await (await dbp).delete('datasets', id);
  notify();
}

export function newDataset(tool: string, name: string, source: string, columns: Column[], rows: Record<string, string>[]): Dataset {
  return { id: crypto.randomUUID(), name, tool, source, createdAt: Date.now(), updatedAt: Date.now(), columns, rows };
}

/** Build columns from row keys in first-seen order, keeping existing labels. */
export function columnsFromRows(rows: Record<string, string>[], label: (key: string) => string = (k) => k, existing: Column[] = []): Column[] {
  const cols = [...existing];
  const seen = new Set(cols.map((c) => c.key));
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) (seen.add(k), cols.push({ key: k, label: label(k) }));
  return cols;
}

export const onRecipesChanged = (fn: () => void) => onStoreChanged('recipes', fn);
const notifyRecipes = () => notifyStore('recipes');

export async function listRecipes(): Promise<Recipe[]> {
  return (await (await dbp).getAllFromIndex('recipes', 'updatedAt')).reverse();
}

export async function saveRecipe(r: Recipe) {
  r.updatedAt = Date.now();
  await (await dbp).put('recipes', r);
  notifyRecipes();
  return r;
}

export async function deleteRecipe(id: string) {
  await (await dbp).delete('recipes', id);
  notifyRecipes();
}

export function newRecipe(name: string, body: ListRecipe | PageRecipe): Recipe {
  return { ...body, id: crypto.randomUUID(), name, createdAt: Date.now(), updatedAt: Date.now() };
}

/** Match a URL against a pattern where `*` stands for any run of characters. */
export function urlMatches(pattern: string, url: string) {
  const p = pattern.trim();
  if (!p || !url) return false;
  const re = new RegExp('^' + p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
  return re.test(url);
}

/** Suggested pattern for a page: same site and folder, anything after. */
export function defaultPattern(url: string) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    // Keep the first folder when the page is inside one (/catalogue/page-2.html -> /catalogue/*)
    return `${u.origin}/${parts.length > 1 ? parts[0] + '/' : ''}*`;
  } catch {
    return url;
  }
}
