// Seller Central, Manage All Inventory: read the listings on the open page, click Next, and
// repeat until the last page. Seller Central draws its table slowly and in pieces, so each page
// is read only once its listings have stopped changing.
import { call, sleep } from './tab';
import type { Row } from './dom/sellerCentral';

export interface SellerCrawlOptions {
  maxPages: number;
  signal: AbortSignal;
  status: (m: string) => void;
  progress: (n: number) => void;
}

/** Column order and labels for the inventory export. */
export const SELLER_COLUMNS: [string, string][] = [
  ['status', 'status'],
  ['title', 'title'],
  ['asin', 'ASIN'],
  ['sku', 'SKU'],
  ['fnsku', 'FNSKU'],
  ['image', 'image'],
  ['product_url', 'Amazon page'],
  ['price', 'price'],
  ['currency', 'currency'],
  ['shipping', 'shipping'],
  ['sale_price', 'sale price'],
  ['featured_offer', 'featured offer'],
  ['competitive_price', 'competitive price'],
  ['business_price', 'business price'],
  ['total_fees', 'total fees'],
  ['fba_fee', 'FBA fee'],
  ['fulfilled_by', 'fulfilled by'],
  ['on_hand', 'on hand'],
  ['available', 'available'],
  ['inbound', 'inbound'],
  ['unfulfillable', 'unfulfillable'],
  ['reserved', 'reserved'],
  ['low_stock_alert', 'low stock alert'],
  ['sales', 'sales (30 days)'],
  ['units_sold', 'units sold (30 days)'],
  ['page_views', 'page views (30 days)'],
  ['sales_rank', 'sales rank'],
  ['rank_category', 'rank category'],
  ['last_updated', 'last updated'],
  ['created', 'created'],
];

const key = (r: Row) => r.sku || r.asin || r.title || '';

/** Wait until the page shows listings and they stop changing (or give up after `ms`). */
async function steady(tabId: number, ms: number, signal: AbortSignal): Promise<string> {
  const until = Date.now() + ms;
  let last = '';
  let same = 0;
  while (Date.now() < until && !signal.aborted) {
    const sig = await call<string>(tabId, 'sellerSignature').catch(() => '');
    if (sig && !sig.startsWith('0|') && sig === last) {
      if (++same >= 2) return sig;
    } else same = 0;
    last = sig;
    await sleep(700);
  }
  return last;
}

export async function crawlSellerInventory(tabId: number, o: SellerCrawlOptions): Promise<{ rows: Row[]; pages: number; stopped: string }> {
  const rows: Row[] = [];
  const seen = new Set<string>();
  let pages = 0;
  let stopped = 'Reached the last page';
  o.status('Waiting for the inventory list to finish loading');
  let sig = await steady(tabId, 25000, o.signal);
  if (!sig || sig.startsWith('0|')) {
    const onInventory = await call<boolean>(tabId, 'sellerInventory').catch(() => false);
    throw new Error(onInventory ? 'The inventory list did not finish loading. Scroll it once, then run again.' : 'Open Seller Central, Inventory > Manage All Inventory in this tab, then run again.');
  }
  while (!o.signal.aborted) {
    const { rows: found } = await call<{ rows: Row[]; page: string }>(tabId, 'sellerListings').catch(() => ({ rows: [] as Row[], page: '' }));
    pages++;
    let added = 0;
    for (const r of found) {
      const k = key(r);
      if (k && !seen.has(k)) {
        seen.add(k);
        rows.push(r);
        added++;
      }
    }
    o.progress(rows.length);
    o.status(`Page ${pages}: ${rows.length} listings so far`);
    if (pages > 1 && !added) {
      stopped = `Page ${pages} showed the same listings again, so that was the last page`;
      break;
    }
    if (pages >= o.maxPages) {
      stopped = `Read the ${o.maxPages} ${o.maxPages === 1 ? 'page' : 'pages'} you asked for`;
      break;
    }
    if (!(await call<boolean>(tabId, 'sellerNextPage').catch(() => false))) break;
    // Wait for the next page's listings to replace these
    const before = sig;
    const until = Date.now() + 30000;
    while (Date.now() < until && !o.signal.aborted) {
      await sleep(800);
      const now = await call<string>(tabId, 'sellerSignature').catch(() => '');
      if (now && now !== before && !now.startsWith('0|')) break;
    }
    sig = await steady(tabId, 15000, o.signal);
    if (sig === before) {
      stopped = `Page ${pages + 1} didn't load in time, so Gleaner stopped and saved what it had`;
      break;
    }
  }
  if (o.signal.aborted) stopped = 'Stopped';
  return { rows, pages, stopped };
}
