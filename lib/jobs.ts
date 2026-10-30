// Run logic shared by the side panel tools and scheduled monitors. Each runner returns an
// unsaved dataset, so the caller decides where it goes. Nothing here touches React.
import { compareWithEarlier, freshNote, scopeOf, type FreshMode } from './seen';
import { expandVariants, VARIANTS_KEY, withoutVariantData } from './variants';
import { columnsFromRows, newDataset, type Column, type Dataset, type ListRecipe, type PageRecipe } from './db';
import { labelForKey, uniqueLabels } from './columns';
import { customFields, pageMetadata, type CustomField } from './dom/doc';
import { goToNextPage, waitForListChange, type NextControl } from './paging';
import { crawlListing } from './listing';
import { extractProduct, toShopifyRows, type Product } from './product';
import { addWholesale, looksWholesale, productColumnLabel, productColumns } from './productColumns';
import { normalizeUrls, runPool, withPage, type LoadMode } from './runner';
import { shopifyColumns, toImportRows } from './shopify';
import { BlockedError, PLATFORM_NAMES, detectPlatform, productFromUrl, productUrlsFromSitemap, shopifyProducts, withRetry, wooProducts, type ProductLoad, type StoreInfo } from './store';
import { call, isRestricted, sleep, withBackgroundTab } from './tab';
import { relocateList, rememberList, scraplingReady } from './scrapling';
import { saveRecipe, type Recipe } from './db';

export interface RunCtx {
  signal: AbortSignal;
  progress: (done: number, total?: number, errors?: number) => void;
  status: (message: string) => void;
  /** A person is watching and can solve a bot check in the open tab (panel runs, not monitors). */
  interactive?: boolean;
  /** Fired once when a run hits a bot check, so the caller can raise a notification. */
  onBotCheck?: () => void;
}

type Row = Record<string, string>;

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ---------- List extractor ----------

export interface ListRunConfig {
  tabId: number;
  url: string;
  itemSelector: string;
  paging: 'none' | 'next' | 'scroll';
  next: NextControl | { selector: string; label: string; kind: string } | null;
  maxPages: number;
  delay: number;
  columns: Column[];
  excluded: Set<string>;
  name: string;
  /** What Scrapling remembers the list as (defaults to the item selector). */
  adaptiveId?: string;
  /** Called when the list was found again after the site changed, with its new selector. */
  onHealed?: (selector: string) => void;
}

const tail = (sel: string) => sel.split(' > ').pop() ?? sel;

/** What Scrapling remembers a list as: the selector it was first saved with. */
export const adaptiveKey = (r: { itemSelector: string; adaptiveId?: string }) => `list:${r.adaptiveId ?? r.itemSelector}`;

/**
 * A list whose selector no longer matches because the site's layout changed: Scrapling finds the
 * remembered items by what they look like and returns a selector that works now (null if not).
 */
export async function healList(tabId: number, selector: string, identifier: string): Promise<{ selector: string; rows: Row[]; count: number } | null> {
  if (!(await scraplingReady().catch(() => false))) return null;
  try {
    const page = await call<{ html: string; url: string }>(tabId, 'pageSource');
    const r = await relocateList(page.html, page.url, selector, identifier);
    if (!r.item_selector) return null;
    const test = await call<{ rows: Row[]; count: number }>(tabId, 'extractItems', r.item_selector);
    return test.count ? { selector: r.item_selector, ...test } : null;
  } catch {
    return null; // the engine isn't running: carry on without it
  }
}

/** Remembers where a working list sits, so it can be found again later (quietly; Scrapling only). */
export async function rememberWorkingList(tabId: number, selector: string, identifier: string): Promise<void> {
  if (!(await scraplingReady().catch(() => false))) return;
  const page = await call<{ html: string; url: string }>(tabId, 'pageSource');
  await rememberList(page.html, page.url, selector, identifier);
}

