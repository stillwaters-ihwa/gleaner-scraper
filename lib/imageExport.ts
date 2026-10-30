// Exports that include the actual pictures: Excel with embedded images, PDF, and a ZIP
// with the CSV plus an images folder. Heavy libraries are loaded only when used.
import Papa from 'papaparse';
import type { Column, Dataset } from './db';
import { looksLikeImage, looksLikeUrl } from './columns';
import { safeName } from './export';

export interface FetchedImage {
  /** Original file, untouched (used in the ZIP). */
  bytes: Uint8Array;
  ext: string;
  /** Small JPEG for embedding in Excel and PDF. */
  thumb: Uint8Array;
  width: number;
  height: number;
}

export type ImageMap = Map<string, FetchedImage | null>;

/** Columns that mostly hold image URLs, best first. */
export function imageColumns(ds: Dataset): Column[] {
  return ds.columns
    .map((c) => {
      const vals = ds.rows.map((r) => r[c.key] ?? '').filter(Boolean);
      const hits = vals.filter(looksLikeImage).length;
      const named = /image|img|photo|thumb|picture|src/i.test(c.label + ' ' + c.key) && vals.some(looksLikeUrl);
      return { c, score: vals.length ? hits / vals.length + (named ? 0.5 : 0) : 0 };
    })
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c);
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp' };

