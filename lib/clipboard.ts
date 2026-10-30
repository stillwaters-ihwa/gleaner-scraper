// Copy a table in the format the destination understands, and hand data to Google Sheets.
import Papa from 'papaparse';
import type { Column } from './db';
import { looksLikeImage } from './columns';

export type CopyFormat = 'sheet' | 'rich' | 'markdown' | 'json' | 'csv';

interface TableData {
  columns: Column[];
  rows: Record<string, string>[];
}

const cell = (v: string) => String(v ?? '').replace(/[\t\r\n]+/g, ' ');

function tsv({ columns, rows }: TableData, imageFormulas = false) {
  const header = columns.map((c) => cell(c.label)).join('\t');
  const body = rows.map((r) =>
    columns
      .map((c) => {
        const v = cell(r[c.key] ?? '');
        // Google Sheets turns =IMAGE("url") into the picture itself
        return imageFormulas && looksLikeImage(v) ? `=IMAGE("${v.replace(/"/g, '%22')}")` : v.replace(/^([=+@]|-(?![\d.]))/, "'$&"); // stop text being run as a formula
      })
      .join('\t'),
  );
  return [header, ...body].join('\n');
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function html({ columns, rows }: TableData) {
  const th = columns.map((c) => `<th style="text-align:left;border:1px solid #ccc;padding:4px 6px;background:#f2f4f7">${esc(c.label)}</th>`).join('');
  const tr = rows
    .map(
      (r) =>
        '<tr>' +
        columns
          .map((c) => {
            const v = r[c.key] ?? '';
            const inner = looksLikeImage(v) ? `<img src="${esc(v)}" width="64" height="64" style="object-fit:cover">` : /^https?:\/\//.test(v) ? `<a href="${esc(v)}">${esc(v)}</a>` : esc(v);
            return `<td style="border:1px solid #ccc;padding:4px 6px;vertical-align:top">${inner}</td>`;
          })
          .join('') +
        '</tr>',
    )
    .join('');
  return `<table style="border-collapse:collapse;font-family:sans-serif;font-size:12px"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

function markdown({ columns, rows }: TableData) {
  const c = (v: string) => cell(v).replace(/\|/g, '\\|');
  return [
    `| ${columns.map((x) => c(x.label)).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${columns.map((x) => c(r[x.key] ?? '')).join(' | ')} |`),
  ].join('\n');
}

export function asJson({ columns, rows }: TableData) {
  return JSON.stringify(
    rows.map((r) => Object.fromEntries(columns.map((c) => [c.label, r[c.key] ?? '']))),
    null,
    2,
  );
}

export async function copyTable(data: TableData, format: CopyFormat) {
  if (format === 'rich') {
    // Rich paste into Docs, Notion, email, Word; spreadsheets fall back to the plain text part
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html(data)], { type: 'text/html' }),
        'text/plain': new Blob([tsv(data)], { type: 'text/plain' }),
      }),
    ]);
    return;
  }
  const text = format === 'sheet' ? tsv(data) : format === 'markdown' ? markdown(data) : format === 'json' ? asJson(data) : Papa.unparse({ fields: data.columns.map((c) => c.label), data: data.rows.map((r) => data.columns.map((c) => r[c.key] ?? '')) });
  await navigator.clipboard.writeText(text);
}

/**
 * Google Sheets without any setup: the table goes on the clipboard (pictures as =IMAGE()
 * formulas) and a new blank sheet opens, ready for Ctrl+V.
 */
export async function openInGoogleSheets(data: TableData) {
  await navigator.clipboard.writeText(tsv(data, true));
  window.open('https://sheets.new', '_blank', 'noopener');
}