/** Read the list on an open tab, following its pages. */
export async function runList(cfg: ListRunConfig, { signal, progress, status }: RunCtx): Promise<Dataset> {
  const { tabId, paging, next, maxPages, delay } = cfg;
  let sel = cfg.itemSelector;
  const all: Row[] = [];
  const seen = new Set<string>();
  const add = (rs: Row[]) => {
    for (const r of rs) {
      const k = JSON.stringify(r);
      if (!seen.has(k)) (seen.add(k), all.push(r));
    }
    progress(all.length);
  };
  // Scrapling's adaptive matching: remember the list while it works, find it again when it doesn't
  const adaptiveId = adaptiveKey(cfg);
  const useScrapling = await scraplingReady().catch(() => false);
  let remembered = false;
  let healed = '';
  const extract = async () => {
    let res = await call<{ rows: Row[]; count: number }>(tabId, 'extractItems', sel);
    if (!res.count) {
      // The list's container moved after navigation: find the same kind of item again
      const again = await call<{ itemSelector: string } | null>(tabId, 'findList', 0);
      if (again && tail(again.itemSelector) === tail(sel)) {
        sel = again.itemSelector;
        res = await call(tabId, 'extractItems', sel);
      }
    }
    if (!res.count && useScrapling) {
      // The site's layout changed: Scrapling finds the remembered list by what its items look like
      status('The list moved on the page: looking for it with Scrapling');
      const h = await healList(tabId, cfg.itemSelector, adaptiveId);
      if (h) {
        sel = healed = h.selector;
        res = h;
        cfg.onHealed?.(sel);
      }
    } else if (res.count && useScrapling && !remembered) {
      remembered = true;
      await rememberWorkingList(tabId, sel, adaptiveId).catch(() => {});
    }
    add(res.rows);
    return res.count;
  };

  const pages = paging === 'none' ? 1 : maxPages;
  let stale = 0;
  for (let page = 1; page <= pages && !signal.aborted; page++) {
    status(paging === 'scroll' ? `Scroll ${page} of ${pages}` : `Page ${page} of ${pages}`);
    await extract();
    if (page === pages || paging === 'none') break;
    const before = await call<string>(tabId, 'signature', sel);
    if (paging === 'next') {
      // Numbered pagers move: find the number after the current page each time
      const target = next?.kind === 'number' ? await call<NextControl | null>(tabId, 'findNext') : next;
      if (!target || !(await call<boolean>(tabId, 'clickNext', target.selector))) {
        status('No more pages');
        break;
      }
    } else {
      await call(tabId, 'scrollToEnd', sel);
    }
    const changed = await waitForListChange(tabId, sel, before, signal);
    if (!changed) {
      if (paging === 'next' || ++stale >= 2) {
        status('No new items appeared, stopping');
        break;
      }
    } else stale = 0;
    await sleep(delay);
  }
  await call(tabId, 'clear').catch(() => {});

  const cols = uniqueLabels(columnsFromRows(all, labelForKey, cfg.columns)).filter((c) => !cfg.excluded.has(c.key));
  const keep = new Set(cols.map((c) => c.key));
  const clean = all.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => keep.has(k))));
  if (!clean.length) throw new Error(healed ? 'No rows were collected.' : useScrapling ? "No rows were collected. The site's layout may have changed too much for Gleaner to find the list again: pick it again in the List extractor." : 'No rows were collected.');
  const ds = newDataset('list', cfg.name || `List ${hostOf(cfg.url)}`, cfg.url, cols, clean);
  if (healed) ds.note = `The site's layout changed, and Gleaner found the list again with Scrapling's adaptive matching (now ${healed}).`;
  return ds;
}

