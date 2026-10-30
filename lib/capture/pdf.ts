// A4 portrait PDF from a long page picture. Page breaks are moved to the nearest calm row (blank
// space between lines) so text isn't cut in half. Each page can carry the address, capture time,
// page number and an exhibit label (e.g. "Exhibit 3" or "甲第3号証").
import { jsPDF } from 'jspdf';

export interface PdfOptions {
  /** Small text above the picture on every page (address, time). */
  header?: string[];
  pageNumbers?: boolean;
  /** Label in the top right of every page, in red. */
  exhibit?: string;
  title?: string;
}

const A4 = { w: 595.28, h: 841.89 };
const M = { side: 28, top: 44, bottom: 36 };

/** Rows that are almost one colour (gaps between lines and blocks) score low. */
function rowBusyness(data: Uint8ClampedArray, width: number, row: number): number {
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let x = 0; x < width; x += 3) {
    const i = (row * width + x) * 4;
    const v = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
    sum += v;
    sum2 += v * v;
    n++;
  }
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

/** Where to cut near `target` (image pixels): the calmest row in the band above it. */
export function calmCut(ctx: OffscreenCanvasRenderingContext2D, width: number, target: number, searchUp: number): number {
  const from = Math.max(0, Math.round(target - searchUp));
  const h = Math.round(target) - from;
  if (h < 4) return Math.round(target);
  const band = ctx.getImageData(0, from, width, h).data;
  let best = h - 1;
  let bestScore = Infinity;
  for (let r = h - 1; r >= 0; r -= 2) {
    const s = rowBusyness(band, width, r);
    // Prefer cuts close to the target when rows are equally calm
    const score = s + (h - r) * 0.02;
    if (score < bestScore) {
      bestScore = score;
      best = r;
      if (s < 1) break;
    }
  }
  return from + best;
}

/** Text drawn as a picture, for labels in scripts the built-in PDF fonts don't have (日本語). */
function textImage(text: string, px: number, color: string, weight = 600, box = false): { url: string; w: number; h: number } {
  const ctx = new OffscreenCanvas(10, 10).getContext('2d')!;
  const font = `${weight} ${px}px "Noto Sans JP", "Yu Gothic", "Meiryo", "Geist Variable", system-ui, sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width + (box ? px : 4));
  const h = Math.ceil(px * 1.5);
  const canvas = document.createElement('canvas');
  canvas.width = w * 2;
  canvas.height = h * 2;
  const k = canvas.getContext('2d')!;
  k.scale(2, 2);
  if (box) {
    k.fillStyle = '#fff';
    k.fillRect(0, 0, w, h);
    k.strokeStyle = color;
    k.lineWidth = 2;
    k.strokeRect(1, 1, w - 2, h - 2);
  }
  k.font = font;
  k.fillStyle = color;
  k.textBaseline = 'middle';
  k.fillText(text, box ? px / 2 : 2, h / 2 + 1);
  return { url: canvas.toDataURL('image/png'), w, h };
}

const latin = (s: string) => /^[\x20-\x7e -ɏ]*$/.test(s);

export async function pdfFromPicture(picture: Blob, o: PdfOptions = {}): Promise<Blob> {
  const bmp = await createImageBitmap(picture);
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait', compress: true });
  if (o.title) doc.setProperties({ title: o.title, creator: 'Gleaner' });
  const cw = A4.w - M.side * 2;
  const ch = A4.h - M.top - M.bottom;
  const scale = cw / bmp.width; // points per image pixel
  const sliceMax = Math.floor(ch / scale);
  const full = new OffscreenCanvas(bmp.width, bmp.height);
  const fctx = full.getContext('2d', { willReadFrequently: true })!;
  fctx.drawImage(bmp, 0, 0);
  // Work out every page's cut first, so pages can say "1 of N"
  const cuts: [number, number][] = [];
  for (let y = 0; y < bmp.height; ) {
    let end = Math.min(bmp.height, y + sliceMax);
    if (end < bmp.height) end = calmCut(fctx, bmp.width, end, Math.min(sliceMax * 0.18, 400));
    if (end <= y) end = Math.min(bmp.height, y + sliceMax);
    cuts.push([y, end]);
    y = end;
  }
  const label = o.exhibit ? textImage(o.exhibit, 22, '#c8102e', 700, true) : null;
  cuts.forEach(([y0, y1], i) => {
    if (i > 0) doc.addPage('a4', 'portrait');
    const slice = new OffscreenCanvas(bmp.width, y1 - y0);
    slice.getContext('2d')!.drawImage(full, 0, y0, bmp.width, y1 - y0, 0, 0, bmp.width, y1 - y0);
    const c = document.createElement('canvas');
    c.width = slice.width;
    c.height = slice.height;
    c.getContext('2d')!.drawImage(slice, 0, 0);
    doc.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', M.side, M.top, cw, (y1 - y0) * scale, undefined, 'FAST');
    doc.setTextColor(70, 80, 95);
    doc.setFontSize(7.5);
    (o.header ?? []).forEach((line, n) => {
      if (latin(line)) doc.text(line.slice(0, 160), M.side, 16 + n * 10);
      else {
        const t = textImage(line.slice(0, 120), 15, '#465060', 500);
        doc.addImage(t.url, 'PNG', M.side, 9 + n * 10, (t.w * 9) / 15, (t.h * 9) / 15);
      }
    });
    if (o.pageNumbers !== false) doc.text(`${i + 1} / ${cuts.length}`, A4.w - M.side, A4.h - 16, { align: 'right' });
    if (label) {
      const w = (label.w * 16) / 22;
      const h = (label.h * 16) / 22;
      doc.addImage(label.url, 'PNG', A4.w - M.side - w, 8, w, h);
    }
  });
  bmp.close();
  return doc.output('blob');
}

/**
 * One PDF page per picture, each the size of the original page (for a PDF opened in the Studio):
 * the exhibit label in the top right and page numbers at the bottom, no address line.
 */
export async function pdfFromPages(pages: Blob[], sizes: { w: number; h: number }[], o: PdfOptions = {}): Promise<Blob> {
  const first = sizes[0] ?? A4;
  const doc = new jsPDF({ unit: 'pt', format: [first.w, first.h], orientation: first.w > first.h ? 'landscape' : 'portrait', compress: true });
  if (o.title) doc.setProperties({ title: o.title, creator: 'Gleaner' });
  const label = o.exhibit ? textImage(o.exhibit, 22, '#c8102e', 700, true) : null;
  for (let i = 0; i < pages.length; i++) {
    const s = sizes[i] ?? first;
    if (i > 0) doc.addPage([s.w, s.h], s.w > s.h ? 'landscape' : 'portrait');
    const bmp = await createImageBitmap(pages[i]);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    doc.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, s.w, s.h, undefined, 'FAST');
    if (label) {
      const w = (label.w * 16) / 22;
      const h = (label.h * 16) / 22;
      doc.addImage(label.url, 'PNG', s.w - 22 - w, 14, w, h);
    }
    if (o.pageNumbers !== false) {
      doc.setFontSize(9);
      doc.setTextColor(40, 40, 40);
      doc.text(`${i + 1} / ${pages.length}`, s.w / 2, s.h - 14, { align: 'center' });
    }
  }
  return doc.output('blob');
}
