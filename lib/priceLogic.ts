// Pure price-tracking logic: no storage, no browser APIs, so it can be unit-tested.
// lib/prices.ts adds storage and scheduling on top and re-exports everything here.
import { CURRENCY_SYMBOL, parsePrice, type Product } from './product';
import { bestMatch, productKey, type MatchBy } from './match';
import type { Every } from './monitor';

export interface PricePoint {
  /** Source id this reading came from. */
  s: string;
  t: number;
  price: number | null;
  /** Currency of `price`. Older points may not have it. */
  c?: string;
  inStock: boolean | null;
}

export interface TrackerSource {
  id: string;
  url: string;
  store: string;
  lastPrice?: number | null;
  lastCurrency?: string;
  lastInStock?: boolean | null;
  lastTitle?: string;
  matched?: boolean;
  matchBy?: MatchBy;
  /** How close a title match was, 0 to 1 (identifier matches are 1). */
  matchScore?: number;
  /** The user's call on this page: always treat it as the product, or never. */
  decision?: 'confirmed' | 'rejected';
  /** False when the page's price is in another currency than yours, so it isn't compared. */
  comparable?: boolean;
  /** True when the latest reading was below MAP. */
  violation?: boolean;
  /** Stored screenshot id for the latest MAP violation (evidence). */
  shotId?: string;
  error?: string;
  checkedAt?: number;
}

export interface TrackerRef {
  title: string;
  brand: string;
  sku: string;
  gtin: string;
  mpn: string;
  yourPrice: number | null;
  map: number | null;
  /** Currency your price and MAP are in, as a 3-letter code (USD, KRW). */
  currency: string;
}

/** The product you track and the competitor pages you watch for it. */
export interface Tracker {
  id: string;
  name: string;
  ref: TrackerRef;
  sources: TrackerSource[];
  every: Every;
  paused: boolean;
  /** Capture a screenshot when a source is found advertising below MAP. */
  evidence: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastStatus?: 'running' | 'ok' | 'error';
  lastMessage?: string;
  lastAlert?: string;
  /** Price and stock readings over time, oldest first, capped per store. */
  history: PricePoint[];
}

/** Readings kept per store: a year of daily checks, or about two weeks of hourly ones. */
export const HISTORY_PER_SOURCE = 365;

export const num = (v: unknown): number | null => {
  const n = parseFloat(String(v ?? '').replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
};

const inStock = (v: string) => (/(in.?stock|available|^true$|^yes$)/i.test(v) && !/out|not|unavail|sold|pre.?order/i.test(v) ? true : /out|sold|unavail|^false$|^no$/i.test(v) ? false : null);

/** "$", "usd", "US$" and "USD" all become "USD". Empty when unknown. */
export function normalizeCurrency(v: string | undefined | null): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (CURRENCY_SYMBOL[s]) return CURRENCY_SYMBOL[s];
  if (/^US\$$/i.test(s)) return 'USD';
  const up = s.toUpperCase();
  return /^[A-Z]{3}$/.test(up) ? up : '';
}

/** Competitor product-page URLs, one per line. Accepts any valid http(s) URL, since these are
 *  specific pages the user pasted (the scraping tools use a stricter parser). */