/** Run a saved list recipe in a background tab opened on its start page. */
export function runListRecipe(r: ListRecipe & { name: string }, ctx: RunCtx): Promise<Dataset> {
  return withBackgroundTab(r.startUrl, async (tabId) => {
    if (isRestricted(r.startUrl)) throw new Error("This page can't be read by extensions.");
    const first = await call<{ rows: Row[] }>(tabId, 'extractItems', r.itemSelector);
    const columns = uniqueLabels(columnsFromRows(first.rows, labelForKey));
    // A list that was found again after the site changed keeps working next time
    const onHealed = (selector: string) => {
      if ('id' in r && r.id) void saveRecipe({ ...(r as unknown as Recipe & ListRecipe), itemSelector: selector, adaptiveId: r.adaptiveId ?? r.itemSelector, updatedAt: Date.now() }).catch(() => {});
    };
    return runList(
      { tabId, url: r.startUrl, itemSelector: r.itemSelector, paging: r.paging, next: r.next, maxPages: r.maxPages, delay: r.delay, columns, excluded: new Set(r.excluded), name: r.name, adaptiveId: r.adaptiveId, onHealed },
      ctx,
    );
  });
}

// ---------- Page extractor ----------

export interface PageRunConfig {
  list: string[];
  useMeta: boolean;
  useProduct: boolean;
  fields: CustomField[];
  load: { mode: LoadMode; concurrency: number; delay: number };
  name: string;
}

const PAGE_LABEL = (k: string) =>
  k.startsWith('product_') ? (['product_title', 'product_description', 'product_image', 'product_url'].includes(k) ? 'product ' : '') + productColumnLabel(k.slice(8)) : k.replace(/_/g, ' ');

export async function runPages({ list, useMeta, useProduct, fields, load, name }: PageRunConfig, { signal, progress, status }: RunCtx): Promise<Dataset> {
  status(`Extracting ${list.length} pages`);
  const results = await runPool(
    list,
    (url) =>
      withPage(url, load.mode, signal, async (p) => {
        const row: Row = { url: p.url };
        if (useMeta) Object.assign(row, await p.run(pageMetadata, 'metadata'));
        if (useProduct) {
          const prod = await p.run(extractProduct, 'fullProduct');
          for (const [k, v] of Object.entries(prod)) if (k !== 'url' && !k.startsWith('_') && v && !row[`product_${k}`]) row[`product_${k}`] = v;
        }
        if (fields.length) Object.assign(row, await p.run((d, u) => customFields(d, fields, u), 'custom', fields));
        return row;
      }),
    { concurrency: load.concurrency, delayMs: load.delay, signal, onProgress: (d, t, e) => progress(d, t, e) },
  );
  const rows = results.map((r, i) => (r instanceof Error ? { url: list[i], error: r.message } : r)).filter(Boolean) as Row[];
  // Drop columns that came back empty for every page
  const cols = columnsFromRows(rows, PAGE_LABEL).filter((c) => rows.some((r) => r[c.key]));
  return newDataset('page', name || `Pages ${hostOf(list[0])}`, list[0], cols, rows);
}

export const runPageRecipe = (r: PageRecipe & { name: string }, ctx: RunCtx) =>
  runPages({ list: r.urls, useMeta: r.useMeta, useProduct: r.useProduct, fields: r.fields, load: r.load, name: r.name }, ctx);

// ---------- Store extractor ----------

export type StoreMethod = 'feed' | 'listing' | 'sitemap' | 'urls';

/** Store extractor settings, as saved in a monitor. */
export interface StoreSetup {
  store: string;
  method: StoreMethod;
  output: 'products' | 'shopify';
  maxProducts: number;
  /** Listing pages to go through; 0 means every page. */
  maxPages: number;
  openEach: boolean;
  load: ProductLoad;
  concurrency: number;
  urls: string;
  /** The listing page that was open, for the "This page" method. */
  listingUrl?: string;
  /** Wholesale extras (1 box = N ea, box price): on, off, or only when MOQ/box data is found. */
  wholesale?: 'auto' | 'on' | 'off';
  /** Columns picked in the column planner. Empty or missing means all found. */
  columns?: string[];
  /** How politely to move between listing pages. */
  speed?: 'gentle' | 'normal' | 'fast';
  /** Listing page to start from, to resume a run that stopped. */
  startPage?: number;
  /** One row per variant (colour, size...) with its own price, SKU, stock and picture. */
  perVariant?: boolean;
  /** Compare with earlier runs: keep all, mark the new products, or keep only the new ones. */
  fresh?: FreshMode;
}

