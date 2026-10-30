// Page capture: turn the open page into files for the next job. Text and pictures for AI tools,
// the page's structure and calls to action, its design system, a single component, a quote with
// its source, a bundled reference pack, and screenshots (visible, full page, A4 PDF) that open in
// Capture Studio for crop, redaction and notes, with record and evidence packs.
import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { Camera, CheckSquare, Cube, FilePdf, FileText, Files, Layout, Palette, Quotes, Square, Stop, Translate, TreeStructure, Trash } from '@phosphor-icons/react';
import { deleteCapture, listCaptures, newDataset, saveCapture, saveDataset, listDatasets, getDataset, type CaptureRecord } from '@/lib/db';
import { htmlToMarkdown } from '@/lib/convert';
import type { ComponentGrab, DesignSpec, PageForAi, PageStructure, Quote } from '@/lib/capture/page';
import { componentHtml, componentJson, designCss, designJson, designMarkdown, designTailwind, quoteMarkdown, sha256Sums, slug, stamp, structureMarkdown, zip, type FileMap } from '@/lib/capture/formats';
import { captureArea, captureFullPage, captureMhtml, captureVisible, type CaptureProgress } from '@/lib/capture/shot';
import { activeTab, call, isRestricted, requestHostAccess } from '@/lib/tab';
import { pdfToCapture } from '@/lib/capture/pdffile';
import { useLang } from '@/lib/capture/i18n';
import { logEvent } from '@/lib/report';
import { ReportProblem } from '../ReportProblem';
import { useNav } from '../nav';
import { Button, Notice, Section } from '../ui';
import { errorText } from './common';

type Action = 'ai' | 'structure' | 'design' | 'component' | 'quote' | 'pack';
const ACTIONS: { id: Action; title: string; blurb: string; saves: string; Icon: typeof Camera }[] = [
  { id: 'ai', title: 'Text and pictures for AI', blurb: 'Articles, posts (X threads too) and landing-page copy as clean Markdown, with the pictures in a folder.', saves: 'Markdown + pictures (ZIP)', Icon: FileText },
  { id: 'structure', title: 'Page structure and calls to action', blurb: 'Section order, headings, every button and where it leads, forms, links, and things worth fixing.', saves: 'Report (Markdown + JSON), buttons to Data', Icon: TreeStructure },
  { id: 'design', title: 'Design specification', blurb: 'Colours by role, type scale, spacing unit, corners, shadows, widths and breakpoints.', saves: 'CSS variables, design tokens JSON, Tailwind config', Icon: Palette },
  { id: 'component', title: 'One component', blurb: 'Point at a button, card or section and keep its HTML with the styles that make it look that way.', saves: 'HTML + CSS + preview picture + JSON', Icon: Cube },
  { id: 'quote', title: 'Selected text with its source', blurb: 'Select text on the page first. Keeps the exact words, the sentences around them, the page, time and a link that jumps to it.', saves: 'Markdown, copied, and added to your Quotes', Icon: Quotes },
];

async function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  try {
    await browser.downloads.download({ url, filename, conflictAction: 'uniquify' });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }
}
const zipBlob = (files: FileMap) => new Blob([zip(files) as BlobPart], { type: 'application/zip' });
const extOf = (type: string, url: string) => (type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : type.includes('gif') ? 'gif' : type.includes('svg') ? 'svg' : type.includes('avif') ? 'avif' : /\.(png|webp|gif|svg|avif)(\?|$)/i.exec(url)?.[1]?.toLowerCase() ?? 'jpg');

/** Pictures from the page into an images/ folder; protected ones are loaded through the tab. */
async function fetchImages(tabId: number, srcs: string[], max = 40): Promise<{ files: FileMap; map: Map<string, string> }> {
  const files: FileMap = {};
  const map = new Map<string, string>();
  let n = 0;
  for (const src of srcs.slice(0, max)) {
    let blob: Blob | null = null;
    try {
      const r = await fetch(src, { credentials: 'include' });
      if (r.ok) blob = await r.blob();
    } catch {
      /* try through the page below */
    }
    if (!blob) blob = await call<string>(tabId, 'fetchAsDataUrl', src).then((d) => fetch(d).then((r) => r.blob())).catch(() => null);
    if (!blob || blob.size < 100) continue;
    const name = `images/${String(++n).padStart(2, '0')}.${extOf(blob.type, src)}`;
    files[name] = new Uint8Array(await blob.arrayBuffer());
    map.set(src, name);
  }
  return { files, map };
}

