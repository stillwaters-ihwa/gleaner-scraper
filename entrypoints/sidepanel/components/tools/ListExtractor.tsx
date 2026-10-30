import { useEffect, useState } from 'react';
import { ArrowsClockwise, BookmarkSimple, CursorClick, MagicWand } from '@phosphor-icons/react';
import { browser } from 'wxt/browser';
import { columnsFromRows, defaultPattern, newRecipe, saveDataset, saveRecipe, urlMatches, type Column, type ListRecipe, type Recipe } from '@/lib/db';
import { labelForKey, uniqueLabels } from '@/lib/columns';
import { activeTab, call, hasHostAccess, isRestricted, requestHostAccess, sleep, waitForLoad } from '@/lib/tab';
import { adaptiveKey, healList, runList } from '@/lib/jobs';
import { Button, Field, NumberInput, Notice, Section, Segmented, inputCls } from '../ui';
import { RunBar, hostOf, useJob } from '../run';
import { PreviewTable } from '../PreviewTable';
import { SaveRecipe, useRecipes } from '../recipes';
import { useHandoff } from '../nav';

interface Candidate {
  index: number;
  total: number;
  itemSelector: string;
  count: number;
}
type Row = Record<string, string>;
type Paging = 'none' | 'next' | 'scroll';
type TabInfo = { id: number; url: string; title: string };
type NextButton = { selector: string; label: string; kind: string };
type ListRecipeRow = Recipe & ListRecipe;

/** Everything a run needs, passed explicitly so a recipe can start before React state settles. */
interface RunConfig {
  tab: TabInfo;
  itemSelector: string;
  paging: Paging;
  next: NextButton | null;
  maxPages: number;
  delay: number;
  columns: Column[];
  excluded: Set<string>;
  name: string;
  /** What Scrapling remembers the list as, for a recipe. */
  adaptiveId?: string;
}

const tail = (sel: string) => sel.split(' > ').pop() ?? sel;