/** What the listing card already names reliably: the product page only fills these in when the card had none. */
const CARD_IDENTITY = new Set(['title', 'brand', 'sku', 'gtin', 'asin', 'url']);

/** Card data first, then anything the product page adds. */
const mergeProduct = (card: Product, page: Product): Product => {
  const out: Product = { ...card };
  for (const [k, v] of Object.entries(page)) if (v && k !== 'source' && !(CARD_IDENTITY.has(k) && card[k])) out[k] = v;
  out.source = [card.source, page.source].filter(Boolean).join(', ');
  return out;
};

/**
 * Extract a store's products. The "This page" method reads `tabId` when given, or opens
 * `setup.listingUrl` in a background tab (scheduled runs).
 */
export async function runStore(setup: StoreSetup, { signal, progress, status, interactive, onBotCheck }: RunCtx, opts: { info?: StoreInfo | null; tabId?: number } = {}): Promise<Dataset> {
  const { method, output, maxProducts, maxPages, openEach, load, concurrency } = setup;
  const i = opts.info ?? (await detectPlatform(setup.store, signal));
  let products: Product[] = [];
  let shopifyRaw: any[] | null = null;
  let listingNote = '';

  const readPages = async (list: string[], cards?: Product[]) => {
    status(`Reading ${list.length} product pages`);
    let blocked = '';
    const ctrl = new AbortController();
    signal.addEventListener('abort', () => ctrl.abort());
    const res = await runPool(
      list,
      async (url, idx) => {
        try {
          const page = await withRetry(() => productFromUrl(url, load, ctrl.signal, !!cards?.[idx]?.title), ctrl.signal);
          return cards ? mergeProduct(cards[idx], page) : page;
        } catch (e) {
          if (e instanceof BlockedError) {
            blocked = e.message;
            ctrl.abort(); // stop hammering a site that is pushing back
          }
          throw e;
        }
      },
      { concurrency: load === 'tab' ? Math.min(concurrency, 2) : concurrency, delayMs: i.platform === 'amazon' ? 2500 : 400, signal: ctrl.signal, onProgress: (d, t, e) => progress(d, t, e) },
    );
    if (blocked) status(`${hostOf(list[0])} showed a bot check. Open the site in a tab, complete it, then run again for the rest.`);
    return res.map((r, k) => (r instanceof Error || !r ? { ...(cards?.[k] ?? {}), url: list[k], error: r instanceof Error ? r.message : 'not read' } : r)) as Product[];
  };

  const readListing = async (tabId: number) => {
    const res = await crawlListing(tabId, {
      maxPages,
      maxItems: maxProducts,
      speed: setup.speed ?? (i.platform === 'amazon' ? 'gentle' : 'normal'),
      startPage: setup.startPage,
      pauseMs: i.platform === 'amazon' ? 1000 : 0,
      signal,
      status,
      progress: (n) => progress(n),
      interactive,
      onBotCheck,
    });
    const fixed = res.recovered ? `, ${res.recovered} error ${res.recovered === 1 ? 'page' : 'pages'} recovered` : '';
    const resume = res.resumeFrom ? ` To continue, set "Start from page" to ${res.resumeFrom} and run again.` : '';
    listingNote = `${res.stopped}. ${res.cards.length} products from ${res.pages} ${res.pages === 1 ? 'page' : 'pages'}${fixed}.${resume}`;
    status(listingNote);
    return res.cards;
  };

  if (method === 'feed') {
    status(`Reading ${PLATFORM_NAMES[i.platform]} product feed`);
    const feedOpts = { signal, maxProducts, onProgress: (n: number, page: number) => (status(`Feed page ${page}: ${n} products`), progress(n)) };
    if (i.platform === 'shopify') {
      const r = await shopifyProducts(i.origin, feedOpts);
      products = r.products;
      shopifyRaw = r.raw;
    } else if (i.platform === 'woocommerce') products = await wooProducts(i.origin, feedOpts);
    else throw new Error('This store has no public product feed. Choose another method.');
  } else if (method === 'sitemap') {
    status('Looking for product pages in the sitemap');
    const list = await productUrlsFromSitemap(i.origin, { signal, max: maxProducts, onProgress: (f, u) => status(`Read ${f} sitemap files, ${u} URLs`) });
    if (!list.length) throw new Error("No product pages found in this store's sitemap. Try the listing page method.");
    products = await readPages(list);
  } else if (method === 'urls') {
    products = await readPages(normalizeUrls(setup.urls).slice(0, maxProducts));
  } else {
    let cards: Product[];
    if (opts.tabId !== undefined) cards = await readListing(opts.tabId);
    else {
      if (!setup.listingUrl || isRestricted(setup.listingUrl)) throw new Error('No listing page saved for this store.');
      cards = await withBackgroundTab(setup.listingUrl, readListing, i.platform === 'amazon' ? 1800 : 1200);
    }
    products = cards.slice(0, maxProducts);
    if (openEach) {
      const withUrl = products.filter((p) => p.url);
      const detailed = await readPages(withUrl.map((p) => p.url), withUrl);
      products = [...detailed, ...products.filter((p) => !p.url)];
    }
  }

  if (!products.length) throw new Error('No products found.');
  const name = `${output === 'shopify' ? 'Shopify import' : 'Products'} ${i.name}`;
  if (output === 'shopify') {
    const rows = shopifyRaw ? toImportRows(shopifyRaw, i.origin) : toShopifyRows(withoutVariantData(products).filter((p) => !p.error));
    return { ...newDataset('store', name, i.origin, shopifyColumns, rows), note: listingNote || undefined };
  }
  // One row per variant, or the variants kept as a summary column
  const withVariants = products.filter((p) => p[VARIANTS_KEY]).length;
  products = setup.perVariant ? expandVariants(products) : withoutVariantData(products);
  if (setup.perVariant) listingNote = [listingNote, withVariants ? `${withVariants} products had variants, ${products.length} rows in all.` : 'No product listed its variants; open each product page to find them.'].filter(Boolean).join(' ');
  if (setup.fresh && setup.fresh !== 'all') {
    const total = products.length;
    const scope = scopeOf('store', method, [method === 'listing' ? setup.listingUrl ?? setup.store : setup.store]);
    const r = await compareWithEarlier(scope, products, (p) => `${p.url || p.title}|${p.variant_sku || p.variant || ''}`, setup.fresh);
    products = r.rows;
    listingNote = (listingNote + freshNote(setup.fresh, r, total, 'products')).trim();
    if (!products.length) return { ...newDataset('store', `New products ${i.name}`, i.origin, [{ key: 'title', label: 'title' }], []), note: listingNote };
  }
  if (setup.wholesale === 'on' || (setup.wholesale !== 'off' && looksWholesale(products))) products = addWholesale(products);
  const cols = productColumns(products, { only: setup.columns?.length ? setup.columns : undefined });
  // Quality check: point out chosen columns that came back mostly empty
  const thin = cols
    .filter((c) => !['error', 'source', 'compare_at_price', 'variant_compare_at', 'variant_gtin', 'variant_image', 'new_since_last_run'].includes(c.key))
    .map((c) => ({ c, fill: products.filter((p) => p[c.key]).length / products.length }))
    .filter((x) => x.fill < 0.5)
    .map((x) => `${x.c.label} ${Math.round(x.fill * 100)}%`);
  const failed = products.filter((p) => p.error).length;
  const quality = [failed ? `${failed} products could not be read` : '', thin.length ? `Mostly empty: ${thin.slice(0, 5).join(', ')}` : ''].filter(Boolean).join('. ');
  const note = [listingNote, quality].filter(Boolean).join(' ') || undefined;
  return { ...newDataset('store', name, i.origin, cols, products), note };
}
