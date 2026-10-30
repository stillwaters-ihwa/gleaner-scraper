import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BellRinging, BookmarkSimple, ListBullets, Pause, Play, Pulse, Stack, Storefront, Trash, WarningCircle } from '@phosphor-icons/react';
import { onStoreChanged } from '@/lib/db';
import { EVERY_LABEL, deleteMonitor, listMonitors, newMonitor, nextRunAt, runNow, saveMonitor, schedule, type Every, type Monitor, type MonitorRules, type MonitorTarget } from '@/lib/monitor';
import { requestHostAccess } from '@/lib/tab';
import { Button, Check, Field, Notice, Section, Segmented, inputCls } from './ui';
import { useNav } from './nav';

export function useMonitors() {
  const [monitors, setMonitors] = useState<Monitor[] | null>(null);
  useEffect(() => {
    const load = () => listMonitors().then(setMonitors);
    load();
    return onStoreChanged('monitors', load);
  }, []);
  return monitors;
}

function ago(t: number) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function when(t: number) {
  const d = new Date(t);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

const defaultRules: MonitorRules = { priceDrop: true, below: null, backInStock: true, newItems: false };

/** "Monitor" button that opens a small schedule and alert rules form. */
export function MonitorSetup({ defaultName, getTarget, disabled, onClose }: { defaultName: string; getTarget: () => Promise<MonitorTarget>; disabled?: boolean; onClose?: (saved: boolean) => void }) {
  const nav = useNav();
  // With onClose the form opens straight away and the parent hides it afterwards
  const [open, setOpen] = useState(!!onClose);
  const [name, setName] = useState(defaultName);
  const [every, setEvery] = useState<Every>('day');
  const [rules, setRules] = useState<MonitorRules>(defaultRules);
  const [below, setBelow] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  function show() {
    setName(defaultName);
    setError('');
    setSaved('');
    setOpen(true);
  }

  async function save() {
    setError('');
    const target = parseFloat(below.replace(',', '.'));
    if (below.trim() && isNaN(target)) return setError('Enter the target price as a number, for example 49.99');
    // Asked here, on a click: scheduled runs can't show the permission prompt
    if (!(await requestHostAccess())) return setError('Monitors need permission to read websites. Click again and choose Allow.');
    try {
      const m = newMonitor(name.trim() || defaultName, await getTarget(), every, { ...rules, below: below.trim() ? target : null });
      await saveMonitor(m);
      await schedule(m);
      // The first run records today's values, so the next one has something to compare with
      runNow(m.id).catch(() => {});
      setSaved(m.name);
      setOpen(false);
      onClose?.(true);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  if (!open)
    return (
      <div className="flex flex-col gap-2">
        <Button variant="ghost" onClick={show} disabled={disabled} className="self-start">
          <Pulse size={15} aria-hidden /> Monitor on a schedule
        </Button>
        {saved && (
          <p role="status" className="text-[12px] text-muted">
            Monitoring <span className="font-medium text-ink">{saved}</span>. The first run is starting now.{' '}
            <button onClick={() => nav.go({ tab: 'monitors' })} className="cursor-pointer text-accent-text underline-offset-2 hover:underline">
              Open Monitors
            </button>
          </p>
        )}
      </div>
    );

  return (
    <MonitorForm
      name={name}
      setName={setName}
      every={every}
      setEvery={setEvery}
      rules={rules}
      setRules={setRules}
      below={below}
      setBelow={setBelow}
      error={error}
      onCancel={() => (setOpen(false), onClose?.(false))}
      onSave={save}
    />
  );
}

function MonitorForm(p: {
  name: string;
  setName: (v: string) => void;
  every: Every;
  setEvery: (v: Every) => void;
  rules: MonitorRules;
  setRules: (r: MonitorRules) => void;
  below: string;
  setBelow: (v: string) => void;
  error: string;
  onCancel: () => void;
  onSave: () => void;
}) {
  const set = (patch: Partial<MonitorRules>) => p.setRules({ ...p.rules, ...patch });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        p.onSave();
      }}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3"
    >
      <Field label="Monitor name">{(id) => <input id={id} autoFocus value={p.name} onChange={(e) => p.setName(e.target.value)} className={inputCls} />}</Field>
      <Field label="Run" help="Runs in the background while your browser is open, even with Gleaner closed. Missed runs catch up when the browser starts.">
        {() => (
          <Segmented
            label="How often"
            value={p.every}
            onChange={p.setEvery}
            options={[
              { value: 'hour', label: 'Hourly' },
              { value: 'day', label: 'Daily' },
              { value: 'week', label: 'Weekly' },
            ]}
          />
        )}
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[12px] font-medium text-ink">Alert me when</legend>
        <Check checked={p.rules.priceDrop} onChange={(v) => set({ priceDrop: v })}>
          Any price drops
        </Check>
        <Check checked={p.rules.backInStock} onChange={(v) => set({ backInStock: v })}>
          Something is back in stock
        </Check>
        <Check checked={p.rules.newItems} onChange={(v) => set({ newItems: v })}>
          New items appear
        </Check>
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <span className="shrink-0">A price goes under</span>
          <input aria-label="Target price" inputMode="decimal" value={p.below} onChange={(e) => p.setBelow(e.target.value)} placeholder="any" className={inputCls + ' w-24 py-1.5 font-mono tabular-nums'} />
        </label>
      </fieldset>
      <p className="text-[12px] leading-snug text-muted">Every run is compared with the one before. Changes are saved to Data as a change report.</p>
      {p.error && <Notice tone="error">{p.error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={p.onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          <Pulse size={15} aria-hidden /> Start monitoring
        </Button>
      </div>
    </form>
  );
}

function targetText(m: Monitor) {
  if (m.target.kind === 'store') return m.target.label;
  const r = m.target.recipe;
  return r.kind === 'list' ? `List recipe ${r.name}` : `Page recipe ${r.name}, ${r.urls.length} pages`;
}

function rulesText(r: MonitorRules) {
  const parts = [r.priceDrop && 'price drops', r.below !== null && `under ${r.below}`, r.backInStock && 'back in stock', r.newItems && 'new items'].filter(Boolean);
  return parts.length ? `Alerts on ${parts.join(', ')}` : 'No alerts, changes only';
}

function MonitorRow({ m }: { m: Monitor }) {
  const nav = useNav();
  const [confirm, setConfirm] = useState(false);
  const [next, setNext] = useState<number | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    nextRunAt(m.id).then(setNext);
  }, [m.id, m.paused, m.every, m.lastRunAt]);

  const Icon = m.target.kind === 'store' ? Storefront : m.target.recipe.kind === 'list' ? ListBullets : Stack;
  const running = m.lastStatus === 'running';

  async function togglePause() {
    const saved = await saveMonitor({ ...m, paused: !m.paused });
    await schedule(saved);
  }
  function askDelete() {
    setConfirm(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setConfirm(false), 4000);
  }

  return (
    <li className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-3">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
          <Icon size={19} weight="duotone" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="flex items-baseline justify-between gap-2">
            <span className="truncate font-display text-[15px] font-semibold tracking-tight">{m.name}</span>
            <span className="shrink-0 font-mono text-[10.5px] text-muted">{m.paused ? 'paused' : EVERY_LABEL[m.every].toLowerCase()}</span>
          </p>
          <p className="truncate text-[12.5px] text-muted">{targetText(m)}</p>
          <p className="text-[12px] text-muted">{rulesText(m.rules)}</p>
        </div>
      </div>

      <div aria-live="polite" className="flex flex-col gap-1.5 rounded-lg bg-surface-2 px-3 py-2 text-[12.5px]">
        {running ? (
          <p className="flex items-center gap-1.5">
            <Pulse size={14} className="shrink-0 animate-pulse text-accent-text motion-reduce:animate-none" aria-hidden />
            <span className="min-w-0 truncate">Running: {m.lastMessage || 'starting'}</span>
          </p>
        ) : m.lastRunAt ? (
          <p className={`flex items-start gap-1.5 ${m.lastStatus === 'error' ? 'text-danger' : ''}`}>
            {m.lastStatus === 'error' && <WarningCircle size={14} weight="bold" className="mt-0.5 shrink-0" aria-hidden />}
            <span>
              <span className="text-muted">Last run {ago(m.lastRunAt)}: </span>
              {m.lastMessage}
            </span>
          </p>
        ) : (
          <p className="text-muted">Not run yet.</p>
        )}
        {m.lastAlert && !running && (
          <p className="flex items-start gap-1.5 text-accent-text">
            <BellRinging size={14} weight="fill" className="mt-0.5 shrink-0" aria-hidden />
            <span>{m.lastAlert}</span>
          </p>
        )}
        {!m.paused && next && <p className="font-mono text-[11px] text-muted tabular-nums">Next run {when(next)}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1">
        {confirm ? (
          <Button variant="danger" onClick={() => deleteMonitor(m.id)}>
            <Trash size={15} aria-hidden /> Delete {m.name}?
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={askDelete} aria-label={`Delete ${m.name}`} title="Delete" className="px-2">
              <Trash size={15} aria-hidden />
            </Button>
            <Button variant="ghost" onClick={togglePause} aria-label={m.paused ? `Resume ${m.name}` : `Pause ${m.name}`} title={m.paused ? 'Resume' : 'Pause'} className="px-2">
              {m.paused ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />}
            </Button>
          </>
        )}
        {(m.reportId || m.snapshotId) && (
          <Button onClick={() => nav.openDataset((m.reportId ?? m.snapshotId)!)}>
            {m.reportId ? 'Changes' : 'Data'} <ArrowRight size={14} aria-hidden />
          </Button>
        )}
        <Button variant="primary" onClick={() => runNow(m.id)} disabled={running} aria-label={`Run ${m.name} now`}>
          <Play size={14} weight="fill" aria-hidden /> Run now
        </Button>
      </div>
    </li>
  );
}

export function MonitorsView() {
  const nav = useNav();
  const monitors = useMonitors();
  if (!monitors) return null;
  return (
    <div className="flex flex-col gap-4">
      <Section title="Monitors">
        <p className="text-[12.5px] leading-relaxed text-muted">
          Recipes and stores that run on a schedule in your browser. Each run is compared with the last one, and you get a notification when a price drops, falls under your target, or something is back in stock.
        </p>
      </Section>
      {monitors.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-line p-4">
          <p className="text-[13px]">No monitors yet.</p>
          <p className="text-[12.5px] leading-relaxed text-muted">Click the pulse button on a saved recipe, or set up the Store extractor and choose Monitor on a schedule.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => nav.go({ tab: 'recipes' })}>
              <BookmarkSimple size={15} aria-hidden /> Recipes
            </Button>
            <Button onClick={() => nav.go({ tab: 'tools', tool: 'shopify' })}>
              <Storefront size={15} aria-hidden /> Store extractor
            </Button>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {monitors.map((m) => (
            <MonitorRow key={m.id} m={m} />
          ))}
        </ul>
      )}
    </div>
  );
}
