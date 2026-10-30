import { useEffect, useRef, useState } from 'react';
import { ArrowSquareOut, Camera, CurrencyDollar, Pause, Play, Plus, Pulse, Trash, WarningCircle } from '@phosphor-icons/react';
import { browser } from 'wxt/browser';
import { getShot, onStoreChanged } from '@/lib/db';
import { EVERY_LABEL, type Every } from '@/lib/monitor';
import {
  decideSource,
  deleteTracker,
  hostOf,
  listTrackers,
  lowestNow,
  newTracker,
  nextTrackerRunAt,
  normalizeCurrency,
  num,
  parseSourceUrls,
  saveTracker,
  scheduleTracker,
  sourceHistory,
  type Tracker,
  type TrackerSource,
} from '@/lib/prices';
import { MATCH_LABEL } from '@/lib/match';
import { runTracker } from '@/lib/trackerRun';
import { activeTab, call, isRestricted, requestHostAccess } from '@/lib/tab';

import type { Product } from '@/lib/product';
import { Button, Check, Field, Notice, Section, Segmented, inputCls } from './ui';
import { useNav } from './nav';

export function useTrackers() {
  const [trackers, setTrackers] = useState<Tracker[] | null>(null);
  useEffect(() => {
    const load = () => listTrackers().then(setTrackers);
    load();
    return onStoreChanged('trackers', load);
  }, []);
  return trackers;
}

function ago(t: number) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const money = (n: number | null | undefined, c?: string) => (n == null ? '-' : `${c ? c + ' ' : ''}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

/** A tiny price line for one source's history. Decorative; the numbers are in the row. */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 64;
  const h = 18;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / span) * (h - 2) - 1}`).join(' ');
  const down = values[values.length - 1] < values[0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="shrink-0">
      <polyline points={pts} fill="none" stroke={down ? 'var(--accent)' : 'currentColor'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity={down ? 1 : 0.5} />
    </svg>
  );
}

