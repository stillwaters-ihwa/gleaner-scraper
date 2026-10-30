// "Clean data" side panel: pick a column and a rule, preview before/after, then apply.
import { useMemo, useState } from 'react';
import { ArrowRight, X } from '@phosphor-icons/react';
import type { Dataset } from '@/lib/db';
import { OP_NAMES, applyOp, cleanColumn, splitColumn, type CleanOp } from '@/lib/parser';

type Kind = keyof typeof OP_NAMES;

const field = 'w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[13px] text-ink placeholder:text-muted/80 focus:border-accent focus:outline-none';

export function CleanPanel({ ds, onApply, onClose }: { ds: Dataset; onApply: (next: Dataset, message: string) => void; onClose: () => void }) {
  const [key, setKey] = useState(ds.columns[0]?.key ?? '');
  const [kind, setKind] = useState<Kind>('trim');
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [regex, setRegex] = useState(false);
  const [pattern, setPattern] = useState('(\\d+)');
  const [caseTo, setCaseTo] = useState<'upper' | 'lower' | 'title'>('title');
  const [before, setBefore] = useState('');
  const [after, setAfter] = useState('');
  const [separator, setSeparator] = useState(' | ');
  const [asNew, setAsNew] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const label = ds.columns.find((c) => c.key === key)?.label ?? '';

  const op: CleanOp | null =
    kind === 'trim' ? { kind } : kind === 'number' ? { kind } : kind === 'replace' ? { kind, find, replace, regex } : kind === 'extract' ? { kind, pattern } : kind === 'case' ? { kind, to: caseTo } : kind === 'prefix' ? { kind, before, after } : null;

  const preview = useMemo(() => {
    const sample = ds.rows.filter((r) => r[key]).slice(0, 6);
    try {
      return {
        rows: sample.map((r) => ({ from: r[key], to: kind === 'split' ? (r[key] ?? '').split(separator).map((s) => s.trim()).filter(Boolean).join('  /  ') : applyOp(r[key], op!) })),
        error: '',
      };
    } catch (e: any) {
      return { rows: [], error: e?.message ?? String(e) };
    }
  }, [ds.rows, key, kind, find, replace, regex, pattern, caseTo, before, after, separator]);

  function apply() {
    try {
      const next = kind === 'split' ? splitColumn(ds, key, separator) : cleanColumn(ds, key, op!, asNew ? newLabel.trim() || `${label} (clean)` : undefined);
      onApply(next, kind === 'split' ? `Split "${label}" into new columns` : `${OP_NAMES[kind]} applied to "${label}"${asNew ? ' as a new column' : ''}`);
    } catch (e: any) {
      onApply(ds, e?.message ?? String(e));
    }
  }

  return (
    <aside aria-label="Clean data" className="flex h-full w-[min(380px,100vw)] shrink-0 flex-col border-l border-line bg-surface">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-display text-[15px] font-semibold tracking-tight">Clean data</h2>
        <button aria-label="Close" onClick={onClose} className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink">
          <X size={16} aria-hidden />
        </button>
      </header>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 text-[13px]">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium">Column</span>
          <select value={key} onChange={(e) => setKey(e.target.value)} className={field}>
            {ds.columns.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium">Rule</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={field}>
            {Object.entries(OP_NAMES).map(([k, n]) => (
              <option key={k} value={k}>
                {n}
              </option>
            ))}
          </select>
        </label>

        {kind === 'replace' && (
          <div className="grid grid-cols-2 gap-2">
            <input aria-label="Find" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find" className={field} />
            <input aria-label="Replace with" value={replace} onChange={(e) => setReplace(e.target.value)} placeholder="Replace with" className={field} />
            <label className="col-span-2 flex items-center gap-2 text-[12px] text-muted">
              <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} className="size-4 accent-[var(--accent)]" /> Use a regular expression
            </label>
          </div>
        )}
        {kind === 'extract' && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium">Pattern</span>
            <input value={pattern} onChange={(e) => setPattern(e.target.value)} className={field + ' font-mono text-[12px]'} />
            <span className="text-[11.5px] text-muted">Keeps the first (group) match, e.g. PartNum : (\d+)</span>
          </label>
        )}
        {kind === 'case' && (
          <select aria-label="Case" value={caseTo} onChange={(e) => setCaseTo(e.target.value as typeof caseTo)} className={field}>
            <option value="title">Title Case</option>
            <option value="upper">UPPERCASE</option>
            <option value="lower">lowercase</option>
          </select>
        )}
        {kind === 'prefix' && (
          <div className="grid grid-cols-2 gap-2">
            <input aria-label="Text before" value={before} onChange={(e) => setBefore(e.target.value)} placeholder="Before, e.g. $" className={field} />
            <input aria-label="Text after" value={after} onChange={(e) => setAfter(e.target.value)} placeholder="After, e.g.  ea" className={field} />
          </div>
        )}
        {kind === 'split' && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium">Separator</span>
            <input value={separator} onChange={(e) => setSeparator(e.target.value)} className={field + ' font-mono'} />
          </label>
        )}
        {kind !== 'split' && (
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-[12.5px]">
              <input type="checkbox" checked={asNew} onChange={(e) => setAsNew(e.target.checked)} className="size-4 accent-[var(--accent)]" /> Put the result in a new column
            </label>
            {asNew && <input aria-label="New column name" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder={`${label} (clean)`} className={field} />}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <p className="text-[12px] font-medium">Preview</p>
          {preview.error ? (
            <p className="text-[12px] text-danger">{preview.error}</p>
          ) : !preview.rows.length ? (
            <p className="text-[12px] text-muted">This column is empty.</p>
          ) : (
            <ul className="flex flex-col gap-1 rounded-lg border border-line bg-bg p-2">
              {preview.rows.map((r, i) => (
                <li key={i} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[12px]">
                  <span className="truncate text-muted" title={r.from}>
                    {r.from}
                  </span>
                  <ArrowRight size={12} className="text-accent-text" aria-hidden />
                  <span className="truncate font-medium" title={r.to}>
                    {r.to || <span className="text-muted/60">(empty)</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <footer className="border-t border-line p-3">
        <button
          onClick={apply}
          disabled={!!preview.error || !key || (kind === 'replace' && !find)}
          className="w-full cursor-pointer rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-accent-ink hover:brightness-105 active:scale-[0.98] disabled:opacity-45"
        >
          Apply to all {ds.rows.length.toLocaleString()} rows
        </button>
      </footer>
    </aside>
  );
}
