// Universal store extractor: any e-commerce site, the best method per platform.
import type { FreshMode } from '@/lib/seen';
import { useEffect, useState } from 'react';
import { MagnifyingGlass, Storefront } from '@phosphor-icons/react';
import { saveDataset } from '@/lib/db';
import { runStore, type StoreMethod, type StoreSetup } from '@/lib/jobs';
import { normalizeUrls } from '@/lib/runner';
import { PLATFORM_NAMES, detectPlatform, type ProductLoad, type StoreInfo } from '@/lib/store';
import { activeTab, isRestricted, requestHostAccess } from '@/lib/tab';
import { Button, Check, Field, NumberInput, Notice, Section, Segmented, inputCls } from '../ui';
import { RunBar, UrlSource, hostOf, useJob } from '../run';
import { MonitorSetup } from '../monitors';
import { PagingControls } from '../PagingControls';
import { ColumnPlanner, type PlannedColumn, type Wholesale } from '../ColumnPlanner';
import { SPEEDS, type Speed } from '@/lib/listing';

type Method = StoreMethod;
type Output = 'products' | 'shopify';

const METHOD_NAME: Record<Method, string> = { feed: 'product feed', listing: 'listing page', sitemap: 'sitemap', urls: 'product links' };

const METHOD_HELP: Record<Method, string> = {
  feed: "Reads the store's public product feed. Fastest and most complete: every product, price, variant and image.",
  listing: 'Reads the product grid on the page open in this tab (search results, a category, a brand page), then goes to the next page and the next, so no page is skipped.',
  sitemap: "Finds product pages in the store's sitemap, then reads each one.",
  urls: 'Reads the product pages you paste.',
};

