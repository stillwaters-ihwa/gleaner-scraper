import { useState } from 'react';
import { CursorClick, ListMagnifyingGlass, Plus, Stop, Trash } from '@phosphor-icons/react';
import type { CustomField } from '@/lib/dom/doc';
import { newRecipe, saveDataset, saveRecipe, type PageRecipe, type Recipe } from '@/lib/db';
import { runPages, type PageRunConfig } from '@/lib/jobs';
import { normalizeUrls } from '@/lib/runner';
import { activeTab, call, isRestricted, requestHostAccess } from '@/lib/tab';
import { Button, Check, Notice, Section, inputCls } from '../ui';
import { RunBar, UrlSource, hostOf, useJob } from '../run';
import { useHandoff } from '../nav';
import { SaveRecipe } from '../recipes';
import { LoadOptions, defaultLoad, errorText, type LoadSettings } from './common';
import { PagingControls } from '../PagingControls';
import { crawlListing } from '@/lib/listing';

export function PageExtractor() {
  const [urls, setUrls] = useState('');
  const [useMeta, setUseMeta] = useState(true);
  const [useProduct, setUseProduct] = useState(true);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [load, setLoad] = useState(defaultLoad);
  const [pickErr, setPickErr] = useState('');
  const [applied, setApplied] = useState<(Recipe & PageRecipe) | null>(null);
  const [from, setFrom] = useState('');
  const job = useJob();

  useHandoff('page', (h) => {
    if (h.urls) {
      setUrls(h.urls.join('\n'));
      setFrom(`${h.urls.length} URLs from the Sitemap Explorer`);
    }
    const r = h.recipe?.kind === 'page' ? (h.recipe as Recipe & PageRecipe) : null;
    if (!r) return;
    setApplied(r);
    setUseMeta(r.useMeta);
    setUseProduct(r.useProduct);
    setFields(r.fields);
    setLoad(r.load);
    if (r.urls.length && !h.urls) {
      setUrls(r.urls.join('\n'));
      setFrom('');
    }
    const list = h.urls ?? r.urls;
    if (h.run && list.length) run({ list, useMeta: r.useMeta, useProduct: r.useProduct, fields: r.fields, load: r.load, name: r.name });
  });

  async function storeRecipe(name: string) {
    const body: PageRecipe = { kind: 'page', useMeta, useProduct, fields: fields.filter((f) => f.selector), load, urls: normalizeUrls(urls) };
    const r = applied && applied.name === name ? { ...applied, ...body } : newRecipe(name, body);
    setApplied((await saveRecipe(r)) as Recipe & PageRecipe);
  }

  async function pickField() {
    setPickErr('');
    try {
      if (!(await requestHostAccess())) return setPickErr('Gleaner needs permission to read websites.');
      const tab = await activeTab();
      if (isRestricted(tab.url)) return setPickErr('Open one of the pages you want to scrape in this tab first.');
      const picked = await call<{ selector: string; label: string; tag: string } | null>(tab.id!, 'pickElement', 'Click the value you want on every page');
      if (!picked) return;
      const attr: CustomField['attr'] = picked.tag === 'img' ? 'src' : 'text';
      setFields((f) => [...f, { name: picked.label.slice(0, 24) || `field ${f.length + 1}`, selector: picked.selector, attr }]);
    } catch (e) {
      setPickErr(errorText(e));
    }
  }

  const update = (i: number, patch: Partial<CustomField>) => setFields((f) => f.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  function start() {
    run({ list: normalizeUrls(urls), useMeta, useProduct, fields, load, name: applied?.name ?? '' });
  }

  function run(cfg: PageRunConfig) {
    job.start(async (ctx) => saveDataset(await runPages(cfg, ctx)));
  }

  const count = normalizeUrls(urls).length;
  return (
    <div className="flex flex-1 flex-col gap-5">
      {applied && (
        <p className="text-[12.5px] text-muted">
          Using recipe <span className="font-medium text-ink">{applied.name}</span>
        </p>
      )}
      <Section title="Pages">
        <UrlSource
          value={urls}
          onChange={(v) => (setUrls(v), setFrom(''))}
          help={from ? `${from}. Edit freely before you start.` : 'One URL per line, or take a link column from a List extractor result.'}
        />
        <ListingLinks
          onLinks={(links, note) => {
            setUrls(links.join('\n'));
            setFrom(note);
          }}
        />
      </Section>
      <Section title="What to collect">
        <Check checked={useMeta} onChange={setUseMeta}>
          Page metadata <span className="text-muted">(title, description, image, author, date, canonical URL)</span>
        </Check>
        <Check checked={useProduct} onChange={setUseProduct}>
          Product details, found automatically <span className="text-muted">(title, price, compare-at price, stock, SKU, barcode, rating, reviews, category, all images; works on Amazon and most stores)</span>
        </Check>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-[13px]">Your own fields</p>
            <div className="flex gap-1">
              <Button variant="ghost" onClick={() => setFields((f) => [...f, { name: `field ${f.length + 1}`, selector: '', attr: 'text' }])}>
                <Plus size={14} aria-hidden /> Add
              </Button>
              <Button onClick={pickField}>
                <CursorClick size={14} aria-hidden /> Pick on page
              </Button>
            </div>
          </div>
          {pickErr && <Notice tone="error">{pickErr}</Notice>}
          {fields.length === 0 && <p className="text-[12px] text-muted">Open one of the pages, click "Pick on page", then click the value you want from every page.</p>}
          {fields.map((f, i) => (
            <div key={i} className="grid grid-cols-[1fr_1.4fr_auto_auto] items-center gap-1.5">
              <input aria-label="Column name" value={f.name} onChange={(e) => update(i, { name: e.target.value })} className={inputCls} />
              <input aria-label="CSS selector" value={f.selector} onChange={(e) => update(i, { selector: e.target.value })} placeholder=".price" className={inputCls + ' font-mono text-[11.5px]'} />
              <select aria-label="Value to take" value={f.attr} onChange={(e) => update(i, { attr: e.target.value as CustomField['attr'] })} className={inputCls + ' w-auto'}>
                <option value="text">Text</option>
                <option value="href">Link</option>
                <option value="src">Image</option>
                <option value="all">All matches</option>
                <option value="html">HTML</option>
              </select>
              <Button variant="ghost" aria-label={`Remove ${f.name}`} onClick={() => setFields((x) => x.filter((_, j) => j !== i))} className="px-2">
                <Trash size={15} aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Loading">
        <LoadOptions value={load} onChange={setLoad} />
      </Section>
      <SaveRecipe defaultName={applied?.name ?? (count ? `Pages ${hostOf(normalizeUrls(urls)[0])}` : 'Page fields')} onSave={storeRecipe} disabled={job.running || (!useMeta && !useProduct && !fields.some((f) => f.selector))} />
      <div className="flex-1" />
      <RunBar job={job} onStart={start} startLabel={count ? `Extract ${count} ${count === 1 ? 'page' : 'pages'}` : 'Extract'} disabled={!count || (!useMeta && !useProduct && !fields.some((f) => f.selector))} />
    </div>
  );
}

/** Fill the URL list from a listing page in this tab, going through all its pages. */
function ListingLinks({ onLinks }: { onLinks: (links: string[], note: string) => void }) {
  const [maxPages, setMaxPages] = useState(0);
  const [state, setState] = useState<{ running: boolean; message: string; error?: string }>({ running: false, message: '' });
  const [ctrl, setCtrl] = useState<AbortController | null>(null);

  async function collect() {
    if (!(await requestHostAccess())) return setState({ running: false, message: '', error: 'Gleaner needs permission to read websites.' });
    const c = new AbortController();
    setCtrl(c);
    setState({ running: true, message: 'Reading the listing' });
    try {
      const tab = await activeTab();
      if (isRestricted(tab.url)) throw new Error('Open a search or category page of the site in this tab first.');
      const res = await crawlListing(tab.id!, {
        maxPages,
        maxItems: 100000,
        speed: /amazon\./i.test(tab.url ?? '') ? 'gentle' : 'normal',
        signal: c.signal,
        status: (message) => setState({ running: true, message }),
        progress: () => {},
        interactive: true,
      });
      const links = [...new Set(res.cards.map((p) => p.url).filter(Boolean))];
      if (!links.length) throw new Error('No product links found in the listing.');
      onLinks(links, `Collected ${links.length} product links from ${res.pages} ${res.pages === 1 ? 'page' : 'pages'} of ${hostOf(tab.url!)}`);
      setState({ running: false, message: `${res.stopped}. Added ${links.length} links.` });
    } catch (e) {
      setState({ running: false, message: '', error: errorText(e) });
    } finally {
      setCtrl(null);
    }
  }

  return (
    <details className="rounded-lg border border-line bg-surface px-3 py-2 text-[13px]">
      <summary className="cursor-pointer font-medium">Get product links from a listing page</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-[12px] leading-snug text-muted">
          Open a search or category page in this tab. Gleaner reads its product links, goes to the next page and the next, and puts every link in the list above.
        </p>
        <PagingControls maxPages={maxPages} onChange={setMaxPages} />
        {state.running ? (
          <Button variant="danger" onClick={() => ctrl?.abort()}>
            <Stop size={14} weight="fill" aria-hidden /> Stop
          </Button>
        ) : (
          <Button onClick={collect}>
            <ListMagnifyingGlass size={15} aria-hidden /> Collect links from this tab
          </Button>
        )}
        {state.message && (
          <p aria-live="polite" className="text-[12px] text-muted">
            {state.message}
          </p>
        )}
        {state.error && <Notice tone="error">{state.error}</Notice>}
      </div>
    </details>
  );
}
