// Amazon Seller Central, Manage All Inventory: the seller's own listings, read from the page they
// have open (signed in as themselves). Each listing is a block of labelled values (ASIN, SKU,
// FNSKU, sales, units, page views, sales rank, on-hand/available/inbound/unfulfillable/reserved,
// price in an input box, sale/featured/business prices, fees). Seller Central draws much of it
// inside web components, so this reads text and input values through open shadow roots too.
// Runs in the page.

export type Row = Record<string, string>;

const ASIN = /\b(B0[A-Z0-9]{8}|\d{9}[\dX])\b/;
const MONEY = /(?:[$€£¥₹]|USD|EUR|GBP|CAD|AUD|JPY|MXN)\s?-?[\d,]+(?:\.\d+)?/;
const STATUS = /^(active|inactive|incomplete|out of stock|suppressed|closed|stranded|search suppressed|listing removed|pending approval|blocked|deleted|approval required)$/i;
const DATE = /^(?:[A-Z][a-z]{2} \d{1,2}, \d{4}|\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4})(?:,? \d{1,2}:\d{2}(?::\d{2})?\s?(?:AM|PM)?)?(?:\s?[A-Z]{2,4})?$/;

/** Child nodes, including an element's open shadow root and slotted content. */
function kids(n: Node): Node[] {
  const out: Node[] = [];
  if (n instanceof Element && n.shadowRoot) out.push(...Array.from(n.shadowRoot.childNodes));
  out.push(...Array.from(n.childNodes));
  return out;
}

/** Every element under `root`, through open shadow roots. */
export function deepAll(root: Node, pred: (el: Element) => boolean): Element[] {
  const out: Element[] = [];
  const walk = (n: Node) => {
    if (n instanceof Element && pred(n)) out.push(n);
    for (const k of kids(n)) walk(k);
  };
  walk(root);
  return out;
}

const hidden = (el: Element) => {
  if (!(el instanceof HTMLElement)) return false;
  const cs = getComputedStyle(el);
  return cs.display === 'none' || cs.visibility === 'hidden';
};

/** The block's visible text as lines, with input boxes' values in place, read through shadow roots. */
export function deepLines(root: Node): string[] {
  const lines: string[] = [];
  let cur = '';
  const flush = () => {
    const t = cur.replace(/\s+/g, ' ').trim();
    if (t) lines.push(t);
    cur = '';
  };
  const BLOCK = /^(DIV|P|LI|TR|TD|TH|SECTION|ARTICLE|H\d|BR|TABLE|UL|OL|DL|DT|DD|LABEL|BUTTON|KAT-[A-Z-]+)$/;
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      cur += ' ' + (n.textContent ?? '');
      return;
    }
    if (!(n instanceof Element)) {
      for (const k of kids(n)) walk(k);
      return;
    }
    if (/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|SVG)$/.test(n.tagName) || hidden(n)) return;
    if (n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement) {
      if (n.type !== 'checkbox' && n.type !== 'radio' && n.type !== 'hidden') {
        flush();
        lines.push(`[input] ${n.value || n.getAttribute('value') || ''}`.trim());
      }
      return;
    }
    // Web components that hold a value as an attribute (e.g. <kat-input value="12.99">)
    if (n.tagName.includes('-') && n.hasAttribute('value') && /input|price/i.test(n.tagName)) {
      flush();
      lines.push(`[input] ${n.getAttribute('value')}`);
      if (n.shadowRoot) return;
    }
    const block = BLOCK.test(n.tagName);
    if (block) flush();
    for (const k of kids(n)) walk(k);
    if (block) flush();
  };
  walk(root);
  flush();
  return lines;
}

/** The listing blocks: the largest elements that hold exactly one ASIN (one product each). */
export function listingBlocks(doc: Document = document): Element[] {
  const withAsin = deepAll(doc.body, (el) => {
    if (!/^(DIV|TR|LI|ARTICLE|SECTION|KAT-TABLE-ROW|KAT-[A-Z-]*ROW)$/.test(el.tagName)) return false;
    const text = el.textContent ?? '';
    return /\bASIN\b/.test(text) || /\bASIN\b/.test(deepLines(el).join(' '));
  });
  const count = (el: Element) => new Set((deepLines(el).join(' ').match(new RegExp(ASIN.source, 'g')) ?? [])).size;
  const single = withAsin.filter((el) => count(el) === 1 && /\bSKU\b/.test(deepLines(el).join(' ')));
  // Keep the outermost single-ASIN block (the whole listing row, not just its ASIN line)
  return single.filter((el) => !single.some((o) => o !== el && o.contains(el)));
}

const num = (s: string | undefined) => (s ?? '').replace(/[^\d.-]/g, '');
const money = (s: string | undefined) => (s?.match(MONEY)?.[0] ?? '').replace(/\s/g, '');