function NewTracker({ onClose }: { onClose: (saved: boolean) => void }) {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [brand, setBrand] = useState('');
  const [sku, setSku] = useState('');
  const [gtin, setGtin] = useState('');
  const [mpn, setMpn] = useState('');
  const [yourPrice, setYourPrice] = useState('');
  const [map, setMap] = useState('');
  const [currency, setCurrency] = useState('');
  const [urls, setUrls] = useState('');
  const [every, setEvery] = useState<Every>('day');
  const [evidence, setEvidence] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function useThisPage() {
    setError('');
    try {
      const tab = await activeTab();
      if (isRestricted(tab.url)) return setError('Open a product page in this tab first.');
      if (!(await requestHostAccess())) return setError('Gleaner needs permission to read the page. Try again and choose Allow.');
      const p = await call<Product>(tab.id!, 'fullProduct');
      if (!p || p.error || !p.title) return setError(p?.error || 'No product found on this page.');
      setTitle(p.title);
      setName((n) => n || p.title.slice(0, 50));
      if (p.brand) setBrand(p.brand);
      if (p.sku) setSku(p.sku);
      if (p.gtin) setGtin(p.gtin);
      if (p.mpn || p.part_number) setMpn(p.mpn || p.part_number);
      if (p.currency) setCurrency(p.currency);
      if (p.price && !yourPrice) setYourPrice(p.price);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function save() {
    setError('');
    if (!title.trim() && !sku.trim() && !gtin.trim()) return setError('Enter at least a product name, SKU or barcode so matches can be confirmed.');
    const sources = parseSourceUrls(urls);
    if (!sources.length) return setError('Add at least one competitor product-page URL to watch.');
    if (currency.trim() && !normalizeCurrency(currency)) return setError('Enter the currency as a code like USD or KRW, or a symbol like $ or ₩.');
    for (const v of [['your price', yourPrice], ['MAP', map]] as const) if (v[1].trim() && num(v[1]) === null) return setError(`Enter ${v[0]} as a number, for example 29.90.`);
    if (!(await requestHostAccess())) return setError('Price tracking needs permission to read websites. Try again and choose Allow.');
    setBusy(true);
    try {
      const t = newTracker(
        name.trim() || title.trim() || hostOf(sources[0]),
        { title: title.trim(), brand: brand.trim(), sku: sku.trim(), gtin: gtin.trim(), mpn: mpn.trim(), yourPrice: num(yourPrice), map: num(map), currency: normalizeCurrency(currency) },
        sources.map((url) => ({ url })),
        every,
        evidence,
      );
      await saveTracker(t);
      await scheduleTracker(t);
      // First check runs now in the panel, so there's data straight away
      runTracker(t.id, { signal: new AbortController().signal, status: () => {}, interactive: true }).catch(() => {});
      onClose(true);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => (e.preventDefault(), save())}
      className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-[15px] font-semibold tracking-tight">Track a product</h3>
        <Button type="button" variant="ghost" onClick={useThisPage}>
          Use this page
        </Button>
      </div>
      <Field label="Name for this tracker">{(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Heartleaf Cleanser 150ml" className={inputCls} />}</Field>
      <Field label="Product name" help="Used to confirm each competitor page is the same item when there's no shared SKU or barcode.">
        {(id) => <input id={id} value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Brand">{(id) => <input id={id} value={brand} onChange={(e) => setBrand(e.target.value)} className={inputCls} />}</Field>
        <Field label="SKU">{(id) => <input id={id} value={sku} onChange={(e) => setSku(e.target.value)} className={inputCls + ' font-mono'} />}</Field>
        <Field label="Barcode (GTIN)">{(id) => <input id={id} value={gtin} onChange={(e) => setGtin(e.target.value)} className={inputCls + ' font-mono'} inputMode="numeric" />}</Field>
        <Field label="Part number">{(id) => <input id={id} value={mpn} onChange={(e) => setMpn(e.target.value)} className={inputCls + ' font-mono'} />}</Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Your price">{(id) => <input id={id} value={yourPrice} onChange={(e) => setYourPrice(e.target.value)} className={inputCls + ' font-mono tabular-nums'} inputMode="decimal" />}</Field>
        <Field label="MAP" help="Minimum advertised price. Leave blank for competitor tracking only.">
          {(id) => <input id={id} value={map} onChange={(e) => setMap(e.target.value)} className={inputCls + ' font-mono tabular-nums'} inputMode="decimal" />}
        </Field>
        <Field label="Currency" help="Pages priced in another currency are shown but not compared.">{(id) => <input id={id} value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="USD" className={inputCls} />}</Field>
      </div>
      <Field label="Competitor product pages" help="One product-page URL per line. These are the pages Gleaner checks on each run.">
        {(id) => <textarea id={id} value={urls} onChange={(e) => setUrls(e.target.value)} rows={4} spellCheck={false} className={inputCls + ' font-mono text-[12px]'} placeholder="https://store-a.com/products/...&#10;https://store-b.com/item/..." />}
      </Field>
      <Field label="Check">
        {() => (
          <Segmented
            label="How often"
            value={every}
            onChange={setEvery}
            options={[
              { value: 'hour', label: 'Hourly' },
              { value: 'day', label: 'Daily' },
              { value: 'week', label: 'Weekly' },
            ]}
          />
        )}
      </Field>
      <Check checked={evidence} onChange={setEvidence}>
        Save a screenshot when a page is priced below MAP
      </Check>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => onClose(false)}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          <Pulse size={15} aria-hidden /> Start tracking
        </Button>
      </div>
    </form>
  );
}

function ShotLink({ shotId }: { shotId: string }) {
  async function open() {
    const shot = await getShot(shotId);
    if (!shot) return;
    const res = await fetch(shot.dataUrl);
    const url = URL.createObjectURL(await res.blob());
    await browser.tabs.create({ url });
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  return (
    <button onClick={open} className="inline-flex items-center gap-1 text-[12px] text-accent-text underline-offset-2 hover:underline">
      <Camera size={13} aria-hidden /> Evidence
    </button>
  );
}

/** How a page was matched, in words: "SKU", "barcode", "title 78%", or the user's own call. */
function matchLabel(s: TrackerSource) {
  if (s.decision === 'confirmed') return 'you confirmed';
  if (s.decision === 'rejected') return 'not this product';
  if (!s.matched || !s.matchBy) return '';
  return s.matchBy === 'title' ? `title ${Math.round((s.matchScore ?? 0) * 100)}%` : MATCH_LABEL[s.matchBy];
}

function SourceRow({ t, s }: { t: Tracker; s: TrackerSource }) {
  const hist = sourceHistory(t, s.id)
    .filter((p) => !p.c || p.c === s.lastCurrency)
    .map((p) => p.price)
    .filter((v): v is number => v != null);
  const label = matchLabel(s);
  // A title match or no match is worth a look; identifier matches are reliable
  const unsure = !s.decision && s.checkedAt && (!s.matched || s.matchBy === 'title');
  const dim = s.decision === 'rejected' || s.comparable === false;
  return (
    <li className={`flex flex-col gap-1 bg-surface-2 px-2.5 py-1.5 text-[12.5px] ${dim ? 'opacity-70' : ''}`}>
      <div className="flex items-center gap-2">
        <a href={s.url} target="_blank" rel="noreferrer" title={s.lastTitle || s.url} className="min-w-0 flex-1 truncate underline-offset-2 hover:underline">
          {s.store}
        </a>
        {label && <span className="shrink-0 rounded border border-line px-1 font-mono text-[10.5px] text-muted">{label}</span>}
        <Spark values={hist} />
        <span className={`shrink-0 font-mono tabular-nums ${s.violation ? 'font-semibold text-danger' : ''}`}>{money(s.lastPrice, s.lastCurrency)}</span>
        {s.lastInStock === false && <span className="shrink-0 text-[11px] text-muted">out</span>}
        {s.shotId && <ShotLink shotId={s.shotId} />}
      </div>
      {(s.error || unsure || s.decision) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted">
          {s.lastTitle && (unsure || s.decision) && <span className="min-w-0 truncate">Page: {s.lastTitle}</span>}
          {s.error && <span>{s.error}</span>}
          <span className="ml-auto flex gap-2">
            {s.decision ? (
              <button onClick={() => decideSource(t.id, s.id, undefined)} className="cursor-pointer text-accent-text underline-offset-2 hover:underline">
                Undo
              </button>
            ) : unsure ? (
              <>
                <button onClick={() => decideSource(t.id, s.id, 'confirmed')} className="cursor-pointer text-accent-text underline-offset-2 hover:underline">
                  It's this product
                </button>
                <button onClick={() => decideSource(t.id, s.id, 'rejected')} className="cursor-pointer text-accent-text underline-offset-2 hover:underline">
                  Not this product
                </button>
              </>
            ) : null}
          </span>
        </div>
      )}
    </li>
  );
}

function TrackerRow({ t }: { t: Tracker }) {
  const [confirm, setConfirm] = useState(false);
  const [next, setNext] = useState<number | undefined>();
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    nextTrackerRunAt(t.id).then(setNext);
  }, [t.id, t.paused, t.every, t.lastRunAt]);

  const busy = running || t.lastStatus === 'running';
  const violations = t.sources.filter((s) => s.violation).length;
  const lowest = lowestNow(t);

  async function checkNow() {
    if (busy) return;
    setRunning(true);
    setMsg('Starting');
    ctrl.current = new AbortController();
    if (!(await requestHostAccess())) {
      setMsg('Gleaner needs permission to read websites.');
      setRunning(false);
      return;
    }
    await runTracker(t.id, { signal: ctrl.current.signal, status: setMsg, interactive: true }).catch((e) => setMsg(String(e?.message ?? e)));
    setRunning(false);
  }
  async function togglePause() {
    const saved = await saveTracker({ ...t, paused: !t.paused });
    await scheduleTracker(saved);
  }
  function askDelete() {
    setConfirm(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setConfirm(false), 4000);
  }

  return (
    <li className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-3">
      <div className="flex items-start gap-3">
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${violations ? 'bg-danger/15 text-danger' : 'bg-accent-soft text-accent-text'}`}>
          {violations ? <WarningCircle size={19} weight="duotone" aria-hidden /> : <CurrencyDollar size={19} weight="duotone" aria-hidden />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="flex items-baseline justify-between gap-2">
            <span className="truncate font-display text-[15px] font-semibold tracking-tight">{t.name}</span>
            <span className="shrink-0 font-mono text-[10.5px] text-muted">{t.paused ? 'paused' : EVERY_LABEL[t.every].toLowerCase()}</span>
          </p>
          <p className="text-[12px] text-muted">
            {t.sources.length} {t.sources.length === 1 ? 'store' : 'stores'}
            {t.ref.map != null && <> · MAP {money(t.ref.map, t.ref.currency)}</>}
            {t.ref.yourPrice != null && <> · you {money(t.ref.yourPrice, t.ref.currency)}</>}
          </p>
        </div>
      </div>

      {lowest && (
        <p className="text-[12px] text-muted">
          Lowest now <span className="font-mono text-ink tabular-nums">{money(lowest.price, lowest.currency)}</span> at {lowest.store}
        </p>
      )}

      <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line">
        {t.sources.map((s) => (
          <SourceRow key={s.id} t={t} s={s} />
        ))}
      </ul>

      <div aria-live="polite" className="text-[12.5px]">
        {busy ? (
          <p className="flex items-center gap-1.5">
            <Pulse size={14} className="shrink-0 animate-pulse text-accent-text motion-reduce:animate-none" aria-hidden />
            <span className="min-w-0 truncate">{msg || t.lastMessage || 'Checking'}</span>
          </p>
        ) : t.lastRunAt ? (
          <p className={t.lastStatus === 'error' ? 'text-danger' : 'text-muted'}>
            Last check {ago(t.lastRunAt)}: {t.lastMessage}
          </p>
        ) : (
          <p className="text-muted">Not checked yet.</p>
        )}
        {!t.paused && next && !busy && <p className="font-mono text-[11px] text-muted tabular-nums">Next check {new Date(next).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1">
        {confirm ? (
          <Button variant="danger" onClick={() => deleteTracker(t.id)}>
            <Trash size={15} aria-hidden /> Delete {t.name}?
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={askDelete} aria-label={`Delete ${t.name}`} title="Delete" className="px-2">
              <Trash size={15} aria-hidden />
            </Button>
            <Button variant="ghost" onClick={togglePause} aria-label={t.paused ? `Resume ${t.name}` : `Pause ${t.name}`} title={t.paused ? 'Resume' : 'Pause'} className="px-2">
              {t.paused ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />}
            </Button>
          </>
        )}
        <Button variant="primary" onClick={checkNow} disabled={busy} aria-label={`Check ${t.name} now`}>
          <Play size={14} weight="fill" aria-hidden /> Check now
        </Button>
      </div>
    </li>
  );
}

export function PriceTrackerView() {
  const nav = useNav();
  const trackers = useTrackers();
  const [adding, setAdding] = useState(false);
  // Open straight to a tracker from an alert click
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('tracker');
    if (id && trackers?.some((t) => t.id === id)) document.getElementById(`tracker-${id}`)?.scrollIntoView({ block: 'center' });
  }, [trackers]);
  if (!trackers) return null;

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Price tracking"
        action={
          !adding && (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus size={15} aria-hidden /> Track a product
            </Button>
          )
        }
      >
        <p className="text-[12.5px] leading-relaxed text-muted">
          Watch a product's price across competitors' stores, and catch sellers advertising below your MAP. Each run records the price and stock, and alerts you to drops, MAP violations and restocks. Runs in your browser while it's open.
        </p>
      </Section>

      {adding && <NewTracker onClose={() => setAdding(false)} />}

      {trackers.length === 0 && !adding ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-line p-4">
          <p className="text-[13px]">No products tracked yet.</p>
          <p className="text-[12.5px] leading-relaxed text-muted">Open a product page, click Track a product, then Use this page to fill in the details. Add the competitor pages you want to watch.</p>
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus size={15} aria-hidden /> Track a product
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {trackers.map((t) => (
            <div key={t.id} id={`tracker-${t.id}`}>
              <TrackerRow t={t} />
            </div>
          ))}
        </ul>
      )}
    </div>
  );
}