function postMarkdown(p: PageForAi): string {
  const post = p.post!;
  const L = [`# Post by ${post.author} ${post.handle}`.trim(), '', `- Address: ${p.url}`, post.time ? `- Posted: ${post.time}` : '', `- Captured: ${p.capturedAt}`, '', post.text, ''];
  for (const img of post.images) L.push(`![](${img})`);
  if (post.replies.length) {
    L.push('', '## Replies', '');
    for (const r of post.replies) L.push(`**${r.author}**`, '', r.text, '');
  }
  return L.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

function pageMarkdown(p: PageForAi): string {
  if (p.post) return postMarkdown(p);
  const { markdown } = htmlToMarkdown(p.html, { mainOnly: true, baseUrl: p.url });
  return `${markdown}\n\n---\nSource: ${p.url}\nCaptured: ${p.capturedAt}\n`;
}

/** Pictures the Markdown refers to, swapped for the local copies. */
function localize(md: string, map: Map<string, string>): string {
  return md.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => (map.has(url) ? `![${alt}](${map.get(url)})` : m));
}

export function PageCapture() {
  const nav = useNav();
  const { lang, setLang, tr } = useLang();
  const pdfInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string>('');
  const [note, setNote] = useState<{ tone: 'info' | 'error'; text: string; dataset?: string } | null>(null);
  const [packParts, setPackParts] = useState({ structure: true, design: true, images: true, screenshot: false });
  const [stampOn, setStampOn] = useState(true);
  const [withMhtml, setWithMhtml] = useState(true);
  const [progress, setProgress] = useState<CaptureProgress | null>(null);
  const stopRef = useRef(false);
  const [recent, setRecent] = useState<Awaited<ReturnType<typeof listCaptures>>>([]);
  const refresh = () => listCaptures().then(setRecent).catch(() => setRecent([]));
  useEffect(() => void refresh(), []);

  const page = async () => {
    if (!(await requestHostAccess())) throw new Error(tr('Gleaner needs access to sites to read this page. Click again and choose Allow.'));
    const tab = await activeTab();
    if (isRestricted(tab.url)) throw new Error(tr('Open a normal web page first (browser pages and the web store cannot be read).'));
    return { id: tab.id!, url: tab.url ?? '', title: tab.title ?? '' };
  };
  const run = async (label: string, fn: () => Promise<string | { text: string; dataset?: string }>) => {
    setBusy(label);
    setNote(null);
    try {
      logEvent('capture', `Started: ${label}`);
      const r = await fn();
      logEvent('capture', `Finished ${label}: ${typeof r === 'string' ? r : r.text}`);
      setNote(typeof r === 'string' ? { tone: 'info', text: r } : { tone: 'info', ...r });
    } catch (e) {
      logEvent('capture', `Failed ${label}: ${errorText(e)}`);
      setNote({ tone: 'error', text: errorText(e) });
    } finally {
      setBusy('');
      setProgress(null);
    }
  };
  const name = (t: { title: string; url: string }, kind: string) => `Gleaner/${slug(t.title || t.url, 50)}_${stamp()}_${kind}`;

  const forAi = () =>
    run('ai', async () => {
      const t = await page();
      const p = await call<PageForAi>(t.id, 'pageForAi');
      let md = pageMarkdown(p);
      const srcs = [...new Set([...(p.post?.images ?? []), ...[...md.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]), ...p.images.map((i) => i.src)])].filter((s) => /^https?:/.test(s));
      const { files, map } = await fetchImages(t.id, srcs);
      md = localize(md, map);
      const unused = [...map.entries()].filter(([src]) => !md.includes(map.get(src)!));
      if (unused.length) md += `\n## More pictures on the page\n\n${unused.map(([src, local]) => `![${p.images.find((i) => i.src === src)?.alt ?? ''}](${local})`).join('\n')}\n`;
      files['page.md'] = md;
      files['source.json'] = JSON.stringify({ url: p.url, title: p.title, kind: p.kind, capturedAt: p.capturedAt, images: Object.fromEntries([...map].map(([src, local]) => [local, src])) }, null, 2);
      await navigator.clipboard.writeText(md).catch(() => {});
      await download(zipBlob(files), `${name(t, 'for-ai')}.zip`);
      return tr('Saved page.md with {n} pictures (ZIP), and copied the Markdown.', { n: map.size });
    });

  const structure = () =>
    run('structure', async () => {
      const t = await page();
      const s = await call<PageStructure>(t.id, 'pageStructure');
      const files: FileMap = { 'structure.md': structureMarkdown(s), 'structure.json': JSON.stringify(s, null, 2) };
      await download(zipBlob(files), `${name(t, 'structure')}.zip`);
      const rows = s.ctas.map((c) => ({ label: c.label, kind: c.kind, where: c.place, times_shown: String(c.count), link: c.href, colour: c.color, background: c.background, font_size: c.fontSize, font_weight: c.fontWeight, corner_radius: c.radius, from_top: `${c.top}px` }));
      const ds = await saveDataset(newDataset('structure', `Calls to action ${new URL(s.url).hostname}`, s.url, Object.keys(rows[0] ?? { label: 1 }).map((k) => ({ key: k, label: k.replace(/_/g, ' ') })), rows));
      return { text: tr('Saved the structure report: {n} sections ({kinds}), {c} calls to action{notes}.', { n: s.sections.length, kinds: [...new Set(s.sections.map((x) => x.kind))].slice(0, 6).join(', '), c: s.ctas.length, notes: s.notes.length ? tr(', {n} things worth a look', { n: s.notes.length }) : '' }), dataset: ds.id };
    });

  const design = () =>
    run('design', async () => {
      const t = await page();
      const d = await call<DesignSpec>(t.id, 'designSpec');
      await download(zipBlob({ 'design.md': designMarkdown(d), 'tokens.css': designCss(d), 'tokens.json': designJson(d), 'tailwind.config.js': designTailwind(d) }), `${name(t, 'design')}.zip`);
      return tr('Saved the design spec: {c} colours, {t} type styles, {s}px spacing unit, {r} corner sizes.', { c: d.colors.length, t: d.type.length, s: d.spacing.base, r: d.radii.length });
    });

  const component = () =>
    run('component', async () => {
      const t = await page();
      await browser.tabs.update(t.id, { active: true });
      setNote({ tone: 'info', text: tr('Point at the part you want on the page. ↑ and ↓ make the box bigger or smaller; click or Enter to take it.') });
      const c = await call<ComponentGrab | null>(t.id, 'pickComponent');
      if (!c) return tr('Cancelled.');
      // The element itself, measured again at the moment of capture
      const preview = await captureArea(t.id, c.rect, c.selector).catch(() => null);
      const files: FileMap = { 'component.html': componentHtml(c), 'component.css': c.css, 'component.json': componentJson(c), 'component-raw.html': c.html };
      if (preview) files['preview.png'] = new Uint8Array(await preview.arrayBuffer());
      await download(zipBlob(files), `${name(t, `component-${c.tag}`)}.zip`);
      return tr('Saved the {tag} ({w}×{h}) with {n} style rules{preview}. Open component.html to see it on its own.', { tag: c.tag, w: c.width, h: c.height, n: c.css.split('\n}').length - 1, preview: preview ? tr(' and a preview picture') : '' });
    });

  const quote = () =>
    run('quote', async () => {
      const t = await page();
      const q = await call<Quote | null>(t.id, 'selectedQuote');
      if (!q) throw new Error(tr('Select some text on the page first, then click this again.'));
      const md = quoteMarkdown(q);
      await navigator.clipboard.writeText(md).catch(() => {});
      await download(new Blob([md], { type: 'text/markdown' }), `${name(t, 'quote')}.md`);
      // Collect quotes in one dataset, so a research session ends with one table
      const row = { text: q.text, before: q.before, after: q.after, section: q.heading, page: q.title, url: q.url, link_to_text: q.linkToText, author: q.author, published: q.published, site: q.site, captured: q.capturedAt };
      const all = await listDatasets();
      const existing = all.find((d) => d.tool === 'quotes');
      const cols = Object.keys(row).map((k) => ({ key: k, label: k.replace(/_/g, ' ') }));
      const ds = existing ? await getDataset(existing.id) : null;
      const saved = ds ? await saveDataset({ ...ds, rows: [...ds.rows, row] }) : await saveDataset(newDataset('quotes', 'Quotes', q.url, cols, [row]));
      return { text: tr('Copied the quote with its source, saved it as Markdown, and added it to Quotes ({n}).', { n: saved.rows.length }), dataset: saved.id };
    });

  const pack = () =>
    run('pack', async () => {
      const t = await page();
      const p = await call<PageForAi>(t.id, 'pageForAi');
      let md = pageMarkdown(p);
      const files: FileMap = {};
      let pics = 0;
      if (packParts.images) {
        const srcs = [...new Set([...[...md.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]), ...p.images.map((i) => i.src)])];
        const got = await fetchImages(t.id, srcs, 30);
        Object.assign(files, got.files);
        md = localize(md, got.map);
        pics = got.map.size;
      }
      files['page.md'] = md;
      const order = ['1. **START-HERE.md** (this file)', '2. **page.md**: the page text, with pictures linked from images/'];
      if (packParts.structure) {
        const s = await call<PageStructure>(t.id, 'pageStructure');
        files['structure.md'] = structureMarkdown(s);
        files['structure.json'] = JSON.stringify(s, null, 2);
        order.push(`${order.length + 1}. **structure.md**: section order, headings, calls to action`);
      }
      if (packParts.design) {
        const d = await call<DesignSpec>(t.id, 'designSpec');
        files['design.md'] = designMarkdown(d);
        files['tokens.css'] = designCss(d);
        files['tokens.json'] = designJson(d);
        order.push(`${order.length + 1}. **design.md**: colours, type, spacing (tokens.css / tokens.json for code)`);
      }
      if (packParts.screenshot) {
        const shot = await captureFullPage(t.id, { onProgress: setProgress, shouldStop: () => stopRef.current });
        for (let i = 0; i < shot.parts.length; i++) files[`screenshot${shot.parts.length > 1 ? `-${i + 1}` : ''}.png`] = new Uint8Array(await shot.parts[i].arrayBuffer());
        order.push(`${order.length + 1}. **screenshot.png**: the whole page as a picture`);
      }
      if (pics) order.push(`${order.length + 1}. **images/**: ${pics} pictures from the page`);
      files['source.json'] = JSON.stringify({ url: p.url, title: p.title, capturedAt: p.capturedAt }, null, 2);
      files['START-HERE.md'] = `# Reference pack: ${p.title || p.url}\n\nSource: ${p.url}\nCaptured: ${p.capturedAt}\n\nRead in this order:\n\n${order.join('\n')}\n\nThe text is unedited from the page. Check it before sharing.\n`;
      files['SHA256SUMS.txt'] = await sha256Sums(files);
      await download(zipBlob(files), `${name(t, 'reference-pack')}.zip`);
      return tr('Saved the reference pack ({n} files). Point your AI tool at START-HERE.md.', { n: Object.keys(files).length });
    });

  const capture = (mode: 'visible' | 'full' | 'pdf') =>
    run(mode, async () => {
      const t = await page();
      stopRef.current = false;
      const shot = mode === 'visible' ? await captureVisible(t.id) : await captureFullPage(t.id, { onProgress: setProgress, shouldStop: () => stopRef.current });
      const mhtml = withMhtml ? await captureMhtml(t.id).catch(() => undefined) : undefined;
      const rec: CaptureRecord = { id: crypto.randomUUID(), createdAt: Date.now(), url: shot.report.url, title: shot.report.title, parts: shot.parts, report: shot.report, mhtml, intent: mode === 'pdf' ? 'pdf' : 'png', edits: { parts: shot.parts.map(() => ({ edits: [], crop: null })), history: [{ at: shot.report.capturedAt, action: 'captured', detail: shot.report.mode }], stampOn } };
      await saveCapture(rec);
      await browser.tabs.create({ url: browser.runtime.getURL(`/studio.html?id=${rec.id}` as any) });
      refresh();
      const r = shot.report;
      return tr('Opened in Capture Studio: {w}×{h}{parts}{end}.', { w: r.pageSize.width, h: r.pageSize.height, parts: r.parts.length > 1 ? tr(' in {n} pictures', { n: r.parts.length }) : '', end: r.mode === 'full page' ? (r.stoppedEarly ? tr(', stopped before the end') : r.reachedBottom ? tr(', whole page') : '') : '' });
    });

  // An existing PDF, opened in the Studio for black-out, notes, exhibit labels and the filing check
  const finishPdf = (file: File) =>
    run('pdf-file', async () => {
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error(tr('Choose a PDF file.'));
      setProgress({ phase: 'loading', done: 0, seconds: 0, detail: '' });
      const t0 = Date.now();
      const rec = await pdfToCapture(file, (d, n) => setProgress({ phase: 'capturing', done: d / n, seconds: (Date.now() - t0) / 1000, detail: tr('Drawing page {d} of {n}', { d, n }) }));
      await saveCapture(rec);
      await browser.tabs.create({ url: browser.runtime.getURL(`/studio.html?id=${rec.id}` as any) });
      refresh();
      return tr('Opened {file} ({n} pages) in Capture Studio.', { file: file.name, n: rec.parts.length });
    });

  const doAction: Record<Action, () => void> = { ai: forAi, structure, design, component, quote, pack };
  const Box = ({ on }: { on: boolean }) => (on ? <CheckSquare size={15} weight="fill" className="text-accent-text" /> : <Square size={15} className="text-muted" />);

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div role="group" aria-label={tr('Language')} className="-mb-2 mt-3 flex items-center gap-1 self-end rounded-lg border border-line p-0.5">
        <Translate size={14} className="mx-1 text-muted" aria-hidden />
        {(['en', 'ja'] as const).map((l) => (
          <button key={l} aria-pressed={lang === l} onClick={() => setLang(l)} className={`cursor-pointer rounded-md px-2 py-0.5 text-[12px] ${lang === l ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink'}`}>
            {l === 'en' ? 'EN' : '日本語'}
          </button>
        ))}
      </div>
      <Section title={tr('Use this page for')}>
        <ul className="flex flex-col gap-2">
          {ACTIONS.map((a) => (
            <li key={a.id}>
              <button disabled={!!busy} onClick={doAction[a.id]} className="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface p-3 text-left transition hover:border-accent/50 disabled:cursor-wait disabled:opacity-60">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text" aria-hidden>
                  <a.Icon size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold">{busy === a.id ? `${tr(a.title)}…` : tr(a.title)}</span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-muted">{tr(a.blurb)}</span>
                  <span className="mt-1 block text-[11px] text-muted/90">{tr('Saves: {what}', { what: tr(a.saves) })}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text" aria-hidden>
              <Files size={18} />
            </span>
            <span>
              <span className="block text-[13.5px] font-semibold">{tr('Reference pack for AI')}</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-muted">{tr('The page text plus what you tick, with a START-HERE file that says what to read first.')}</span>
            </span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 pl-12 text-[12px]">
            {(
              [
                ['structure', 'Structure'],
                ['design', 'Design spec'],
                ['images', 'Pictures'],
                ['screenshot', 'Full-page picture'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" role="checkbox" aria-checked={packParts[k]} onClick={() => setPackParts((p) => ({ ...p, [k]: !p[k] }))} className="flex cursor-pointer items-center gap-1.5">
                <Box on={packParts[k]} /> {tr(label)}
              </button>
            ))}
          </div>
          <Button variant="primary" className="ml-12 self-start" disabled={!!busy} onClick={pack}>
            {busy === 'pack' ? tr('Packing…') : tr('Save reference pack (ZIP)')}
          </Button>
        </div>
      </Section>

      <Section title={tr('Capture the page')}>
        <div className="grid grid-cols-2 gap-2">
          <button disabled={!!busy} onClick={() => capture('visible')} className="flex cursor-pointer flex-col items-start gap-0.5 rounded-xl border border-line bg-surface p-3 text-left hover:border-accent/50 disabled:opacity-60">
            <Camera size={18} className="text-accent-text" aria-hidden />
            <span className="mt-1 text-[13px] font-semibold">{tr('Visible area')}</span>
            <span className="text-[11.5px] text-muted">{tr('Edit, then save PNG')}</span>
          </button>
          <button disabled={!!busy} onClick={() => capture('full')} className="flex cursor-pointer flex-col items-start gap-0.5 rounded-xl border border-line bg-surface p-3 text-left hover:border-accent/50 disabled:opacity-60">
            <Layout size={18} className="text-accent-text" aria-hidden />
            <span className="mt-1 text-[13px] font-semibold">{tr('Whole page')}</span>
            <span className="text-[11.5px] text-muted">{tr('Loads everything first')}</span>
          </button>
          <button disabled={!!busy} onClick={() => capture('pdf')} className="col-span-2 flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface p-3 text-left hover:border-accent/50 disabled:opacity-60">
            <FileText size={18} className="text-accent-text" aria-hidden />
            <span>
              <span className="block text-[13px] font-semibold">{tr('Whole page as A4 PDF')}</span>
              <span className="text-[11.5px] text-muted">{tr('Pages break between lines, never through them')}</span>
            </span>
          </button>
          <button disabled={!!busy} onClick={() => pdfInput.current?.click()} className="col-span-2 flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface p-3 text-left hover:border-accent/50 disabled:opacity-60">
            <FilePdf size={18} className="text-accent-text" aria-hidden />
            <span>
              <span className="block text-[13px] font-semibold">{busy === 'pdf-file' ? tr('Opening the PDF…') : tr('Finish a PDF you have')}</span>
              <span className="text-[11.5px] text-muted">{tr('Black out, add notes, exhibit labels and page numbers, check before filing')}</span>
            </span>
          </button>
          <input ref={pdfInput} type="file" accept="application/pdf,.pdf" aria-label={tr('PDF to finish')} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void finishPdf(f); }} />
        </div>
        <button type="button" role="checkbox" aria-checked={stampOn} onClick={() => setStampOn((v) => !v)} className="flex cursor-pointer items-center gap-2 text-[12.5px]">
          <Box on={stampOn} /> {tr('Add the address and capture time (can change in the Studio)')}
        </button>
        <button type="button" role="checkbox" aria-checked={withMhtml} onClick={() => setWithMhtml((v) => !v)} className="flex cursor-pointer items-center gap-2 text-[12.5px]">
          <Box on={withMhtml} /> {tr('Also keep a copy of the page itself (MHTML) for the record')}
        </button>
        {progress && (
          <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-2.5" aria-live="polite">
            <div className="flex justify-between text-[12px]">
              <span>{progress.detail && busy === 'pdf-file' ? progress.detail : progress.phase === 'loading' ? tr('Loading the page: {p}%', { p: Math.round(progress.done * 100) }) : progress.phase === 'capturing' ? tr('Taking the picture: {p}%', { p: Math.round(progress.done * 100) }) : tr('Putting the picture together')}</span>
              <span className="font-mono text-muted tabular-nums">{progress.seconds.toFixed(1)}s</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={tr('Capture progress')} aria-valuenow={Math.round(progress.done * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(progress.done * 100)}%` }} />
            </div>
            {progress.phase === 'loading' && busy !== 'pdf-file' && (
              <Button onClick={() => (stopRef.current = true)} className="self-start">
                <Stop size={14} aria-hidden /> {tr('Save what has loaded')}
              </Button>
            )}
          </div>
        )}
        <p className="text-[11.5px] leading-snug text-muted">{tr('Whole-page captures use the browser\'s debugging interface, so Edge shows a "debugging" bar for a moment. Where a site doesn\'t allow that, Gleaner scrolls and takes the page screen by screen instead.')}</p>
      </Section>

      {note && (
        <Notice tone={note.tone}>
          {note.text}
          {note.dataset && (
            <button className="ml-1 cursor-pointer text-accent-text underline" onClick={() => nav.openDataset(note.dataset!)}>
              {tr('Open in Data')}
            </button>
          )}
        </Notice>
      )}
      {note?.tone === 'error' && <ReportProblem tool="capture" run={{ error: note.text }} />}

      {recent.length > 0 && (
        <Section title={tr('Recent captures')}>
          <ul className="flex flex-col gap-1.5">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-2">
                <button className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => browser.tabs.create({ url: browser.runtime.getURL(`/studio.html?id=${r.id}` as any) })}>
                  <span className="block truncate text-[12.5px] font-medium">{r.title || r.url}</span>
                  <span className="block text-[11px] text-muted">
                    {new Date(r.createdAt).toLocaleString(lang === 'ja' ? 'ja-JP' : undefined)} · {tr(r.report.mode)}{r.report.mode === 'pdf file' ? ` · ${tr('{n} pages', { n: r.report.source?.pages.length ?? 0 })}` : ` · ${r.report.pageSize.width}×${r.report.pageSize.height}`}
                  </span>
                </button>
                <button aria-label={tr('Delete this capture')} className="cursor-pointer rounded p-1 text-muted hover:text-danger" onClick={() => deleteCapture(r.id).then(refresh)}>
                  <Trash size={15} />
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[11.5px] text-muted">{tr('The 10 newest captures from the last week stay on this computer. Save what you need.')}</p>
        </Section>
      )}
    </div>
  );
}
