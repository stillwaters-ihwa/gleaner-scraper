// Virtualized grid: only the rows on screen are in the DOM, so 50,000 rows scroll smoothly.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, CalendarBlank, CurrencyCircleDollar, Hash, ImageSquare, LinkSimple, TextT } from '@phosphor-icons/react';
import type { Column, Dataset } from '@/lib/db';
import type { ColumnProfile, ColumnType, Sort } from '@/lib/table';

export type Density = 'compact' | 'comfortable';

const TYPE_ICON: Record<ColumnType, typeof TextT> = { image: ImageSquare, url: LinkSimple, price: CurrencyCircleDollar, number: Hash, date: CalendarBlank, text: TextT };
const TYPE_NAME: Record<ColumnType, string> = { image: 'Pictures', url: 'Links', price: 'Prices', number: 'Numbers', date: 'Dates', text: 'Text' };
const NUM_W = 56;
const HEADER_H = 44;

interface Props {
  ds: Dataset;
  columns: Column[];
  profiles: Map<string, ColumnProfile>;
  view: number[];
  widths: Record<string, number>;
  onResize: (key: string, width: number) => void;
  sort: Sort;
  onSort: (key: string) => void;
  density: Density;
  query: string;
  onOpenRow: (rowIndex: number) => void;
  onEdit: (rowIndex: number, key: string, value: string) => void;
}

function shortUrl(v: string) {
  try {
    const u = new URL(v);
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/$/, '') : '';
    return u.hostname.replace(/^www\./, '') + (path.length > 28 ? '/…' + path.slice(-24) : path);
  } catch {
    return v;
  }
}

/** Wrap search matches in <mark>. Only runs for the rows on screen. */
function highlight(text: string, terms: string[]): ReactNode {
  if (!terms.length || !text) return text;
  const lower = text.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    let hit = -1;
    let len = 0;
    for (const t of terms) {
      const at = lower.indexOf(t, i);
      if (at !== -1 && (hit === -1 || at < hit)) ((hit = at), (len = t.length));
    }
    if (hit === -1) break;
    if (hit > i) out.push(text.slice(i, hit));
    out.push(
      <mark key={hit} className="rounded-sm bg-accent/35 px-0.5 text-ink">
        {text.slice(hit, hit + len)}
      </mark>,
    );
    i = hit + len;
  }
  out.push(text.slice(i));
  return out;
}

interface CellProps {
  value: string;
  type: ColumnType;
  terms: string[];
  onPreview: (src: string | null, rect?: DOMRect) => void;
}

const Cell = memo(function Cell({ value, type, terms, onPreview }: CellProps) {
  if (!value) return <span className="text-muted/50">-</span>;
  if (type === 'image') {
    const src = value.split(' | ')[0];
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onMouseEnter={(e) => onPreview(src, e.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => onPreview(null)}
        className="size-11 rounded-md border border-line bg-surface-2 object-cover"
      />
    );
  }
  if (type === 'url') {
    return (
      <a href={value} target="_blank" rel="noreferrer" title={value} onClick={(e) => e.stopPropagation()} className="block truncate text-accent-text hover:underline">
        {highlight(shortUrl(value), terms)}
      </a>
    );
  }
  if (type === 'price' || type === 'number') {
    return <span className="block truncate text-right font-mono tabular-nums">{highlight(value, terms)}</span>;
  }
  return (
    <span className="block truncate" title={value.length > 40 ? value.slice(0, 600) : undefined}>
      {highlight(value, terms)}
    </span>
  );
});

interface RowProps {
  index: number;
  rowIndex: number;
  row: Record<string, string>;
  columns: Column[];
  types: ColumnType[];
  widths: number[];
  top: number;
  height: number;
  terms: string[];
  editingKey: string | null;
  onOpen: (rowIndex: number) => void;
  onStartEdit: (rowIndex: number, key: string) => void;
  onCommit: (rowIndex: number, key: string, value: string | null) => void;
  onPreview: CellProps['onPreview'];
}

