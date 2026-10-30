import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckSquare, DownloadSimple, FileArchive, Square, Stop } from '@phosphor-icons/react';
import Papa from 'papaparse';
import { browser } from 'wxt/browser';
import { findImages, type ImageInfo } from '@/lib/dom/doc';
import { withPageProduct } from '@/lib/dom/imageContext';
import { getDataset, listDatasets, newDataset, onDatasetsChanged, saveDataset, type Dataset } from '@/lib/db';
import { safeName } from '@/lib/export';
import { imageColumns } from '@/lib/imageExport';
import {
  NAMING_PRESETS,
  NAME_TOKENS,
  SIZE_CLASSES,
  SIZE_LABEL,
  SIZE_RULE,
  convert,
  fetchImage,
  viaTab,
  fileNames,
  formatBytes,
  measureImages,
  type Measured,
  type NamingPreset,
  type OutFormat,
  type SizeClass,
} from '@/lib/imageTools';
import { normalizeUrls, runPool, withPage } from '@/lib/runner';
import { activeTab, call, isRestricted, requestHostAccess } from '@/lib/tab';
import { Button, Check, Field, Notice, Section, Segmented, inputCls } from '../ui';
import { RunBar, UrlSource, hostOf, useJob } from '../run';
import { LoadOptions, defaultLoad } from './common';

type Source = 'tab' | 'urls' | 'saved';
type SaveAs = 'files' | 'zip';
type Summary = Awaited<ReturnType<typeof listDatasets>>[number] & { rowCount?: number };

const TINY = 100;
const isTiny = (m: Measured) => m.width > 0 && m.height > 0 && (m.width < TINY || m.height < TINY);
// Site furniture rather than product photos: not selected at first (still listed, to pick by hand)
const JUNK = /logo|sprite|icon|favicon|banner|placeholder|no[-_]?ima?ge?|noimg|blank|\/images\/G\/\d+\/|nav[-_]|spacer|loading|spinner|arrow|btn[-_]|button|top[-_]?btn|badge|flag|payment|social|sns|kakao|facebook|instagram|youtube/i;
const isJunk = (m: Measured) => JUNK.test((m.foundAs ?? m.src).split('?')[0].split('/').slice(-2).join('/')) || (m.width > 0 && m.height > 0 && Math.max(m.width, m.height) / Math.min(m.width, m.height) > 4);