async function decode(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(blob);
  } catch {
    // SVG and some formats only decode through an <img>
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

async function thumbnail(blob: Blob, maxDim: number) {
  const src = await decode(blob);
  const w0 = 'naturalWidth' in src ? src.naturalWidth || 300 : src.width;
  const h0 = 'naturalHeight' in src ? src.naturalHeight || 300 : src.height;
  const scale = Math.min(1, maxDim / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; // JPEG has no transparency
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  return { thumb: new Uint8Array(await out.arrayBuffer()), width: w, height: h };
}

/** Download every image once. Failed images map to null so exports leave the cell empty. */
export async function fetchImages(
  urls: string[],
  opts: { signal: AbortSignal; onProgress: (done: number, total: number, failed: number) => void; maxDim?: number; concurrency?: number },
): Promise<ImageMap> {
  const unique = [...new Set(urls.filter(looksLikeUrl))];
  const map: ImageMap = new Map();
  let next = 0;
  let done = 0;
  let failed = 0;
  opts.onProgress(0, unique.length, 0);
  const worker = async () => {
    while (next < unique.length && !opts.signal.aborted) {
      const url = unique[next++];
      try {
        const res = await fetch(url, { signal: opts.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const type = (blob.type || res.headers.get('content-type') || '').split(';')[0];
        const ext = EXT[type] ?? (url.split(/[?#]/)[0].match(/\.([a-z0-9]{3,4})$/i)?.[1]?.toLowerCase() || 'jpg');
        const t = await thumbnail(blob, opts.maxDim ?? 320);
        map.set(url, { bytes: new Uint8Array(await blob.arrayBuffer()), ext, ...t });
      } catch {
        map.set(url, null);
        failed++;
      }
      done++;
      opts.onProgress(done, unique.length, failed);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 6, unique.length) }, worker));
  return map;
}

function save(data: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Excel file with the picture embedded in the first column of each row. */
export async function exportXlsxWithImages(ds: Dataset, imageKey: string, images: ImageMap) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Gleaner';
  const ws = wb.addWorksheet('Data', { views: [{ state: 'frozen', ySplit: 1 }] });
  const PX = 96; // picture box in pixels
  ws.columns = [{ header: 'Picture', key: '__picture', width: 15 }, ...ds.columns.map((c) => ({ header: c.label, key: c.key, width: Math.min(50, Math.max(12, c.label.length + 2)) }))];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F4F7' } };

  ds.rows.forEach((r, i) => {
    const row = ws.addRow({ __picture: '', ...Object.fromEntries(ds.columns.map((c) => [c.key, r[c.key] ?? ''])) });
    row.alignment = { vertical: 'top', wrapText: true };
    const img = images.get(r[imageKey] ?? '');
    if (!img) return;
    row.height = PX * 0.78; // points
    const id = wb.addImage({ buffer: img.thumb as any, extension: 'jpeg' });
    const scale = Math.min(PX / img.width, PX / img.height);
    ws.addImage(id, { tl: { col: 0.08, row: i + 1.05 } as any, ext: { width: img.width * scale * 0.95, height: img.height * scale * 0.95 }, editAs: 'oneCell' });
  });
  const buf = await wb.xlsx.writeBuffer();
  save(buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', safeName(ds.name) + '-with-images.xlsx');
}

/** Columns that read well in a PDF: everything except the image column, text before URLs. */
export function pdfColumns(ds: Dataset, imageKey: string, max = 8): Column[] {
  const rest = ds.columns.filter((c) => c.key !== imageKey);
  const isUrlCol = (c: Column) => ds.rows.slice(0, 20).every((r) => !r[c.key] || looksLikeUrl(r[c.key]));
  return [...rest.filter((c) => !isUrlCol(c)), ...rest.filter(isUrlCol)].slice(0, max);
}

/** PDF catalogue: one table row per item with its picture in the first column. */
export async function exportPdf(ds: Dataset, imageKey: string, images: ImageMap) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const cols = pdfColumns(ds, imageKey);
  const landscape = cols.length > 4;
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  const IMG = 22; // picture box in mm
  // Columns get fixed widths below; long URLs are shortened to host and last path segment.
  const shortUrl = (v: string) => {
    try {
      const u = new URL(v);
      const tail = u.pathname.split('/').filter(Boolean).pop() ?? '';
      return u.hostname.replace(/^www\./, '') + (tail ? '/.../' + tail : '');
    } catch {
      return v;
    }
  };
  const cellText = (v: string) => (looksLikeUrl(v) ? shortUrl(v) : v.length > 280 ? v.slice(0, 277) + '...' : v);

  doc.setFontSize(15);
  doc.text(ds.name, 14, 16);
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(`${ds.rows.length} rows${ds.source ? ` from ${ds.source}` : ''}, exported ${new Date().toLocaleDateString()}`, 14, 22);

  autoTable(doc, {
    startY: 27,
    head: [['', ...cols.map((c) => c.label)]],
    body: ds.rows.map((r) => ['', ...cols.map((c) => cellText(r[c.key] ?? ''))]),
    styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: [22, 28, 37], textColor: [231, 235, 241] },
    alternateRowStyles: { fillColor: [246, 247, 249] },
    columnStyles: Object.fromEntries([
      [0, { cellWidth: IMG + 4, minCellHeight: IMG + 4 }],
      ...cols.map((_, i) => [i + 1, { cellWidth: (doc.internal.pageSize.getWidth() - 28 - IMG - 4) / cols.length }]),
    ]),
    didDrawCell: (d) => {
      if (d.section !== 'body' || d.column.index !== 0) return;
      const img = images.get(ds.rows[d.row.index]?.[imageKey] ?? '');
      if (!img) return;
      const scale = Math.min(IMG / img.width, IMG / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      doc.addImage(img.thumb, 'JPEG', d.cell.x + 2 + (IMG - w) / 2, d.cell.y + 2 + (IMG - h) / 2, w, h);
    },
    margin: { left: 14, right: 14 },
  });
  save(doc.output('arraybuffer'), 'application/pdf', safeName(ds.name) + '.pdf');
}

/** ZIP with data.csv (plus an "image file" column) and every picture in images/. */
export async function exportZip(ds: Dataset, imageKey: string, images: ImageMap) {
  const { zipSync, strToU8 } = await import('fflate');
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  const fileFor = new Map<string, string>();
  const pad = String(ds.rows.length).length;
  ds.rows.forEach((r, i) => {
    const url = r[imageKey] ?? '';
    const img = images.get(url);
    if (!img || fileFor.has(url)) return;
    const base = url.split(/[?#]/)[0].split('/').pop()?.replace(/\.[a-z0-9]+$/i, '') || 'image';
    const name = `images/${String(i + 1).padStart(pad, '0')}-${safeName(decodeURIComponent(base)).slice(0, 40)}.${img.ext}`;
    fileFor.set(url, name);
    files[name] = [img.bytes, { level: 0 }]; // images are already compressed
  });
  const header = ['image file', ...ds.columns.map((c) => c.label)];
  const rows = ds.rows.map((r) => [fileFor.get(r[imageKey] ?? '') ?? '', ...ds.columns.map((c) => r[c.key] ?? '')]);
  files['data.csv'] = strToU8('﻿' + Papa.unparse({ fields: header, data: rows }));
  save(zipSync(files), 'application/zip', safeName(ds.name) + '.zip');
}
