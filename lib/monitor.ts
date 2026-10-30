// Scheduled monitors: re-run a recipe or a store setup on a timer, compare with the last run
// and raise an alert when something matches the user's rules. Runs happen in the offscreen
// document (entrypoints/offscreen), driven by chrome.alarms in the background service worker.
import { browser } from 'wxt/browser';
import { dbp, notifyStore, type Dataset, type Recipe } from './db';
import type { DiffSummary } from './diff';
import type { StoreSetup } from './jobs';

export type Every = 'hour' | 'day' | 'week';
export const EVERY_MINUTES: Record<Every, number> = { hour: 60, day: 60 * 24, week: 60 * 24 * 7 };
export const EVERY_LABEL: Record<Every, string> = { hour: 'Every hour', day: 'Every day', week: 'Every week' };

export type MonitorTarget = { kind: 'recipe'; recipe: Recipe } | { kind: 'store'; setup: StoreSetup; label: string };

export interface MonitorRules {
  priceDrop: boolean;
  /** Alert when a price goes under this amount. */
  below: number | null;
  backInStock: boolean;
  newItems: boolean;
}

export interface Monitor {
  id: string;
  name: string;
  target: MonitorTarget;
  every: Every;
  rules: MonitorRules;
  paused: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastStatus?: 'running' | 'ok' | 'error';
  lastMessage?: string;
  /** The latest full run, kept as the baseline for the next comparison. */
  snapshotId?: string;
  /** The latest change report, if the last run found changes. */
  reportId?: string;
  lastSummary?: DiffSummary;
  /** What the last alert said, if the last run raised one. */
  lastAlert?: string;
}

export const ALARM_PREFIX = 'monitor:';
/** chrome.storage key where the side panel picks up "open this dataset" requests from alert clicks. */
export const OPEN_KEY = 'gleaner:open';

/** Ask the background service worker to run a monitor now. */
export const runNow = (id: string) => browser.runtime.sendMessage({ type: 'monitor:run', id });

// ---------- Storage ----------

export async function listMonitors(): Promise<Monitor[]> {
  // Newest first by creation, so rows don't jump around while runs update them
  return (await (await dbp).getAll('monitors')).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getMonitor(id: string) {
  return (await dbp).get('monitors', id);
}

export async function saveMonitor(m: Monitor) {
  m.updatedAt = Date.now();
  await (await dbp).put('monitors', m);
  notifyStore('monitors');
  return m;
}

/** Update a few fields of the stored monitor, keeping whatever else changed meanwhile (pause, rename). */
export async function patchMonitor(id: string, patch: Partial<Monitor>) {
  const m = await getMonitor(id);
  return m ? saveMonitor({ ...m, ...patch }) : undefined;
}

export async function deleteMonitor(id: string) {
  await (await dbp).delete('monitors', id);
  await browser.alarms.clear(ALARM_PREFIX + id);
  notifyStore('monitors');
}

export function newMonitor(name: string, target: MonitorTarget, every: Every, rules: MonitorRules): Monitor {
  return { id: crypto.randomUUID(), name, target, every, rules, paused: false, createdAt: Date.now(), updatedAt: Date.now() };
}

/** Create or clear the alarm for a monitor so it matches its schedule. */
export async function schedule(m: Monitor) {
  const name = ALARM_PREFIX + m.id;
  if (m.paused) return void (await browser.alarms.clear(name));
  const period = EVERY_MINUTES[m.every];
  const existing = await browser.alarms.get(name);
  if (existing?.periodInMinutes === period) return;
  // First run one period after the last one (or from now), then on the period
  const due = (m.lastRunAt ?? Date.now()) + period * 60000;
  await browser.alarms.create(name, { when: Math.max(Date.now() + 60000, due), periodInMinutes: period });
}

export async function nextRunAt(id: string) {
  return (await browser.alarms.get(ALARM_PREFIX + id))?.scheduledTime;
}

/** What a target can be monitored with. Page recipes need saved URLs. */
export function canMonitor(r: Recipe) {
  return r.kind === 'list' || (r.kind === 'page' && r.urls.length > 0);
}

// ---------- Rules ----------

const num = (v: string) => {
  const n = parseFloat(String(v ?? '').replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
};
const isPriceField = (label: string) => /price/i.test(label) && !/compare|old|was|regular|list/i.test(label);
const isStockField = (label: string) => /availability|stock/i.test(label);
const inStock = (v: string) => /in.?stock|available|^true$|^yes$/i.test(v) && !/out|not|unavail|sold|pre.?order/i.test(v);
const outOfStock = (v: string) => !v || /out|sold|unavail|^false$|^no$|^0$/i.test(v);

export interface AlertHits {
  drops: Record<string, string>[];
  below: Record<string, string>[];
  restocked: Record<string, string>[];
  added: Record<string, string>[];
}

/** Which rows of a change report match the rules. */
export function matchRules(rows: Record<string, string>[], rules: MonitorRules): AlertHits {
  const hits: AlertHits = { drops: [], below: [], restocked: [], added: [] };
  for (const r of rows) {
    const before = num(r.old);
    const after = num(r.new);
    if (r.change === 'price changed' && isPriceField(r.field) && before !== null && after !== null) {
      if (rules.priceDrop && after < before) hits.drops.push(r);
      if (rules.below !== null && after < rules.below && before >= rules.below) hits.below.push(r);
    }
    if (r.change === 'changed' && rules.backInStock && isStockField(r.field) && outOfStock(r.old) && inStock(r.new)) hits.restocked.push(r);
    if (r.change === 'new') {
      if (rules.newItems) hits.added.push(r);
      if (rules.below !== null && after !== null && after < rules.below) hits.below.push(r);
    }
  }
  return hits;
}

/** On the first run there is nothing to compare with, but a price may already be under the target. */
export function belowOnFirstRun(ds: Dataset, rules: MonitorRules): Record<string, string>[] {
  if (rules.below === null) return [];
  const price = ds.columns.find((c) => /^(price|variant price)$/i.test(c.label)) ?? ds.columns.find((c) => isPriceField(c.label));
  if (!price) return [];
  const title = ds.columns.find((c) => /^(title|name|product name)$/i.test(c.label));
  return ds.rows
    .filter((r) => {
      const p = num(r[price.key]);
      return p !== null && p < rules.below!;
    })
    .map((r) => ({ change: 'new', key: '', title: title ? r[title.key] : '', field: price.label, old: '', new: r[price.key], delta: '' }));
}

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export function alertText(h: AlertHits, rules: MonitorRules): { message: string; detail: string } | null {
  const parts = [
    h.drops.length && plural(h.drops.length, 'price drop'),
    h.below.length && `${plural(h.below.length, 'price')} under ${rules.below}`,
    h.restocked.length && `${h.restocked.length} back in stock`,
    h.added.length && plural(h.added.length, 'new item'),
  ].filter(Boolean) as string[];
  if (!parts.length) return null;
  const top = h.below[0] ?? h.drops[0] ?? h.restocked[0] ?? h.added[0];
  const name = (top.title || top.key || 'An item').slice(0, 60);
  const detail =
    top.change === 'price changed' ? `${name}: ${top.old} to ${top.new}` : top.change === 'new' ? `${name}${top.new ? ` at ${top.new}` : ''}` : `${name} is ${top.new || 'available'}`;
  return { message: parts.join(', '), detail };
}

export interface MonitorResult {
  id: string;
  name: string;
  ok: boolean;
  /** Set when the run matched a rule. */
  alert?: { message: string; detail: string };
  error?: string;
  /** Dataset to open when the alert is clicked: the change report, or the run itself. */
  openId?: string;
}
