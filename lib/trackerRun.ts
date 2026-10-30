// Runs one price tracker: open each competitor page, read its price and stock, confirm it's the
// tracked product, record the reading, and raise an alert on drops, MAP violations and restocks.
// Used by the panel ("Check now") and by scheduled runs in the offscreen document.
import { saveShot, type Shot } from './db';
import type { Product } from './product';
import { runPool } from './runner';
import { call, sleep, tabs, waitForLoad } from './tab';
import { appendHistory, getTracker, patchTracker, priceAlerts, readSource, type PricePoint, type TrackerResult, type TrackerSource } from './prices';

export interface TrackerRunCtx {
  signal: AbortSignal;
  status: (message: string) => void;
  /** Panel runs are watched by a person; scheduled runs are not. */
  interactive?: boolean;
}

/** Competitor pages read at the same time. Small, so stores aren't hit hard and tabs stay few. */
const PARALLEL = 3;

/** Load one page in a background tab and read its product; optionally screenshot it first. */
async function readInTab(url: string, signal: AbortSignal, capture: boolean): Promise<{ product: Product | null; shot?: string }> {
  let tabId: number | undefined;
  try {
    const tab = await tabs.create({ url, active: false });
    tabId = tab.id;
    if (!tabId) return { product: null };
    await waitForLoad(tabId);
    await sleep(1200);
    if (signal.aborted) return { product: null };
    const product = await call<Product>(tabId, 'fullProduct').catch(() => null);
    let shot: string | undefined;
    if (capture && product && !product.error) shot = await tabs.capture(tabId).catch(() => undefined);
    return { product, shot };
  } finally {
    if (tabId) tabs.remove(tabId).catch(() => {});
  }
}

/** Check every source of one tracker. */
export async function runTracker(id: string, ctx: TrackerRunCtx): Promise<TrackerResult> {
  const t = await getTracker(id);
  if (!t) return { id, name: '', ok: false, error: 'This tracker was deleted.' };
  await patchTracker(id, { lastStatus: 'running', lastMessage: 'Starting' });
  const before = new Map(t.sources.map((s) => [s.id, { ...s }]));
  const now = Date.now();
  const active = t.sources.filter((s) => s.decision !== 'rejected');
  let done = 0;

  ctx.status(`Checking ${active.length} ${active.length === 1 ? 'store' : 'stores'}`);
  await runPool(
    active,
    async (s: TrackerSource) => {
      try {
        const { product } = await readInTab(s.url, ctx.signal, false);
        const r = readSource(t.ref, product, s.decision);
        Object.assign(s, {
          checkedAt: now,
          lastTitle: r.title,
          matched: r.matched,
          matchBy: r.matchBy,
          matchScore: r.matchScore,
          comparable: r.comparable,
          error: r.error,
          lastPrice: r.price,
          lastCurrency: r.currency,
          lastInStock: r.inStock,
          violation: r.matched && r.comparable && t.ref.map != null && r.price != null && r.price < t.ref.map,
        });
      } catch (e: any) {
        Object.assign(s, { checkedAt: now, error: e?.message ?? String(e) });
      }
      ctx.status(`Checked ${++done} of ${active.length} stores`);
    },
    { concurrency: PARALLEL, delayMs: 300, signal: ctx.signal, onProgress: () => {} },
  );

  // Evidence: screenshot each page that is breaking MAP. One at a time, since a screenshot
  // needs its tab to be the visible one.
  if (t.evidence) {
    for (const s of active.filter((x) => x.violation)) {
      if (ctx.signal.aborted) break;
      ctx.status(`Saving evidence for ${s.store}`);
      const { shot: dataUrl } = await readInTab(s.url, ctx.signal, true);
      if (!dataUrl) continue;
      const shot: Shot = { id: crypto.randomUUID(), trackerId: t.id, sourceId: s.id, store: s.store, url: s.url, price: s.lastPrice ?? null, map: t.ref.map, at: now, dataUrl };
      await saveShot(shot);
      s.shotId = shot.id;
    }
  }

  if (ctx.signal.aborted) {
    await patchTracker(id, { lastStatus: 'error', lastMessage: 'The run was stopped.' });
    return { id, name: t.name, ok: false, error: 'stopped' };
  }

  const points: PricePoint[] = active.filter((s) => s.checkedAt === now && s.matched && s.lastPrice != null).map((s) => ({ s: s.id, t: now, price: s.lastPrice!, c: s.lastCurrency, inStock: s.lastInStock ?? null }));
  appendHistory(t, points);
  const alert = priceAlerts(t, before) ?? undefined;
  const read = active.filter((s) => s.matched && s.lastPrice != null && !s.error).length;
  const issues = active.length - read;
  const message = `Checked ${active.length} ${active.length === 1 ? 'store' : 'stores'}: ${read} compared${issues ? `, ${issues} need a look` : ''}${alert ? `. ${alert.message}` : ''}`;

  // Save onto the latest record so a confirm/reject made during the run isn't lost
  const latest = await getTracker(id);
  const sources = (latest?.sources ?? t.sources).map((s) => {
    const ran = active.find((x) => x.id === s.id);
    return ran ? { ...ran, decision: s.decision ?? ran.decision } : s;
  });
  await patchTracker(id, {
    sources,
    history: t.history,
    lastRunAt: now,
    lastStatus: 'ok',
    lastMessage: message,
    lastAlert: alert ? `${alert.message}. ${alert.detail}` : undefined,
  });
  const wasFailing = t.lastStatus === 'error';
  return { id, name: t.name, ok: true, alert, error: read === 0 && active.length && !wasFailing ? 'No store could be compared. Open the tracker to see why.' : undefined };
}