/** Pictures from a saved dataset, with product details from its name, SKU and brand columns. */
function imagesFromDataset(ds: Dataset, imageKey: string): ImageInfo[] {
  const find = (re: RegExp) => ds.columns.find((c) => re.test(c.key) || re.test(c.label))?.key;
  const nameKey = ds.columns.find((c) => ['title', 'name', 'product', 'product_name'].includes(c.key))?.key ?? find(/title|product name|^name$/i);
  const skuKey = find(/^sku$|sku/i) ?? find(/asin/i);
  const brandKey = find(/brand|vendor/i);
  const partKey = find(/part.?num|part_number|mpn/i);
  const out: ImageInfo[] = [];
  const seen = new Set<string>();
  for (const r of ds.rows) {
    for (const src of (r[imageKey] ?? '').split(/\s+\|\s+|\s*\n\s*/).filter((s) => /^https?:\/\//i.test(s))) {
      if (seen.has(src)) continue;
      seen.add(src);
      out.push({
        src,
        alt: '',
        width: 0,
        height: 0,
        page: r.url ?? ds.source,
        product: nameKey ? r[nameKey] : '',
        sku: skuKey ? r[skuKey] : '',
        brand: brandKey ? r[brandKey] : '',
        part: partKey ? r[partKey] : '',
      });
    }
  }
  return out;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  return browser.downloads.download({ url, filename, conflictAction: 'uniquify' }).finally(() => setTimeout(() => URL.revokeObjectURL(url), 60000));
}

export function ImageDownloader() {
  const [source, setSource] = useState<Source>('tab');
  const [urls, setUrls] = useState('');
  const [load, setLoad] = useState(defaultLoad);
  const [sets, setSets] = useState<Summary[]>([]);
  const [setId, setSetId] = useState('');
  const [picked, setPicked] = useState<Dataset | null>(null);
  const [imageKey, setImageKey] = useState('');
  const [fullSize, setFullSize] = useState(true);
  const [openSmall, setOpenSmall] = useState(true);
  const [variantPics, setVariantPics] = useState(true);

  const [images, setImages] = useState<Measured[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sizes, setSizes] = useState<Set<SizeClass>>(new Set());
  const [hideTiny, setHideTiny] = useState(true);
  const [grouped, setGrouped] = useState(true);

  const [folder, setFolder] = useState('');
  const [naming, setNaming] = useState<NamingPreset>('number');
  const [custom, setCustom] = useState('{sku}_{name}');
  const [format, setFormat] = useState<OutFormat>('original');
  const [bySize, setBySize] = useState(false);
  const [saveAs, setSaveAs] = useState<SaveAs>('files');
  const [dl, setDl] = useState<{ done: number; total: number; failed: number; running: boolean } | null>(null);
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const dlCtrl = useRef<AbortController | null>(null);
  // The tab the pictures came from, for shops that only serve pictures to their own pages
  const pageTab = useRef<number | null>(null);
  const job = useJob();

  // Saved datasets that hold picture links
  useEffect(() => {
    if (source !== 'saved') return;
    const load = () => listDatasets().then((all) => setSets(all as Summary[]));
    load();
    return onDatasetsChanged(load);
  }, [source]);
  useEffect(() => {
    let live = true;
    if (!setId) return setPicked(null);
    getDataset(setId).then((ds) => {
      if (!live) return;
      setPicked(ds ?? null);
      setImageKey(ds ? (imageColumns(ds)[0]?.key ?? '') : '');
    });
    return () => {
      live = false;
    };
  }, [setId]);
  const pictureCols = useMemo(() => (picked ? imageColumns(picked) : []), [picked]);

  const pool = useMemo(() => (hideTiny ? images.filter((m) => !isTiny(m)) : images), [images, hideTiny]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of pool) if (m.size) c[m.size] = (c[m.size] ?? 0) + 1;
    return c;
  }, [pool]);
  const visible = useMemo(() => (sizes.size ? pool.filter((m) => m.size && sizes.has(m.size)) : pool), [pool, sizes]);
  const chosen = useMemo(() => visible.filter((m) => selected.has(m.src)), [visible, selected]);
  const withProduct = useMemo(() => images.filter((m) => m.product || m.sku).length, [images]);
  const pattern = naming === 'custom' ? custom : NAMING_PRESETS.find((p) => p.value === naming)!.pattern;
  const names = useMemo(() => fileNames(chosen, pattern), [chosen, pattern]);

  function collect() {
    setMsg(null);
    job.start(async ({ signal, progress, status }) => {
      let found: ImageInfo[] = [];
      let name = '';
      pageTab.current = null;
      if (source === 'tab') {
        const tab = await activeTab();
        if (isRestricted(tab.url)) throw new Error("This page can't be read by extensions. Open a normal website first.");
        status('Collecting pictures on this page');
        found = (await call<ImageInfo[] | null>(tab.id!, 'images')) ?? [];
        pageTab.current = tab.id!;
        if (variantPics) {
          status("Looking for each variant's pictures (colour, size)");
          const vp = (await call<{ variant: string; image: string; sku?: string }[] | null>(tab.id!, 'variantPictures').catch(() => null)) ?? [];
          const bySrc = new Map(found.map((f) => [f.src, f]));
          const product = found.find((f) => f.product)?.product ?? '';
          for (const v of vp) {
            const hit = bySrc.get(v.image);
            if (hit) ((hit.variant ||= v.variant), (hit.sku ||= v.sku ?? ''));
            else found.push({ src: v.image, alt: v.variant, width: 0, height: 0, page: tab.url!, product, sku: v.sku ?? '', variant: v.variant });
          }
        }
        if (fullSize && openSmall && found.length) {
          status('Opening small pictures to find their big versions (up to a minute)');
          const pairs = (await call<{ thumb: string; big: string }[] | null>(tab.id!, 'openThumbnails').catch(() => null)) ?? [];
          const big = new Map(pairs.map((p) => [p.thumb, p.big]));
          for (const img of found) if (big.has(img.src)) img.big = big.get(img.src);
        }
        name = hostOf(tab.url!);
      } else if (source === 'urls') {
        const list = normalizeUrls(urls);
        status(`Scanning ${list.length} pages`);
        const res = await runPool(list, (u) => withPage(u, load.mode, signal, (p) => p.run((d, x) => withPageProduct(findImages(d, x, false), d, x), 'images')), {
          concurrency: load.concurrency,
          delayMs: load.delay,
          signal,
          onProgress: (d, t, e) => progress(d, t, e),
        });
        const seen = new Set<string>();
        for (const r of res) if (!(r instanceof Error)) for (const img of r as ImageInfo[]) if (!seen.has(img.src)) (seen.add(img.src), found.push(img));
        name = list.length > 1 ? `${list.length} pages` : hostOf(list[0]);
      } else {
        if (!picked || !imageKey) throw new Error('Pick saved data that has a picture column.');
        found = imagesFromDataset(picked, imageKey);
        name = picked.name;
      }
      if (!found.length) throw new Error('No pictures found.');

      status(fullSize ? 'Measuring pictures and looking for full-size versions' : 'Measuring pictures');
      const m = await measureImages(found, { fullSize, signal, viaPage: pageTab.current ? viaTab(call, pageTab.current) : undefined, onProgress: (d, t, f) => progress(d, t, f) });
      if (signal.aborted) return null;
      setImages(m.images);
      setSizes(new Set());
      setSelected(new Set(m.images.filter((x) => !isTiny(x) && !isJunk(x)).map((x) => x.src)));
      setFolder(safeName(`images-${name}`));
      const tagged = m.images.filter((x) => x.sku).length;
      setNaming(m.images.filter((x) => x.variant).length >= 2 ? 'name_variant' : tagged >= m.images.length * 0.3 ? 'sku_name' : m.images.some((x) => x.product) ? 'name' : 'number');

      const notes = [`${m.images.length} ${m.images.length === 1 ? 'picture' : 'pictures'}`];
      if (m.upgraded) notes.push(`${m.upgraded} upgraded to full size`);
      const variants = m.images.filter((x) => x.variant).length;
      if (variants) notes.push(`${variants} variant pictures`);
      const opened = found.filter((x) => x.big).length;
      if (opened && source === 'tab') notes.push(`${opened} small pictures had a bigger version`);
      if (m.duplicates) notes.push(`${m.duplicates} duplicates merged`);
      const failed = m.images.filter((x) => x.failed).length;
      if (failed) notes.push(`${failed} couldn't be measured`);
      const ds = newDataset(
        'images',
        `Images ${name}`,
        found[0]?.page ?? '',
        [
          { key: 'src', label: 'image url' },
          { key: 'product', label: 'product' },
          { key: 'sku', label: 'sku' },
          { key: 'brand', label: 'brand' },
          { key: 'variant', label: 'variant' },
          { key: 'size', label: 'size' },
          { key: 'width', label: 'width' },
          { key: 'height', label: 'height' },
          { key: 'file_size', label: 'file size' },
          { key: 'alt', label: 'alt text' },
          { key: 'page', label: 'page' },
        ],
        m.images.map((x) => ({
          src: x.src,
          product: x.product ?? '',
          sku: x.sku ?? '',
          brand: x.brand ?? '',
          variant: x.variant ?? '',
          size: x.size ? SIZE_LABEL[x.size] : '',
          width: x.width ? String(x.width) : '',
          height: x.height ? String(x.height) : '',
          file_size: formatBytes(x.bytes),
          alt: x.alt === 'og:image' ? '' : x.alt,
          page: x.page,
        })),
      );
      return saveDataset({ ...ds, note: notes.join(', ') });
    }, { needsHostAccess: true });
  }

  /** Download all chosen pictures, or just one size group of them. */
  async function download(subset?: Measured[], group?: string) {
    setMsg(null);
    if (!(await requestHostAccess())) return setMsg({ tone: 'error', text: 'Gleaner needs permission to read websites to download the pictures. Try again and choose Allow.' });
    const list = subset ?? chosen;
    // Names come from the whole selection, so a product's pictures keep their numbers in every size
    const nameOf = new Map(chosen.map((m, i) => [m.src, names[i]]));
    const fileList = list.map((m, i) => nameOf.get(m.src) ?? `${String(i + 1).padStart(3, '0')}`);
    const root = safeName(folder || 'gleaner-images') + (group ? `-${safeName(group.toLowerCase())}` : '');
    const ctrl = (dlCtrl.current = new AbortController());
    setDl({ done: 0, total: list.length, failed: 0, running: true });
    const zip: Record<string, [Uint8Array, { level: 0 }]> = {};
    const manifest: string[][] = [];
    let done = 0;
    let failed = 0;
    await runPool(
      list,
      async (m, i) => {
        const sub = bySize ? `${m.size ? SIZE_LABEL[m.size] : 'Unknown size'}/` : '';
        try {
          let blob = await fetchImage(m.src, ctrl.signal, pageTab.current ? viaTab(call, pageTab.current) : undefined);
          let ext = m.ext;
          const conv = await convert(blob, format).catch(() => null);
          if (conv) ((blob = conv.blob), (ext = conv.ext));
          const path = `${sub}${fileList[i]}.${ext}`;
          if (saveAs === 'zip') zip[path] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
          else await saveBlob(blob, `${root}/${path}`);
          manifest.push([path, m.product ?? '', m.sku ?? '', m.brand ?? '', m.size ? SIZE_LABEL[m.size] : '', String(m.width || ''), String(m.height || ''), formatBytes(blob.size), m.src, m.page]);
        } catch {
          if (ctrl.signal.aborted) return;
          // Some hosts refuse direct reads; let the browser fetch it as a normal download
          if (saveAs === 'files' && format === 'original') {
            await browser.downloads
              .download({ url: m.src, filename: `${root}/${sub}${fileList[i]}.${m.ext}`, conflictAction: 'uniquify' })
              .catch(() => failed++);
          } else failed++;
        }
        setDl({ done: ++done, total: list.length, failed, running: true });
      },
      { concurrency: 4, delayMs: 0, signal: ctrl.signal, onProgress: () => {} },
    );
    if (saveAs === 'zip' && !ctrl.signal.aborted && Object.keys(zip).length) {
      const { zipSync, strToU8 } = await import('fflate');
      manifest.sort((a, b) => a[0].localeCompare(b[0]));
      const csv = Papa.unparse({ fields: ['file', 'product', 'sku', 'brand', 'size', 'width', 'height', 'file size', 'image url', 'page'], data: manifest });
      const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = { ...zip, 'pictures.csv': strToU8('﻿' + csv) };
      await saveBlob(new Blob([zipSync(files)], { type: 'application/zip' }), `${root}.zip`);
    }
    setDl({ done, total: list.length, failed, running: false });
    if (ctrl.signal.aborted) setMsg({ tone: 'info', text: `Stopped after ${done} pictures.` });
    else if (failed) setMsg({ tone: 'error', text: `${done - failed} saved. ${failed} pictures couldn't be downloaded.` });
    else setMsg({ tone: 'info', text: saveAs === 'zip' ? `Saved ${root}.zip with ${done} pictures and a pictures.csv list.` : `Saved ${done} pictures to Downloads/${root}.` });
  }

  const toggle = (src: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(src) ? n.delete(src) : n.add(src);
      return n;
    });
  const toggleSize = (c: SizeClass) =>
    setSizes((s) => {
      const n = new Set(s);
      n.has(c) ? n.delete(c) : n.add(c);
      return n;
    });
  const allOn = chosen.length === visible.length && visible.length > 0;
  const busy = !!dl?.running;
  const ext = format === 'original' ? (chosen[0]?.ext ?? 'jpg') : format;
  // Size groups, biggest first; pictures whose size couldn't be measured come last
  const groups = useMemo(
    () =>
      (['XL', 'L', 'M', 'S', ''] as const)
        .map((c) => ({ c, label: c ? SIZE_LABEL[c] : 'Unknown size', items: visible.filter((m) => m.size === c) }))
        .filter((g) => g.items.length),
    [visible],
  );
  const setGroup = (items: Measured[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      for (const m of items) on ? n.add(m.src) : n.delete(m.src);
      return n;
    });

  const tile = (img: Measured) => {
    const on = selected.has(img.src);
    const info = [img.product || img.alt, img.sku && `SKU ${img.sku}`, img.width ? `${img.width} x ${img.height} px` : '', formatBytes(img.bytes)].filter(Boolean).join('\n');
    return (
      <li key={img.src}>
        <button
          onClick={() => toggle(img.src)}
          aria-pressed={on}
          aria-label={`${on ? 'Selected' : 'Not selected'}: ${info.replace(/\n/g, ', ') || img.src}`}
          title={info || img.src}
          className={`relative block aspect-square w-full cursor-pointer overflow-hidden rounded-lg border bg-surface-2 transition ${on ? 'border-accent ring-1 ring-accent' : 'border-line opacity-60 hover:opacity-100'}`}
        >
          <img src={img.foundAs ?? img.src} alt="" loading="lazy" className="size-full object-cover" />
          <span className="absolute top-1 left-1 rounded bg-bg/80 text-accent-text">{on ? <CheckSquare size={16} weight="fill" aria-hidden /> : <Square size={16} aria-hidden />}</span>
          {img.size && <span className="absolute right-1 bottom-1 rounded bg-bg/85 px-1 font-mono text-[10.5px] leading-4 text-ink">{img.size}</span>}
        </button>
      </li>
    );
  };
  const GRID = 'grid grid-cols-3 gap-1.5 min-[480px]:grid-cols-4 min-[680px]:grid-cols-6';

  return (
    <div className="flex flex-1 flex-col gap-5">
      <Section title="Find pictures">
        <Segmented
          label="Picture source"
          value={source}
          onChange={setSource}
          options={[
            { value: 'tab', label: 'This page' },
            { value: 'urls', label: 'List of pages' },
            { value: 'saved', label: 'Saved data' },
          ]}
        />
        {source === 'urls' && (
          <>
            <UrlSource value={urls} onChange={setUrls} />
            <LoadOptions value={load} onChange={setLoad} />
          </>
        )}
        {source === 'saved' && (
          <>
            <Field label="Saved data" help="Use pictures from a Store or List extractor run. Files can then be named after each product's name or SKU.">
              {(id) => (
                <select id={id} value={setId} onChange={(e) => setSetId(e.target.value)} className={inputCls}>
                  <option value="">Choose saved data</option>
                  {sets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.rowCount} rows)
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {picked && !pictureCols.length && <Notice tone="error">This data has no column with picture links.</Notice>}
            {pictureCols.length > 1 && (
              <Field label="Picture column">
                {(id) => (
                  <select id={id} value={imageKey} onChange={(e) => setImageKey(e.target.value)} className={inputCls}>
                    {pictureCols.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
          </>
        )}
        <Check checked={fullSize} onChange={setFullSize}>
          Get full-size versions when the site serves resized ones
          <span className="block text-[12px] text-muted">Works for Shopify, WordPress, Amazon, Wix, Squarespace and Cafe24 picture links, and for thumbnails that link to their big picture.</span>
        </Check>
        {source === 'tab' && (
          <Check checked={variantPics} onChange={setVariantPics}>
            Get every variant's pictures (colour, size)
            <span className="block text-[12px] text-muted">On a product page: each variant's picture, from the shop's own data or by choosing each option in turn.</span>
          </Check>
        )}
        {source === 'tab' && fullSize && (
          <Check checked={openSmall} onChange={setOpenSmall}>
            Open small pictures to get the big ones
            <span className="block text-[12px] text-muted">Clicks each thumbnail on the page, like a gallery or zoom, and keeps the bigger picture it shows. Links to other pages are not followed. Adds up to a minute.</span>
          </Check>
        )}
      </Section>

      {images.length > 0 && (
        <Section
          title={`${visible.length} pictures`}
          action={
            <Button variant="ghost" onClick={() => setSelected(allOn ? new Set() : new Set(visible.map((i) => i.src)))}>
              {allOn ? 'Select none' : 'Select all'}
            </Button>
          }
        >
          <div className="flex flex-col gap-2">
            <div role="group" aria-label="Filter by size" className="flex flex-wrap gap-1.5">
              <button
                type="button"
                aria-pressed={sizes.size === 0}
                onClick={() => setSizes(new Set())}
                className={`min-h-8 cursor-pointer rounded-full border px-3 text-[12.5px] transition ${sizes.size === 0 ? 'border-accent bg-accent/15 text-ink' : 'border-line text-muted hover:text-ink'}`}
              >
                All <span className="font-mono tabular-nums">{pool.length}</span>
              </button>
              {SIZE_CLASSES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={sizes.has(c)}
                  disabled={!counts[c]}
                  onClick={() => toggleSize(c)}
                  title={`${SIZE_LABEL[c]}: longest side ${SIZE_RULE[c]}`}
                  className={`min-h-8 cursor-pointer rounded-full border px-3 text-[12.5px] transition disabled:cursor-default disabled:opacity-40 ${sizes.has(c) ? 'border-accent bg-accent/15 text-ink' : 'border-line text-muted hover:text-ink'}`}
                >
                  {SIZE_LABEL[c]} <span className="font-mono tabular-nums">{counts[c] ?? 0}</span>
                </button>
              ))}
            </div>
            <p className="text-[12px] text-muted">
              Sized by the longest side: Small {SIZE_RULE.S}, Medium {SIZE_RULE.M}, Large {SIZE_RULE.L}, Extra large {SIZE_RULE.XL}. File size decides when the pixels are unknown.
            </p>
            <Check checked={hideTiny} onChange={setHideTiny}>
              Hide icons and tiny pictures (under {TINY} px)
            </Check>
          </div>

          <Segmented
            label="Show"
            value={grouped ? 'grouped' : 'all'}
            onChange={(v) => setGrouped(v === 'grouped')}
            options={[
              { value: 'grouped', label: 'Grouped by size' },
              { value: 'all', label: 'All together' },
            ]}
          />

          {grouped ? (
            groups.map((g) => {
              const picked = g.items.filter((m) => selected.has(m.src));
              const allPicked = picked.length === g.items.length;
              const bytes = g.items.reduce((s, m) => s + (m.bytes || 0), 0);
              return (
                <section key={g.c || 'unknown'} aria-label={`${g.label} pictures`} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-display text-[14px] font-semibold tracking-tight">
                      {g.label} <span className="font-mono text-[12px] font-normal text-muted tabular-nums">{g.items.length}{bytes ? `, ${formatBytes(bytes)}` : ''}</span>
                    </h4>
                    <div className="flex gap-1">
                      <Button variant="ghost" className="px-2" onClick={() => setGroup(g.items, !allPicked)}>
                        {allPicked ? 'Select none' : 'Select all'}
                      </Button>
                      <Button onClick={() => download(picked, g.label)} disabled={!picked.length || busy}>
                        <DownloadSimple size={15} aria-hidden /> Download {picked.length} {g.label.toLowerCase()}
                      </Button>
                    </div>
                  </div>
                  {g.c && <p className="-mt-1 text-[11.5px] text-muted">Longest side {SIZE_RULE[g.c]}</p>}
                  <ul className={GRID}>{g.items.slice(0, 120).map(tile)}</ul>
                  {g.items.length > 120 && <p className="text-[12px] text-muted">Showing the first 120. All {g.items.length} get downloaded.</p>}
                </section>
              );
            })
          ) : (
            <>
              <ul className={GRID}>{visible.slice(0, 300).map(tile)}</ul>
              {visible.length > 300 && <p className="text-[12px] text-muted">Showing the first 300. All {visible.length} are in the saved data and get downloaded.</p>}
            </>
          )}
        </Section>
      )}

      {images.length > 0 && (
        <Section title="Save">
          <div className="grid grid-cols-2 gap-3">
            <Field label="File names" help={withProduct ? `${withProduct} of ${images.length} pictures are linked to a product.` : 'No product details were found for these pictures.'}>
              {(id) => (
                <select id={id} value={naming} onChange={(e) => setNaming(e.target.value as NamingPreset)} className={inputCls}>
                  {NAMING_PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Format">
              {(id) => (
                <select id={id} value={format} onChange={(e) => setFormat(e.target.value as OutFormat)} className={inputCls}>
                  <option value="original">Keep original</option>
                  <option value="jpg">JPG</option>
                  <option value="png">PNG</option>
                  <option value="webp">WebP</option>
                </select>
              )}
            </Field>
          </div>
          {naming === 'custom' && (
            <Field label="Name pattern" help="Missing details fall back to the product name, then alt text, then the original name.">
              {(id) => (
                <div className="flex flex-col gap-1.5">
                  <input id={id} value={custom} onChange={(e) => setCustom(e.target.value)} className={inputCls + ' font-mono'} spellCheck={false} />
                  <div className="flex flex-wrap gap-1">
                    {NAME_TOKENS.map((t) => (
                      <button key={t} type="button" onClick={() => setCustom((c) => c + t)} className="cursor-pointer rounded border border-line px-1.5 py-0.5 font-mono text-[11.5px] text-muted hover:text-ink">
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Field>
          )}
          {names.length > 0 && (
            <p className="truncate font-mono text-[12px] text-muted" title={names.slice(0, 5).join('\n')}>
              {names[0]}.{ext}
              {names[1] ? `, ${names[1]}.${chosen[1]?.ext && format === 'original' ? chosen[1].ext : ext}` : ''}
            </p>
          )}
          <Field label="Folder in Downloads">{(id) => <input id={id} value={folder} onChange={(e) => setFolder(e.target.value)} className={inputCls} />}</Field>
          <Check checked={bySize} onChange={setBySize}>
            Put each size in its own folder (Small, Medium, Large, Extra large)
          </Check>
          <Segmented
            label="Save as"
            value={saveAs}
            onChange={setSaveAs}
            options={[
              { value: 'files', label: 'Separate files' },
              { value: 'zip', label: 'One ZIP with a list' },
            ]}
          />
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          {busy ? (
            <Button onClick={() => dlCtrl.current?.abort()}>
              <Stop size={16} weight="fill" aria-hidden /> Stop ({dl!.done}/{dl!.total})
            </Button>
          ) : (
            <Button variant="primary" onClick={() => download()} disabled={!chosen.length}>
              {saveAs === 'zip' ? <FileArchive size={16} aria-hidden /> : <DownloadSimple size={16} aria-hidden />}
              Download all {chosen.length} pictures{grouped && groups.length > 1 ? ` (${groups.length} sizes)` : ""}
            </Button>
          )}
        </Section>
      )}
      <div className="flex-1" />
      <RunBar
        job={job}
        onStart={collect}
        startLabel={images.length ? 'Find again' : 'Find pictures'}
        disabled={(source === 'urls' && !normalizeUrls(urls).length) || (source === 'saved' && !imageKey)}
      />
    </div>
  );
}
