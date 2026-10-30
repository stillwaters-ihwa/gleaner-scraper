// PDFs and images: text, tables and invoice fields. PDFs are read with pdf.js (text-based PDFs
// keep their exact text); images and scanned PDFs go through Tesseract OCR (English and
// Korean). Both engines ship inside the extension, so documents never leave the computer.
import { browser } from 'wxt/browser';

export interface Box {
  text: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

// ---------- Layout -> table ----------

/** Words or text pieces grouped into lines, top to bottom, each line left to right. */
export function linesOf(boxes: Box[]): Box[][] {
  const sorted = boxes.filter((b) => b.text.trim()).sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const lines: Box[][] = [];
  for (const b of sorted) {
    const mid = (b.y0 + b.y1) / 2;
    const h = Math.max(1, b.y1 - b.y0);
    const line = lines.find((l) => {
      const lm = l.reduce((s, x) => s + (x.y0 + x.y1) / 2, 0) / l.length;
      return Math.abs(lm - mid) < h * 0.55;
    });
    if (line) line.push(b);
    else lines.push([b]);
  }
  for (const l of lines) l.sort((a, b) => a.x0 - b.x0);
  return lines;
}

/** Pieces on one line merged into cells wherever the gap is wider than a couple of spaces. */
function cellsOf(line: Box[]): Box[] {
  const cells: Box[] = [];
  for (const b of line) {
    const last = cells[cells.length - 1];
    const charW = Math.max(1, (b.x1 - b.x0) / Math.max(1, b.text.length));
    if (last && b.x0 - last.x1 < charW * 1.8) {
      last.text += (b.x0 - last.x1 > charW * 0.25 ? ' ' : '') + b.text;
      last.x1 = Math.max(last.x1, b.x1);
    } else cells.push({ ...b });
  }
  return cells;
}

/**
 * A table from positioned text: lines become rows, and column positions are found from where
 * cells start across many lines. Lines with a single cell (titles, notes) are left out.
 */
export function tableFromBoxes(boxes: Box[]): string[][] {
  const rows = linesOf(boxes).map(cellsOf).filter((r) => r.length >= 2);
  if (rows.length < 2) return [];
  // Column anchors: cluster the left edges of cells
  const width = Math.max(...rows.flat().map((c) => c.x1)) - Math.min(...rows.flat().map((c) => c.x0));
  const tol = Math.max(6, width * 0.025);
  const anchors: { x: number; n: number }[] = [];
  for (const c of rows.flat().sort((a, b) => a.x0 - b.x0)) {
    const a = anchors.find((a) => Math.abs(a.x - c.x0) < tol);
    if (a) {
      a.x = (a.x * a.n + c.x0) / (a.n + 1);
      a.n++;
    } else anchors.push({ x: c.x0, n: 1 });
  }
  // Columns used by fewer than a fifth of rows are usually wrapped text, not real columns
  const cols = anchors.filter((a) => a.n >= Math.max(2, rows.length * 0.2)).sort((a, b) => a.x - b.x);
  if (cols.length < 2) return rows.map((r) => r.map((c) => c.text.trim()));
  return rows.map((r) => {
    const out = Array.from({ length: cols.length }, () => '');
    for (const c of r) {
      // The column whose start is the closest one at or left of the cell
      let idx = 0;
      for (let i = 0; i < cols.length; i++) if (cols[i].x - tol <= c.x0) idx = i;
      out[idx] = out[idx] ? `${out[idx]} ${c.text.trim()}` : c.text.trim();
    }
    return out;
  });
}

// ---------- Invoices and receipts ----------

export interface InvoiceFields {
  vendor: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  po_number: string;
  currency: string;
  subtotal: string;
  tax: string;
  shipping: string;
  total: string;
  amount_due: string;
}

const AMOUNT = String.raw`([$€£₩¥]|USD|EUR|GBP|KRW|JPY|CAD|AUD)?\s?(-?\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})?|-?\d+(?:\.\d{1,2})?)`;
const DATE = String.raw`(\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}[-./]\d{1,2}[-./]\d{2,4}|[A-Z][a-z]{2,8}\.? \d{1,2},? \d{4}|\d{1,2} [A-Z][a-z]{2,8}\.? \d{4})`;

/** Key fields from an invoice or receipt's text. Amounts are taken from labelled lines only. */
export function invoiceFields(text: string): InvoiceFields {
  const lines = text.split(/\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const find = (label: RegExp, value: string) => {
    for (const l of lines) {
      const m = l.match(new RegExp(`${label.source}\\s*[:#.]?\\s*${value}`, 'i'));
      if (m) return m;
    }
    return null;
  };
  const amount = (label: RegExp) => {
    // Use the last amount on the labelled line (e.g. "Total  3 items  $42.00")
    for (const l of [...lines].reverse()) {
      if (!label.test(l)) continue;
      const all = [...l.matchAll(new RegExp(AMOUNT, 'g'))].filter((m) => /\d/.test(m[2]));
      const last = all[all.length - 1];
      if (last) return { sym: last[1] ?? '', value: last[2].replace(/[,\s]/g, '') };
    }
    return null;
  };
  const SYM: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP', '₩': 'KRW', '¥': 'JPY' };
  const total = amount(/^(grand\s+)?total\b|^total\s+(amount|due)|합계|총\s*금액/i);
  const due = amount(/amount\s+due|balance\s+due|total\s+due|청구\s*금액/i);
  const sub = amount(/^sub\s?-?total|소계|공급가액/i);
  const tax = amount(/^(vat|tax|gst|hst|sales tax|부가세|세액)\b/i);
  const ship = amount(/^(shipping|delivery|freight)\b/i);
  const sym = total?.sym || due?.sym || sub?.sym || '';
  return {
    vendor: lines.find((l) => /[A-Za-z가-힣]{3,}/.test(l) && !/invoice|receipt|bill to|date|page|tax/i.test(l))?.slice(0, 80) ?? '',
    invoice_number: find(/(?:invoice|inv|receipt|bill)\s*(?:no|number|num|#)/, String.raw`([A-Z0-9][A-Z0-9-/]{2,})`)?.[1] ?? '',
    invoice_date: find(/(?:invoice\s*date|date\s*of\s*issue|issue\s*date|date|발행일)/, DATE)?.[1] ?? '',
    due_date: find(/(?:due\s*date|payment\s*due|due)/, DATE)?.[1] ?? '',
    po_number: find(/(?:p\.?o\.?|purchase\s*order)\s*(?:no|number|#)?/, String.raw`([A-Z0-9][A-Z0-9-]{2,})`)?.[1] ?? '',
    currency: SYM[sym] ?? (sym.toUpperCase() || (text.match(/\b(USD|EUR|GBP|KRW|JPY|CAD|AUD)\b/)?.[1] ?? '')),
    subtotal: sub?.value ?? '',
    tax: tax?.value ?? '',
    shipping: ship?.value ?? '',
    total: total?.value ?? due?.value ?? '',
    amount_due: due?.value ?? '',
  };
}

// ---------- PDF ----------

export interface PdfPage {
  page: number;
  text: string;
  boxes: Box[];
}

/** Text and positioned text pieces from every page of a PDF. Scanned PDFs have no text layer. */
export async function readPdf(data: ArrayBuffer, onPage?: (n: number, total: number) => void): Promise<PdfPage[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = browser.runtime.getURL('/vendor/pdf.worker.min.mjs' as any);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  const pages: PdfPage[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const boxes: Box[] = [];
    for (const it of content.items as any[]) {
      if (!it.str?.trim()) continue;
      const x = it.transform[4];
      const h = Math.abs(it.transform[3]) || it.height || 10;
      const y = vp.height - it.transform[5];
      boxes.push({ text: it.str, x0: x, x1: x + it.width, y0: y - h, y1: y });
    }
    const text = linesOf(boxes).map((l) => cellsOf(l).map((c) => c.text).join('  ')).join('\n');
    pages.push({ page: i, text, boxes });
    onPage?.(i, pdf.numPages);
    page.cleanup();
  }
  await pdf.destroy();
  return pages;
}

/** Render one PDF page to an image, for OCR of scanned PDFs. */
export async function pdfPageImage(data: ArrayBuffer, pageNo: number): Promise<Blob> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = browser.runtime.getURL('/vendor/pdf.worker.min.mjs' as any);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  const page = await pdf.getPage(pageNo);
  const vp = page.getViewport({ scale: 2 });
  const canvas = new OffscreenCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  await page.render({ canvasContext: canvas.getContext('2d') as any, viewport: vp }).promise;
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  await pdf.destroy();
  return blob;
}

// ---------- OCR ----------

export type OcrLang = 'eng' | 'kor' | 'eng+kor';

let workerP: Promise<any> | null = null;
let workerLang = '';

async function ocrWorker(lang: OcrLang, onProgress?: (p: number) => void) {
  if (workerP && workerLang === lang) return workerP;
  if (workerP) (await workerP).terminate();
  workerLang = lang;
  const { createWorker, OEM } = await import('tesseract.js');
  workerP = createWorker(lang.split('+'), OEM.LSTM_ONLY, {
    // Everything loads from inside the extension; nothing is downloaded
    workerPath: browser.runtime.getURL('/vendor/ocr/worker.min.js' as any),
    corePath: browser.runtime.getURL('/vendor/ocr/tesseract-core-simd-lstm.wasm.js' as any),
    langPath: browser.runtime.getURL('/vendor/ocr' as any),
    gzip: true,
    workerBlobURL: false,
    cacheMethod: 'none',
    logger: (m: any) => m.status === 'recognizing text' && onProgress?.(m.progress),
  });
  return workerP;
}

/** Specks OCR reads from table borders and dividers ("~~", "|", "—"), not words. */
const NOISE = /^[~_|\\/=—–\-‘’'"`.,:;]{1,4}$/;

export interface OcrResult {
  text: string;
  confidence: number;
  boxes: Box[];
}

/** Text and word positions from an image (PNG, JPG, WebP, BMP). */
export async function ocrImage(image: Blob, lang: OcrLang, onProgress?: (p: number) => void): Promise<OcrResult> {
  const w = await ocrWorker(lang, onProgress);
  const { data } = await w.recognize(image, {}, { text: true, blocks: true });
  const boxes: Box[] = [];
  for (const b of data.blocks ?? []) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) for (const wd of l.words ?? []) {
    if (wd.text?.trim() && !NOISE.test(wd.text.trim())) boxes.push({ text: wd.text, x0: wd.bbox.x0, x1: wd.bbox.x1, y0: wd.bbox.y0, y1: wd.bbox.y1 });
  }
  const text = String(data.text ?? '')
    .split('\n')
    .map((l: string) => l.split(/\s+/).filter((w: string) => !NOISE.test(w)).join(' '))
    .join('\n')
    .trim();
  return { text, confidence: Math.round(data.confidence ?? 0), boxes };
}

export async function stopOcr() {
  if (workerP) (await workerP).terminate();
  workerP = null;
  workerLang = '';
}
