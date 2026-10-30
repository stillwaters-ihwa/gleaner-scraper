// Data tools: HTML to Markdown, HTML tables to rows, spreadsheets to JSON, JSON formatting and
// flattening, merging CSV/Excel files, and pulling every link out of a page. All run offline.
import TurndownService from 'turndown';
// @ts-expect-error: the plugin ships without types
import { gfm } from 'turndown-plugin-gfm';
import { Readability } from '@mozilla/readability';

import { uniq } from './dom/pageData';
export { htmlTables, tableRows, pageLinks, type HtmlTable, type LinkRow } from './dom/pageData';

export type Row = Record<string, string>;

// ---------- HTML to Markdown ----------

export function htmlToMarkdown(html: string, opts: { mainOnly?: boolean; baseUrl?: string } = {}): { markdown: string; title: string } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (opts.baseUrl && !doc.querySelector('base')) {
    const b = doc.createElement('base');
    b.href = opts.baseUrl;
    doc.head.prepend(b);
  }
  let title = doc.title.trim();
  let root: string = doc.body?.innerHTML ?? html;
  if (opts.mainOnly) {
    const art = new Readability(doc.cloneNode(true) as Document, { keepClasses: false }).parse();
    if (art?.content) {
      root = art.content;
      title = art.title || title;
    }
  }
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
  td.use(gfm);
  td.remove(['script', 'style', 'noscript', 'iframe', 'form', 'button', 'svg'] as any);
  // Absolute links and images, so the Markdown still works away from the page
  if (opts.baseUrl) {
    const fix = (u: string | null) => {
      try {
        return u ? new URL(u, opts.baseUrl).href : '';
      } catch {
        return u ?? '';
      }
    };
    td.addRule('absLinks', { filter: (n) => n.nodeName === 'A' && !!(n as HTMLElement).getAttribute('href'), replacement: (content, n) => (content.trim() ? `[${content.trim()}](${fix((n as HTMLElement).getAttribute('href'))})` : '') });
    td.addRule('absImages', { filter: 'img', replacement: (_c, n) => { const el = n as HTMLImageElement; const src = fix(el.getAttribute('src') || el.getAttribute('data-src')); return src ? `![${el.getAttribute('alt') ?? ''}](${src})` : ''; } });
  }
  const markdown = td.turndown(root).replace(/\n{3,}/g, '\n\n').trim();
  return { markdown: title && !markdown.startsWith('# ') ? `# ${title}\n\n${markdown}` : markdown, title };
}

// ---------- Spreadsheets ----------

/** Every sheet in an Excel or CSV file, as rows keyed by the header row. */
export async function readSpreadsheet(file: File): Promise<{ name: string; rows: Row[]; headers: string[] }[]> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = /\.csv$|\.tsv$|\.txt$/i.test(file.name) ? XLSX.read(new TextDecoder().decode(buf).replace(/^﻿/, ''), { type: 'string', raw: true }) : XLSX.read(buf, { type: 'array', cellDates: true });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const matrix: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
    const headers = uniq((matrix[0] ?? []).map((h, i) => String(h ?? '').trim() || `column ${i + 1}`));
    const rows = matrix.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? '')])));
    return { name, rows, headers };
  });
}

// ---------- JSON ----------

export interface JsonResult {
  ok: boolean;
  value?: unknown;
  error?: string;
  line?: number;
  column?: number;
}

/**
 * Where JSON first goes wrong, as an index, by walking it the way a parser would. Browsers
 * don't always say where in their error message, so this finds the spot itself.
 */
