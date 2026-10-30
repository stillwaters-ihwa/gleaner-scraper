// Full-page data table: the side panel's Data tab, with room to breathe.
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Broom, CalendarBlank, CaretDown, Columns, Desktop, LinkSimple, MagnifyingGlass, Moon, Rows, Sun, X } from '@phosphor-icons/react';
import { getDataset, listDatasets, onDatasetsChanged, saveDataset, type Dataset } from '@/lib/db';
import { initialWidth, profileColumns, rowTitle, viewIndexes, type Sort } from '@/lib/table';
import { DataGrid, type Density } from './DataGrid';
import { ExportMenu } from './ExportMenu';
import { RowDrawer } from './RowDrawer';
import { CleanPanel } from './CleanPanel';
import { useTheme } from './theme';

type Summary = { id: string; name: string; tool: string; source: string; updatedAt: number; rowCount?: number };

const TOOL_NAMES: Record<string, string> = { list: 'List', page: 'Pages', images: 'Images', emails: 'Contacts', social: 'Social links', shopify: 'Shopify', store: 'Store', text: 'Text', diff: 'Changes', sitemap: 'Sitemap' };
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

function Monogram({ text }: { text: string }) {
  return (
    <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent-soft font-display text-[12px] font-bold text-accent-text uppercase">
      {(text || '?').replace(/^www\./, '')[0]}
    </span>
  );
}

function Chip({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-[12px] text-muted">
      {children}
    </span>
  );
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return { open, setOpen, ref };
}