export function ListExtractor() {
  const [tab, setTab] = useState<TabInfo | null>(null);
  const [cand, setCand] = useState<Candidate | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [paging, setPaging] = useState<Paging>('none');
  const [next, setNext] = useState<NextButton | null>(null);
  const [maxPages, setMaxPages] = useState(10);
  const [delay, setDelay] = useState(1500);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [healedNote, setHealedNote] = useState('');
  // The recipe currently loaded, if any
  const [applied, setApplied] = useState<ListRecipeRow | null>(null);
  const [pick, setPick] = useState('');
  const job = useJob();
  const recipes = useRecipes();
  const matching = (recipes ?? []).filter((r): r is ListRecipeRow => r.kind === 'list' && !!tab && urlMatches(r.urlPattern, tab.url));
  const chosen = matching.find((r) => r.id === pick) ?? matching[0];

  // Follow the active tab
  useEffect(() => {
    const refresh = async () => {
      try {
        const t = await activeTab();
        setTab((prev) => {
          if (prev?.id !== t.id || prev?.url !== t.url) {
            setCand(null);
            setRows([]);
            setNext(null);
            setApplied(null);
          }
          return { id: t.id!, url: t.url ?? '', title: t.title ?? '' };
        });
      } catch {
        setTab(null);
      }
    };
    refresh();
    const onUpdated = (_id: number, info: { status?: string; url?: string }) => (info.status === 'complete' || info.url) && refresh();
    browser.tabs.onActivated.addListener(refresh);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      browser.tabs.onActivated.removeListener(refresh);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  async function load(c: Candidate | null) {
    if (!tab) return;
    setCand(c);
    setApplied(null);
    if (!c) {
      setRows([]);
      setError('No repeating list found on this page. Try "Pick on page" and click one item of the list.');
      return;
    }
    const res = await call<{ rows: Row[] }>(tab.id, 'extractItems', c.itemSelector);
    setRows(res.rows);
    setColumns(uniqueLabels(columnsFromRows(res.rows, labelForKey)));
    setExcluded(new Set());
    if (!next) {
      const n = await call(tab.id, 'findNext');
      if (n) {
        setNext(n);
        setPaging('next');
      }
    }
  }

  /** `needsTab: false` for recipe runs, which look up the tab themselves (it may not be known yet on first mount). */
  async function act(fn: () => Promise<void>, needsTab = true) {
    if (needsTab && !tab) return;
    setError('');
    if (!(await requestHostAccess())) {
      setError('Gleaner needs permission to read websites. Click again and choose Allow.');
      return;
    }
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  const detect = (index = 0) => act(async () => load(await call(tab!.id, 'findList', index)));

  // One click: find the list as soon as the tool opens on a page (or the page changes), when
  // Gleaner may already read websites. A saved recipe for this page is left for the user to apply.
  useEffect(() => {
    if (!tab || isRestricted(tab.url) || matching.length) return;
    let live = true;
    void (async () => {
      if (!(await hasHostAccess())) return;
      await sleep(300);
      if (!live) return;
      try {
        const c = await call<Candidate | null>(tab.id, 'findList', 0);
        if (live && c) await load(c);
      } catch {
        /* the page is still loading; Find list works by hand */
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.id, tab?.url, matching.length]);
  const pickList = () => act(async () => load(await call(tab!.id, 'pickList')));
  const pickNext = () =>
    act(async () => {
      const n = await call(tab!.id, 'pickElement', 'Click the "Next" or "Load more" button');
      if (n) {
        setNext({ ...n, kind: 'next' });
        setPaging('next');
      }
      if (cand) await call(tab!.id, 'showList', cand.itemSelector);
    });

  function start() {
    if (!tab || !cand) return;
    run({ tab, itemSelector: cand.itemSelector, paging, next, maxPages, delay, columns, excluded, name: applied?.name ?? '', adaptiveId: applied ? applied.adaptiveId ?? applied.itemSelector : undefined });
  }

  function run({ tab, ...cfg }: RunConfig) {
    job.start(async (ctx) => saveDataset(await runList({ ...cfg, tabId: tab.id, url: tab.url }, ctx)));
  }

  /** Load a saved recipe, opening its start page first if this tab is somewhere else. Optionally run it. */
  const applyRecipe = (r: ListRecipeRow, andRun: boolean) =>
    act(async () => {
      let t = await activeTab();
      if (!urlMatches(r.urlPattern, t.url ?? '')) {
        await browser.tabs.update(t.id!, { url: r.startUrl });
        await sleep(400);
        await waitForLoad(t.id!);
        await sleep(1000);
        t = await browser.tabs.get(t.id!);
      }
      const info: TabInfo = { id: t.id!, url: t.url ?? r.startUrl, title: t.title ?? '' };
      if (isRestricted(info.url)) throw new Error("This page can't be read by extensions. Open a normal website in this tab.");
      let sel = r.itemSelector;
      let res = await call<{ rows: Row[]; count: number }>(info.id, 'extractItems', sel);
      if (!res.count) {
        const again = await call<Candidate | null>(info.id, 'findList', 0);
        if (again && tail(again.itemSelector) === tail(sel)) {
          sel = again.itemSelector;
          res = await call(info.id, 'extractItems', sel);
        }
      }
      let healed = false;
      if (!res.count) {
        // The site's layout changed: Scrapling finds the remembered list again
        const h = await healList(info.id, r.itemSelector, adaptiveKey(r));
        if (h) {
          sel = h.selector;
          res = h;
          healed = true;
          await saveRecipe({ ...r, itemSelector: sel, adaptiveId: r.adaptiveId ?? r.itemSelector, updatedAt: Date.now() });
        }
      }
      if (!res.count) throw new Error(`The list saved in "${r.name}" isn't on this page. Use Find list or Pick on page instead.`);
      setHealedNote(healed ? `The site's layout changed: Gleaner found the list of "${r.name}" again with Scrapling and updated the recipe.` : '');
      await call(info.id, 'showList', sel);
      const cols = uniqueLabels(columnsFromRows(res.rows, labelForKey));
      const excl = new Set(r.excluded);
      setTab(info);
      setCand({ index: 0, total: 1, itemSelector: sel, count: res.count });
      setRows(res.rows);
      setColumns(cols);
      setExcluded(excl);
      setPaging(r.paging);
      setNext(r.next);
      setMaxPages(r.maxPages);
      setDelay(r.delay);
      setApplied(healed ? { ...r, itemSelector: sel, adaptiveId: r.adaptiveId ?? r.itemSelector } : r);
      if (andRun) run({ tab: info, itemSelector: sel, paging: r.paging, next: r.next, maxPages: r.maxPages, delay: r.delay, columns: cols, excluded: excl, name: r.name, adaptiveId: r.adaptiveId ?? r.itemSelector });
    }, false);

  useHandoff('list', (h) => applyRecipe(h.recipe as ListRecipeRow, h.run));

  async function storeRecipe(name: string, urlPattern: string) {
    if (!tab || !cand) return;
    if (!urlPattern) throw new Error(`Enter which pages this recipe is for, for example ${defaultPattern(tab.url)}`);
    const body: ListRecipe = {
      kind: 'list',
      urlPattern,
      startUrl: tab.url,
      itemSelector: cand.itemSelector,
      excluded: [...excluded],
      columns: columns.filter((c) => !excluded.has(c.key)),
      paging,
      next,
      maxPages,
      delay,
    };
    // Saving under the loaded recipe's name updates it instead of making a copy
    const r = applied && applied.name === name ? { ...applied, ...body } : newRecipe(name, body);
    setApplied((await saveRecipe(r)) as ListRecipeRow);
  }

  const restricted = tab ? isRestricted(tab.url) : true;
  const shown = columns.filter((c) => !excluded.has(c.key));

  return (
    <div className="flex flex-1 flex-col gap-5">
      <Section title="Find the list">
        <p className="truncate text-[12.5px] text-muted" title={tab?.url}>
          {tab ? `On ${hostOf(tab.url)}: ${tab.title}` : 'No active tab'}
        </p>
        {restricted && tab && <Notice>This page can't be read by extensions. Open a normal website in this tab.</Notice>}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="primary" onClick={() => detect(0)} disabled={busy || restricted || job.running}>
            <MagicWand size={16} aria-hidden /> Find list
          </Button>
          <Button onClick={pickList} disabled={busy || restricted || job.running}>
            <CursorClick size={16} aria-hidden /> Pick on page
          </Button>
        </div>
        {chosen && applied?.id !== chosen.id && (
          <div className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[12.5px]">
              <BookmarkSimple size={15} weight="fill" className="shrink-0 text-accent-text" aria-hidden />
              {matching.length === 1 ? (
                <span className="min-w-0 truncate">
                  Your recipe <span className="font-medium">{chosen.name}</span> fits this page.
                </span>
              ) : (
                <span>{matching.length} of your recipes fit this page.</span>
              )}
            </p>
            <div className="flex gap-2">
              {matching.length > 1 && (
                <select aria-label="Recipe" value={chosen.id} onChange={(e) => setPick(e.target.value)} className={inputCls + ' min-w-0 flex-1 py-1.5'}>
                  {matching.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              )}
              <Button onClick={() => applyRecipe(chosen, false)} disabled={busy || restricted || job.running}>
                Use recipe
              </Button>
            </div>
          </div>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        {healedNote && !error && <Notice>{healedNote}</Notice>}
        {cand && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2">
            <p className="text-[13px]">
              <span className="font-mono tabular-nums">{cand.count}</span> items, <span className="font-mono tabular-nums">{shown.length}</span> columns
              {applied && <span className="text-muted"> from {applied.name}</span>}
              {cand.total > 1 && (
                <span className="text-muted">
                  {' '}
                  (list {cand.index + 1} of {cand.total})
                </span>
              )}
            </p>
            {cand.total > 1 && (
              <Button variant="ghost" onClick={() => detect(cand.index + 1)} disabled={busy || job.running}>
                <ArrowsClockwise size={15} aria-hidden /> Another list
              </Button>
            )}
          </div>
        )}
      </Section>

      {cand && rows.length > 0 && (
        <Section title="Preview">
          <PreviewTable columns={shown} rows={rows} max={6} />
          {columns.length > 0 && (
            <details className="text-[12.5px]">
              <summary className="cursor-pointer text-muted hover:text-ink">Choose columns ({shown.length} of {columns.length})</summary>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {columns.map((c) => {
                  const on = !excluded.has(c.key);
                  return (
                    <button
                      key={c.key}
                      aria-pressed={on}
                      onClick={() =>
                        setExcluded((s) => {
                          const n = new Set(s);
                          on ? n.add(c.key) : n.delete(c.key);
                          return n;
                        })
                      }
                      className={`cursor-pointer rounded-md border px-2 py-1 transition ${on ? 'border-accent/50 bg-accent-soft text-ink' : 'border-line text-muted line-through'}`}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </details>
          )}
        </Section>
      )}

      {cand && (
        <Section title="More pages">
          <Segmented
            label="Pagination"
            value={paging}
            onChange={setPaging}
            options={[
              { value: 'none', label: 'This page' },
              { value: 'next', label: 'Next button' },
              { value: 'scroll', label: 'Infinite scroll' },
            ]}
          />
          {paging === 'next' && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2">
              <p className="min-w-0 truncate text-[13px]">
                {next ? (
                  <>
                    {next.kind === 'number' ? (
                      <>Clicks the next page number <span className="text-muted">(numbered pages)</span></>
                    ) : (
                      <>Clicks <span className="font-medium">"{next.label || 'Next'}"</span></>
                    )}
                    {next.kind === 'load-more' && <span className="text-muted"> (load more)</span>}
                  </>
                ) : (
                  <span className="text-muted">No next button found yet</span>
                )}
              </p>
              <Button variant="ghost" onClick={pickNext} disabled={busy || job.running}>
                <CursorClick size={15} aria-hidden /> Pick
              </Button>
            </div>
          )}
          {paging !== 'none' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={paging === 'scroll' ? 'Max scrolls' : 'Max pages'}>{(id) => <NumberInput id={id} value={maxPages} onChange={setMaxPages} min={1} max={500} />}</Field>
              <Field label="Wait between (ms)">{(id) => <NumberInput id={id} value={delay} onChange={setDelay} min={0} max={30000} />}</Field>
            </div>
          )}
        </Section>
      )}

      {cand && tab && (
        <SaveRecipe
          defaultName={applied?.name ?? `List ${hostOf(tab.url)}`}
          pattern={applied?.urlPattern ?? defaultPattern(tab.url)}
          onSave={storeRecipe}
          disabled={job.running}
        />
      )}

      <div className="flex-1" />
      <RunBar job={job} onStart={start} startLabel="Extract" disabled={!cand || busy || restricted || (paging === 'next' && !next)} />
    </div>
  );
}
