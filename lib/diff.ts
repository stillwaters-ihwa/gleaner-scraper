// Compare two runs of a scrape: what's new, what's gone, and what changed (prices, stock...).
import type { Column, Dataset } from './db';

export interface DiffSummary {
  keyLabel: string;
  added: number;
  removed: number;
  changed: number;
  priceUp: number;
  priceDown: number;
  unchanged: number;
}

const KEY_PREFERENCE = [/^(url|product url|link|title link|handle)$/i, /^(asin|sku|variant sku|barcode|barcode \(gtin\)|gtin|id)$/i, /url|link|href/i, /^(title|name|product name)$/i];

const num = (v: string) => {
  const n = parseFloat(String(v).replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
};

function uniqueRatio(ds: Dataset, key: string) {
  const vals = ds.rows.map((r) => r[key]).filter(Boolean);
  return vals.length ? new Set(vals).size / ds.rows.length : 0;
}

/** Columns present in both runs, matched by label. */
function shared(a: Dataset, b: Dataset): { label: string; ka: string; kb: string }[] {
  const byLabel = new Map(a.columns.map((c) => [c.label, c.key]));
  return b.columns.filter((c) => byLabel.has(c.label)).map((c) => ({ label: c.label, ka: byLabel.get(c.label)!, kb: c.key }));
}

/** The column that identifies a row in both runs. */
export function pickKey(older: Dataset, newer: Dataset) {
  const cols = shared(older, newer);
  for (const re of KEY_PREFERENCE) {
    const hit = cols.find((c) => re.test(c.label) && uniqueRatio(older, c.ka) > 0.9 && uniqueRatio(newer, c.kb) > 0.9);
    if (hit) return hit;
  }
  return cols.filter((c) => uniqueRatio(older, c.ka) > 0.9 && uniqueRatio(newer, c.kb) > 0.9).sort((x, y) => uniqueRatio(newer, y.kb) - uniqueRatio(newer, x.kb))[0] ?? null;
}

export const DIFF_COLUMNS: Column[] = [
  { key: 'change', label: 'change' },
  { key: 'key', label: 'item' },
  { key: 'title', label: 'title' },
  { key: 'field', label: 'field' },
  { key: 'old', label: 'before' },
  { key: 'new', label: 'after' },
  { key: 'delta', label: 'difference' },
];

export function diffDatasets(older: Dataset, newer: Dataset): { rows: Record<string, string>[]; summary: DiffSummary } {
  const key = pickKey(older, newer);
  if (!key) throw new Error('These two results have no column that identifies each row (like a URL or SKU), so they can\'t be compared.');
  const cols = shared(older, newer).filter((c) => c.label !== key.label);
  const titleCol = cols.find((c) => /^(title|name|product name|full title|Title)$/i.test(c.label));
  const oldMap = new Map(older.rows.map((r) => [r[key.ka], r]));
  const newMap = new Map(newer.rows.map((r) => [r[key.kb], r]));
  const rows: Record<string, string>[] = [];
  const s: DiffSummary = { keyLabel: key.label, added: 0, removed: 0, changed: 0, priceUp: 0, priceDown: 0, unchanged: 0 };
  const priceCol = cols.find((c) => /^(price|variant price)$/i.test(c.label)) ?? cols.find((c) => /price/i.test(c.label) && !/compare|old|was/i.test(c.label));

  for (const [k, r] of newMap) {
    if (!k) continue;
    const o = oldMap.get(k);
    const title = titleCol ? r[titleCol.kb] ?? '' : '';
    if (!o) {
      s.added++;
      rows.push({ change: 'new', key: k, title, field: priceCol?.label ?? '', old: '', new: priceCol ? r[priceCol.kb] ?? '' : '', delta: '' });
      continue;
    }
    let changed = false;
    for (const c of cols) {
      const before = o[c.ka] ?? '';
      const after = r[c.kb] ?? '';
      if (before === after) continue;
      changed = true;
      let delta = '';
      const a = num(before);
      const b = num(after);
      if (/price/i.test(c.label) && a !== null && b !== null && a !== 0) {
        delta = `${b - a > 0 ? '+' : ''}${(b - a).toFixed(2)} (${b - a > 0 ? '+' : ''}${(((b - a) / a) * 100).toFixed(1)}%)`;
        if (c === priceCol) b > a ? s.priceUp++ : s.priceDown++;
      }
      rows.push({ change: /price/i.test(c.label) ? 'price changed' : 'changed', key: k, title, field: c.label, old: before, new: after, delta });
    }
    changed ? s.changed++ : s.unchanged++;
  }
  for (const [k, o] of oldMap) {
    if (!k || newMap.has(k)) continue;
    s.removed++;
    rows.push({ change: 'removed', key: k, title: titleCol ? o[titleCol.ka] ?? '' : '', field: '', old: priceCol ? o[priceCol.ka] ?? '' : '', new: '', delta: '' });
  }
  const order: Record<string, number> = { 'price changed': 0, new: 1, removed: 2, changed: 3 };
  rows.sort((x, y) => order[x.change] - order[y.change]);
  return { rows, summary: s };
}