/** One listing block as a row of named values. */
export function readListing(block: Element, base = location.href): Row {
  const lines = deepLines(block);
  const r: Row = {};
  /** The value after a label: on the same line ("ASIN B07..."), else the next line. */
  const after = (label: RegExp, valid: RegExp = /\S/): string => {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(new RegExp(`^${label.source}\\s*:?\\s*(.*)$`, 'i'));
      if (!m) continue;
      if (m[1] && valid.test(m[1])) return m[1].trim();
      if (lines[i + 1] && valid.test(lines[i + 1]) && !/^\[input\]/.test(lines[i + 1])) return lines[i + 1].trim();
    }
    return '';
  };
  r.status = lines.find((l) => STATUS.test(l)) ?? '';
  const dates = lines.filter((l) => DATE.test(l));
  r.last_updated = dates[0] ?? '';
  r.created = dates[1] ?? '';
  r.asin = (after(/ASIN/, ASIN).match(ASIN) ?? [''])[0];
  r.sku = after(/SKU/);
  r.fnsku = after(/FNSKU/);
  // The product link: the title
  const link = deepAll(block, (el) => el instanceof HTMLAnchorElement && (el.textContent ?? '').trim().length > 15)[0] as HTMLAnchorElement | undefined;
  r.title = (link?.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!r.title) r.title = lines.find((l) => l.length > 25 && !/ASIN|SKU|\$/.test(l)) ?? '';
  const img = deepAll(block, (el) => el instanceof HTMLImageElement && !!(el as HTMLImageElement).src)[0] as HTMLImageElement | undefined;
  r.image = img?.currentSrc || img?.src || '';
  r.product_url = r.asin ? new URL(`/dp/${r.asin}`, 'https://www.amazon.com').href : '';
  // Performance (last 30 days)
  r.sales = money(after(/Sales/, MONEY));
  r.units_sold = num(after(/Units sold/, /^[\d,]+$|^--$/));
  r.page_views = num(after(/Page views/, /^[\d,]+$|^--$/));
  const rank = after(/Sales rank/, /\d|--/);
  r.sales_rank = num(rank.split('(')[0]);
  r.rank_category = (lines.find((l) => /^\(.*\)$/.test(l)) ?? rank.match(/\((.*)\)/)?.[0] ?? '').replace(/[()]/g, '');
  // Inventory
  const fulfilled = lines.find((l) => /^\((FBA|FBM|MFN|AFN|Merchant|Amazon)\)$/i.test(l) || /^(FBA|FBM|Merchant|Amazon)$/i.test(l));
  r.fulfilled_by = fulfilled?.replace(/[()]/g, '') ?? (lines.some((l) => /\bFBA\b/.test(l)) ? 'FBA' : '');
  r.on_hand = num(after(/On-?hand(?: \((?:FBA|FBM)\))?/, /^[\d,]+$/));
  r.available = num(after(/Available/, /^[\d,]+$/));
  r.inbound = num(after(/Inbound/, /^[\d,]+$/));
  r.unfulfillable = num(after(/Unfulfillable/, /^[\d,]+$/));
  r.reserved = num(after(/Reserved/, /^[\d,]+$/));
  // Price: the input box after "Price", else the first amount after it
  const priceAt = lines.findIndex((l) => /^Price\b/i.test(l));
  const priceInput = lines.slice(Math.max(0, priceAt)).find((l) => /^\[input\]/.test(l));
  r.price = num(priceInput?.replace('[input]', '') ?? '') || num(money(after(/Price/, MONEY)));
  r.currency = (lines.slice(Math.max(0, priceAt), priceAt + 3).join(' ').match(/\b(USD|EUR|GBP|CAD|AUD|JPY|MXN|INR|SGD|AED|SAR|BRL|SEK|PLN|TRY)\b/) ?? ['', ''])[1];
  r.shipping = money(lines.find((l) => /^\+\s?[$€£]/.test(l)) ?? '');
  r.sale_price = money(after(/Sale price/, MONEY));
  r.featured_offer = money(after(/Featured offer/, MONEY));
  r.competitive_price = money(after(/Competitive price/, MONEY));
  r.business_price = money(after(/Business price/, MONEY));
  r.total_fees = money(after(/Total fees/, MONEY));
  r.fba_fee = money(after(/FBA fee/, MONEY));
  r.low_stock_alert = deepAll(block, (el) => /alert|warning|low/i.test(el.getAttribute('aria-label') ?? '') || /low.?inventory|restock/i.test(el.getAttribute('title') ?? '')).length ? 'yes' : '';
  void base;
  return Object.fromEntries(Object.entries(r).filter(([, v]) => v !== '' && v !== '--'));
}

/** Whether the open page is Seller Central's inventory list. */
export function isSellerInventory(doc: Document = document): boolean {
  return /sellercentral(-europe|-japan)?\.amazon\./.test(location.hostname) && listingBlocks(doc).length > 0;
}

/** Every listing on the current page. */
export function sellerListings(doc: Document = document): { rows: Row[]; page: string } {
  const rows = listingBlocks(doc).map((b) => readListing(b));
  const pageEl = deepAll(doc.body, (el) => el.getAttribute('aria-current') === 'page' || /current-page|page-current|selected/i.test(el.className?.toString?.() ?? ''))[0];
  return { rows, page: (pageEl?.textContent ?? '').trim() };
}

/** Seller Central's "next page" control (inside its pagination component), clicked; false at the end. */
export function sellerNextPage(doc: Document = document): boolean {
  const candidates = deepAll(doc.body, (el) => {
    if (!/^(BUTTON|A|SPAN|LI|KAT-[A-Z-]+)$/.test(el.tagName) && el.getAttribute('role') !== 'button') return false;
    const label = `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''} ${el.getAttribute('data-test-id') ?? ''} ${(el.textContent ?? '').trim().slice(0, 20)}`;
    return /\bnext\b|nach|suivant|siguiente|次へ/i.test(label) && !/previous|prev/i.test(label);
  });
  const btn = candidates.find((el) => !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true' && !/disabled/i.test(el.className?.toString?.() ?? '') && !hidden(el));
  if (!btn) return false;
  (btn as HTMLElement).click();
  return true;
}

/** A short fingerprint of the listings shown, to tell when the next page has arrived. */
export const sellerSignature = (doc: Document = document) => {
  const b = listingBlocks(doc);
  const asin = (el: Element | undefined) => (el ? (deepLines(el).join(' ').match(ASIN) ?? [''])[0] : '');
  return `${b.length}|${asin(b[0])}|${asin(b[b.length - 1])}`;
};
