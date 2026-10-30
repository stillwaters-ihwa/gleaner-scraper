import { useEffect, useRef, useState, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import { ArrowRight, DownloadSimple, Play, Stop } from '@phosphor-icons/react';
import { getDataset, listDatasets, type Dataset } from '@/lib/db';
import { exportCsv } from '@/lib/export';
import { hasHostAccess, requestHostAccess } from '@/lib/tab';
import { normalizeUrls } from '@/lib/runner';
import { Button, Field, Notice, inputCls } from './ui';
import { useNav } from './nav';
import { logEvent } from '@/lib/report';
import { ReportProblem } from './ReportProblem';

export interface JobCtx {
  signal: AbortSignal;
  progress: (done: number, total?: number, errors?: number) => void;
  status: (message: string) => void;
  /** Panel runs are watched by a person, so a bot check can be solved in the tab. */
  interactive: boolean;
  onBotCheck: () => void;
}

/** Let the user know a run is paused on a bot check even when the panel isn't in view. */
function notifyBotCheck() {
  browser.notifications
    ?.create('gleaner:botcheck:' + Date.now(), {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icons/128.png'),
      title: 'Gleaner is waiting for you',
      message: 'A website is asking to verify you are human. Solve the check in the open tab and the run continues.',
      priority: 2,
    })
    .catch(() => {});
}

interface JobState {
  running: boolean;
  done: number;
  total: number;
  errors: number;
  message: string;
  error?: string;
  result?: Dataset;
}

const idle: JobState = { running: false, done: 0, total: 0, errors: 0, message: '' };

/** Runs one job at a time with progress, stop and a saved dataset at the end. */
export function useJob() {
  const [s, set] = useState<JobState>(idle);
  const ctrl = useRef<AbortController | null>(null);
  const nav = useNav();

  async function start(fn: (ctx: JobCtx) => Promise<Dataset | null | void>, opts: { needsHostAccess?: boolean } = { needsHostAccess: true }) {
    if (opts.needsHostAccess !== false && !(await requestHostAccess())) {
      set({ ...idle, error: 'Gleaner needs permission to read websites to run this tool. Click Start again and choose Allow.' });
      return;
    }
    ctrl.current = new AbortController();
    // Every step goes into the activity log, for "Report a problem"
    const tool = (nav.view.tab === 'tools' && nav.view.tool) || nav.view.tab;
    logEvent(tool, 'Started');
    set({ ...idle, running: true, message: 'Starting' });
    const ctx: JobCtx = {
      signal: ctrl.current.signal,
      progress: (done, total, errors) => set((p) => ({ ...p, done, total: total ?? p.total, errors: errors ?? p.errors })),
      status: (message) => (logEvent(tool, message), set((p) => ({ ...p, message }))),
      interactive: true,
      onBotCheck: notifyBotCheck,
    };
    try {
      const ds = await fn(ctx);
      const end = ctrl.current?.signal.aborted ? 'Stopped' : ds?.note ?? 'Done';
      logEvent(tool, `Finished: ${end}${ds ? ` (${ds.rows.length} rows)` : ''}`);
      set((p) => ({ ...p, running: false, message: end, result: ds || undefined }));
    } catch (e: any) {
      logEvent(tool, `Failed: ${e?.message ?? String(e)}`);
      set((p) => ({ ...p, running: false, error: e?.message ?? String(e) }));
    }
  }

  const stop = () => ctrl.current?.abort();
  const reset = () => set(idle);
  return { ...s, start, stop, reset };
}

export function RunBar({ job, onStart, startLabel = 'Start', disabled, extra }: { job: ReturnType<typeof useJob>; onStart: () => void; startLabel?: string; disabled?: boolean; extra?: ReactNode }) {
  const nav = useNav();
  const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
  return (
    <div className="sticky bottom-0 -mx-4 mt-2 flex flex-col gap-3 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur">
      {job.error && <Notice tone="error">{job.error}</Notice>}
      {(job.running || job.result || job.message === 'Stopped') && (
        <div aria-live="polite" className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
            <span className="truncate text-muted">{job.message}</span>
            <span className="font-mono tabular-nums text-ink">
              {job.total ? `${job.done}/${job.total}` : job.done ? `${job.done}` : ''}
              {job.errors ? <span className="text-danger"> {job.errors} failed</span> : null}
            </span>
          </div>
          {job.running && job.total > 0 && (
            <div className="h-1 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      )}
      {job.result && !job.running && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-accent-soft px-3 py-2">
          <p className="min-w-0 truncate text-[12.5px]">
            Saved <span className="font-mono tabular-nums">{job.result.rows.length}</span> {job.result.rows.length === 1 ? 'row' : 'rows'} to{' '}
            <span className="font-medium">{job.result.name}</span>
          </p>
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" onClick={() => exportCsv(job.result!)} aria-label="Export CSV" title="Export CSV" className="px-2">
              <DownloadSimple size={16} aria-hidden />
            </Button>
            <Button onClick={() => nav.openDataset(job.result!.id)}>
              Open <ArrowRight size={14} aria-hidden />
            </Button>
          </div>
        </div>
      )}
      {!job.running && (job.error || job.result || job.message === 'Stopped') && (
        <ReportProblem
          tool={(nav.view.tab === 'tools' && nav.view.tool) || nav.view.tab}
          run={{ message: job.message, error: job.error, done: job.done, total: job.total, errors: job.errors, rows: job.result?.rows.length, dataset: job.result?.name }}
        />
      )}
      <div className="flex gap-2">
        {job.running ? (
          <Button variant="danger" onClick={job.stop} className="flex-1">
            <Stop size={15} weight="fill" aria-hidden /> Stop
          </Button>
        ) : (
          <Button variant="primary" onClick={onStart} disabled={disabled} className="flex-1">
            <Play size={15} weight="fill" aria-hidden /> {startLabel}
          </Button>
        )}
        {extra}
      </div>
    </div>
  );
}

/** URL list input with shortcuts: current tab, or a column from a saved dataset. */
export function UrlSource({ value, onChange, help }: { value: string; onChange: (v: string) => void; help?: string }) {
  const [sets, setSets] = useState<Awaited<ReturnType<typeof listDatasets>>>([]);
  const [dsId, setDsId] = useState('');
  const [ds, setDs] = useState<Dataset | undefined>();
  const count = normalizeUrls(value).length;

  useEffect(() => {
    listDatasets().then(setSets);
  }, []);
  useEffect(() => {
    if (dsId) getDataset(dsId).then(setDs);
    else setDs(undefined);
  }, [dsId]);

  const urlColumns = ds?.columns.filter((c) => ds.rows.some((r) => /^https?:\/\//.test(r[c.key] ?? ''))) ?? [];

  return (
    <div className="flex flex-col gap-3">
      <Field label={`Page URLs${count ? ` (${count})` : ''}`} help={`${help ?? 'One URL per line.'} Ranges work too: .../page/[1-40]`}>
        {(id) => (
          <textarea
            id={id}
            rows={5}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={'https://example.com/page-1\nhttps://example.com/page-2'}
            className={inputCls + ' resize-y font-mono text-[12px] leading-relaxed'}
          />
        )}
      </Field>
      {sets.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <select aria-label="Take URLs from saved data" value={dsId} onChange={(e) => setDsId(e.target.value)} className={inputCls}>
            <option value="">From saved data</option>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Column with URLs"
            disabled={!ds}
            value=""
            onChange={(e) => {
              const key = e.target.value;
              if (!ds || !key) return;
              const urls = [...new Set(ds.rows.map((r) => r[key]).filter((v) => /^https?:\/\//.test(v ?? '')))];
              onChange(urls.join('\n'));
            }}
            className={inputCls}
          >
            <option value="">{ds ? (urlColumns.length ? 'Pick a URL column' : 'No URL columns') : 'Column'}</option>
            {urlColumns.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

export function useHostAccess() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    hasHostAccess().then(setOk);
  }, []);
  return ok;
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function today() {
  return new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
