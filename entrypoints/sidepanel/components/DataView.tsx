import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowSquareOut, Copy, DownloadSimple, HouseLine, MagnifyingGlass, PencilSimple, Rows, Trash, X } from '@phosphor-icons/react';
import { browser } from 'wxt/browser';
import { deleteDataset, getDataset, listDatasets, onDatasetsChanged, saveDataset, type Dataset } from '@/lib/db';
import { copyTsv, exportCsv, exportJson, exportXlsx } from '@/lib/export';
import { Button, Notice, inputCls } from './ui';
import { Cell } from './PreviewTable';
import { ExportImages } from './ExportImages';
import { CompareRuns } from './CompareRuns';
import { useNav } from './nav';

/** Open the full-page data table in a new tab. */
export function openFullTable(id?: string) {
  browser.tabs.create({ url: browser.runtime.getURL(`/table.html${id ? `?id=${encodeURIComponent(id)}` : ''}`) });
}

const PAGE = 100;
type Summary = Awaited<ReturnType<typeof listDatasets>>[number] & { rowCount?: number };

function when(ts: number) {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function DatasetList() {
  const nav = useNav();
  const [sets, setSets] = useState<Summary[] | null>(null);
  useEffect(() => {
    const load = () => listDatasets().then((l) => setSets(l as Summary[]));
    load();
    return onDatasetsChanged(load);
  }, []);

  if (!sets) return <div className="h-24 animate-pulse rounded-xl bg-surface" />;
  if (!sets.length) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-line p-5">
        <Rows size={28} className="text-accent-text" aria-hidden />
        <div>
          <h2 className="font-display text-[16px] font-semibold">No data yet</h2>
          <p className="mt-1 text-[13px] text-muted">Every tool saves its results here, where you can edit, clean and export them.</p>
        </div>
        <Button variant="primary" onClick={() => nav.go({ tab: 'tools' })}>
          Choose a tool
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
    <Button onClick={() => openFullTable()} className="self-start">
      <ArrowSquareOut size={15} aria-hidden /> Open full data table
    </Button>
    <ul className="flex flex-col gap-1.5">
      {sets.map((s) => (
        <li key={s.id}>
          <button
            onClick={() => nav.openDataset(s.id)}
            className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left transition hover:border-accent/50"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{s.name}</span>
              <span className="block truncate text-[12px] text-muted">{when(s.updatedAt)}</span>
            </span>
            <span className="shrink-0 text-right font-mono text-[12px] text-muted tabular-nums">
              {s.rowCount} rows
              <br />
              {s.columns.length} cols
            </span>
          </button>
        </li>
      ))}
    </ul>
    </div>
  );
}

