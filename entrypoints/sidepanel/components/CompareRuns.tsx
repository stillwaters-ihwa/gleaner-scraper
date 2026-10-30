import { useEffect, useState } from 'react';
import { GitDiff } from '@phosphor-icons/react';
import { getDataset, listDatasets, newDataset, saveDataset, type Dataset } from '@/lib/db';
import { DIFF_COLUMNS, diffDatasets, type DiffSummary } from '@/lib/diff';
import { Button, Notice, inputCls } from './ui';
import { useNav } from './nav';

const host = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return '';
  }
};

/** Compare this result with an earlier run of the same scrape. */
export function CompareRuns({ ds }: { ds: Dataset }) {
  const nav = useNav();
  const [others, setOthers] = useState<{ id: string; name: string; updatedAt: number; source: string }[]>([]);
  const [otherId, setOtherId] = useState('');
  const [result, setResult] = useState<{ summary: DiffSummary; id: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    listDatasets().then((all) => {
      const list = (all as any[]).filter((d) => d.id !== ds.id && d.tool !== 'diff');
      // Same site first, then newest
      list.sort((a, b) => Number(host(b.source) === host(ds.source)) - Number(host(a.source) === host(ds.source)) || b.updatedAt - a.updatedAt);
      setOthers(list);
      const same = list.find((d) => host(d.source) === host(ds.source) && d.tool === ds.tool);
      if (same) setOtherId(same.id);
    });
  }, [ds.id]);

  if (!others.length || ds.tool === 'diff') return null;

  async function compare() {
    setError('');
    setResult(null);
    const other = await getDataset(otherId);
    if (!other) return;
    // The older run is the baseline
    const [older, newer] = other.createdAt < ds.createdAt ? [other, ds] : [ds, other];
    try {
      const { rows, summary } = diffDatasets(older, newer);
      const when = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const saved = await saveDataset(newDataset('diff', `Changes ${newer.name} (${when(older.createdAt)} to ${when(newer.createdAt)})`, newer.source, DIFF_COLUMNS, rows));
      setResult({ summary, id: saved.id });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  const s = result?.summary;
  return (
    <section aria-label="Compare with another run" className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3">
      <div>
        <h3 className="font-display text-[14px] font-semibold">Compare with another run</h3>
        <p className="mt-0.5 text-[12px] text-muted">Run the same scrape again later, then see what's new, what's gone and which prices changed.</p>
      </div>
      <div className="flex gap-2">
        <select aria-label="Result to compare with" value={otherId} onChange={(e) => setOtherId(e.target.value)} className={inputCls}>
          <option value="">Choose a result</option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} ({new Date(o.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})
            </option>
          ))}
        </select>
        <Button onClick={compare} disabled={!otherId}>
          <GitDiff size={15} aria-hidden /> Compare
        </Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {s && (
        <div className="flex flex-col gap-2">
          <dl className="grid grid-cols-2 gap-1.5 text-[12.5px] min-[480px]:grid-cols-4">
            {[
              ['new', s.added],
              ['removed', s.removed],
              ['price up', s.priceUp],
              ['price down', s.priceDown],
            ].map(([label, n]) => (
              <div key={label} className="rounded-lg bg-surface-2 px-2.5 py-2">
                <dt className="text-muted">{label}</dt>
                <dd className="font-mono text-[16px] tabular-nums">{n}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[12px] text-muted">
            Matched rows by "{s.keyLabel}". {s.changed} changed, {s.unchanged} unchanged.
          </p>
          <Button variant="primary" onClick={() => nav.openDataset(result!.id)}>
            Open the change report
          </Button>
        </div>
      )}
    </section>
  );
}
