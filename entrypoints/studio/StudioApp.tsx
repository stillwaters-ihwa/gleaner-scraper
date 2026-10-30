// Capture Studio: check a page capture, then crop, hide (blur, pixelate, solid black), point
// things out (box, arrow, highlight, text), and save it as a picture, an A4 PDF, or a record
// ZIP that keeps the untouched original apart from the edited copy with a full edit history.
import { Spider } from '@/entrypoints/sidepanel/components/Emblem';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  ArrowClockwise, ArrowCounterClockwise, ArrowUpRight, CheckCircle, Clock, Crop as CropIcon, Cursor, DownloadSimple, DropHalf, FilePdf, FileZip, GridFour, Highlighter, Info, ListChecks, MagnifyingGlassMinus, MagnifyingGlassPlus, Rectangle, Scales, Square, TextT, Trash, Translate, WarningCircle, X, XCircle,
} from '@phosphor-icons/react';
import { getCapture, saveCapture, type CaptureRecord } from '@/lib/db';
import { norm, renderEdited, type Crop, type Edit, type EditKind } from '@/lib/capture/render';
import { pdfFromPages, pdfFromPicture } from '@/lib/capture/pdf';
import { pdfFacts, preflight, preflightMarkdown, type Check } from '@/lib/capture/preflight';
import { loadPdfjs } from '@/lib/capture/pdffile';
import { useLang } from '@/lib/capture/i18n';
import { recordFiles, requestTimestamp, stampLines, TSA_URL, type EvidenceInfo, type HistoryEntry } from '@/lib/capture/record';
import { sha256, slug, stamp, zip } from '@/lib/capture/formats';

type Tool = 'select' | 'crop' | EditKind;
type PartState = { edits: Edit[]; crop: Crop | null };
type Saved = { parts: PartState[]; history: HistoryEntry[]; stampOn: boolean };

const TOOLS: { id: Tool; label: string; key: string; Icon: typeof Cursor }[] = [
  { id: 'select', label: 'Select and move', key: 'V', Icon: Cursor },
  { id: 'crop', label: 'Crop', key: 'C', Icon: CropIcon },
  { id: 'blackout', label: 'Black out (solid, for secrets)', key: 'K', Icon: Square },
  { id: 'pixelate', label: 'Pixelate', key: 'P', Icon: GridFour },
  { id: 'blur', label: 'Blur', key: 'B', Icon: DropHalf },
  { id: 'highlight', label: 'Highlight', key: 'H', Icon: Highlighter },
  { id: 'box', label: 'Box', key: 'R', Icon: Rectangle },
  { id: 'arrow', label: 'Arrow', key: 'A', Icon: ArrowUpRight },
  { id: 'text', label: 'Text', key: 'T', Icon: TextT },
];
const COLORS = ['#e5484d', '#e3b04b', '#1d7a4e', '#2f6feb', '#141922', '#ffffff'];
const HIGHLIGHTS = ['#ffe14d', '#9ff0b4', '#ffc2d1', '#bfe1ff'];
const NAMES: Record<string, string> = { blur: 'Blur', pixelate: 'Pixelate', blackout: 'Black out', box: 'Box', arrow: 'Arrow', text: 'Text', highlight: 'Highlight' };

const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();
const btn = 'inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3 text-[13px] whitespace-nowrap text-ink transition hover:border-muted/60 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45';
const primary = 'inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-semibold whitespace-nowrap text-accent-ink transition hover:brightness-105 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45';
const input = 'w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[13px] text-ink placeholder:text-muted/80 focus:border-accent focus:outline-none';

async function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  try {
    await browser.downloads.download({ url, filename, conflictAction: 'uniquify' });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }
}

function hit(e: Edit, x: number, y: number, tol: number) {
  if (e.kind === 'arrow') {
    const x2 = e.x2 ?? e.x;
    const y2 = e.y2 ?? e.y;
    const len = Math.hypot(x2 - e.x, y2 - e.y) || 1;
    const t = Math.max(0, Math.min(1, ((x - e.x) * (x2 - e.x) + (y - e.y) * (y2 - e.y)) / (len * len)));
    return Math.hypot(x - (e.x + t * (x2 - e.x)), y - (e.y + t * (y2 - e.y))) <= tol * 1.5;
  }
  const b = norm(e);
  return x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol;
}

