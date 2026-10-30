// Column profiling, sorting and search for the full-page data table. Pure functions, no DOM.
import type { Column, Dataset } from './db';
import { looksLikeImage, looksLikeUrl } from './columns';

export type ColumnType = 'image' | 'url' | 'price' | 'number' | 'date' | 'text';

export interface ColumnProfile {
  key: string;
  type: ColumnType;
  /** Share of rows with a value, 0..1. */
  filled: number;
  unique: number;
  /** Average text length, used to pick a sensible starting width. */
  avgLength: number;
}

const NUM = /^-?[\d.,\s]+$/;
const PRICE = /^[^\d-]{0,4}\s?-?\d[\d.,\s]*\s?[^\d\s]{0,4}$/;
const DATE = /^\d{4}-\d{2}-\d{2}|^\d{1,2}[/.]\d{1,2}[/.]\d{2,4}$/;

export function toNumber(v: string): number | null {
  if (!v) return null;
  let s = v.replace(/[^\d.,-]/g, '');
  if (!s || s === '-' ) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function typeOf(c: Column, values: string[]): ColumnType {
  const sample = values.slice(0, 200);
  if (!sample.length) return 'text';
  const share = (test: (v: string) => boolean) => sample.filter(test).length / sample.length;
  if (share(looksLikeImage) > 0.6 || (/image|img|photo|thumb|picture/i.test(c.label) && share(looksLikeUrl) > 0.6)) return 'image';
  if (share(looksLikeUrl) > 0.6) return 'url';
  if (/price|cost|amount|total|msrp/i.test(c.label) && share((v) => PRICE.test(v.trim())) > 0.6) return 'price';
  if (share((v) => NUM.test(v.trim()) && toNumber(v) !== null) > 0.8) return 'number';
  if (share((v) => DATE.test(v.trim())) > 0.8) return 'date';
  return 'text';
}

export function profileColumns(ds: Dataset): ColumnProfile[] {
  const n = ds.rows.length || 1;
  return ds.columns.map((c) => {
    const values: string[] = [];
    let total = 0;
    const seen = new Set<string>();
    for (const r of ds.rows) {
      const v = r[c.key];
      if (v) {
        values.push(v);
        total += Math.min(v.length, 200);
        if (seen.size < 5000) seen.add(v);
      }
    }
    return { key: c.key, type: typeOf(c, values), filled: values.length / n, unique: seen.size, avgLength: values.length ? total / values.length : 0 };
  });
}

/** Starting column width in pixels from the content. */
export function initialWidth(p: ColumnProfile, label: string): number {
  if (p.type === 'image') return 76;
  if (p.type === 'price' || p.type === 'number' || p.type === 'date') return Math.max(96, label.length * 8 + 48);
  if (p.type === 'url') return 220;
  return Math.round(Math.min(360, Math.max(120, label.length * 8 + 48, p.avgLength * 6.5)));
}

export type Sort = { key: string; dir: 'asc' | 'desc' } | null;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Row indexes after search and sort. Empty values always sort last. */
export function viewIndexes(ds: Dataset, profiles: ColumnProfile[], query: string, sort: Sort, visibleKeys: string[]): number[] {
  let idx = ds.rows.map((_, i) => i);
  const q = query.trim().toLowerCase();
  if (q) {
    const terms = q.split(/\s+/);
    idx = idx.filter((i) => {
      const r = ds.rows[i];
      const hay = visibleKeys.map((k) => r[k] ?? '').join(' \u0001 ').toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }
  if (sort) {
    const p = profiles.find((x) => x.key === sort.key);
    const numeric = !!p && (p.type === 'price' || p.type === 'number');
    const sign = sort.dir === 'asc' ? 1 : -1;
    // Read and convert every value once, instead of inside each comparison
    const raw = ds.rows.map((r) => r[sort.key] ?? '');
    const nums = numeric ? raw.map(toNumber) : null;
    idx.sort((a, b) => {
      const va = raw[a];
      const vb = raw[b];
      if (!va || !vb) return !va && !vb ? a - b : !va ? 1 : -1;
      if (nums) {
        const na = nums[a];
        const nb = nums[b];
        if (na !== null && nb !== null && na !== nb) return (na - nb) * sign;
      }
      return (va < vb ? -1 : va > vb ? 1 : 0) === 0 ? a - b : collator.compare(va, vb) * sign || a - b;
    });
  }
  return idx;
}

/** The first image column, used for the picture column and the row drawer. */
export function primaryImageKey(profiles: ColumnProfile[]): string | null {
  return profiles.find((p) => p.type === 'image')?.key ?? null;
}

/** A readable title for a row: the first long-ish text value. */
export function rowTitle(ds: Dataset, row: Record<string, string>, profiles: ColumnProfile[]): string {
  const titleCol = ds.columns.find((c) => /^(title|name|product ?name|full title|Title)$/i.test(c.label));
  if (titleCol && row[titleCol.key]) return row[titleCol.key];
  const text = profiles.find((p) => p.type === 'text' && (row[p.key] ?? '').length > 8);
  return text ? row[text.key] : `Row`;
}