function DatasetTable({ id }: { id: string }) {
  const nav = useNav();
  const [ds, setDs] = useState<Dataset | null | undefined>(undefined);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ row: number; key: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    getDataset(id).then((d) => setDs(d ?? null));
  }, [id]);

  const filtered = useMemo(() => {
    if (!ds) return [];
    const idx = ds.rows.map((r, i) => ({ r, i }));
    if (!query.trim()) return idx;
    const q = query.toLowerCase();
    return idx.filter(({ r }) => ds.columns.some((c) => (r[c.key] ?? '').toLowerCase().includes(q)));
  }, [ds, query]);

  if (ds === undefined) return <div className="h-40 animate-pulse rounded-xl bg-surface" />;
  if (ds === null) return <Notice tone="error">This dataset no longer exists.</Notice>;

  const commit = async (next: Dataset, message?: string) => {
    setDs({ ...(await saveDataset({ ...next })) });
    if (message) {
      setNote(message);
      setTimeout(() => setNote(''), 3500);
    }
  };

  const removeDuplicates = () => {
    const seen = new Set<string>();
    const rows = ds.rows.filter((r) => {
      const k = JSON.stringify(ds.columns.map((c) => r[c.key] ?? ''));
      return seen.has(k) ? false : (seen.add(k), true);
    });
    commit({ ...ds, rows }, `Removed ${ds.rows.length - rows.length} duplicate rows`);
  };

  const removeEmptyColumns = () => {
    const columns = ds.columns.filter((c) => ds.rows.some((r) => (r[c.key] ?? '').trim()));
    commit({ ...ds, columns }, `Removed ${ds.columns.length - columns.length} empty columns`);
  };

  const pageRows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" aria-label="All data" onClick={() => nav.go({ tab: 'data' })} className="px-2">
          <ArrowLeft size={16} aria-hidden />
        </Button>
        <input
          aria-label="Dataset name"
          value={ds.name}
          onChange={(e) => setDs({ ...ds, name: e.target.value })}
          onBlur={() => commit(ds)}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 font-display text-[16px] font-semibold hover:border-line focus:border-accent focus:outline-none"
        />
      </div>
      <p className="truncate px-1 text-[12px] text-muted">
        <span className="font-mono tabular-nums">{ds.rows.length}</span> rows, <span className="font-mono tabular-nums">{ds.columns.length}</span> columns
        {ds.source && (
          <>
            {' '}from{' '}
            <a href={ds.source} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">
              {ds.source}
            </a>
          </>
        )}
      </p>

      <div className="flex flex-wrap gap-1.5">
        <Button onClick={() => openFullTable(ds.id)}>
          <ArrowSquareOut size={15} aria-hidden /> Open full table
        </Button>
        {ds.tool === 'realestate' && (
          <Button onClick={() => browser.tabs.create({ url: browser.runtime.getURL(`/property.html?id=${encodeURIComponent(ds.id)}` as any) })}>
            <HouseLine size={15} aria-hidden /> Open property viewer
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button variant="primary" onClick={() => exportCsv(ds)}>
          <DownloadSimple size={15} aria-hidden /> CSV
        </Button>
        <Button onClick={() => exportXlsx(ds)}>Excel</Button>
        <Button onClick={() => exportJson(ds)}>JSON</Button>
        <Button onClick={() => copyTsv(ds).then(() => setNote('Copied. Paste into Google Sheets or Excel.'))}>
          <Copy size={15} aria-hidden /> Copy
        </Button>
        <span className="flex-1" />
        <Button variant="ghost" onClick={removeDuplicates}>
          Remove duplicates
        </Button>
        <Button variant="ghost" onClick={removeEmptyColumns}>
          Remove empty columns
        </Button>
      </div>
      {note && <Notice>{note}</Notice>}
      <ExportImages ds={ds} />
      <CompareRuns ds={ds} />

      <div className="relative">
        <MagnifyingGlass size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" aria-hidden />
        <input aria-label="Search rows" value={query} onChange={(e) => (setQuery(e.target.value), setPage(0))} placeholder="Search rows" className={inputCls + ' pl-8'} />
      </div>

      <div className="max-h-[62dvh] overflow-auto rounded-lg border border-line">
        <table className="w-max min-w-full border-collapse text-[12px]">
          <thead className="sticky top-0 z-[1]">
            <tr className="bg-surface-2 text-left">
              <th scope="col" className="w-10 px-2 py-2 text-right font-mono font-normal text-muted">
                #
              </th>
              {ds.columns.map((c) => (
                <th key={c.key} scope="col" className="group px-2 py-1.5 font-medium whitespace-nowrap">
                  {renaming === c.key ? (
                    <input
                      autoFocus
                      aria-label="Column name"
                      defaultValue={c.label}
                      onBlur={(e) => {
                        setRenaming(null);
                        commit({ ...ds, columns: ds.columns.map((x) => (x.key === c.key ? { ...x, label: e.target.value || x.label } : x)) });
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      className={inputCls + ' py-1'}
                    />
                  ) : (
                    <span className="flex items-center gap-1">
                      <span className="max-w-[200px] truncate">{c.label}</span>
                      <button aria-label={`Rename ${c.label}`} onClick={() => setRenaming(c.key)} className="cursor-pointer rounded p-0.5 text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-ink">
                        <PencilSimple size={13} aria-hidden />
                      </button>
                      <button
                        aria-label={`Delete column ${c.label}`}
                        onClick={() => commit({ ...ds, columns: ds.columns.filter((x) => x.key !== c.key) }, `Deleted column "${c.label}"`)}
                        className="cursor-pointer rounded p-0.5 text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-danger"
                      >
                        <X size={13} aria-hidden />
                      </button>
                    </span>
                  )}
                </th>
              ))}
              <th scope="col" className="w-8" />
            </tr>
          </thead>
          <tbody>
            {pageRows.map(({ r, i }) => (
              <tr key={i} className="group border-t border-line bg-surface">
                <td className="px-2 py-1.5 text-right align-top font-mono text-muted tabular-nums">{i + 1}</td>
                {ds.columns.map((c) => (
                  <td key={c.key} className="max-w-[240px] px-2 py-1.5 align-top" onDoubleClick={() => setEditing({ row: i, key: c.key })}>
                    {editing?.row === i && editing.key === c.key ? (
                      <textarea
                        autoFocus
                        aria-label={`Edit ${c.label}`}
                        defaultValue={r[c.key] ?? ''}
                        onBlur={(e) => {
                          setEditing(null);
                          const rows = ds.rows.slice();
                          rows[i] = { ...rows[i], [c.key]: e.target.value };
                          commit({ ...ds, rows });
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), (e.target as HTMLTextAreaElement).blur());
                          if (e.key === 'Escape') setEditing(null);
                        }}
                        className={inputCls + ' min-w-[160px] py-1 text-[12px]'}
                      />
                    ) : (
                      <div className="flex max-w-[240px] min-w-0 overflow-hidden" title="Double-click to edit">
                        <Cell value={r[c.key] ?? ''} />
                      </div>
                    )}
                  </td>
                ))}
                <td className="px-1 align-top">
                  <button
                    aria-label={`Delete row ${i + 1}`}
                    onClick={() => commit({ ...ds, rows: ds.rows.filter((_, j) => j !== i) })}
                    className="cursor-pointer rounded p-1 text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-danger"
                  >
                    <Trash size={13} aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!pageRows.length && <p className="bg-surface px-3 py-6 text-center text-[12.5px] text-muted">{query ? 'No rows match your search.' : 'This dataset has no rows.'}</p>}
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] text-muted">Double-click a cell to edit it.</p>
        {pages > 1 && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span className="font-mono text-[12px] tabular-nums">
              {page + 1}/{pages}
            </span>
            <Button variant="ghost" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        )}
      </div>

      <div className="mt-2 border-t border-line pt-3">
        <Button
          variant="danger"
          onClick={async () => {
            if (!confirm(`Delete "${ds.name}"? This can't be undone.`)) return;
            await deleteDataset(ds.id);
            nav.go({ tab: 'data' });
          }}
        >
          <Trash size={15} aria-hidden /> Delete dataset
        </Button>
      </div>
    </div>
  );
}

export function DataView({ datasetId }: { datasetId?: string }) {
  return datasetId ? <DatasetTable key={datasetId} id={datasetId} /> : <DatasetList />;
}