export function StoreExtractor() {
  const [store, setStore] = useState('');
  const [info, setInfo] = useState<StoreInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [method, setMethod] = useState<Method>('listing');
  const [output, setOutput] = useState<Output>('products');
  const [maxProducts, setMaxProducts] = useState(5000);
  const [perVariant, setPerVariant] = useState(false);
  const [fresh, setFresh] = useState<FreshMode>('all');
  const [maxPages, setMaxPages] = useState(0); // 0 = every page
  const [openEach, setOpenEach] = useState(false);
  const [load, setLoad] = useState<ProductLoad>('auto');
  const [concurrency, setConcurrency] = useState(3);
  const [urls, setUrls] = useState('');
  const [error, setError] = useState('');
  const [speed, setSpeed] = useState<Speed>('normal');
  const [startPage, setStartPage] = useState(1);
  const [wholesale, setWholesale] = useState<Wholesale>('auto');
  const [plan, setPlan] = useState<PlannedColumn[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const job = useJob();

  useEffect(() => {
    activeTab()
      .then((t) => !isRestricted(t.url) && setStore((s) => s || t.url!))
      .catch(() => {});
  }, []);

  async function check() {
    setError('');
    if (!(await requestHostAccess())) return setError('Gleaner needs permission to read websites.');
    setChecking(true);
    try {
      const i = await detectPlatform(store);
      setInfo(i);
      setMethod(i.feed ? 'feed' : 'listing');
      if (i.platform === 'amazon') {
        setLoad('tab');
        setConcurrency(1);
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setChecking(false);
    }
  }

  /** The current settings, with the open tab as the listing page. */
  async function setup(): Promise<StoreSetup> {
    const tab = method === 'listing' ? await activeTab().catch(() => null) : null;
    return {
      store, method, output, maxProducts, maxPages, openEach, load, concurrency, urls, listingUrl: tab?.url,
      speed, startPage: startPage > 1 ? startPage : undefined, wholesale,
      columns: plan ? [...chosen] : undefined,
      perVariant: output === 'products' && perVariant,
      fresh: output === 'products' ? fresh : 'all',
    };
  }

  function start() {
    job.start(async (ctx) => {
      let tabId: number | undefined;
      if (method === 'listing') {
        const tab = await activeTab();
        if (isRestricted(tab.url)) throw new Error('Open a listing page of the store in this tab first.');
        tabId = tab.id!;
      }
      return saveDataset(await runStore(await setup(), ctx, { info, tabId }));
    });
  }

  const methods: { value: Method; label: string }[] = [
    ...(info?.feed ? [{ value: 'feed' as Method, label: 'Product feed' }] : []),
    { value: 'listing', label: 'This page' },
    { value: 'sitemap', label: 'Sitemap' },
    { value: 'urls', label: 'Product links' },
  ];
  const pageReads = method === 'sitemap' || method === 'urls' || (method === 'listing' && openEach);

  return (
    <div className="flex flex-1 flex-col gap-5">
      <Section title="Store">
        <div className="flex gap-2">
          <input aria-label="Store address" value={store} onChange={(e) => (setStore(e.target.value), setInfo(null))} placeholder="amazon.com, any-store.com or a category page" className={inputCls} />
          <Button onClick={check} disabled={!store || checking || job.running}>
            <MagnifyingGlass size={15} aria-hidden /> {checking ? 'Checking' : 'Check'}
          </Button>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        {info && (
          <div className="flex items-start gap-3 rounded-lg border border-line bg-surface px-3 py-2.5">
            <Storefront size={20} className="mt-0.5 shrink-0 text-accent-text" aria-hidden />
            <p className="text-[13px] leading-snug">
              <span className="font-medium">{info.name}</span> runs on <span className="font-medium">{PLATFORM_NAMES[info.platform]}</span>.{' '}
              <span className="text-muted">
                {info.feed
                  ? 'It has a public product feed, so the whole catalogue can be read in one go.'
                  : info.platform === 'amazon'
                    ? 'Open a search or category page on Amazon in this tab, then use "This page". Pages load slowly on purpose so Amazon is less likely to block you.'
                    : 'No public feed. Use a listing page in this tab, the sitemap, or product links.'}
              </span>
            </p>
          </div>
        )}
      </Section>

      <Section title="Method">
        <Segmented label="Method" value={methods.some((m) => m.value === method) ? method : 'listing'} onChange={setMethod} options={methods} />
        <p className="text-[12px] leading-snug text-muted">{METHOD_HELP[method]}</p>
        {method === 'listing' && (
          <>
            <Check checked={openEach} onChange={setOpenEach}>
              Also open each product page <span className="text-muted">(adds description, all images, barcode, category; slower)</span>
            </Check>
            <PagingControls maxPages={maxPages} onChange={setMaxPages} />
            <Field label="Pace between pages" help={`${SPEEDS[speed].label}. If a page fails to load, Gleaner waits, retries that same page and slows down, so no page is skipped.`}>
              {() => (
                <Segmented
                  label="Pace between pages"
                  value={speed}
                  onChange={setSpeed}
                  options={[
                    { value: 'gentle', label: 'Gentle' },
                    { value: 'normal', label: 'Normal' },
                    { value: 'fast', label: 'Fast' },
                  ]}
                />
              )}
            </Field>
            <Field label="Start from page" help="Leave at 1. To continue a run that stopped, enter the page it stopped on.">
              {(id) => <NumberInput id={id} value={startPage} onChange={setStartPage} min={1} max={5000} />}
            </Field>
          </>
        )}
        {method === 'urls' && <UrlSource value={urls} onChange={setUrls} help="Product page URLs, one per line, or a link column from earlier results." />}
        <Field label="Max products">{(id) => <NumberInput id={id} value={maxProducts} onChange={setMaxProducts} min={1} max={100000} />}</Field>
      </Section>

      {pageReads && (
        <Section title="Loading product pages">
          <Segmented
            label="How to load product pages"
            value={load}
            onChange={setLoad}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'fetch', label: 'Fast' },
              { value: 'tab', label: 'Browser tab' },
            ]}
          />
          <p className="text-[12px] leading-snug text-muted">
            {load === 'auto'
              ? 'Reads the page HTML first and opens a real tab only when the page needs JavaScript or the site blocks the fast way.'
              : load === 'fetch'
                ? 'Fastest. Misses content that appears only after JavaScript runs.'
                : 'Opens every page in a background tab. Slowest, but sees exactly what you see, including signed-in prices.'}
          </p>
          <Field label="Pages at once">{(id) => <NumberInput id={id} value={concurrency} onChange={setConcurrency} min={1} max={load === 'tab' ? 2 : 8} />}</Field>
        </Section>
      )}

      {method !== 'feed' && (
        <Section title="Columns">
          <ColumnPlanner
            source={method === 'listing' ? 'listing' : 'urls'}
            urls={normalizeUrls(urls)}
            openEach={openEach || method !== 'listing'}
            load={load}
            wholesale={wholesale}
            onWholesale={(w) => (setWholesale(w), setPlan(null))}
            plan={plan}
            onPlan={setPlan}
            chosen={chosen}
            onChosen={setChosen}
          />
        </Section>
      )}

      <Section title="Output">
        <Segmented
          label="Output columns"
          value={output}
          onChange={setOutput}
          options={[
            { value: 'products', label: 'Product columns' },
            { value: 'shopify', label: 'Shopify import CSV' },
          ]}
        />
        <p className="text-[12px] leading-snug text-muted">
          {output === 'products'
            ? 'Title, brand, price, compare-at price, currency, stock, SKU, barcode, rating, reviews, category, images, description and URL.'
            : "Shopify's own column layout, ready to import into a Shopify store, from any platform. Products from other platforms import as drafts."}
        </p>
        {output === 'products' && (
          <>
            <p className="text-[12px] font-medium">Products from earlier runs</p>
            <Segmented
              label="Products from earlier runs"
              value={fresh}
              onChange={setFresh}
              options={[
                { value: 'all', label: 'Keep all' },
                { value: 'mark', label: 'Mark new' },
                { value: 'only', label: 'Only new' },
              ]}
            />
            <p className="text-[12px] leading-snug text-muted">
              {fresh === 'all' ? 'Every run keeps every product.' : `Compares with earlier runs of this store: ${fresh === 'mark' ? 'keeps everything and marks the new products' : 'keeps only the new products'}.`}
            </p>
          </>
        )}
        {output === 'products' && (
          <Check checked={perVariant} onChange={setPerVariant}>
            One row per variant (colour, size, scent)
            <span className="block text-[12px] text-muted">
              Each variant with its own price, SKU, stock and picture.{method === 'listing' && !openEach ? ' Turn on "Also open each product page" so Gleaner can see them.' : ''}
            </span>
          </Check>
        )}
      </Section>

      {store && (
        <MonitorSetup
          defaultName={`Prices ${hostOf(store)}`}
          disabled={job.running || (method === 'urls' && !normalizeUrls(urls).length)}
          getTarget={async () => {
            const s = await setup();
            if (method === 'listing' && (!s.listingUrl || isRestricted(s.listingUrl))) throw new Error('Open a listing page of the store in this tab first.');
            return { kind: 'store', setup: s, label: `${hostOf(store)}, ${METHOD_NAME[method]}` };
          }}
        />
      )}

      <div className="flex-1" />
      <RunBar job={job} onStart={start} startLabel="Extract products" disabled={!store || (method === 'urls' && !normalizeUrls(urls).length)} />
    </div>
  );
}

