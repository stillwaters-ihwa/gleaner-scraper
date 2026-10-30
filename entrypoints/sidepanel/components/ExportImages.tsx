import { useMemo, useRef, useState } from 'react';
import { FileArchive, FilePdf, FileXls, Stop } from '@phosphor-icons/react';
import type { Dataset } from '@/lib/db';
import { exportPdf, exportXlsxWithImages, exportZip, fetchImages, imageColumns, pdfColumns, type ImageMap } from '@/lib/imageExport';
import { requestHostAccess } from '@/lib/tab';
import { Button, Field, Notice, inputCls } from './ui';

type Format = 'xlsx' | 'pdf' | 'zip';

/** "Export with images" box in the Data view. Only shown when a column holds image URLs. */
export function ExportImages({ ds }: { ds: Dataset }) {
  const cols = useMemo(() => imageColumns(ds), [ds]);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<Format | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const cache = useRef<{ key: string; images: ImageMap } | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  if (!cols.length) return null;
  const imageKey = key && cols.some((c) => c.key === key) ? key : cols[0].key;

  async function run(format: Format) {
    setMsg(null);
    if (!(await requestHostAccess())) {
      setMsg({ tone: 'error', text: 'Gleaner needs permission to read websites to download the pictures. Try again and choose Allow.' });
      return;
    }
    setBusy(format);
    ctrl.current = new AbortController();
    try {
      let images = cache.current?.key === imageKey ? cache.current.images : null;
      if (!images) {
        images = await fetchImages(
          ds.rows.map((r) => r[imageKey] ?? ''),
          { signal: ctrl.current.signal, onProgress: (done, total, failed) => setProgress({ done, total, failed }) },
        );
        if (ctrl.current.signal.aborted) return setMsg({ tone: 'info', text: 'Stopped.' });
        cache.current = { key: imageKey, images };
      }
      setProgress(null);
      if (format === 'xlsx') await exportXlsxWithImages(ds, imageKey, images);
      if (format === 'pdf') await exportPdf(ds, imageKey, images);
      if (format === 'zip') await exportZip(ds, imageKey, images);
      const failed = [...images.values()].filter((v) => v === null).length;
      setMsg({
        tone: 'info',
        text: failed ? `Exported. ${failed} pictures couldn't be downloaded, so their cells are empty.` : 'Exported with pictures.',
      });
    } catch (e: any) {
      setMsg({ tone: 'error', text: `Export failed: ${e?.message ?? e}` });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  const pdfCount = pdfColumns(ds, imageKey).length;
  return (
    <section aria-label="Export with pictures" className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3">
      <div>
        <h3 className="font-display text-[14px] font-semibold">Export with pictures</h3>
        <p className="mt-0.5 text-[12px] text-muted">Downloads each picture and puts it in the file, not just its link.</p>
      </div>
      {cols.length > 1 && (
        <Field label="Picture column">
          {(id) => (
            <select id={id} value={imageKey} onChange={(e) => setKey(e.target.value)} className={inputCls}>
              {cols.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <div className="grid grid-cols-1 gap-1.5 min-[520px]:grid-cols-3">
        <Button onClick={() => run('xlsx')} disabled={!!busy} title="Excel workbook with pictures in the first column">
          <FileXls size={16} aria-hidden /> Excel + pictures
        </Button>
        <Button onClick={() => run('pdf')} disabled={!!busy} title={`PDF with pictures and up to ${pdfCount} columns`}>
          <FilePdf size={16} aria-hidden /> PDF
        </Button>
        <Button onClick={() => run('zip')} disabled={!!busy} title="CSV plus a folder of the picture files">
          <FileArchive size={16} aria-hidden /> CSV + pictures
        </Button>
      </div>
      {busy && (
        <div aria-live="polite" className="flex items-center justify-between gap-2 text-[12.5px]">
          <span className="text-muted">
            {progress ? 'Downloading pictures' : 'Building file'}
            {progress && (
              <span className="font-mono text-ink tabular-nums">
                {' '}
                {progress.done}/{progress.total}
              </span>
            )}
          </span>
          {progress && (
            <Button variant="ghost" onClick={() => ctrl.current?.abort()}>
              <Stop size={14} weight="fill" aria-hidden /> Stop
            </Button>
          )}
        </div>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <p className="text-[11.5px] leading-snug text-muted">
        CSV files can only hold text, so "CSV + pictures" gives you a ZIP with the CSV and an images folder, with each row's file name in its own column. The PDF shows up to {pdfCount} columns; Excel keeps them all.
      </p>
    </section>
  );
}