function DatasetSwitcher({ sets, current, onPick }: { sets: Summary[]; current: Dataset; onPick: (id: string) => void }) {
  const pop = usePopover();
  const [q, setQ] = useState('');
  const shown = sets.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div ref={pop.ref} className="relative min-w-0">
      <button
        aria-haspopup="listbox"
        aria-expanded={pop.open}
        onClick={() => pop.setOpen((o) => !o)}
        className="flex h-9 max-w-[min(520px,48vw)] min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-2 hover:border-muted/60"
      >
        <Monogram text={host(current.source) || current.name} />
        <span className="truncate text-[13px] font-medium">{current.name}</span>
        <span className="rounded bg-surface-2 px-1.5 font-mono text-[11px] text-muted tabular-nums">{current.rows.length.toLocaleString()}</span>
        <CaretDown size={13} className="shrink-0 text-muted" aria-hidden />
      </button>
      {pop.open && (
        <div className="absolute top-11 left-0 z-20 w-[380px] max-w-[90vw] overflow-hidden rounded-xl border border-line bg-surface shadow-[0_20px_60px_rgb(0_0_0/0.28)]">
          <div className="border-b border-line p-2">
            <input autoFocus aria-label="Find a dataset" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a dataset" className="w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[13px] text-ink placeholder:text-muted/80 focus:border-accent focus:outline-none" />
          </div>
          <ul role="listbox" aria-label="Datasets" className="max-h-[60vh] overflow-y-auto p-1.5">
            {shown.map((s) => (
              <li key={s.id}>
                <button
                  role="option"
                  aria-selected={s.id === current.id}
                  onClick={() => (onPick(s.id), pop.setOpen(false))}
                  className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-surface-2 ${s.id === current.id ? 'bg-accent-soft' : ''}`}
                >
                  <Monogram text={host(s.source) || s.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{s.name}</span>
                    <span className="block text-[11px] text-muted">
                      {TOOL_NAMES[s.tool] ?? s.tool} · {new Date(s.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </span>
                  <span className="font-mono text-[11px] text-muted tabular-nums">{(s.rowCount ?? 0).toLocaleString()}</span>
                </button>
              </li>
            ))}
            {!shown.length && <li className="px-2 py-3 text-[12.5px] text-muted">No datasets match.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function ColumnPicker({ ds, hidden, setHidden }: { ds: Dataset; hidden: Set<string>; setHidden: (s: Set<string>) => void }) {
  const pop = usePopover();
  const shown = ds.columns.length - hidden.size;
  return (
    <div ref={pop.ref} className="relative">
      <button aria-haspopup="true" aria-expanded={pop.open} onClick={() => pop.setOpen((o) => !o)} className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-[12px] text-muted hover:text-ink">
        <Columns size={13} aria-hidden />
        <span className="font-mono tabular-nums">
          {shown}/{ds.columns.length}
        </span>
        columns
      </button>
      {pop.open && (
        <div className="absolute top-9 left-0 z-20 w-[280px] rounded-xl border border-line bg-surface p-2 shadow-[0_20px_60px_rgb(0_0_0/0.28)]">
          <div className="flex justify-between px-1.5 pb-1.5 text-[12px]">
            <button className="cursor-pointer text-accent-text hover:underline" onClick={() => setHidden(new Set())}>
              Show all
            </button>
            <button className="cursor-pointer text-muted hover:text-ink" onClick={() => setHidden(new Set(ds.columns.slice(1).map((c) => c.key)))}>
              Hide all
            </button>
          </div>
          <ul className="max-h-[50vh] overflow-y-auto">
            {ds.columns.map((c) => (
              <li key={c.key}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-[12.5px] hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={!hidden.has(c.key)}
                    onChange={(e) => {
                      const n = new Set(hidden);
                      e.target.checked ? n.delete(c.key) : n.add(c.key);
                      if (n.size < ds.columns.length) setHidden(n);
                    }}
                    className="size-4 accent-[var(--accent)]"
                  />
                  <span className="truncate">{c.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function TableApp() {
  const { theme, cycle } = useTheme();
  const [sets, setSets] = useState<Summary[]>([]);
  const [ds, setDs] = useState<Dataset | null | undefined>(undefined);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [sort, setSort] = useState<Sort>(null);
  const [queryInput, setQueryInput] = useState('');
  const query = useDeferredValue(queryInput);
  const [density, setDensity] = useState<Density>('comfortable');
  const [openPos, setOpenPos] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const [cleanOpen, setCleanOpen] = useState(false);
  const savedAt = useRef(0);
  const saveTimer = useRef<number>(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (id?: string) => {
    const list = (await listDatasets()) as Summary[];
    setSets(list);
    const wanted = id ?? new URLSearchParams(location.search).get('id') ?? list[0]?.id;
    setDs(wanted ? (await getDataset(wanted)) ?? null : null);
  }, []);

  useEffect(() => {
    load();
    // Pick up changes from the side panel or monitors, but not our own saves
    return onDatasetsChanged(() => {
      if (Date.now() - savedAt.current < 2000) {
        listDatasets().then((l) => setSets(l as Summary[]));
        return;
      }
      load(new URLSearchParams(location.search).get('id') ?? undefined);
    });
  }, [load]);

  // New dataset: reset view state and size columns from their content
  const profilesList = useMemo(() => (ds ? profileColumns(ds) : []), [ds?.id, ds?.columns, ds?.rows.length]);
  const profiles = useMemo(() => new Map(profilesList.map((p) => [p.key, p])), [profilesList]);
  useEffect(() => {
    if (!ds) return;
    setWidths(Object.fromEntries(ds.columns.map((c) => [c.key, initialWidth(profiles.get(c.key)!, c.label)])));
    setHidden(new Set());
    setSort(null);
    setOpenPos(null);
    document.title = `${ds.name} - Gleaner`;
  }, [ds?.id]);

  // Ctrl/Cmd+F focuses the table search
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const columns = useMemo(() => (ds ? ds.columns.filter((c) => !hidden.has(c.key)) : []), [ds?.columns, hidden]);
  const view = useMemo(() => (ds ? viewIndexes(ds, profilesList, query, sort, columns.map((c) => c.key)) : []), [ds, profilesList, query, sort, columns]);
  const exportView = useMemo<Dataset | null>(() => (ds ? { ...ds, columns, rows: view.map((i) => ds.rows[i]) } : null), [ds, columns, view]);

  const pick = (id: string) => {
    history.replaceState(null, '', `?id=${encodeURIComponent(id)}`);
    setQueryInput('');
    load(id);
  };
  const onSort = useCallback((key: string) => setSort((s) => (s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null)), []);
  const onResize = useCallback((key: string, w: number) => setWidths((x) => ({ ...x, [key]: w })), []);
  const onEdit = useCallback((rowIndex: number, key: string, value: string) => {
    setDs((cur) => {
      if (!cur || (cur.rows[rowIndex]?.[key] ?? '') === value) return cur;
      const rows = cur.rows.slice();
      rows[rowIndex] = { ...rows[rowIndex], [key]: value };
      const next = { ...cur, rows };
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        savedAt.current = Date.now();
        saveDataset({ ...next });
      }, 400);
      return next;
    });
  }, []);
  const onOpenRow = useCallback((rowIndex: number) => setOpenPos(view.indexOf(rowIndex)), [view]);
  const showToast = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((t) => (t === m ? '' : t)), 5000);
  }, []);

  if (ds === undefined) return <div className="h-dvh animate-pulse bg-bg" />;
  if (ds === null)
    return (
      <main className="flex h-dvh flex-col items-center justify-center gap-2 bg-bg p-6 text-center">
        <Rows size={32} className="text-accent-text" aria-hidden />
        <h1 className="font-display text-[20px] font-semibold">No data yet</h1>
        <p className="max-w-[44ch] text-[13px] text-muted">Run any tool in the Gleaner side panel. Its results show up here as a table you can sort, search, edit and export.</p>
      </main>
    );

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Desktop;
  const openRow = openPos !== null && openPos >= 0 && openPos < view.length ? ds.rows[view[openPos]] : null;
  const filtered = view.length !== ds.rows.length;

  return (
    <div className="flex h-dvh flex-col bg-bg text-ink">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
        <div aria-hidden className="flex size-8 shrink-0 flex-col justify-center gap-[3px] rounded-lg bg-surface-2 px-[7px] shadow-[inset_0_0_0_1px_var(--line)]">
          <span className="h-[3px] w-full rounded-full bg-accent" />
          <span className="h-[3px] w-[78%] rounded-full bg-accent/80" />
          <span className="h-[3px] w-[56%] rounded-full bg-accent/60" />
        </div>
        <h1 className="hidden font-display text-[18px] font-bold tracking-tight sm:block">Data table</h1>
        <DatasetSwitcher sets={sets} current={ds} onPick={pick} />
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={cycle}
            aria-label={`Theme: ${theme}. Click to change.`}
            title={`Theme: ${theme === 'system' ? 'follow system' : theme}`}
            className="flex size-9 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface text-muted hover:text-ink"
          >
            <ThemeIcon size={16} aria-hidden />
          </button>
          {exportView && <ExportMenu view={exportView} onToast={showToast} />}
        </div>
      </header>

      <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-line px-4 py-2">
        <Chip>{TOOL_NAMES[ds.tool] ?? ds.tool}</Chip>
        <Chip title="Created">
          <CalendarBlank size={13} aria-hidden />
          {new Date(ds.createdAt).toLocaleDateString()}
        </Chip>
        <Chip>
          <Rows size={13} aria-hidden />
          <span className="font-mono tabular-nums text-ink">{filtered ? `${view.length.toLocaleString()} of ${ds.rows.length.toLocaleString()}` : ds.rows.length.toLocaleString()}</span> rows
        </Chip>
        <ColumnPicker ds={ds} hidden={hidden} setHidden={setHidden} />
        <button
          onClick={() => setCleanOpen((o) => !o)}
          aria-pressed={cleanOpen}
          className={`inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-[12px] ${cleanOpen ? 'border-accent/60 bg-accent-soft text-ink' : 'border-line bg-surface text-muted hover:text-ink'}`}
        >
          <Broom size={13} aria-hidden /> Clean data
        </button>
        <button
          onClick={() => setDensity((d) => (d === 'comfortable' ? 'compact' : 'comfortable'))}
          className="inline-flex h-7 shrink-0 cursor-pointer items-center rounded-md border border-line bg-surface px-2 text-[12px] text-muted hover:text-ink"
        >
          {density === 'comfortable' ? 'Comfortable' : 'Compact'}
        </button>
        {ds.source && (
          <a href={ds.source} target="_blank" rel="noreferrer" className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[12px] text-accent-text hover:underline">
            <LinkSimple size={13} className="shrink-0" aria-hidden />
            <span className="max-w-[340px] truncate">{ds.source}</span>
          </a>
        )}
        <div className="relative ml-auto shrink-0">
          <MagnifyingGlass size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" aria-hidden />
          <input
            ref={searchRef}
            aria-label="Search rows"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="Search rows  (Ctrl+F)"
            className="h-8 w-[240px] rounded-lg border border-line bg-surface pr-7 pl-8 text-[12.5px] text-ink placeholder:text-muted/80 focus:border-accent focus:outline-none"
          />
          {queryInput && (
            <button aria-label="Clear search" onClick={() => setQueryInput('')} className="absolute top-1/2 right-1.5 -translate-y-1/2 cursor-pointer rounded p-0.5 text-muted hover:text-ink">
              <X size={13} aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <DataGrid
          ds={ds}
          columns={columns}
          profiles={profiles}
          view={view}
          widths={widths}
          onResize={onResize}
          sort={sort}
          onSort={onSort}
          density={density}
          query={query}
          onOpenRow={onOpenRow}
          onEdit={onEdit}
        />
        {cleanOpen && (
          <CleanPanel
            ds={ds}
            onClose={() => setCleanOpen(false)}
            onApply={(next, message) => {
              if (next !== ds) {
                setDs(next);
                savedAt.current = Date.now();
                saveDataset({ ...next });
              }
              showToast(message);
            }}
          />
        )}
        {openRow && !cleanOpen && (
          <RowDrawer
            title={rowTitle(ds, openRow, profilesList)}
            position={openPos! + 1}
            total={view.length}
            row={openRow}
            columns={ds.columns}
            onClose={() => setOpenPos(null)}
            onStep={(d) => setOpenPos((p) => (p === null ? p : Math.max(0, Math.min(view.length - 1, p + d))))}
          />
        )}
      </div>

      <footer className="flex h-8 shrink-0 items-center gap-3 border-t border-line px-4 text-[11.5px] text-muted">
        <span>{sort ? `Sorted by ${ds.columns.find((c) => c.key === sort.key)?.label} (${sort.dir === 'asc' ? 'A to Z, low to high' : 'Z to A, high to low'})` : 'Click a column name to sort'}</span>
        <span className="ml-auto hidden md:inline">Double-click a cell to edit. Click a row for details.</span>
      </footer>

      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-12 z-30 flex justify-center px-4">
        {toast && <p className="pointer-events-auto max-w-[560px] rounded-xl border border-line bg-surface px-4 py-2.5 text-[13px] shadow-[0_14px_40px_rgb(0_0_0/0.3)]">{toast}</p>}
      </div>
    </div>
  );
}
