// PDF and image to data: text, tables and invoice fields from PDFs, photos, scans and
// screenshots. Text PDFs are read exactly; images and scanned pages go through OCR (English and
// Korean). Everything runs inside the extension; files are not uploaded anywhere.
import { useState } from 'react';
import { newDataset, saveDataset, type Column } from '@/lib/db';
import { invoiceFields, ocrImage, pdfPageImage, readPdf, tableFromBoxes, type Box, type OcrLang } from '@/lib/documents';
import { downloadText, safeName } from '@/lib/export';
import { Check, Field, Notice, Section, Segmented, inputCls } from '../ui';
import { RunBar, useJob } from '../run';

type Mode = 'text' | 'tables' | 'invoice';

interface PageContent {
  file: string;
  page: number;
  text: string;
  boxes: Box[];
  method: 'PDF text' | 'OCR';
  confidence?: number;
}

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const isImage = (f: File) => /^image\/(png|jpe?g|webp|bmp|gif|tiff)$/.test(f.type) || /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(f.name);

export function DocumentTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<Mode>('tables');
  const [lang, setLang] = useState<OcrLang>('eng');
  const [ocrScans, setOcrScans] = useState(true);
  const [text, setText] = useState('');
  const job = useJob();
  const usable = files.filter((f) => isPdf(f) || isImage(f));

  function start() {
    setText('');
    job.start(
      async ({ signal, progress, status }) => {
        const pages: PageContent[] = [];
        for (const [fi, f] of usable.entries()) {
          if (signal.aborted) break;
          const data = await f.arrayBuffer();
          if (isPdf(f)) {
            status(`Reading ${f.name}`);
            const pdf = await readPdf(data, (n, t) => status(`Reading ${f.name}: page ${n} of ${t}`));
            for (const p of pdf) {
              if (signal.aborted) break;
              // A page with almost no text is a scan: read it with OCR
              if (p.text.replace(/\s/g, '').length < 20 && ocrScans) {
                status(`${f.name} page ${p.page} is a scan: reading it with OCR`);
                const r = await ocrImage(await pdfPageImage(data, p.page), lang, (x) => status(`OCR ${f.name} page ${p.page}: ${Math.round(x * 100)}%`));
                pages.push({ file: f.name, page: p.page, text: r.text, boxes: r.boxes, method: 'OCR', confidence: r.confidence });
              } else pages.push({ file: f.name, page: p.page, text: p.text, boxes: p.boxes, method: 'PDF text' });
            }
          } else {
            status(`Reading ${f.name} with OCR`);
            const r = await ocrImage(new Blob([data], { type: f.type || 'image/png' }), lang, (x) => status(`OCR ${f.name}: ${Math.round(x * 100)}%`));
            pages.push({ file: f.name, page: 1, text: r.text, boxes: r.boxes, method: 'OCR', confidence: r.confidence });
          }
          progress(fi + 1, usable.length);
        }
        if (!pages.length) throw new Error('Nothing could be read from these files.');
        const name = usable.length === 1 ? usable[0].name.replace(/\.\w+$/, '') : `${usable.length} files`;
        const low = pages.filter((p) => p.method === 'OCR' && (p.confidence ?? 100) < 60).length;
        const lowNote = low ? ` ${low} ${low === 1 ? 'page was' : 'pages were'} hard to read (low OCR confidence); check those values.` : '';

        if (mode === 'text') {
          const all = pages.map((p) => `--- ${p.file}${pages.filter((x) => x.file === p.file).length > 1 ? `, page ${p.page}` : ''} ---\n${p.text}`).join('\n\n');
          setText(all);
          const rows = pages.map((p) => ({ file: p.file, page: String(p.page), method: p.method, confidence: p.confidence != null ? String(p.confidence) : '', words: String(p.text.split(/\s+/).filter(Boolean).length), text: p.text }));
          const cols: Column[] = ['file', 'page', 'method', 'confidence', 'words', 'text'].filter((k) => rows.some((r) => (r as any)[k])).map((k) => ({ key: k, label: k }));
          return saveDataset({ ...newDataset('documents', `Text ${name}`, usable[0].name, cols, rows), note: `${pages.length} ${pages.length === 1 ? "page" : "pages"} read.${lowNote}` });
        }

        if (mode === 'invoice') {
          const byFile = new Map<string, string>();
          for (const p of pages) byFile.set(p.file, `${byFile.get(p.file) ?? ''}\n${p.text}`);
          const rows = [...byFile.entries()].map(([file, t]) => ({ file, ...invoiceFields(t) }));
          const keys = ['file', 'vendor', 'invoice_number', 'invoice_date', 'due_date', 'po_number', 'currency', 'subtotal', 'tax', 'shipping', 'total', 'amount_due'];
          const cols = keys.filter((k) => rows.some((r) => (r as any)[k])).map((k) => ({ key: k, label: k.replace(/_/g, ' ') }));
          // Line items, if the invoice has a table
          const items = pages.flatMap((p) => tableFromBoxes(p.boxes).map((cells) => ({ file: p.file, cells })));
          if (items.length > 1) {
            const width = Math.max(...items.map((i) => i.cells.length));
            const header = items[0].cells.map((h, i) => h || `column ${i + 1}`);
            const itemRows = items.slice(1).map((i) => ({ file: i.file, ...Object.fromEntries(header.map((h, k) => [h, i.cells[k] ?? ''])) }));
            await saveDataset(newDataset('documents', `Invoice lines ${name}`, usable[0].name, [{ key: 'file', label: 'file' }, ...header.slice(0, width).map((h) => ({ key: h, label: h }))], itemRows));
          }
          return saveDataset({ ...newDataset('documents', `Invoices ${name}`, usable[0].name, cols, rows), note: `${rows.length} ${rows.length === 1 ? 'invoice' : 'invoices'} read.${items.length > 1 ? ' Line items were saved as their own data.' : ''} Check totals against the original.${lowNote}` });
        }

        // Tables: one table per page, stacked, with the file and page on each row
        const rows: Record<string, string>[] = [];
        let header: string[] = [];
        for (const p of pages) {
          const t = tableFromBoxes(p.boxes);
          if (t.length < 2) continue;
          // Reuse the first table's header when later pages repeat it or continue it
          const first = t[0];
          const isHeader = first.some((c) => /[A-Za-z가-힣]/.test(c)) && !first.some((c) => /^\$?\d[\d,.]*$/.test(c));
          if (!header.length) header = isHeader ? first.map((h, i) => h || `column ${i + 1}`) : first.map((_, i) => `column ${i + 1}`);
          const body = isHeader && first.join('|') === header.join('|') ? t.slice(1) : isHeader && rows.length === 0 ? t.slice(1) : t;
          for (const cells of body) rows.push({ file: p.file, page: String(p.page), ...Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])) });
        }
        if (!rows.length) throw new Error('No tables found. Try "Text" to see what was read.');
        const cols: Column[] = [{ key: 'file', label: 'file' }, { key: 'page', label: 'page' }, ...header.map((h) => ({ key: h, label: h }))];
        return saveDataset({ ...newDataset('documents', `Tables ${name}`, usable[0].name, cols, rows), note: `${rows.length} ${rows.length === 1 ? "row" : "rows"} from ${pages.length} ${pages.length === 1 ? "page" : "pages"}.${lowNote}` });
      },
      { needsHostAccess: false },
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <Section title="Files">
        <p className="text-[12.5px] leading-relaxed text-muted">PDFs, photos, scans and screenshots to text, tables or invoice fields. Text PDFs are read exactly; images and scanned pages are read with OCR. Files stay on this computer.</p>
        <Field label={`PDF or image files${usable.length ? ` (${usable.length})` : ''}`} help="PDF, PNG, JPG, WebP, BMP or TIFF. Several at once is fine.">
          {(id) => <input id={id} type="file" multiple accept=".pdf,image/*" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className={inputCls} />}
        </Field>
        {files.length > usable.length && <Notice tone="error">{files.length - usable.length} files aren&apos;t PDFs or images and will be skipped.</Notice>}
      </Section>
      <Section title="Get">
        <Segmented label="What to get" value={mode} onChange={setMode} options={[{ value: 'tables', label: 'Tables' }, { value: 'text', label: 'Text' }, { value: 'invoice', label: 'Invoice fields' }]} />
        <p className="text-[12px] leading-relaxed text-muted">
          {mode === 'tables' ? 'Rows and columns, ready for Excel. Works best on price lists, statements and reports laid out in columns.' : mode === 'text' ? 'All the text, page by page, in reading order.' : 'Invoice number, dates, PO number, subtotal, tax, shipping and total, plus line items when there is a table.'}
        </p>
        <Field label="Language in images and scans">
          {() => <Segmented label="OCR language" value={lang} onChange={setLang} options={[{ value: 'eng', label: 'English' }, { value: 'kor', label: 'Korean' }, { value: 'eng+kor', label: 'Both' }]} />}
        </Field>
        <Check checked={ocrScans} onChange={setOcrScans}>
          Read scanned PDF pages with OCR
        </Check>
      </Section>
      {text && (
        <Section title="Text">
          <textarea readOnly value={text} rows={10} aria-label="Text read from the files" className={inputCls + ' resize-y font-mono text-[12px] leading-relaxed'} />
          <button onClick={() => downloadText(text, safeName(usable[0]?.name.replace(/\.\w+$/, '') ?? 'text') + '.txt')} className="self-start text-[12.5px] text-accent-text underline-offset-2 hover:underline">
            Download as a text file
          </button>
        </Section>
      )}
      <div className="flex-1" />
      <RunBar job={job} onStart={start} startLabel={usable.length ? `Read ${usable.length} ${usable.length === 1 ? 'file' : 'files'}` : 'Read files'} disabled={!usable.length} />
    </div>
  );
}