function jsonErrorAt(s: string): { at: number; what: string } {
  let i = 0;
  const ws = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };
  const fail = (what: string): never => {
    throw { at: i, what };
  };
  const value = (): void => {
    ws();
    const c = s[i];
    if (c === '{') {
      i++;
      ws();
      if (s[i] === '}') return void i++;
      for (;;) {
        ws();
        if (s[i] !== '"') fail(s[i] === '}' ? 'Trailing comma before }' : 'Expected a "quoted" key');
        str();
        ws();
        if (s[i] !== ':') fail('Expected : after the key');
        i++;
        value();
        ws();
        if (s[i] === ',') {
          i++;
          continue;
        }
        if (s[i] === '}') return void i++;
        fail('Expected , or } after a value');
      }
    }
    if (c === '[') {
      i++;
      ws();
      if (s[i] === ']') return void i++;
      for (;;) {
        ws();
        if (s[i] === ']') fail('Trailing comma before ]');
        value();
        ws();
        if (s[i] === ',') {
          i++;
          continue;
        }
        if (s[i] === ']') return void i++;
        fail('Expected , or ] after a value');
      }
    }
    if (c === '"') return str();
    const lit = s.slice(i).match(/^(true|false|null|-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?)/);
    if (lit) return void (i += lit[0].length);
    fail(c === undefined ? 'Unexpected end of the text' : c === "'" ? 'Use "double quotes", not single quotes' : `Unexpected ${c}`);
  };
  const str = () => {
    i++;
    while (i < s.length && s[i] !== '"') {
      if (s[i] === '\\') i++;
      else if (s[i] === '\n') fail('Line break inside a string');
      i++;
    }
    if (s[i] !== '"') fail('A string is never closed');
    i++;
  };
  try {
    value();
    ws();
    if (i < s.length) fail('Extra text after the end');
  } catch (e: any) {
    if (typeof e?.at === 'number') return e;
    throw e;
  }
  return { at: -1, what: '' };
}

/** Parse JSON and, when it's broken, say where and why. */
export function parseJson(text: string): JsonResult {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e: any) {
    const { at, what } = jsonErrorAt(text);
    if (at < 0) return { ok: false, error: String(e?.message ?? e) };
    const before = text.slice(0, at);
    return { ok: false, error: what, line: before.split('\n').length, column: at - before.lastIndexOf('\n') };
  }
}

const sortDeep = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortDeep((v as any)[k])])) : v;

export function formatJson(value: unknown, opts: { indent: number; sortKeys: boolean }): string {
  return JSON.stringify(opts.sortKeys ? sortDeep(value) : value, null, opts.indent || undefined);
}

/** Flatten nested objects into "a.b.c" columns; arrays of plain values are joined. */
export function flatten(v: unknown, prefix = '', out: Row = {}): Row {
  if (v === null || typeof v !== 'object') {
    out[prefix || 'value'] = v == null ? '' : String(v);
    return out;
  }
  if (Array.isArray(v)) {
    if (v.every((x) => x === null || typeof x !== 'object')) out[prefix || 'value'] = v.join(', ');
    else v.forEach((x, i) => flatten(x, prefix ? `${prefix}.${i}` : String(i), out));
    return out;
  }
  for (const [k, x] of Object.entries(v)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

/** JSON turned into table rows: an array of objects, or the biggest such array inside it. */
export function jsonToRows(value: unknown): Row[] {
  const find = (v: unknown, depth: number): unknown[] | null => {
    if (Array.isArray(v)) return v;
    if (!v || typeof v !== 'object' || depth > 4) return null;
    let best: unknown[] | null = null;
    for (const x of Object.values(v)) {
      const a = find(x, depth + 1);
      if (a && (!best || a.length > best.length)) best = a;
    }
    return best;
  };
  const arr = find(value, 0) ?? [value];
  return arr.map((x) => flatten(x));
}

// ---------- Merging files ----------

export interface MergeInput {
  name: string;
  rows: Row[];
}

/**
 * Stack files into one table. Columns line up by name (ignoring case, spaces and
 * punctuation), a "source file" column says where each row came from, and exact duplicate
 * rows can be dropped.
 */
export function mergeTables(inputs: MergeInput[], opts: { dedupe: boolean; sourceColumn: boolean }): { headers: string[]; rows: Row[]; duplicates: number } {
  const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  const order: string[] = [];
  const canonical = new Map<string, string>();
  for (const f of inputs) for (const r of f.rows.slice(0, 1)) for (const h of Object.keys(r)) {
    if (!canonical.has(key(h))) {
      canonical.set(key(h), h);
      order.push(h);
    }
  }
  const rows: Row[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const f of inputs) {
    for (const r of f.rows) {
      const out: Row = {};
      for (const [h, v] of Object.entries(r)) {
        const c = canonical.get(key(h)) ?? h;
        if (!canonical.has(key(h))) {
          canonical.set(key(h), h);
          order.push(h);
        }
        out[c] = v;
      }
      if (opts.dedupe) {
        const sig = order.map((h) => out[h] ?? '').join('\u0001');
        if (seen.has(sig)) {
          duplicates++;
          continue;
        }
        seen.add(sig);
      }
      if (opts.sourceColumn) out['source file'] = f.name;
      rows.push(out);
    }
  }
  return { headers: opts.sourceColumn ? [...order, 'source file'] : order, rows, duplicates };
}