export function StudioApp() {
  const id = new URLSearchParams(location.search).get('id') ?? '';
  const [rec, setRec] = useState<CaptureRecord | null | undefined>(undefined);
  const [urls, setUrls] = useState<string[]>([]);
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const [part, setPart] = useState(0);
  const [state, setState] = useState<PartState[]>([]);
  const [past, setPast] = useState<PartState[][]>([]);
  const [future, setFuture] = useState<PartState[][]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [tool, setTool] = useState<Tool>('blackout');
  const [color, setColor] = useState(COLORS[0]);
  const [strength, setStrength] = useState(2);
  const [textSize, setTextSize] = useState(28);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Edit | Crop | null>(null);
  const [stampOn, setStampOn] = useState(true);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [withMhtml, setWithMhtml] = useState(true);
  const [withTimestamp, setWithTimestamp] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [ev, setEv] = useState<EvidenceInfo>({ number: 'Exhibit 1', title: '', createdOn: new Date().toISOString().slice(0, 10), author: '', purpose: '', notes: '' });
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'draw' | 'move' | 'resize'; x0: number; y0: number; orig?: Edit } | null>(null);
  const [stageW, setStageW] = useState(1000);
  const { lang, setLang, tr } = useLang();
  const [checks, setChecks] = useState<{ name: string; list: Check[] } | null>(null);
  const [maskName, setMaskName] = useState(false);
  const isPdf = rec?.report.mode === 'pdf file';
  // Exhibit numbering follows the language until the person types their own
  useEffect(() => setEv((e) => (lang === 'ja' && e.number === 'Exhibit 1' ? { ...e, number: '甲第1号証' } : lang === 'en' && e.number === '甲第1号証' ? { ...e, number: 'Exhibit 1' } : e)), [lang]);

  // Load the capture
  useEffect(() => {
    getCapture(id).then(async (r) => {
      if (!r) return setRec(null);
      setRec(r);
      const u = r.parts.map((b) => URL.createObjectURL(b));
      setUrls(u);
      setSizes(await Promise.all(r.parts.map(async (b) => {
        const bmp = await createImageBitmap(b);
        const s = { w: bmp.width, h: bmp.height };
        bmp.close();
        return s;
      })));
      const saved = r.edits as Saved | undefined;
      setState(saved?.parts?.length === r.parts.length ? saved.parts : r.parts.map(() => ({ edits: [], crop: null })));
      setHistory(saved?.history ?? [{ at: r.report.capturedAt, action: 'captured', detail: `${r.report.mode}, ${r.report.pageSize.width}×${r.report.pageSize.height}` }]);
      if (saved) setStampOn(saved.stampOn);
      setWithMhtml(!!r.mhtml);
      document.title = `${r.title || r.url} · Capture Studio`;
      if (r.report.mode === 'pdf file') setShowEvidence(true);
    });
  }, [id]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  // Keep edits with the capture so they come back next time
  useEffect(() => {
    if (!rec || !state.length) return;
    const t = setTimeout(() => void saveCapture({ ...rec, edits: { parts: state, history, stampOn } satisfies Saved }), 500);
    return () => clearTimeout(t);
  }, [state, history, stampOn, rec]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [rec]);

  const size = sizes[part];
  const scale = !size ? 1 : zoom === 'fit' ? Math.min(1, (stageW - 48) / size.w) : zoom;
  const cur = state[part] ?? { edits: [], crop: null };
  const sel = cur.edits.find((e) => e.id === selected) ?? null;

  const commit = useCallback(
    (next: PartState, action: string, detail?: string) => {
      setPast((p) => [...p.slice(-80), state]);
      setFuture([]);
      setState((s) => s.map((x, i) => (i === part ? next : x)));
      setHistory((h) => [...h, { at: now(), action, detail: `${state.length > 1 ? `picture ${part + 1}: ` : ''}${detail ?? ''}`.trim() }]);
    },
    [state, part],
  );
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [state, ...f]);
    setState(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setHistory((h) => [...h, { at: now(), action: 'undo' }]);
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, state]);
    setState(future[0]);
    setFuture((f) => f.slice(1));
    setHistory((h) => [...h, { at: now(), action: 'redo' }]);
  };
  const updateSel = (patch: Partial<Edit>, action = 'changed') => sel && commit({ ...cur, edits: cur.edits.map((e) => (e.id === sel.id ? { ...e, ...patch } : e)) }, action, NAMES[sel.kind]);
  const removeSel = () => {
    if (!sel) return;
    commit({ ...cur, edits: cur.edits.filter((e) => e.id !== sel.id) }, 'removed', NAMES[sel.kind]);
    setSelected(null);
  };

  // Keyboard: tools, undo/redo, delete, nudge
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') return e.preventDefault(), e.shiftKey ? redo() : undo();
      if (mod && e.key.toLowerCase() === 'y') return e.preventDefault(), redo();
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) return e.preventDefault(), removeSel();
      if (e.key === 'Escape') return setSelected(null), setDraft(null);
      if (sel && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
        return updateSel({ x: sel.x + dx, y: sel.y + dy, x2: sel.x2 !== undefined ? sel.x2 + dx : undefined, y2: sel.y2 !== undefined ? sel.y2 + dy : undefined }, 'moved');
      }
      if (!mod) {
        const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase() && !(isPdf && x.id === 'crop'));
        if (t) setTool(t.id);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  const toImage = (e: React.PointerEvent) => {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = toImage(e);
    if (tool === 'select') {
      const handle = sel && sel.kind !== 'arrow' && Math.hypot(p.x - (norm(sel).x + norm(sel).w), p.y - (norm(sel).y + norm(sel).h)) < 10 / scale;
      if (handle && sel) {
        drag.current = { mode: 'resize', x0: p.x, y0: p.y, orig: sel };
        return;
      }
      const target = [...cur.edits].reverse().find((x) => hit(x, p.x, p.y, 6 / scale));
      setSelected(target?.id ?? null);
      if (target) drag.current = { mode: 'move', x0: p.x, y0: p.y, orig: target };
      return;
    }
    if (tool === 'text') {
      const t: Edit = { id: uid(), kind: 'text', x: p.x, y: p.y, w: 0, h: 0, text: tr('Note'), color, size: textSize };
      commit({ ...cur, edits: [...cur.edits, t] }, 'added', 'Text');
      setSelected(t.id);
      setTool('select');
      setTimeout(() => (document.getElementById('edit-text') as HTMLTextAreaElement | null)?.select(), 50);
      return;
    }
    drag.current = { mode: 'draw', x0: p.x, y0: p.y };
    setDraft(tool === 'crop' ? { x: p.x, y: p.y, w: 0, h: 0 } : { id: uid(), kind: tool as EditKind, x: p.x, y: p.y, w: 0, h: 0, x2: p.x, y2: p.y, color: tool === 'highlight' ? HIGHLIGHTS[0] : color, strength });
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = toImage(e);
    if (d.mode === 'draw' && draft) {
      if ('kind' in draft && draft.kind === 'arrow') setDraft({ ...draft, x2: p.x, y2: p.y });
      else setDraft({ ...draft, w: p.x - d.x0, h: p.y - d.y0 });
    } else if ((d.mode === 'move' || d.mode === 'resize') && d.orig) {
      const dx = p.x - d.x0;
      const dy = p.y - d.y0;
      const o = d.orig;
      const next = d.mode === 'move' ? { ...o, x: o.x + dx, y: o.y + dy, x2: o.x2 !== undefined ? o.x2 + dx : undefined, y2: o.y2 !== undefined ? o.y2 + dy : undefined } : { ...o, ...norm(o), w: Math.max(4, norm(o).w + dx), h: Math.max(4, norm(o).h + dy) };
      setState((s) => s.map((x, i) => (i === part ? { ...x, edits: x.edits.map((ed) => (ed.id === o.id ? next : ed)) } : x)));
    }
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.mode === 'draw' && draft) {
      const small = 'kind' in draft && draft.kind === 'arrow' ? Math.hypot((draft.x2 ?? 0) - draft.x, (draft.y2 ?? 0) - draft.y) < 6 : Math.abs(draft.w) < 4 || Math.abs(draft.h) < 4;
      setDraft(null);
      if (small) return;
      if (!('kind' in draft)) commit({ ...cur, crop: norm(draft) }, 'cropped', `${Math.round(Math.abs(draft.w))}×${Math.round(Math.abs(draft.h))}`);
      else {
        const ed = draft.kind === 'arrow' ? draft : { ...draft, ...norm(draft) };
        commit({ ...cur, edits: [...cur.edits, ed] }, 'added', `${NAMES[ed.kind]} at ${Math.round(ed.x)},${Math.round(ed.y)}`);
        setSelected(ed.id);
      }
    } else if ((d.mode === 'move' || d.mode === 'resize') && d.orig) {
      // The live drag already changed state; record it as one step
      const after = state[part].edits.find((e) => e.id === d.orig!.id);
      if (after && (after.x !== d.orig.x || after.y !== d.orig.y || after.w !== d.orig.w || after.h !== d.orig.h)) {
        setPast((p) => [...p.slice(-80), state.map((x, i) => (i === part ? { ...x, edits: x.edits.map((e) => (e.id === d.orig!.id ? d.orig! : e)) } : x))]);
        setFuture([]);
        setHistory((h) => [...h, { at: now(), action: d.mode === 'move' ? 'moved' : 'resized', detail: NAMES[d.orig!.kind] }]);
      }
    }
  };

  // ---------- Saving ----------
  const base = rec ? `Gleaner/${slug(rec.title || rec.url, 50)}_${stamp(new Date(rec.report.capturedAt))}` : '';
  const renderAll = async (withStamp: boolean) => {
    const out: Blob[] = [];
    for (let i = 0; i < rec!.parts.length; i++) {
      const bmp = await createImageBitmap(rec!.parts[i]);
      out.push(await renderEdited(bmp, state[i].edits, state[i].crop, withStamp && i === rec!.parts.length - 1 ? { lines: stampLines(rec!.report) } : null, rec!.report.devicePixelRatio || 1));
      bmp.close();
    }
    return out;
  };
  const makePdf = async (exhibit?: string) => {
    const edited = await renderAll(false);
    // A PDF that was opened here: one page per page, at its own size, no address line
    if (isPdf && rec!.report.source) return pdfFromPages(edited, rec!.report.source.pages, { exhibit, title: rec!.title });
    // Parts are stacked into one tall picture for the PDF, minus their overlaps
    const bmps = await Promise.all(edited.map((b) => createImageBitmap(b)));
    const overlap = (i: number) => (i === 0 || state[i].crop ? 0 : rec!.report.parts[i]?.overlapPx ?? 0);
    const w = Math.max(...bmps.map((b) => b.width));
    const h = bmps.reduce((s, b, i) => s + b.height - overlap(i), 0);
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d')!;
    let y = 0;
    bmps.forEach((b, i) => {
      ctx.drawImage(b, 0, overlap(i), b.width, b.height - overlap(i), 0, y, b.width, b.height - overlap(i));
      y += b.height - overlap(i);
      b.close();
    });
    return pdfFromPicture(await c.convertToBlob({ type: 'image/png' }), { header: stampOn || exhibit ? stampLines(rec!.report) : [], exhibit, title: rec!.title });
  };
  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setNote(null);
    try {
      const msg = await fn();
      setNote({ tone: 'ok', text: msg });
      setHistory((h) => [...h, { at: now(), action: 'saved', detail: label }]);
    } catch (e) {
      setNote({ tone: 'error', text: tr('{what} failed: {why}', { what: label, why: (e as Error).message }) });
    } finally {
      setBusy('');
    }
  };
  const savePng = () =>
    run('PNG', async () => {
      const out = await renderAll(stampOn);
      for (let i = 0; i < out.length; i++) await download(out[i], `${base}${out.length > 1 ? `_${i + 1}` : ''}.png`);
      return out.length > 1 ? tr('Saved {n} pictures to Downloads/Gleaner.', { n: out.length }) : tr('Saved the picture to Downloads/Gleaner.');
    });
  const savePdf = () =>
    run('PDF', async () => {
      await download(await makePdf(), `${base}.pdf`);
      return tr('Saved the PDF to Downloads/Gleaner.');
    });
  // "Check before filing": the exhibit PDF against the mints file rules
  const masked = state.some((s) => s.edits.some((e) => e.kind === 'blackout' || e.kind === 'pixelate' || e.kind === 'blur'));
  const filingName = () => {
    const base = `${maskName && masked ? '（マスキング）' : ''}${ev.number}${ev.title ? ` ${ev.title}` : ''}`.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
    // mints allows 100 characters including ".pdf"
    return `${[...base].slice(0, 96).join('')}.pdf`;
  };
  const runChecks = async (pdf: Blob, name: string) => {
    const facts = await pdfFacts(await loadPdfjs(), new Uint8Array(await pdf.arrayBuffer()), name, masked);
    const list = preflight(facts);
    setChecks({ name, list });
    return list;
  };
  const checkNow = () =>
    run(tr('Check before filing'), async () => {
      const name = filingName();
      const list = await runChecks(await makePdf(ev.number), name);
      const fails = list.filter((c) => c.status === 'fail').length;
      const warns = list.filter((c) => c.status === 'warn').length;
      return fails ? tr('{n} problems to fix before filing.', { n: fails }) : warns ? tr('No problems found; {n} things to look at.', { n: warns }) : tr('No problems found against the mints file rules.');
    });

  const saveRecord = (kind: 'record' | 'evidence-full' | 'evidence-shared') =>
    run(kind === 'record' ? tr('Record ZIP') : kind === 'evidence-full' ? tr('Preservation pack') : tr('Submission pack'), async () => {
      const evidence = kind === 'record' ? undefined : ev;
      const pdf = await makePdf(evidence?.number);
      const pdfName = evidence ? filingName() : undefined;
      const checksNow = evidence ? await runChecks(pdf, pdfName!) : undefined;
      const files = await recordFiles({
        report: rec!.report,
        originals: rec!.parts,
        edited: await renderAll(stampOn),
        pdf,
        pdfName,
        mhtml: withMhtml && kind !== 'evidence-shared' ? rec!.mhtml : undefined,
        sourcePdf: rec!.sourcePdf,
        edits: state.flatMap((s) => s.edits),
        crop: state[0]?.crop ?? null,
        history,
        withoutOriginal: kind === 'evidence-shared',
        evidence,
        preflight: checksNow ? { markdown: preflightMarkdown(checksNow, pdfName!, lang === 'ja'), json: JSON.stringify({ file: pdfName, checkedAt: now(), rules: 'mints 操作マニュアル～当事者ユーザ編～ 2.2版', checks: checksNow }, null, 2) } : undefined,
      });
      let extra = '';
      if (withTimestamp) {
        const target = Object.keys(files).find((p) => p.endsWith('.pdf'))!;
        const sha = await sha256(files[target]);
        const tsr = await requestTimestamp(sha);
        files[`${target}.tsr`] = tsr;
        files['TIMESTAMP-HOW-TO-CHECK.txt'] = `${target}.tsr is a trusted timestamp (RFC 3161) from ${TSA_URL} for SHA-256 ${sha}.\nOnly this fingerprint was sent; the file never left this computer.\n\nTo check it (OpenSSL): download the authority's certificates from https://freetsa.org and run\n  openssl ts -verify -in ${target.split('/').pop()}.tsr -data ${target.split('/').pop()} -CAfile cacert.pem -untrusted tsa.crt\n`;
        extra = tr(' with a trusted timestamp');
      }
      const name = kind === 'record' ? 'record' : kind === 'evidence-full' ? `${slug(ev.number, 20)}_preservation` : `${slug(ev.number, 20)}_submission`;
      await download(new Blob([zip(files) as BlobPart], { type: 'application/zip' }), `${base}_${name}.zip`);
      const issues = checksNow?.filter((c) => c.status === 'fail').length ?? 0;
      const checked = checksNow ? (issues ? tr(' The check found {n} problems to fix before filing.', { n: issues }) : tr(' The check found no problems.')) : '';
      return (kind === 'evidence-shared' ? tr('Saved the submission pack{extra} (edited copy only, no original or page copy).', { extra }) : kind === 'record' ? tr('Saved the record{extra}. It contains the unedited original: keep it private.', { extra }) : tr('Saved the preservation pack{extra}. It contains the unedited original: keep it private.', { extra })) + checked;
    });

  if (rec === undefined) return <div className="m-6 h-[70vh] animate-pulse rounded-xl bg-surface" />;
  if (rec === null)
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <h1 className="font-display text-[20px] font-semibold">{tr('This capture is no longer here')}</h1>
        <p className="mt-2 text-muted">{tr('Gleaner keeps the 10 newest captures for a week. Take a new one from the side panel: Page capture.')}</p>
      </main>
    );

  const strengthTools: Tool[] = ['blur', 'pixelate', 'box', 'arrow'];
  const colorTools: Tool[] = ['box', 'arrow', 'text'];
  const showStrength = strengthTools.includes(tool) || (sel && strengthTools.includes(sel.kind));
  const showColor = colorTools.includes(tool) || (sel && colorTools.includes(sel.kind));
  const edits = cur.edits;
  const crop = cur.crop;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2">
        <span className="flex items-center gap-1.5 font-display text-[15px]"><Spider size={22} className="text-accent-text" />Capture Studio</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted" title={rec.url}>
          {isPdf ? tr('{file}, {n} pages', { file: rec.report.source?.name ?? rec.title, n: rec.parts.length }) : `${rec.title || rec.url} · ${new Date(rec.report.capturedAt).toLocaleString(lang === 'ja' ? 'ja-JP' : undefined)}`}
          {rec.report.stoppedEarly ? tr(' · stopped before the end') : ''}
        </span>
        {rec.parts.length > 1 && (
          <select aria-label={isPdf ? tr('Page') : tr('Picture')} value={part} onChange={(e) => (setPart(Number(e.target.value)), setSelected(null))} className="rounded-lg border border-line bg-bg px-2 py-1.5 text-[12.5px]">
            {rec.parts.map((_, i) => (
              <option key={i} value={i}>
                {tr(isPdf ? 'Page {i} of {n}' : 'Picture {i} of {n}', { i: i + 1, n: rec.parts.length })}
              </option>
            ))}
          </select>
        )}
        <div role="group" aria-label={tr('Language')} className="flex items-center rounded-lg border border-line p-0.5">
          <Translate size={15} className="mx-1 text-muted" aria-hidden />
          {(['en', 'ja'] as const).map((l) => (
            <button key={l} aria-pressed={lang === l} onClick={() => setLang(l)} className={`cursor-pointer rounded-md px-2 py-1 text-[12px] ${lang === l ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink'}`}>
              {l === 'en' ? 'EN' : '日本語'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button className={btn} aria-label={tr('Undo (Ctrl+Z)')} title={tr('Undo (Ctrl+Z)')} disabled={!past.length} onClick={undo}>
            <ArrowCounterClockwise size={16} />
          </button>
          <button className={btn} aria-label={tr('Redo (Ctrl+Shift+Z)')} title={tr('Redo (Ctrl+Shift+Z)')} disabled={!future.length} onClick={redo}>
            <ArrowClockwise size={16} />
          </button>
          <span className="mx-1 h-6 w-px bg-line" />
          <button className={btn} aria-label={tr('Zoom out')} onClick={() => setZoom(Math.max(0.1, (zoom === 'fit' ? scale : zoom) / 1.25))}>
            <MagnifyingGlassMinus size={16} />
          </button>
          <button className={btn} onClick={() => setZoom(zoom === 'fit' ? 1 : 'fit')} title={tr('Fit width or actual size')}>
            {zoom === 'fit' ? tr('Fit') : `${Math.round(scale * 100)}%`}
          </button>
          <button className={btn} aria-label={tr('Zoom in')} onClick={() => setZoom(Math.min(4, (zoom === 'fit' ? scale : zoom) * 1.25))}>
            <MagnifyingGlassPlus size={16} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Tools */}
        <nav aria-label={tr('Tools')} className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-2">
          {/* A PDF page keeps its size, so cropping is left out */}
          {TOOLS.filter((t) => !(isPdf && t.id === 'crop')).map((t) => (
            <button
              key={t.id}
              aria-label={`${tr(t.label)} (${t.key})`}
              title={`${tr(t.label)} (${t.key})`}
              aria-pressed={tool === t.id}
              onClick={() => (setTool(t.id), t.id !== 'select' && setSelected(null))}
              className={`flex size-10 cursor-pointer items-center justify-center rounded-lg transition ${tool === t.id ? 'bg-accent text-accent-ink' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}
            >
              <t.Icon size={19} weight={t.id === 'blackout' ? 'fill' : 'regular'} />
            </button>
          ))}
        </nav>

        {/* Picture */}
        <div ref={stage} className="relative min-w-0 flex-1 overflow-auto bg-bg p-6">
          {size && urls[part] && (
            <div className="relative mx-auto shadow-[0_8px_40px_rgb(0_0_0/0.35)]" style={{ width: size.w * scale, height: size.h * scale }}>
              <img src={urls[part]} alt={tr('The captured page')} draggable={false} className="absolute inset-0 h-full w-full select-none" />
              <svg
                viewBox={`0 0 ${size.w} ${size.h}`}
                className={`absolute inset-0 h-full w-full touch-none ${tool === 'select' ? 'cursor-default' : tool === 'text' ? 'cursor-text' : 'cursor-crosshair'}`}
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                role="application"
                aria-label={tr('Drawing area')}
              >
                <defs>
                  {[1, 2, 3].map((s) => (
                    <filter key={s} id={`blur${s}`} x="-10%" y="-10%" width="120%" height="120%">
                      <feGaussianBlur stdDeviation={[0, 6, 14, 28][s]} />
                    </filter>
                  ))}
                  <pattern id="pix" width="16" height="16" patternUnits="userSpaceOnUse">
                    <rect width="16" height="16" fill="#8c95a3" />
                    <rect width="8" height="8" fill="#5a6372" />
                    <rect x="8" y="8" width="8" height="8" fill="#5a6372" />
                  </pattern>
                  {[...edits, ...(draft && 'kind' in draft ? [draft] : [])].filter((e) => e.kind === 'blur').map((e) => (
                    <clipPath key={e.id} id={`c${e.id}`}>
                      <rect {...norm(e)} width={norm(e).w} height={norm(e).h} />
                    </clipPath>
                  ))}
                </defs>
                {[...edits, ...(draft && 'kind' in draft ? [draft] : [])].map((e) => {
                  const b = norm(e);
                  const isSel = e.id === selected;
                  const outline = isSel ? <rect x={b.x - 3} y={b.y - 3} width={b.w + 6} height={b.h + 6} fill="none" stroke="#e3b04b" strokeWidth={2 / scale} strokeDasharray={`${6 / scale} ${4 / scale}`} /> : null;
                  const handle = isSel && e.kind !== 'arrow' ? <rect x={b.x + b.w - 5 / scale} y={b.y + b.h - 5 / scale} width={10 / scale} height={10 / scale} fill="#e3b04b" /> : null;
                  if (e.kind === 'blur')
                    return (
                      <g key={e.id}>
                        <image href={urls[part]} width={size.w} height={size.h} clipPath={`url(#c${e.id})`} filter={`url(#blur${e.strength ?? 2})`} />
                        {outline}
                        {handle}
                      </g>
                    );
                  if (e.kind === 'pixelate')
                    return (
                      <g key={e.id}>
                        <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="url(#pix)" opacity={0.92} />
                        {outline}
                        {handle}
                      </g>
                    );
                  if (e.kind === 'blackout')
                    return (
                      <g key={e.id}>
                        <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="#000" />
                        {outline}
                        {handle}
                      </g>
                    );
                  if (e.kind === 'highlight')
                    return (
                      <g key={e.id}>
                        <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={e.color} style={{ mixBlendMode: 'multiply' }} />
                        {outline}
                        {handle}
                      </g>
                    );
                  if (e.kind === 'box')
                    return (
                      <g key={e.id}>
                        <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke={e.color} strokeWidth={(e.strength ?? 2) * 2} />
                        {outline}
                        {handle}
                      </g>
                    );
                  if (e.kind === 'arrow') {
                    const x2 = e.x2 ?? e.x;
                    const y2 = e.y2 ?? e.y;
                    const w = (e.strength ?? 2) * 2;
                    const a = Math.atan2(y2 - e.y, x2 - e.x);
                    const hd = Math.max(14, w * 4.5);
                    return (
                      <g key={e.id}>
                        <line x1={e.x} y1={e.y} x2={x2 - Math.cos(a) * hd * 0.8} y2={y2 - Math.sin(a) * hd * 0.8} stroke={e.color} strokeWidth={w} strokeLinecap="round" />
                        <polygon points={`${x2},${y2} ${x2 - hd * Math.cos(a - Math.PI / 7)},${y2 - hd * Math.sin(a - Math.PI / 7)} ${x2 - hd * Math.cos(a + Math.PI / 7)},${y2 - hd * Math.sin(a + Math.PI / 7)}`} fill={e.color} />
                        {isSel && <line x1={e.x} y1={e.y} x2={x2} y2={y2} stroke="#e3b04b" strokeWidth={w + 8 / scale} opacity={0.35} />}
                      </g>
                    );
                  }
                  if (e.kind === 'text') {
                    const lines = (e.text ?? '').split('\n');
                    const s = e.size ?? 24;
                    const w = Math.max(...lines.map((l) => l.length)) * s * 0.56;
                    return (
                      <g key={e.id}>
                        <rect x={e.x - s * 0.25} y={e.y - s * 0.15} width={w + s * 0.5} height={lines.length * s * 1.25 + s * 0.2} fill="rgba(255,255,255,0.86)" />
                        {lines.map((l, i) => (
                          <text key={i} x={e.x} y={e.y + i * s * 1.25 + s * 0.85} fontSize={s} fontWeight={600} fill={e.color} style={{ fontFamily: '"Geist Variable", system-ui, sans-serif' }}>
                            {l}
                          </text>
                        ))}
                        {isSel && <rect x={e.x - s * 0.3} y={e.y - s * 0.2} width={w + s * 0.6} height={lines.length * s * 1.25 + s * 0.3} fill="none" stroke="#e3b04b" strokeWidth={2 / scale} strokeDasharray={`${6 / scale} ${4 / scale}`} />}
                      </g>
                    );
                  }
                  return null;
                })}
                {/* Crop: dim what will be cut away */}
                {(crop || (draft && !('kind' in draft))) && (() => {
                  const c = norm((draft && !('kind' in draft) ? draft : crop) as Crop);
                  return (
                    <g pointerEvents="none">
                      <path d={`M0 0H${size.w}V${size.h}H0Z M${c.x} ${c.y}V${c.y + c.h}H${c.x + c.w}V${c.y}Z`} fill="rgba(15,19,25,0.62)" fillRule="evenodd" />
                      <rect x={c.x} y={c.y} width={c.w} height={c.h} fill="none" stroke="#e3b04b" strokeWidth={2 / scale} />
                    </g>
                  );
                })()}
              </svg>
            </div>
          )}
        </div>

        {/* Settings and saving */}
        <aside className="flex w-[310px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-surface p-4">
          <section className="flex flex-col gap-2.5">
            <h2 className="font-display text-[14px] font-semibold">{sel ? tr(NAMES[sel.kind]) : tr(TOOLS.find((t) => t.id === tool)?.label ?? '')}</h2>
            {tool === 'blackout' && !sel && <p className="text-[12px] text-muted">{tr('Solid black: the only way to hide a secret for sure. Blur and pixelate can sometimes be read back.')}</p>}
            {tool === 'crop' && (
              <p className="text-[12px] text-muted">
                {tr('Drag over the part to keep.')}{' '}
                {crop && (
                  <button className="ml-1 cursor-pointer text-accent-text underline" onClick={() => commit({ ...cur, crop: null }, 'removed crop')}>
                    {tr('Remove crop')}
                  </button>
                )}
              </p>
            )}
            {tool === 'select' && !sel && <p className="text-[12px] text-muted">{tr('Click a mark to change it. Drag to move, the corner square to resize, arrow keys to nudge, Delete to remove.')}</p>}
            {showStrength && (
              <div role="group" aria-label={sel?.kind === 'box' || sel?.kind === 'arrow' || tool === 'box' || tool === 'arrow' ? tr('Line width') : tr('Strength')} className="flex rounded-lg border border-line p-0.5">
                {[1, 2, 3].map((s) => {
                  const on = (sel?.strength ?? strength) === s;
                  return (
                    <button key={s} aria-pressed={on} onClick={() => (sel ? updateSel({ strength: s }) : setStrength(s))} className={`flex-1 cursor-pointer rounded-md py-1 text-[12px] ${on ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink'}`}>
                      {tr(['Light', 'Medium', 'Strong'][s - 1])}
                    </button>
                  );
                })}
              </div>
            )}
            {(showColor || tool === 'highlight' || sel?.kind === 'highlight') && (
              <div className="flex gap-1.5" role="group" aria-label={tr('Colour')}>
                {(tool === 'highlight' || sel?.kind === 'highlight' ? HIGHLIGHTS : COLORS).map((c) => (
                  <button key={c} aria-label={`${tr('Colour')} ${c}`} aria-pressed={(sel?.color ?? color) === c} onClick={() => (sel ? updateSel({ color: c }) : setColor(c))} className={`size-7 cursor-pointer rounded-full border-2 ${(sel?.color ?? color) === c ? 'border-accent' : 'border-line'}`} style={{ background: c }} />
                ))}
              </div>
            )}
            {sel?.kind === 'text' && (
              <>
                <label htmlFor="edit-text" className="text-[12px] font-medium">
                  {tr('Words')}
                </label>
                <textarea id="edit-text" rows={3} className={input} defaultValue={sel.text} key={sel.id} onBlur={(e) => e.target.value !== sel.text && updateSel({ text: e.target.value }, 'edited text')} />
                <label className="flex items-center gap-2 text-[12px]">
                  {tr('Size')}
                  <input type="range" min={12} max={96} value={sel.size ?? 24} onChange={(e) => setState((s) => s.map((x, i) => (i === part ? { ...x, edits: x.edits.map((ed) => (ed.id === sel.id ? { ...ed, size: Number(e.target.value) } : ed)) } : x)))} onPointerUp={() => setHistory((h) => [...h, { at: now(), action: 'resized', detail: 'Text' }])} className="flex-1 accent-[var(--accent)]" />
                  <span className="w-8 text-right font-mono tabular-nums">{sel.size ?? 24}</span>
                </label>
              </>
            )}
            {tool === 'text' && !sel && (
              <label className="flex items-center gap-2 text-[12px]">
                {tr('Size')}
                <input type="range" min={12} max={96} value={textSize} onChange={(e) => setTextSize(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" />
                <span className="w-8 text-right font-mono tabular-nums">{textSize}</span>
              </label>
            )}
            {sel && (
              <button className={`${btn} self-start`} onClick={removeSel}>
                <Trash size={15} aria-hidden /> {tr('Remove')}
              </button>
            )}
          </section>

          <section className="flex flex-col gap-2 border-t border-line pt-4">
            <h2 className="font-display text-[14px] font-semibold">{tr('Save')}</h2>
            {isPdf ? (
              <p className="text-[11.5px] leading-snug text-muted">{tr('Each page keeps its size. Saved PDFs get page numbers; exhibit packs also get the exhibit label.')}</p>
            ) : (
              <label className="flex items-center gap-2 text-[12.5px]">
                <input type="checkbox" checked={stampOn} onChange={(e) => setStampOn(e.target.checked)} className="accent-[var(--accent)]" />
                {tr('Add the address and capture time')}
              </label>
            )}
            {!isPdf && (
              <button className={primary} onClick={savePng} disabled={!!busy}>
                <DownloadSimple size={16} aria-hidden /> {busy === 'PNG' ? tr('Saving…') : tr('Save picture (PNG)')}
              </button>
            )}
            <button className={isPdf ? primary : btn} onClick={savePdf} disabled={!!busy}>
              <FilePdf size={16} aria-hidden /> {busy === 'PDF' ? tr('Making the PDF…') : isPdf ? tr('Save PDF') : tr('Save A4 PDF')}
            </button>
            <button className={btn} onClick={() => saveRecord('record')} disabled={!!busy}>
              <FileZip size={16} aria-hidden /> {busy === tr('Record ZIP') ? tr('Packing…') : tr('Save record ZIP')}
            </button>
            <p className="text-[11.5px] leading-snug text-muted">{tr('The record keeps the untouched original apart from your edited copy, with the edit history, a capture report and SHA-256 fingerprints of every file.')}</p>
            {rec.mhtml && (
              <label className="flex items-center gap-2 text-[12.5px]">
                <input type="checkbox" checked={withMhtml} onChange={(e) => setWithMhtml(e.target.checked)} className="accent-[var(--accent)]" />
                {tr('Include the page itself (MHTML)')}
              </label>
            )}
            <label className="flex items-start gap-2 text-[12.5px]">
              <input type="checkbox" checked={withTimestamp} onChange={(e) => setWithTimestamp(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
              <span>
                <Clock size={13} className="mr-1 inline" aria-hidden />
                {tr("Add a trusted timestamp. Sends only the PDF's fingerprint to freetsa.org, never the file.")}
              </span>
            </label>
            {note && (
              <p role={note.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-2.5 py-2 text-[12px] ${note.tone === 'error' ? 'border-danger/40 text-danger' : 'border-line text-ok'}`}>
                {note.text}
              </p>
            )}
          </section>

          <section className="flex flex-col gap-2 border-t border-line pt-4">
            <button className="flex cursor-pointer items-center justify-between text-left" aria-expanded={showEvidence} onClick={() => setShowEvidence((v) => !v)}>
              <span className="flex items-center gap-2 font-display text-[14px] font-semibold">
                <Scales size={16} className="text-accent-text" aria-hidden /> {tr('Evidence pack')}
              </span>
              {showEvidence ? <X size={14} aria-label={tr('Hide')} /> : <span className="text-[12px] text-muted">{tr('Show')}</span>}
            </button>
            {showEvidence && (
              <>
                <p className="text-[11.5px] leading-snug text-muted">{tr("A PDF with the exhibit label on every page, a draft evidence list (CSV for Excel), and the record. Gleaner does not judge whether it meets a court's rules: check before filing.")}</p>
                {(
                  [
                    ['number', 'Exhibit number', 'Exhibit 1, 甲第1号証…'],
                    ['title', 'Title', 'e.g. Product page as of today'],
                    ['createdOn', 'Created on', ''],
                    ['author', 'Author', 'Who published the page'],
                    ['purpose', 'What it shows', 'The point this exhibit proves'],
                    ['notes', 'Notes', ''],
                  ] as const
                ).map(([k, label, ph]) => (
                  <label key={k} className="flex flex-col gap-1 text-[12px] font-medium">
                    {tr(label)}
                    <input className={input} value={ev[k]} placeholder={ph ? tr(ph) : ''} type={k === 'createdOn' ? 'date' : 'text'} onChange={(e) => setEv({ ...ev, [k]: e.target.value })} />
                  </label>
                ))}
                <div className="flex flex-wrap gap-1.5">
                  {['Exhibit 1', '甲第1号証', '乙第1号証'].map((p) => (
                    <button key={p} className="cursor-pointer rounded-md border border-line px-2 py-0.5 text-[11.5px] text-muted hover:text-ink" onClick={() => setEv({ ...ev, number: p })}>
                      {p}
                    </button>
                  ))}
                </div>
                {masked && (
                  <label className="flex items-start gap-2 text-[12px]">
                    <input type="checkbox" checked={maskName} onChange={(e) => setMaskName(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
                    <span>{tr('Name it as a masked copy: （マスキング） at the start, as the court asks for access-restriction filings')}</span>
                  </label>
                )}
                <p className="truncate rounded-md bg-surface-2 px-2 py-1 font-mono text-[11px] text-muted" title={filingName()}>
                  {filingName()}
                </p>
                <button className={btn} onClick={checkNow} disabled={!!busy || !ev.number}>
                  <ListChecks size={16} aria-hidden /> {busy === tr('Check before filing') ? tr('Checking…') : tr('Check before filing (mints)')}
                </button>
                {checks && (
                  <ul className="flex flex-col gap-1.5" aria-label={tr('Check results')}>
                    {checks.list.map((c) => {
                      const Icon = c.status === 'pass' ? CheckCircle : c.status === 'fail' ? XCircle : c.status === 'warn' ? WarningCircle : Info;
                      const color = c.status === 'pass' ? 'text-ok' : c.status === 'fail' ? 'text-danger' : c.status === 'warn' ? 'text-accent-text' : 'text-muted';
                      return (
                        <li key={c.id} className="flex gap-2 text-[12px] leading-snug">
                          <Icon size={16} weight="fill" className={`mt-px shrink-0 ${color}`} aria-label={c.status} />
                          <span>
                            <span className="font-medium">{lang === 'ja' ? c.labelJa : c.label}</span>: {lang === 'ja' ? c.detailJa : c.detail}
                            <span className="block text-[10.5px] text-muted">{c.source}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <button className={primary} onClick={() => saveRecord('evidence-full')} disabled={!!busy || !ev.number}>
                  {busy === tr('Preservation pack') ? tr('Packing…') : tr('Save preservation pack (keep)')}
                </button>
                <button className={btn} onClick={() => saveRecord('evidence-shared')} disabled={!!busy || !ev.number}>
                  {busy === tr('Submission pack') ? tr('Packing…') : tr('Save submission pack (to share)')}
                </button>
                <p className="text-[11.5px] leading-snug text-muted">{tr('Preservation: with the untouched original and the page itself. Submission: the edited copy only, for handing to others after blacking out. Both include the check results.')}</p>
              </>
            )}
          </section>

          <section className="mt-auto flex flex-col gap-1 border-t border-line pt-4 text-[12px] text-muted">
            <span>{tr('{marks} marks{crop} · {steps} steps in the history', { marks: edits.length, crop: crop ? tr(', cropped') : '', steps: history.length })}</span>
          </section>
        </aside>
      </div>
    </div>
  );
}
