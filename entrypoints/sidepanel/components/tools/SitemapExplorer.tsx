import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CaretRight, FloppyDisk, MagnifyingGlass, Stack } from '@phosphor-icons/react';
import { newDataset, saveDataset, type Dataset } from '@/lib/db';
import { MAX_URLS, buildTree, crawlSitemaps, robotsSitemaps, sitemapStart, subtreeIndexes, type SitemapResult, type TreeNode } from '@/lib/sitemap';
import { activeTab } from '@/lib/tab';
import { Button, Field, Notice, Section, inputCls } from '../ui';
import { RunBar, hostOf, useJob } from '../run';
import { useNav } from '../nav';

const PAGE = 200;
const fmt = (n: number) => n.toLocaleString();

type Row = { kind: 'folder'; node: TreeNode; depth: number } | { kind: 'page'; index: number; label: string; depth: number } | { kind: 'more'; node: TreeNode; depth: number; hidden: number };

function TriCheck({ checked, mixed, label, onChange }: { checked: boolean; mixed: boolean; label: string; onChange: (v: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      aria-checked={mixed ? 'mixed' : checked}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="size-4 shrink-0 cursor-pointer accent-[var(--accent)]"
    />
  );
}

export function SitemapExplorer() {
  const nav = useNav();
  const [domain, setDomain] = useState('');
  const [result, setResult] = useState<SitemapResult | null>(null);
  const [filter, setFilter] = useState('');
  const query = useDeferredValue(filter.trim().toLowerCase());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState<Dataset | null>(null);
  const job = useJob();

  useEffect(() => {
    activeTab()
      .then((t) => t.url?.startsWith('http') && setDomain((d) => d || new URL(t.url!).hostname))
      .catch(() => {});
  }, []);
  // Folder open/closed state is relative to the filter, so start fresh when it changes
  useEffect(() => setToggled(new Set()), [query]);

  let valid = false;
  try {
    valid = !!domain.trim() && !!sitemapStart(domain);
  } catch {
    valid = false;
  }

  function start() {
    setSaved(null);
    job.start(async ({ signal, progress, status }) => {
      const { origin, sitemap } = sitemapStart(domain);
      let starts: string[];
      if (sitemap) starts = [sitemap];
      else {
        status('Reading robots.txt');
        const listed = await robotsSitemaps(origin, signal);
        starts = listed.length ? listed : [`${origin}/sitemap.xml`];
      }
      const res = await crawlSitemaps(starts, {
        signal,
        onProgress: (files, urls, current) => {
          progress(urls);
          if (current) status(`Sitemap ${files + 1}: ${current.replace(/^https?:\/\//, '')}`);
        },
      });
      setResult(res);
      setSelected(new Set());
      setFilter('');
      setLimits({});
      if (!res.entries.length) {
        const failed = res.files.filter((f) => f.error);
        throw new Error(
          failed.length === res.files.length
            ? `No sitemap found for ${hostOf(origin)}. Checked ${res.files.map((f) => f.url.replace(origin, '')).join(', ')}. Paste the sitemap's full address if it lives somewhere else.`
            : 'The sitemaps were read but listed no page URLs.',
        );
      }
      status(`${fmt(res.entries.length)} URLs from ${res.files.length} ${res.files.length === 1 ? 'sitemap' : 'sitemaps'}`);
    }, { needsHostAccess: true });
  }

  const entries = result?.entries ?? [];
  const visible = useMemo(() => {
    const all = entries.map((_, i) => i);
    return query ? all.filter((i) => entries[i].url.toLowerCase().includes(query)) : all;
  }, [entries, query]);
  const tree = useMemo(() => buildTree(entries, visible), [entries, visible]);

  // Selected count per folder, for checkbox state
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    const walk = (n: TreeNode): number => {
      let c = n.own.reduce((s, i) => s + (selected.has(i) ? 1 : 0), 0);
      for (const k of n.children) c += walk(k);
      m.set(n.id, c);
      return c;
    };
    walk(tree);
    return m;
  }, [tree, selected]);

  const isOpen = (n: TreeNode) => {
    const auto = !!query && n.total <= 300;
    return toggled.has(n.id) ? !auto : auto;
  };

  const rows = useMemo(() => {
    const out: Row[] = [];
    const add = (n: TreeNode, depth: number) => {
      if (!n.children.length && n.own.length === 1) {
        out.push({ kind: 'page', index: n.own[0], label: n.label, depth });
        return;
      }
      out.push({ kind: 'folder', node: n, depth });
      if (isOpen(n)) addChildren(n, depth + 1);
    };
    const addChildren = (n: TreeNode, depth: number) => {
      const limit = limits[n.id] ?? PAGE;
      const items = [...n.own.map((i) => ({ page: i })), ...n.children.map((c) => ({ node: c }))];
      for (const it of items.slice(0, limit)) {
        if ('page' in it) out.push({ kind: 'page', index: it.page, label: n.label ? '(this page)' : '/', depth });
        else add(it.node, depth);
      }
      if (items.length > limit) out.push({ kind: 'more', node: n, depth, hidden: items.length - limit });
    };
    addChildren(tree, 0);
    return out;
  }, [tree, toggled, limits, query]);

  function setMany(idx: number[], on: boolean) {
    setSelected((s) => {
      const n = new Set(s);
      for (const i of idx) on ? n.add(i) : n.delete(i);
      return n;
    });
    setSaved(null);
  }
  const toggleOpen = (id: string) =>
    setToggled((t) => {
      const n = new Set(t);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const picked = [...selected].sort((a, b) => a - b);
  const visibleSelected = counts.get(tree.id) ?? 0;

  async function saveSelection() {
    const { origin } = sitemapStart(domain);
    const rowsOut = picked.map((i) => ({ url: entries[i].url, lastmod: entries[i].lastmod, sitemap: entries[i].sitemap }));
    const cols = [
      { key: 'url', label: 'url' },
      { key: 'lastmod', label: 'last modified' },
      { key: 'sitemap', label: 'sitemap' },
    ].filter((c) => rowsOut.some((r) => r[c.key as keyof typeof r]));
    setSaved(await saveDataset(newDataset('sitemap', `Sitemap ${hostOf(origin)}`, origin, cols, rowsOut)));
  }

  const failed = result?.files.filter((f) => f.error) ?? [];

  return (
    <div className="flex flex-1 flex-col gap-5">
      <Section title="Site">
        <Field label="Domain or sitemap address" help="Gleaner reads the Sitemap lines in robots.txt and /sitemap.xml, then follows sitemap indexes, including .xml.gz files.">
          {(id) => (
            <input
              id={id}
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && valid && !job.running && start()}
              placeholder="example.com"
              className={inputCls}
            />
          )}
        </Field>
      </Section>

      {result && entries.length > 0 && (
        <Section title="URLs">
          <p className="text-[12.5px] text-muted">
            <span className="font-mono tabular-nums text-ink">{fmt(entries.length)}</span> URLs from <span className="font-mono tabular-nums text-ink">{result.files.length}</span>{' '}
            {result.files.length === 1 ? 'sitemap' : 'sitemaps'}
            {failed.length > 0 && <span>, {failed.length} could not be read</span>}
          </p>
          {result.capped && <Notice>Stopped at {fmt(MAX_URLS)} URLs. Enter a specific sitemap address to explore one section of a very large site.</Notice>}
          {failed.length > 0 && (
            <details className="text-[12px] text-muted">
              <summary className="cursor-pointer hover:text-ink">Sitemaps that failed</summary>
              <ul className="mt-1.5 flex flex-col gap-1">
                {failed.map((f) => (
                  <li key={f.url} className="break-all font-mono text-[11.5px]">
                    {f.url} <span className="text-danger">{f.error}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="relative">
            <MagnifyingGlass size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" aria-hidden />
            <input aria-label="Filter URLs" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter, e.g. /blog/ or 2024" className={inputCls + ' pl-8'} />
          </div>

          <div className="flex items-center justify-between gap-2 text-[12.5px]">
            <p aria-live="polite" className="text-muted">
              <span className="font-mono tabular-nums text-ink">{fmt(selected.size)}</span> selected
              {query && (
                <>
                  , <span className="font-mono tabular-nums text-ink">{fmt(visible.length)}</span> match
                </>
              )}
            </p>
            <div className="flex gap-1">
              <Button variant="ghost" onClick={() => setMany(visible, true)} disabled={!visible.length || visibleSelected === visible.length}>
                {query ? 'Select matches' : 'Select all'}
              </Button>
              <Button variant="ghost" onClick={() => (query ? setMany(visible, false) : (setSelected(new Set()), setSaved(null)))} disabled={query ? !visibleSelected : !selected.size}>
                Clear
              </Button>
            </div>
          </div>

          <div role="tree" aria-label="Sitemap URLs" aria-multiselectable className="max-h-[52vh] overflow-auto rounded-lg border border-line bg-surface py-1">
            {rows.length === 0 && <p className="px-3 py-4 text-[12.5px] text-muted">No URLs match "{filter}".</p>}
            {rows.map((r) => {
              const pad = { paddingLeft: 8 + r.depth * 16 };
              if (r.kind === 'more')
                return (
                  <div key={r.node.id + ':more'} style={pad} className="py-1 pr-2">
                    <button onClick={() => setLimits((l) => ({ ...l, [r.node.id]: (l[r.node.id] ?? PAGE) + PAGE * 5 }))} className="ml-6 cursor-pointer text-[12px] text-accent-text hover:underline">
                      Show {fmt(Math.min(r.hidden, PAGE * 5))} more of {fmt(r.hidden)}
                    </button>
                  </div>
                );
              if (r.kind === 'page') {
                const url = entries[r.index].url;
                return (
                  <div key={'p' + r.index} role="treeitem" aria-selected={selected.has(r.index)} style={pad} className="flex min-h-8 items-center gap-2 pr-2 hover:bg-surface-2">
                    <span className="w-4 shrink-0" />
                    <TriCheck checked={selected.has(r.index)} mixed={false} label={url} onChange={(v) => setMany([r.index], v)} />
                    <span className="min-w-0 truncate text-[12.5px]" title={url}>
                      {r.label}
                    </span>
                  </div>
                );
              }
              const n = r.node;
              const open = isOpen(n);
              const c = counts.get(n.id) ?? 0;
              return (
                <div key={n.id} role="treeitem" aria-expanded={open} aria-selected={c === n.total} style={pad} className="flex min-h-8 items-center gap-2 pr-2 hover:bg-surface-2">
                  <button onClick={() => toggleOpen(n.id)} aria-label={`${open ? 'Collapse' : 'Expand'} ${n.label}`} aria-expanded={open} className="flex size-4 shrink-0 cursor-pointer items-center justify-center text-muted hover:text-ink">
                    <CaretRight size={12} weight="bold" className={`transition-transform duration-150 ${open ? 'rotate-90' : ''}`} aria-hidden />
                  </button>
                  <TriCheck checked={c > 0 && c === n.total} mixed={c > 0 && c < n.total} label={`All ${fmt(n.total)} URLs in ${n.label}`} onChange={(v) => setMany(subtreeIndexes(n), v)} />
                  <button onClick={() => toggleOpen(n.id)} className="flex min-w-0 flex-1 cursor-pointer items-baseline justify-between gap-2 text-left">
                    <span className="min-w-0 truncate text-[12.5px] font-medium">{n.label}/</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted tabular-nums">
                      {c > 0 && c < n.total ? `${fmt(c)} of ` : ''}
                      {fmt(n.total)}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button variant="primary" disabled={!selected.size} onClick={() => nav.handoff({ tool: 'page', urls: picked.map((i) => entries[i].url), run: false })}>
              <Stack size={15} aria-hidden /> Page extractor
            </Button>
            <Button disabled={!selected.size} onClick={saveSelection}>
              <FloppyDisk size={15} aria-hidden /> Save as data
            </Button>
          </div>
          {saved && (
            <div role="status" className="flex items-center justify-between gap-2 rounded-lg bg-accent-soft px-3 py-2">
              <p className="min-w-0 truncate text-[12.5px]">
                Saved <span className="font-mono tabular-nums">{fmt(saved.rows.length)}</span> URLs to <span className="font-medium">{saved.name}</span>
              </p>
              <Button onClick={() => nav.openDataset(saved.id)}>
                Open <ArrowRight size={14} aria-hidden />
              </Button>
            </div>
          )}
        </Section>
      )}

      <div className="flex-1" />
      <RunBar job={job} onStart={start} startLabel={result ? 'Read again' : 'Read sitemaps'} disabled={!valid} />
    </div>
  );
}
