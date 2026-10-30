// Reads "Label: value" details from product cards and pages (SKU, PartNum, Stock, MOQ, box
// quantities...) and every price with its currency. Works on live pages and fetched HTML.
import { parsePrice } from '../product';

export type Fields = Record<string, string>;

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const slug = (s: string) => clean(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '').slice(0, 40);

// Labels we understand, mapped to standard columns. Order matters: first match wins.
const SEMANTIC: { key: string; re: RegExp }[] = [
  { key: 'part_number', re: /^(part ?(num(ber)?|no\.?|#)|mpn|mfr ?(part|#)|manufacturer ?part)/i },
  { key: 'sku', re: /^(sku|item ?(no\.?|number|code|#)|product ?(code|no\.?|id)|article ?(no\.?|number)|style ?(no\.?|#)|model( ?no\.?)?|ref(erence)?|상품코드|품번)$/i },
  { key: 'gtin', re: /^(bar ?code|ean(-?13)?|upc|jan|gtin|isbn|바코드)$/i },
  { key: 'qty_per_carton', re: /^((pcs|pieces|qty|quantity|units?|ea)\s*(per|\/)\s*(carton|ctn|case|outer)|(carton|ctn|case|outer)\s*(qty|quantity|pack|size)|master ?carton|case ?pack|1 ?(carton|ctn|case)$|(carton|ctn)$|카톤|박스입수)/i },
  { key: 'qty_per_box', re: /^((pcs|pieces|qty|quantity|units?|ea)\s*(per|\/)\s*(box|pack|inner|bundle)|(box|inner|pack)\s*(qty|quantity|pack|size)|inner ?pack|1 ?box$|box$|입수)/i },
  { key: 'moq', re: /^(moq|min(imum)?\.?\s*(order)?\s*(qty|quantity|amount)?|min\.? ?order|최소( ?주문| ?구매)?( ?수량)?|구매수량)$/i },
  { key: 'stock_qty', re: /^(stock|in ?stock|stock ?(qty|quantity|level|status)?|inventory|available( ?qty| ?quantity)?|qty ?available|on ?hand|재고( ?수량)?)$/i },
  { key: 'weight', re: /^(weight|net ?weight|gross ?weight|중량)$/i },
  { key: 'volume', re: /^(volume|capacity|size|용량)$/i },
  { key: 'origin', re: /^(origin|country( of origin)?|made in|원산지)$/i },
  { key: 'expiry', re: /^(exp(iry|iration)?( ?date)?|best before|유통기한)$/i },
];

export const FIELD_LABELS: Record<string, string> = {
  part_number: 'part number', sku: 'sku', gtin: 'barcode (gtin)', qty_per_carton: 'qty per carton', qty_per_box: 'qty per box',
  moq: 'moq', stock_qty: 'stock qty', weight: 'weight', volume: 'volume', origin: 'origin', expiry: 'expiry',
  box: 'box', carton: 'carton', box_price: 'box price', stock_status: 'stock status',
};

function semanticKey(label: string): string | null {
  const l = clean(label).replace(/[.:#\s]+$/, '');
  return SEMANTIC.find((s) => s.re.test(l))?.key ?? null;
}

// "Label : value" pairs inside one line; the value stops where the next "Label :" begins.
const PAIR_RE = /(\p{N}{0,2}\s?\p{L}[\p{L}\p{N} .#/()&'-]{0,28}?)\s*[:：]\s*(.+?)(?=\s+\p{N}{0,2}\s?\p{L}[\p{L}\p{N} .#/()&'-]{0,28}?\s*[:：]|\s*[|•·]\s*|$)/gu;

/** Label/value pairs found in a block of text, one line at a time. */
export function pairsFromText(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of text.split(/\n+/)) {
    for (const m of line.matchAll(PAIR_RE)) {
      const label = clean(m[1]);
      const value = clean(m[2]).replace(/[,;]$/, '');
      if (label.length < 2 || !value || value.length > 120 || /^https?$/i.test(label) || /^\d+$/.test(label)) continue;
      if (/\d$/.test(label) && /^\d/.test(value)) continue; // a time like 10:30, not a label
      out.push([label, value]);
    }
  }
  return out;
}

/** Pairs from definition lists, two-column tables and label/value elements. */
export function pairsFromMarkup(root: ParentNode): [string, string][] {
  const out: [string, string][] = [];
  const txt = (e: Element | null | undefined) => clean(e?.textContent);
  root.querySelectorAll('dl').forEach((dl) => {
    dl.querySelectorAll('dt').forEach((dt) => {
      const dd = dt.nextElementSibling;
      if (dd?.tagName === 'DD') out.push([txt(dt), txt(dd)]);
    });
  });
  root.querySelectorAll('tr').forEach((tr) => {
    const cells = tr.querySelectorAll('th, td');
    if (cells.length === 2) out.push([txt(cells[0]), txt(cells[1])]);
  });
  root.querySelectorAll('[class*="label" i], [class*="name" i][class*="attr" i], [class*="key" i]').forEach((el) => {
    const v = el.nextElementSibling;
    if (v && /value|val|data|text/i.test(v.className + '')) out.push([txt(el).replace(/[:：]$/, ''), txt(v)]);
  });
  return out.filter(([l, v]) => l && v && l.length <= 40 && v.length <= 160);
}

const firstInt = (v: string) => v.replace(/(\d),(?=\d{3}\b)/g, '$1').match(/\d+(?:\.\d+)?/)?.[0] ?? '';

/** Text-only patterns: "48ea/box", "1 Box = 48 EA", "MOQ 10", "Only 3 left", "120 in stock". */
function loosePatterns(text: string): Fields {
  const f: Fields = {};
  const t = clean(text);
  const perBox = t.match(/(\d[\d,]*)\s*(?:ea|pcs|pieces|units?|개)\s*(?:\/|per|in a|in 1)\s*(?:1\s*)?(?:box|pack|inner)\b/i) ?? t.match(/1\s*(?:box|pack|inner)\s*[=:(]\s*(\d[\d,]*)\s*(?:ea|pcs|pieces|units?|개)?/i);
  if (perBox) f.qty_per_box = firstInt(perBox[1]);
  const perCtn = t.match(/(\d[\d,]*)\s*(?:ea|pcs|pieces|units?|개)\s*(?:\/|per|in a|in 1)\s*(?:1\s*)?(?:carton|ctn|case)\b/i) ?? t.match(/1\s*(?:carton|ctn|case)\s*[=:(]\s*(\d[\d,]*)/i);
  if (perCtn) f.qty_per_carton = firstInt(perCtn[1]);
  const moq = t.match(/\b(?:moq|min(?:imum)?\.?\s*order(?:\s*qty)?)\s*[:：]?\s*(\d[\d,]*\s*(?:ea|pcs|pieces|units?|boxes?|cartons?|개)?)/i);
  if (moq) f.moq = clean(moq[1]);
  const stock = t.match(/\b(?:only\s+)?(\d[\d,]*)\s+(?:left|in stock|available|pcs? in stock)\b/i) ?? t.match(/\bstock\s*[:：]?\s*(\d[\d,]*)\b/i) ?? t.match(/재고\s*[:：]?\s*(\d[\d,]*)/);
  if (stock) f.stock_qty = firstInt(stock[1]);
  if (/out of stock|sold ?out|품절|unavailable/i.test(t)) f.stock_status = 'out of stock';
  else if (/\bin stock\b|available now|재고 ?있음/i.test(t)) f.stock_status = 'in stock';
  else if (/low stock|only \d+ left|few left/i.test(t)) f.stock_status = 'low stock';
  return f;
}

/** Every price in the text, grouped by currency: { price_KRW: "12000", price_USD: "9.10" }. */
export function pricesByCurrency(texts: string[]): Fields {
  const out: Fields = {};
  for (const t of texts) {
    for (const piece of clean(t).split(/\s*(?:\/|\||·|•|\(|\))\s*|\s{2,}/)) {
      const p = parsePrice(piece);
      if (p?.currency && !out[`price_${p.currency}`]) out[`price_${p.currency}`] = p.amount;
    }
  }
  return out;
}

export interface DetailOptions {
  /** Keep labels we don't recognize as their own columns (attr_<label>). */
  keepUnknown?: boolean;
}

/**
 * All details found in an element (a product card, or a product page's main area).
 * Returns standard keys (sku, part_number, stock_qty, moq, qty_per_box...) plus attr_* columns.
 */
export function readDetails(root: Element | Document, text: string, opts: DetailOptions = { keepUnknown: true }): { fields: Fields; labels: Record<string, string> } {
  const fields: Fields = {};
  const labels: Record<string, string> = {};
  const pairs = [...pairsFromMarkup(root), ...pairsFromText(text)];
  for (const [label, value] of pairs) {
    const key = semanticKey(label);
    if (key) {
      if (!fields[key]) fields[key] = key.startsWith('qty_per') ? firstInt(value) || value : key === 'stock_qty' && /\d/.test(value) ? firstInt(value) : value;
      if (key === 'stock_qty' && !/\d/.test(value)) fields.stock_status ||= value.toLowerCase();
      continue;
    }
    if (!opts.keepUnknown || parsePrice(value)?.currency) continue;
    const k = 'attr_' + slug(label);
    if (k.length > 5 && !fields[k]) {
      fields[k] = value;
      labels[k] = clean(label);
    }
  }
  for (const [k, v] of Object.entries(loosePatterns(text))) if (v && !fields[k]) fields[k] = v;
  return { fields, labels };
}

const BLOCK = /^(P|DIV|LI|TR|DT|DD|H[1-6]|SECTION|ARTICLE|TABLE|UL|OL|DL|BR|TD|TH|SPAN)$/;

/** Text with line breaks between blocks, also for fetched documents that have no layout. */
export function blockText(root: Element | Document): string {
  const el = root instanceof Document ? root.body : root;
  if (!el) return '';
  if (el instanceof HTMLElement && el.isConnected && el.ownerDocument.defaultView && el.innerText) return el.innerText;
  const parts: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) parts.push(n.textContent ?? '');
    else if (n.nodeType === 1) {
      const tag = (n as Element).tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return;
      const block = BLOCK.test(tag) && tag !== 'SPAN';
      if (block) parts.push('\n');
      n.childNodes.forEach(walk);
      if (block) parts.push('\n');
    }
  };
  walk(el);
  return parts.join('').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
}

/** Wholesale helpers: "1 box = 48 ea" style labels and the price of a full box. */
export function wholesaleColumns(f: Fields, unitPrice: string): Fields {
  const out: Fields = {};
  if (f.qty_per_box) out.box = `1 box = ${f.qty_per_box} ea`;
  if (f.qty_per_carton) out.carton = `1 carton = ${f.qty_per_carton} ea`;
  const price = parseFloat(unitPrice);
  const perBox = parseFloat(f.qty_per_box);
  if (!isNaN(price) && !isNaN(perBox) && perBox > 0) out.box_price = (price * perBox).toFixed(2).replace(/\.00$/, '');
  return out;
}
