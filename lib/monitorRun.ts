// Runs one monitor. Loaded only by the offscreen document, which has the DOM the extractors need.
import { deleteDataset, getDataset, newDataset, saveDataset, type Dataset, type ListRecipe, type PageRecipe, type Recipe } from './db';
import { DIFF_COLUMNS, diffDatasets, type DiffSummary } from './diff';
import { runListRecipe, runPageRecipe, runStore, type RunCtx } from './jobs';
import { alertText, belowOnFirstRun, getMonitor, matchRules, patchMonitor, plural, type AlertHits, type MonitorResult, type MonitorTarget } from './monitor';

function runTarget(t: MonitorTarget, ctx: RunCtx): Promise<Dataset> {
  if (t.kind === 'store') return runStore(t.setup, ctx);
  const r = t.recipe;
  return r.kind === 'list' ? runListRecipe(r as ListRecipe & Recipe, ctx) : runPageRecipe(r as PageRecipe & Recipe, ctx);
}

const stamp = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** One scheduled run: extract, compare with the last run, save the change report, decide on an alert. */
export async function runMonitor(id: string, signal: AbortSignal): Promise<MonitorResult> {
  const m = await getMonitor(id);
  if (!m) return { id, name: '', ok: false, error: 'This monitor was deleted.' };
  await patchMonitor(id, { lastStatus: 'running', lastMessage: 'Starting' });
  let last = 0;
  const ctx: RunCtx = {
    signal,
    progress: () => {},
    // Status lines are written back so the Monitors screen can show progress, at most once a second
    status: (message) => {
      if (Date.now() - last < 1000) return;
      last = Date.now();
      patchMonitor(id, { lastMessage: message }).catch(() => {});
    },
  };
  const startedAt = Date.now();
  try {
    const ds = await runTarget(m.target, ctx);
    if (signal.aborted) throw new Error('The run took too long and was stopped.');
    ds.name = `${m.name} (${stamp(startedAt)})`;
    await saveDataset(ds);
    const prev = m.snapshotId ? await getDataset(m.snapshotId) : undefined;

    let reportId: string | undefined;
    let summary: DiffSummary | undefined;
    let hits: AlertHits;
    let message: string;
    if (prev) {
      const diff = diffDatasets(prev, ds);
      summary = diff.summary;
      hits = matchRules(diff.rows, m.rules);
      if (diff.rows.length) {
        const report = await saveDataset(newDataset('diff', `Changes ${m.name} (${stamp(prev.createdAt)} to ${stamp(startedAt)})`, ds.source, DIFF_COLUMNS, diff.rows));
        reportId = report.id;
      }
      const s = diff.summary;
      message = diff.rows.length
        ? [s.added && `${s.added} new`, s.removed && `${s.removed} gone`, s.priceDown && `${s.priceDown} cheaper`, s.priceUp && `${s.priceUp} pricier`, s.changed - s.priceDown - s.priceUp > 0 && `${s.changed - s.priceDown - s.priceUp} changed`]
            .filter(Boolean)
            .join(', ') || `${diff.rows.length} changes`
        : `No changes in ${plural(ds.rows.length, 'row')}`;
      // Only the latest run is kept as the baseline; the change reports hold the history
      await deleteDataset(prev.id);
    } else {
      hits = { drops: [], below: belowOnFirstRun(ds, m.rules), restocked: [], added: [] };
      message = `First run saved ${plural(ds.rows.length, 'row')}. Changes show from the next run.`;
    }
    const alert = alertText(hits, m.rules) ?? undefined;
    await patchMonitor(id, {
      lastRunAt: startedAt,
      lastStatus: 'ok',
      lastMessage: message,
      snapshotId: ds.id,
      // A run without changes keeps the link to the last change report
      reportId: reportId ?? m.reportId,
      lastSummary: summary,
      lastAlert: alert ? `${alert.message}. ${alert.detail}` : undefined,
    });
    return { id, name: m.name, ok: true, alert, openId: reportId ?? ds.id };
  } catch (e: any) {
    const error = e?.message ?? String(e);
    const wasFailing = m.lastStatus === 'error';
    await patchMonitor(id, { lastRunAt: startedAt, lastStatus: 'error', lastMessage: error });
    // Tell the user once when a monitor starts failing, not on every run
    return { id, name: m.name, ok: false, error: wasFailing ? undefined : error };
  }
}