const Row = memo(function Row({ index, rowIndex, row, columns, types, widths, top, height, terms, editingKey, onOpen, onStartEdit, onCommit, onPreview }: RowProps) {
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      tabIndex={0}
      onClick={(e) => !(e.target as HTMLElement).closest('a, input, textarea') && onOpen(rowIndex)}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && onOpen(rowIndex)}
      className={`group absolute top-0 right-0 left-0 flex cursor-pointer border-b border-line text-[12.5px] outline-none hover:bg-accent-soft focus-visible:bg-accent-soft ${index % 2 ? 'bg-surface' : 'bg-bg/40'}`}
      style={{ transform: `translateY(${top}px)`, height }}
    >
      <div role="rowheader" className="sticky left-0 z-[1] flex shrink-0 items-center justify-end border-r border-line bg-inherit px-3 font-mono text-[11.5px] text-muted tabular-nums" style={{ width: NUM_W }}>
        {rowIndex + 1}
      </div>
      {columns.map((c, ci) => (
        <div
          key={c.key}
          role="gridcell"
          className="flex min-w-0 shrink-0 items-center border-r border-line/60 px-3"
          style={{ width: widths[ci] }}
          onDoubleClick={(e) => {
            if (types[ci] === 'image') return;
            e.stopPropagation();
            onStartEdit(rowIndex, c.key);
          }}
        >
          {editingKey === c.key ? (
            <input
              autoFocus
              aria-label={`Edit ${c.label}`}
              defaultValue={row[c.key] ?? ''}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => onCommit(rowIndex, c.key, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') onCommit(rowIndex, c.key, null);
              }}
              className="w-full rounded border border-accent bg-surface px-1.5 py-1 text-[12.5px] text-ink outline-none"
            />
          ) : (
            <div className="min-w-0 flex-1">
              <Cell value={row[c.key] ?? ''} type={types[ci]} terms={terms} onPreview={onPreview} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
});

export function DataGrid({ ds, columns, profiles, view, widths, onResize, sort, onSort, density, query, onOpenRow, onEdit }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Stable arrays, so memoized rows only re-render when something they show changed
  const types = useMemo(() => columns.map((c) => profiles.get(c.key)?.type ?? 'text'), [columns, profiles]);
  const colWidths = useMemo(() => columns.map((c) => widths[c.key] ?? 160), [columns, widths]);
  const hasImages = types.includes('image');
  const rowH = density === 'compact' ? (hasImages ? 52 : 34) : hasImages ? 64 : 44;
  const total = NUM_W + colWidths.reduce((a, b) => a + b, 0);
  const terms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);

  const virtual = useVirtualizer({ count: view.length, getScrollElement: () => scrollRef.current, estimateSize: () => rowH, overscan: 10 });
  useEffect(() => {
    virtual.measure();
  }, [rowH]);
  // Back to the top when the result set changes (new search, sort or dataset)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [ds.id, query, sort?.key, sort?.dir]);

  const [editing, setEditing] = useState<{ row: number; key: string } | null>(null);
  const [preview, setPreview] = useState<{ src: string; x: number; y: number } | null>(null);
  const onPreview = useCallback((src: string | null, rect?: DOMRect) => {
    if (!src || !rect) return setPreview(null);
    const x = Math.min(rect.right + 12, window.innerWidth - 300);
    const y = Math.max(8, Math.min(rect.top - 100, window.innerHeight - 300));
    setPreview({ src, x, y });
  }, []);
  const onStartEdit = useCallback((row: number, key: string) => setEditing({ row, key }), []);
  const onCommit = useCallback(
    (row: number, key: string, value: string | null) => {
      setEditing(null);
      if (value !== null) onEdit(row, key, value);
    },
    [onEdit],
  );

  const startResize = (key: string, startWidth: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const move = (ev: PointerEvent) => onResize(key, Math.max(60, Math.min(900, startWidth + ev.clientX - startX)));
    const up = () => (window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up));
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div ref={scrollRef} role="grid" aria-rowcount={view.length + 1} aria-colcount={columns.length + 1} className="relative min-h-0 flex-1 overflow-auto">
      <div style={{ width: total, height: HEADER_H + virtual.getTotalSize() }} className="relative min-w-full">
        <div role="row" className="sticky top-0 z-[2] flex min-w-full border-b border-line bg-surface-2" style={{ height: HEADER_H, width: total }}>
          <div role="columnheader" className="sticky left-0 z-[1] flex shrink-0 items-center justify-end border-r border-line bg-surface-2 px-3 font-mono text-[11px] text-muted" style={{ width: NUM_W }}>
            #
          </div>
          {columns.map((c, ci) => {
            const p = profiles.get(c.key);
            const Icon = TYPE_ICON[types[ci]];
            const sorted = sort?.key === c.key ? sort.dir : null;
            return (
              <div
                key={c.key}
                role="columnheader"
                aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
                className="relative flex shrink-0 flex-col justify-center border-r border-line"
                style={{ width: colWidths[ci] }}
              >
                <button
                  onClick={() => onSort(c.key)}
                  title={`${TYPE_NAME[types[ci]]}. ${Math.round((p?.filled ?? 0) * 100)}% filled, ${p?.unique ?? 0} different values. Click to sort.`}
                  className={`flex h-full w-full cursor-pointer items-center gap-1.5 px-3 text-left text-[12px] font-semibold tracking-tight ${sorted ? 'text-accent-text' : 'text-ink'} hover:bg-surface`}
                >
                  <Icon size={14} weight="bold" className="shrink-0 text-muted" aria-hidden />
                  <span className="truncate">{c.label}</span>
                  {sorted === 'asc' && <ArrowUp size={12} weight="bold" className="shrink-0" aria-hidden />}
                  {sorted === 'desc' && <ArrowDown size={12} weight="bold" className="shrink-0" aria-hidden />}
                </button>
                {/* Fill meter: how much of this column has data */}
                <span aria-hidden className="pointer-events-none absolute bottom-0 left-0 h-[2px] bg-accent/70" style={{ width: `${Math.round((p?.filled ?? 0) * 100)}%` }} />
                <span
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Resize ${c.label}`}
                  onPointerDown={startResize(c.key, colWidths[ci])}
                  onDoubleClick={() => onResize(c.key, 160)}
                  className="absolute top-0 right-[-3px] z-[1] h-full w-[6px] cursor-col-resize hover:bg-accent/50"
                />
              </div>
            );
          })}
        </div>
        {virtual.getVirtualItems().map((vr) => {
          const rowIndex = view[vr.index];
          return (
            <Row
              key={rowIndex}
              index={vr.index}
              rowIndex={rowIndex}
              row={ds.rows[rowIndex]}
              columns={columns}
              types={types}
              widths={colWidths}
              top={HEADER_H + vr.start}
              height={rowH}
              terms={terms}
              editingKey={editing?.row === rowIndex ? editing.key : null}
              onOpen={onOpenRow}
              onStartEdit={onStartEdit}
              onCommit={onCommit}
              onPreview={onPreview}
            />
          );
        })}
      </div>
      {!view.length && (
        <p className="absolute inset-x-0 top-24 text-center text-[13px] text-muted">{query ? 'No rows match your search.' : 'This dataset has no rows.'}</p>
      )}
      {preview && (
        <img
          src={preview.src}
          alt=""
          aria-hidden
          className="pointer-events-none fixed z-30 max-h-[280px] max-w-[280px] rounded-xl border border-line bg-surface object-contain p-1 shadow-[0_18px_50px_rgb(0_0_0/0.35)]"
          style={{ left: preview.x, top: preview.y }}
        />
      )}
    </div>
  );
}
