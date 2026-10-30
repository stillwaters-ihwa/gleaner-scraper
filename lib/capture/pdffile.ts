// Opening an existing PDF in Capture Studio: every page drawn at print quality (200 dpi), the
// original kept untouched with its fingerprint and page sizes, ready for black-out, notes and
// exhibit labels.
import { browser } from 'wxt/browser';
import type { CaptureRecord } from '../db';
import { sha256 } from './formats';
import type { CaptureReport } from './shot';

const DPI = 200;

export async function loadPdfjs() {
  const pdfjs: any = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = browser.runtime.getURL('/vendor/pdf.worker.min.mjs' as any);
  return pdfjs;
}

export async function pdfToCapture(file: File, onProgress?: (done: number, total: number) => void): Promise<CaptureRecord> {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdfjs = await loadPdfjs();
  let doc: any;
  try {
    doc = await pdfjs.getDocument({ data: data.slice(), isEvalSupported: false }).promise;
  } catch (e) {
    if ((e as any)?.name === 'PasswordException') throw new Error('This PDF has a password. Open it in a PDF reader, remove the password, save it, and try again.');
    throw new Error(`This file could not be read as a PDF (${(e as Error).message}).`);
  }
  const parts: Blob[] = [];
  const sizes: { w: number; h: number }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const v1 = page.getViewport({ scale: 1 });
    sizes.push({ w: v1.width, h: v1.height });
    const vp = page.getViewport({ scale: DPI / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    parts.push(await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Page could not be drawn'))), 'image/png')));
    onProgress?.(i, doc.numPages);
  }
  await doc.destroy();
  const now = new Date().toISOString();
  const report: CaptureReport = {
    url: file.name,
    title: file.name.replace(/\.pdf$/i, ''),
    mode: 'pdf file',
    capturedAt: now,
    viewport: { width: 0, height: 0 },
    devicePixelRatio: DPI / 72,
    pageSize: { width: Math.round(sizes[0]?.w ?? 0), height: Math.round(sizes.reduce((s, p) => s + p.h, 0)) },
    scrolled: 'none',
    reachedBottom: true,
    stoppedEarly: false,
    scrollSteps: 0,
    loadSeconds: 0,
    parts: parts.map(() => ({ width: 0, height: 0, overlapPx: 0 })),
    userAgent: navigator.userAgent,
    source: { name: file.name, bytes: data.length, sha256: await sha256(data), pages: sizes },
  };
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    url: file.name,
    title: report.title,
    parts,
    report,
    sourcePdf: new Blob([data as BlobPart], { type: 'application/pdf' }),
    intent: 'pdf',
    edits: { parts: parts.map(() => ({ edits: [], crop: null })), history: [{ at: now, action: 'opened PDF', detail: `${file.name}, ${parts.length} pages` }], stampOn: false },
  };
}
