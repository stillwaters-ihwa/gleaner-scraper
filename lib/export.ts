import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { Dataset } from './db';

function table(ds: Dataset) {
  const header = ds.columns.map((c) => c.label);
  const rows = ds.rows.map((r) => ds.columns.map((c) => r[c.key] ?? ''));
  return { header, rows };
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_').slice(0, 80) || 'gleaner';
}

export function exportCsv(ds: Dataset) {
  const { header, rows } = table(ds);
  const csv = Papa.unparse({ fields: header, data: rows });
  save(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), safeName(ds.name) + '.csv');
}

export function exportXlsx(ds: Dataset) {
  const { header, rows } = table(ds);
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  save(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), safeName(ds.name) + '.xlsx');
}

export function exportJson(ds: Dataset) {
  const data = ds.rows.map((r) => Object.fromEntries(ds.columns.map((c) => [c.label, r[c.key] ?? ''])));
  save(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), safeName(ds.name) + '.json');
}

export async function copyTsv(ds: Dataset) {
  const { header, rows } = table(ds);
  const tsv = [header, ...rows].map((r) => r.map((v) => String(v).replace(/[\t\n]/g, ' ')).join('\t')).join('\n');
  await navigator.clipboard.writeText(tsv);
}

/** Save some text as a file (Markdown, JSON, plain text). */
export function downloadText(text: string, filename: string, type = 'text/plain') {
  save(new Blob([text], { type: `${type};charset=utf-8` }), filename);
}
