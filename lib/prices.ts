// Competitor price tracking and MAP (minimum advertised price) monitoring: storage and schedule.
// You keep one tracked product with its identifiers and, optionally, a MAP. Gleaner opens each
// competitor's product page on a schedule, confirms it's the same item (see lib/match.ts),
// records the price and stock over time, and alerts on drops, MAP violations and restocks.
// The comparison logic itself lives in lib/priceLogic.ts.
import { browser } from 'wxt/browser';
import { dbp, deleteShotsFor, notifyStore } from './db';
import { groupId, productKey } from './match';
import { EVERY_MINUTES, type Every } from './monitor';
import type { PriceAlert, Tracker, TrackerRef } from './priceLogic';

export * from './priceLogic';

export const PRICE_ALARM_PREFIX = 'tracker:';

export interface TrackerResult {
  id: string;
  name: string;
  ok: boolean;
  alert?: PriceAlert;
  error?: string;
}

// ---------- Storage ----------

export async function listTrackers(): Promise<Tracker[]> {
  return (await (await dbp).getAll('trackers')).sort((a, b) => b.createdAt - a.createdAt);
}
export const getTracker = (id: string) => dbp.then((db) => db.get('trackers', id));
export async function saveTracker(t: Tracker) {
  t.updatedAt = Date.now();
  await (await dbp).put('trackers', t);
  notifyStore('trackers');
  return t;
}
export async function patchTracker(id: string, patch: Partial<Tracker>) {
  const t = await getTracker(id);
  return t ? saveTracker({ ...t, ...patch }) : undefined;
}
export async function deleteTracker(id: string) {
  await (await dbp).delete('trackers', id);
  await deleteShotsFor(id);
  await browser.alarms.clear(PRICE_ALARM_PREFIX + id);
  notifyStore('trackers');
}

/** Record the user's call on one competitor page: it is (or isn't) the tracked product. */
export async function decideSource(trackerId: string, sourceId: string, decision: 'confirmed' | 'rejected' | undefined) {
  const t = await getTracker(trackerId);
  if (!t) return;
  const sources = t.sources.map((s) =>
    s.id !== sourceId
      ? s
      : {
          ...s,
          decision,
          matched: decision === 'confirmed' ? true : decision === 'rejected' ? false : s.matched,
          // A rejected page stops counting at once; the next check fills the rest in
          violation: decision === 'rejected' ? false : s.violation,
          error: decision === 'rejected' ? 'You marked this page as a different product' : decision === 'confirmed' && s.error?.includes('did not match') ? undefined : s.error,
        },
  );
  await saveTracker({ ...t, sources });
}

export function newTracker(name: string, ref: TrackerRef, sources: { url: string }[], every: Every, evidence: boolean): Tracker {
  return {
    id: crypto.randomUUID(),
    name,
    ref,
    sources: sources.map((s) => ({ id: crypto.randomUUID(), url: s.url, store: hostOf(s.url) })),
    every,
    paused: false,
    evidence,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    history: [],
  };
}

export function hostOf(url: string) {
  try {
    const u = new URL(url);
    // Keep the port for local addresses, so two test stores on one host stay apart
    return u.hostname.replace(/^www\./, '') + (u.port && !u.hostname.includes('.') ? `:${u.port}` : '');
  } catch {
    return url;
  }
}

/** Create or clear the alarm so it matches the tracker's schedule. */
export async function scheduleTracker(t: Tracker) {
  const name = PRICE_ALARM_PREFIX + t.id;
  if (t.paused) return void (await browser.alarms.clear(name));
  const period = EVERY_MINUTES[t.every];
  const existing = await browser.alarms.get(name);
  if (existing?.periodInMinutes === period) return;
  const due = (t.lastRunAt ?? Date.now()) + period * 60000;
  await browser.alarms.create(name, { when: Math.max(Date.now() + 60000, due), periodInMinutes: period });
}
export async function nextTrackerRunAt(id: string) {
  return (await browser.alarms.get(PRICE_ALARM_PREFIX + id))?.scheduledTime;
}

export const groupIdFor = (ref: TrackerRef) => groupId(productKey({ title: ref.title, brand: ref.brand, sku: ref.sku, gtin: ref.gtin, mpn: ref.mpn }));
