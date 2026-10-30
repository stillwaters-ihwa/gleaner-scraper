// "Check before filing" rules, reading PDF facts, and the labelled PDF made from an opened PDF.
import { beforeAll, describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import sharp from 'sharp';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { oddNameChars, paperOf, pdfFacts, preflight, preflightMarkdown, type PdfFacts } from '@/lib/capture/preflight';
import { pdfFromPages } from '@/lib/capture/pdf';

const A4 = { w: 595.28, h: 841.89 };
const A3 = { w: 841.89, h: 1190.55 };
const LETTER = { w: 612, h: 792 };
const facts = (o: Partial<PdfFacts> = {}): PdfFacts => ({ name: '甲第1号証 商品ページ.pdf', bytes: 2 * 1024 * 1024, encrypted: false, pages: [A4], hasJavaScript: false, hasAttachments: false, ...o });
const status = (f: PdfFacts, id: string) => preflight(f).find((c) => c.id === id)?.status;

describe('paper sizes', () => {
  it('knows A4 and A3 either way up, with a little slack', () => {
    expect(paperOf(A4)).toBe('A4');
    expect(paperOf({ w: A4.h, h: A4.w })).toBe('A4');
    expect(paperOf(A3)).toBe('A3');
    expect(paperOf({ w: 596, h: 842 })).toBe('A4');
    expect(paperOf(LETTER)).toBeNull();
  });
});

describe('check before filing', () => {
  it('passes a plain A4 PDF with a good name', () => {
    const list = preflight(facts());
    expect(list.filter((c) => c.status === 'fail')).toEqual([]);
    expect(list.map((c) => c.id)).toEqual(['password', 'paper', 'size', 'name-length', 'name-chars']);
    for (const c of list) expect(c.source).toBeTruthy();
  });
  it('fails a password-protected PDF', () => {
    expect(status(facts({ encrypted: true }), 'password')).toBe('fail');
  });
  it('accepts A3 and A4 mixed, fails other sizes and names the pages', () => {
    expect(status(facts({ pages: [A4, A3, { w: A3.h, h: A3.w }] }), 'paper')).toBe('pass');
    const c = preflight(facts({ pages: [A4, LETTER] })).find((x) => x.id === 'paper')!;
    expect(c.status).toBe('fail');
    expect(c.detail).toContain('1 of 2 pages');
    expect(c.detail).toContain('2: 216×279 mm');
    expect(c.detailJa).toContain('2ページ目');
    expect(status(facts({ pages: [] }), 'paper')).toBe('fail');
  });
  it('limits the size to 200 MB and warns when close', () => {
    expect(status(facts({ bytes: 201 * 1024 * 1024 }), 'size')).toBe('fail');
    expect(status(facts({ bytes: 160 * 1024 * 1024 }), 'size')).toBe('warn');
    expect(status(facts({ bytes: 1024 }), 'size')).toBe('pass');
  });
  it('counts name length in characters, extension included, up to 100', () => {
    expect(status(facts({ name: 'あ'.repeat(96) + '.pdf' }), 'name-length')).toBe('pass');
    expect(status(facts({ name: 'あ'.repeat(97) + '.pdf' }), 'name-length')).toBe('fail');
  });
  it('flags characters that often fail', () => {
    expect(oddNameChars('甲第1号証 （マスキング）①.pdf')).toEqual([]);
    expect(oddNameChars('a:b?😀한.pdf')).toEqual([':', '?', '😀', '한']);
    expect(status(facts({ name: 'report😀.pdf' }), 'name-chars')).toBe('warn');
  });
  it('wants a .pdf name', () => {
    expect(status(facts({ name: 'exhibit' }), 'extension')).toBe('fail');
    expect(status(facts(), 'extension')).toBeUndefined();
  });
  it('reminds about the （マスキング） name only for blacked-out copies', () => {
    expect(status(facts(), 'masking')).toBeUndefined();
    expect(status(facts({ masked: true }), 'masking')).toBe('info');
    expect(status(facts({ masked: true, name: '（マスキング）甲第1号証.pdf' }), 'masking')).toBe('pass');
  });
  it('warns about scripts and attached files', () => {
    expect(status(facts({ hasJavaScript: true }), 'javascript')).toBe('warn');
    expect(status(facts({ hasAttachments: true }), 'attachments')).toBe('warn');
  });
  it('writes a report that never promises acceptance', () => {
    const md = preflightMarkdown(preflight(facts({ encrypted: true })), 'x.pdf');
    expect(md).toContain('**Fail** Password or encryption');
    expect(md).toContain('does not guarantee');
    const ja = preflightMarkdown(preflight(facts()), 'x.pdf', true);
    expect(ja).toContain('保証するものではありません');
    expect(md + ja).not.toContain('—');
  });
});

const bytes = (d: jsPDF) => new Uint8Array(d.output('arraybuffer'));

describe('reading PDF facts', () => {
  it('reads page sizes in points', async () => {
    const d = new jsPDF({ unit: 'pt', format: 'a4' });
    d.text('Hello', 40, 40);
    d.addPage('letter', 'landscape');
    const f = await pdfFacts(pdfjs, bytes(d), 'a.pdf');
    expect(f.encrypted).toBe(false);
    expect(f.pages.length).toBe(2);
    expect(paperOf(f.pages[0])).toBe('A4');
    expect(Math.round(f.pages[1].w)).toBe(792);
    expect(preflight(f).find((c) => c.id === 'paper')!.status).toBe('fail');
  });
  it('spots a password', async () => {
    const d = new jsPDF({ unit: 'pt', format: 'a4', encryption: { userPassword: 'secret', ownerPassword: 'owner', userPermissions: ['print'] } });
    d.text('Private', 40, 40);
    const f = await pdfFacts(pdfjs, bytes(d), 'locked.pdf');
    expect(f.encrypted).toBe(true);
  });
});

describe('labelled PDF from an opened PDF', () => {
  beforeAll(async () => {
    // jsPDF needs real image bytes; the browser canvas is stood in for with sharp-made pictures
    const jpeg = `data:image/jpeg;base64,${(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } }).jpeg().toBuffer()).toString('base64')}`;
    const png = `data:image/png;base64,${(await sharp({ create: { width: 8, height: 4, channels: 4, background: '#c8102e' } }).png().toBuffer()).toString('base64')}`;
    const ctx = new Proxy({ measureText: (t: string) => ({ width: t.length * 10 }) } as any, { get: (o, k) => (k in o ? o[k] : () => {}), set: () => true });
    const canvas = () => ({ width: 0, height: 0, getContext: () => ctx, toDataURL: (type: string) => (type === 'image/png' ? png : jpeg) });
    (globalThis as any).OffscreenCanvas = class { getContext() { return ctx; } };
    (globalThis as any).document = { createElement: canvas };
    (globalThis as any).createImageBitmap = async () => ({ width: 8, height: 8, close() {} });
  });

  it('keeps each page size, numbers the pages and adds no address line', async () => {
    const blob = await pdfFromPages([new Blob(['a']), new Blob(['b'])], [A4, { w: A3.h, h: A3.w }], { exhibit: '甲第1号証', title: 'Test' });
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
    expect(doc.numPages).toBe(2);
    const sizes: string[] = [];
    const texts: string[] = [];
    let images = 0;
    for (let i = 1; i <= 2; i++) {
      const p = await doc.getPage(i);
      const v = p.getViewport({ scale: 1 });
      sizes.push(paperOf({ w: v.width, h: v.height })! + (v.width > v.height ? ' landscape' : ''));
      texts.push((await p.getTextContent()).items.map((t: any) => t.str).join(' '));
      const ops = await p.getOperatorList();
      images += ops.fnArray.filter((f: number) => f === pdfjs.OPS.paintImageXObject).length;
    }
    expect(sizes).toEqual(['A4', 'A3 landscape']);
    expect(texts).toEqual(['1 / 2', '2 / 2']);
    expect(images).toBe(4); // the page and the exhibit label on each
    expect((await doc.getMetadata()).info).toMatchObject({ Title: 'Test' });
  });

  it('can leave out the label and the numbers', async () => {
    const blob = await pdfFromPages([new Blob(['a'])], [A4], { pageNumbers: false });
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
    const p = await doc.getPage(1);
    expect((await p.getTextContent()).items.length).toBe(0);
    expect((await p.getOperatorList()).fnArray.filter((f: number) => f === pdfjs.OPS.paintImageXObject).length).toBe(1);
  });
});
