// Per-column clean-up rules for the data table. Pure functions over strings.
import type { Column, Dataset } from './db';
import { toNumber } from './table';

export type CleanOp =
  | { kind: 'trim' }
  | { kind: 'number' }
  | { kind: 'replace'; find: string; replace: string; regex: boolean }
  | { kind: 'extract'; pattern: string }
  | { kind: 'case'; to: 'upper' | 'lower' | 'title' }
  | { kind: 'prefix'; before: string; after: string };

export const OP_NAMES: Record<CleanOp['kind'] | 'split', string> = {
  trim: 'Trim spaces',
  number: 'Keep only the number',
  replace: 'Find and replace',
  extract: 'Extract with a pattern',
  case: 'Change case',
  prefix: 'Add text before / after',
  split: 'Split into columns',
};

function regexOf(src: string, flags = 'g'): RegExp {
  try {
    return new RegExp(src, flags);
  } catch {
    throw new Error('That pattern is not a valid regular expression.');
  }
}

export function applyOp(value: string, op: CleanOp): string {
  if (!value && op.kind !== 'prefix') return value;
  switch (op.kind) {
    case 'trim':
      return value.replace(/\s+/g, ' ').trim();
    case 'number': {
      const n = toNumber(value);
      return n === null ? '' : String(n);
    }
    case 'replace':
      return op.regex ? value.replace(regexOf(op.find), op.replace) : value.split(op.find).join(op.replace);
    case 'extract': {
      const m = value.match(regexOf(op.pattern, ''));
      return m ? (m[1] ?? m[0]) : '';
    }
    case 'case':
      return op.to === 'upper' ? value.toUpperCase() : op.to === 'lower' ? value.toLowerCase() : value.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase());
    case 'prefix':
      return value ? `${op.before}${value}${op.after}` : value;
  }
}

const newKey = (ds: Dataset, label: string) => {
  let base = 'col_' + label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 30);
  let k = base;
  let n = 2;
  while (ds.columns.some((c) => c.key === k)) k = `${base}_${n++}`;
  return k;
};

/** Apply a rule to every row. Writes into `target` (same column) or a new column after it. */
export function cleanColumn(ds: Dataset, key: string, op: CleanOp, newLabel?: string): Dataset {
  const targetKey = newLabel ? newKey(ds, newLabel) : key;
  const rows = ds.rows.map((r) => ({ ...r, [targetKey]: applyOp(r[key] ?? '', op) }));
  let columns: Column[] = ds.columns;
  if (newLabel) {
    const at = ds.columns.findIndex((c) => c.key === key);
    columns = [...ds.columns.slice(0, at + 1), { key: targetKey, label: newLabel }, ...ds.columns.slice(at + 1)];
  }
  return { ...ds, rows, columns };
}

/** Split one column into several by a separator: "a | b | c" becomes three columns. */
export function splitColumn(ds: Dataset, key: string, separator: string, max = 10): Dataset {
  const label = ds.columns.find((c) => c.key === key)?.label ?? key;
  const parts = ds.rows.map((r) => (r[key] ?? '').split(separator).map((s) => s.trim()).filter(Boolean));
  const width = Math.min(max, Math.max(0, ...parts.map((p) => p.length)));
  if (width < 2) throw new Error(`No row has "${separator}" in it, so there is nothing to split.`);
  let next = ds;
  const keys: string[] = [];
  for (let i = 0; i < width; i++) {
    const k = newKey(next, `${label} ${i + 1}`);
    keys.push(k);
    next = { ...next, columns: [...next.columns, { key: k, label: `${label} ${i + 1}` }] };
  }
  const at = ds.columns.findIndex((c) => c.key === key);
  const added = next.columns.slice(ds.columns.length);
  const columns = [...ds.columns.slice(0, at + 1), ...added, ...ds.columns.slice(at + 1)];
  const rows = ds.rows.map((r, i) => ({ ...r, ...Object.fromEntries(keys.map((k, j) => [k, parts[i][j] ?? ''])) }));
  return { ...ds, columns, rows };
}