export function parseSourceUrls(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.split(/[\n,]+/)) {
    const t = raw.trim().replace(/^["']|["']$/g, '');
    if (!t) continue;
    try {
      const u = new URL(/^https?:\/\//i.test(t) ? t : 'https://' + t);
      if (u.protocol === 'http:' || u.protocol === 'https:') out.add(u.href);
    } catch {
      /* skip non-URLs */
    }
  }
  return [...out];
}

// ---------- One reading from a source ----------

export interface SourceReading {
  price: number | null;
  currency: string;
  /** Price is in your currency, so MAP and your price can be compared with it. */
  comparable: boolean;
  inStock: boolean | null;
  title: string;
  matched: boolean;
  matchBy?: MatchBy;
  matchScore?: number;
  error?: string;
}

/**
 * The page's price in your currency when it shows one. Pages that list several currencies
 * (e.g. ₩12,000 / $9.10) have price_KRW and price_USD fields; the one matching yours is used.
 */
function priceIn(product: Product, want: string): { amount: number | null; currency: string } {
  if (want && product[`price_${want}`]) return { amount: num(product[`price_${want}`]), currency: want };
  if (!product.price) return { amount: null, currency: normalizeCurrency(product.currency) };
  const parsed = parsePrice(`${product.currency ?? ''}${product.price}`);
  const currency = normalizeCurrency(parsed?.currency || product.currency);
  return { amount: num(parsed?.amount ?? product.price), currency };
}

/** Turn an extracted competitor product into a price reading, confirming it's the tracked item. */
export function readSource(ref: TrackerRef, product: Product | null, decision?: TrackerSource['decision']): SourceReading {
  if (!product || product.error) {
    return { price: null, currency: '', comparable: false, inStock: null, title: product?.title ?? '', matched: false, error: product?.error || 'Could not read the page' };
  }
  const want = normalizeCurrency(ref.currency);
  const { amount, currency } = priceIn(product, want);
  // A page with no currency on it is assumed to be in yours; a different one is never compared
  const comparable = amount != null && (!want || !currency || currency === want);
  const refKey = productKey({ title: ref.title, brand: ref.brand, sku: ref.sku, gtin: ref.gtin, mpn: ref.mpn });
  const m = bestMatch(refKey, [product], 0.5);
  const matched = decision === 'confirmed' ? true : decision === 'rejected' ? false : !!m;
  const error =
    decision === 'rejected'
      ? 'You marked this page as a different product'
      : !matched
        ? 'This page did not match the tracked product'
        : amount == null
          ? 'No price found on the page'
          : !comparable
            ? `Priced in ${currency}, not ${want}, so it isn't compared`
            : undefined;
  return {
    price: amount,
    currency: currency || want,
    comparable,
    inStock: inStock(product.availability ?? product.stock_status ?? ''),
    title: product.title ?? '',
    matched,
    matchBy: m?.match.by,
    matchScore: m ? Math.round(m.match.score * 100) / 100 : undefined,
    error,
  };
}

// ---------- Alerts ----------

export interface PriceAlert {
  message: string;
  detail: string;
  /** Sources now advertising below MAP, for the evidence step. */
  violations: TrackerSource[];
}

/** Whether a source's latest reading can be compared with your MAP and price. */
export const countable = (s: TrackerSource) => !!s.matched && s.comparable !== false && s.lastPrice != null && s.decision !== 'rejected';

/** Compare new readings with each source's last reading and decide what to alert on. */
export function priceAlerts(t: Tracker, before: Map<string, TrackerSource>): PriceAlert | null {
  const drops: TrackerSource[] = [];
  const violations: TrackerSource[] = [];
  const restocked: TrackerSource[] = [];
  const belowYou: TrackerSource[] = [];
  for (const s of t.sources) {
    if (!countable(s)) continue;
    const price = s.lastPrice!;
    const prev = before.get(s.id);
    // An advertised price below MAP is a violation even while the item is out of stock
    if (t.ref.map != null && price < t.ref.map) violations.push(s);
    if (t.ref.yourPrice != null && price < t.ref.yourPrice) belowYou.push(s);
    // A drop only counts against a reading in the same currency
    if (prev?.lastPrice != null && (prev.lastCurrency ?? '') === (s.lastCurrency ?? '') && price < prev.lastPrice) drops.push(s);
    if (prev && prev.lastInStock === false && s.lastInStock === true) restocked.push(s);
  }
  const parts = [
    violations.length && `${violations.length} below MAP`,
    drops.length && `${drops.length} price ${drops.length === 1 ? 'drop' : 'drops'}`,
    belowYou.length && `${belowYou.length} under your price`,
    restocked.length && `${restocked.length} back in stock`,
  ].filter(Boolean) as string[];
  if (!parts.length) return null;
  const lead = violations[0] ?? drops[0] ?? belowYou[0] ?? restocked[0];
  const price = `${lead.lastCurrency ? lead.lastCurrency + ' ' : ''}${lead.lastPrice}`;
  const detail = violations[0] === lead ? `${lead.store}: ${price} (MAP ${t.ref.map})` : restocked[0] === lead && !drops.length && !belowYou.length ? `${lead.store} is back in stock` : `${lead.store}: ${price}`;
  return { message: parts.join(', '), detail, violations };
}

// ---------- History ----------

/** One source's readings over time, oldest first. */
export const sourceHistory = (t: Tracker, sourceId: string) => t.history.filter((p) => p.s === sourceId);

/** Add readings, keeping the newest HISTORY_PER_SOURCE per store so one busy store can't push out the others. */
export function appendHistory(t: Tracker, points: PricePoint[], perSource = HISTORY_PER_SOURCE) {
  t.history.push(...points);
  const counts = new Map<string, number>();
  for (const p of t.history) counts.set(p.s, (counts.get(p.s) ?? 0) + 1);
  if ([...counts.values()].every((n) => n <= perSource)) return;
  const keep: PricePoint[] = [];
  const seen = new Map<string, number>();
  // Walk newest first, keep up to the cap for each store, then restore oldest-first order
  for (let i = t.history.length - 1; i >= 0; i--) {
    const p = t.history[i];
    const n = (seen.get(p.s) ?? 0) + 1;
    seen.set(p.s, n);
    if (n <= perSource) keep.push(p);
  }
  t.history = keep.reverse();
}

/** The lowest current comparable price across sources, for a quick summary. */
export function lowestNow(t: Tracker): { store: string; price: number; currency: string } | null {
  let best: { store: string; price: number; currency: string } | null = null;
  for (const s of t.sources) if (countable(s) && (!best || s.lastPrice! < best.price)) best = { store: s.store, price: s.lastPrice!, currency: s.lastCurrency ?? '' };
  return best;
}
