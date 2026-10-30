// Export menu for the full-page table. Everything is included; nothing is behind a paywall.
import { useEffect, useRef, useState } from 'react';
import { BracketsCurly, CaretRight, ClipboardText, DownloadSimple, FileCsv, FilePdf, FileXls, GoogleDriveLogo, ImageSquare } from '@phosphor-icons/react';
import type { Dataset } from '@/lib/db';
import { exportCsv, exportJson, exportXlsx } from '@/lib/export';
import { copyTable, openInGoogleSheets, type CopyFormat } from '@/lib/clipboard';
import { exportPdf, exportXlsxWithImages, fetchImages, imageColumns } from '@/lib/imageExport';
import { requestHostAccess } from '@/lib/tab';

interface Props {
  /** The current view: search, sort and visible columns applied. */
  view: Dataset;
  onToast: (message: string) => void;
}

type Item = { id: string; label: string; detail: string; Icon: typeof FileCsv; run: () => Promise<string | void> };

export function ExportMenu({ view, onToast }: Props) {
  const [open, setOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const rows = view.rows.length;
  const pics = imageColumns(view)[0];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !root.current?.contains(e.target as Node)) {
        setOpen(false);
        setCopyOpen(false);
        if (e instanceof KeyboardEvent) button.current?.focus();
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  async function run(item: Item) {
    setBusy(item.id);
    try {
      const msg = await item.run();
      onToast(msg || `${item.label} ready: ${rows} rows`);
      setOpen(false);
      setCopyOpen(false);
    } catch (e: any) {
      onToast(`${item.label} failed: ${e?.message ?? e}`);
    } finally {
      setBusy('');
      setProgress('');
    }
  }

  const withPictures = async (fn: typeof exportPdf) => {
    if (!pics) throw new Error('No picture column in this table');
    if (!(await requestHostAccess())) throw new Error('Gleaner needs permission to download the pictures');
    const ctrl = new AbortController();
    const images = await fetchImages(view.rows.map((r) => r[pics.key] ?? ''), { signal: ctrl.signal, onProgress: (d, t) => setProgress(`Downloading pictures ${d}/${t}`) });
    await fn(view, pics.key, images);
  };

  const files: Item[] = [
    { id: 'csv', label: 'CSV', detail: 'Opens in any spreadsheet app', Icon: FileCsv, run: async () => exportCsv(view) },
    { id: 'xlsx', label: 'Excel', detail: 'Microsoft Excel workbook (.xlsx)', Icon: FileXls, run: async () => exportXlsx(view) },
    ...(pics
      ? [
          { id: 'xlsx-pics', label: 'Excel with pictures', detail: 'Each picture inside its row', Icon: ImageSquare, run: () => withPictures(exportXlsxWithImages) },
          { id: 'pdf', label: 'PDF catalogue', detail: 'Printable, pictures beside each row', Icon: FilePdf, run: () => withPictures(exportPdf) },
        ]
      : [{ id: 'pdf', label: 'PDF', detail: 'Printable table', Icon: FilePdf, run: () => exportPdf(view, '', new Map()) }]),
    {
      id: 'sheets',
      label: 'Google Sheets',
      detail: 'Opens a new sheet, then press Ctrl+V',
      Icon: GoogleDriveLogo,
      run: async () => {
        await openInGoogleSheets(view);
        return `A new Google Sheet is opening. Press Ctrl+V in cell A1 to paste ${rows} rows${pics ? ', pictures included' : ''}.`;
      },
    },
    { id: 'json', label: 'JSON', detail: 'For developers and other tools', Icon: BracketsCurly, run: async () => exportJson(view) },
  ];

  const copies: { id: CopyFormat; label: string; detail: string }[] = [
    { id: 'sheet', label: 'For Excel or Sheets', detail: 'Paste straight into cells' },
    { id: 'rich', label: 'Formatted table', detail: 'Docs, Notion, email, Word, with pictures' },
    { id: 'markdown', label: 'Markdown', detail: 'GitHub, Notion, chat' },
    { id: 'json', label: 'JSON', detail: 'Developer-friendly' },
    { id: 'csv', label: 'CSV text', detail: 'Comma-separated' },
  ];

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-accent px-3.5 text-[13px] font-semibold text-accent-ink transition hover:brightness-105 active:scale-[0.98]"
      >
        <DownloadSimple size={16} weight="bold" aria-hidden /> Export
      </button>
      {open && (
        <div role="menu" aria-label="Export" className="absolute top-11 right-0 z-20 w-[340px] overflow-hidden rounded-xl border border-line bg-surface shadow-[0_20px_60px_rgb(0_0_0/0.28)]">
          <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <p className="font-display text-[15px] font-semibold tracking-tight">Export</p>
              <p className="text-[11.5px] text-muted">Uses your current search, sort and columns</p>
            </div>
            <p className="text-right">
              <span className="block font-mono text-[20px] leading-none tabular-nums">{rows.toLocaleString()}</span>
              <span className="text-[11px] text-muted">rows</span>
            </p>
          </div>
          <ul className="p-1.5">
            {files.map((it) => (
              <li key={it.id}>
                <button role="menuitem" disabled={!!busy} onClick={() => run(it)} className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface-2 disabled:opacity-60">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
                    <it.Icon size={17} weight="duotone" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">{it.label}</span>
                    <span className="block truncate text-[11.5px] text-muted">{busy === it.id ? progress || 'Working' : it.detail}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-line p-1.5">
            <button
              role="menuitem"
              aria-expanded={copyOpen}
              onClick={() => setCopyOpen((c) => !c)}
              className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface-2"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
                <ClipboardText size={17} weight="duotone" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">Copy to clipboard</span>
                <span className="block text-[11.5px] text-muted">Paste anywhere, no file</span>
              </span>
              <CaretRight size={14} className={`text-muted transition ${copyOpen ? 'rotate-90' : ''}`} aria-hidden />
            </button>
            {copyOpen && (
              <ul className="mt-1 ml-12 flex flex-col gap-0.5 pb-1">
                {copies.map((c) => (
                  <li key={c.id}>
                    <button
                      role="menuitem"
                      onClick={() =>
                        run({ id: 'copy-' + c.id, label: `Copy (${c.label})`, detail: '', Icon: ClipboardText, run: async () => (await copyTable(view, c.id), `Copied ${rows} rows (${c.label.toLowerCase()})`) })
                      }
                      className="flex w-full cursor-pointer items-baseline justify-between gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-surface-2"
                    >
                      <span className="text-[12.5px]">{c.label}</span>
                      <span className="truncate text-[11px] text-muted">{c.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
