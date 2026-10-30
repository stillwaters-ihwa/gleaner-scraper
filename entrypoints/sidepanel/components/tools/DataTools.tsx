// Data tools: link extractor, and a converter for HTML to Markdown, HTML tables, spreadsheets to
// JSON, JSON formatting, and merging CSV/Excel files.
import { useMemo, useState } from 'react';
import { Copy, DownloadSimple, FloppyDisk } from '@phosphor-icons/react';
import { newDataset, saveDataset, type Column } from '@/lib/db';
import { downloadText, safeName } from '@/lib/export';
import { formatJson, htmlTables, htmlToMarkdown, jsonToRows, mergeTables, pageLinks, parseJson, readSpreadsheet, tableRows, type HtmlTable } from '@/lib/convert';
import { fetchDocument, normalizeUrls, runPool, withPage } from '@/lib/runner';
import { activeTab, call, isRestricted, requestHostAccess } from '@/lib/tab';
import { Button, Check, Field, Notice, Section, Segmented, inputCls } from '../ui';
import { RunBar, UrlSource, hostOf, useJob } from '../run';
import { LoadOptions, defaultLoad } from './common';
import { useNav } from '../nav';

const colsOf = (rows: Record<string, string>[], order?: string[]): Column[] => {
  const keys = order ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return keys.map((k) => ({ key: k, label: k }));
};

// ---------- Link extractor ----------

export function LinkExtractor() {
  const [source, setSource] = useState<'tab' | 'urls'>('tab');
  const [urls, setUrls] = useState('');
  const [types, setTypes] = useState({ internal: true, external: true, email: true, phone: true, file: true });
  const [contains, setContains] = useState('');
  const [load, setLoad] = useState(defaultLoad);
  const job = useJob();
  const list = normalizeUrls(urls);

  function start() {
    job.start(async ({ signal, progress, status }) => {
      let rows: Record<string, string>[] = [];
      if (source === 'tab') {
        const tab = await activeTab();
        if (isRestricted(tab.url)) throw new Error('Open a normal website first.');
        status('Reading links on this page');
        rows = await call(tab.id!, 'links');
      } else {
        const res = await runPool(list, (u) => withPage(u, load.mode, signal, (p) => p.run(pageLinks, 'links')), { concurrency: load.concurrency, delayMs: load.delay, signal, onProgress: (d, t, e) => progress(d, t, e) });
        rows = res.flatMap((r) => (r instanceof Error ? [] : (r as Record<string, string>[])));
      }
      const needle = contains.trim().toLowerCase();
      rows = rows.filter((r) => types[r.type as keyof typeof types] && (!needle || `${r.url} ${r.text}`.toLowerCase().includes(needle)));
      if (!rows.length) throw new Error('No links matched.');
      const name = source === 'tab' ? hostOf(rows[0].found_on) : list.length === 1 ? hostOf(list[0]) : `${list.length} pages`;
      return saveDataset(newDataset('links', `Links ${name}`, rows[0].found_on, colsOf(rows, ['url', 'text', 'type', 'rel', 'found_on']), rows));
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <Section title="Pages">
        <p className="text-[12.5px] leading-relaxed text-muted">Every link on a page with its text, sorted into same-site, other sites, emails, phone numbers and files.</p>
        <Segmented label="Source" value={source} onChange={setSource} options={[{ value: 'tab', label: 'This page' }, { value: 'urls', label: 'List of pages' }]} />
        {source === 'urls' && (
          <>
            <UrlSource value={urls} onChange={setUrls} />
            <LoadOptions value={load} onChange={setLoad} />
          </>
        )}
      </Section>
      <Section title="Keep">
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(types) as (keyof typeof types)[]).map((t) => (
            <Check key={t} checked={types[t]} onChange={(v) => setTypes({ ...types, [t]: v })}>
              {{ internal: 'Same-site links', external: 'Other sites', email: 'Email links', phone: 'Phone links', file: 'Files (PDF, images...)' }[t]}
            </Check>
          ))}
        </div>
        <Field label="Only links containing">{(id) => <input id={id} value={contains} onChange={(e) => setContains(e.target.value)} placeholder="e.g. /products/" className={inputCls} />}</Field>
      </Section>
      <div className="flex-1" />
      <RunBar job={job} onStart={start} startLabel="Get links" disabled={source === 'urls' && !list.length} />
    </div>
  );
}

// ---------- Converter ----------

type Mode = 'markdown' | 'tables' | 'sheet' | 'json' | 'merge';

function Output({ text, filename, type }: { text: string; filename: string; type: string }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return (
    <div className="flex flex-col gap-2">
      <textarea readOnly value={text} rows={12} aria-label="Result" className={inputCls + ' resize-y font-mono text-[12px] leading-relaxed'} />
      <div className="flex gap-2">
        <Button onClick={() => navigator.clipboard.writeText(text).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}>
          <Copy size={15} aria-hidden /> {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button onClick={() => downloadText(text, filename, type)}>
          <DownloadSimple size={15} aria-hidden /> Download
        </Button>
      </div>
    </div>
  );
}

export function DataConverter() {
  const nav = useNav();
  const [mode, setMode] = useState<Mode>('markdown');
  const [html, setHtml] = useState('');
  const [url, setUrl] = useState('');
  const [mainOnly, setMainOnly] = useState(true);
  const [out, setOut] = useState('');
  const [outName, setOutName] = useState('result');
  const [tables, setTables] = useState<HtmlTable[]>([]);
  const [sheets, setSheets] = useState<{ file: string; name: string; rows: Record<string, string>[]; headers: string[] }[]>([]);
  const [jsonText, setJsonText] = useState('');
  const [indent, setIndent] = useState<'2' | '4' | '0'>('2');
  const [sortKeys, setSortKeys] = useState(false);
  const [mergeFiles, setMergeFiles] = useState<File[]>([]);
  const [dedupe, setDedupe] = useState(true);
  const [sourceCol, setSourceCol] = useState(true);
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const json = useMemo(() => (jsonText.trim() ? parseJson(jsonText) : null), [jsonText]);

  async function getHtml(): Promise<{ html: string; base: string }> {
    if (html.trim()) return { html, base: url.trim() || 'https://example.com/' };
    if (url.trim()) {
      if (!(await requestHostAccess())) throw new Error('Gleaner needs permission to read websites.');
      const doc = await fetchDocument(normalizeUrls(url)[0] ?? url.trim());
      return { html: doc.documentElement.outerHTML, base: normalizeUrls(url)[0] ?? url };
    }
    const tab = await activeTab();
    if (isRestricted(tab.url)) throw new Error('Paste HTML, enter a page address, or open a normal website in this tab.');
    if (!(await requestHostAccess())) throw new Error('Gleaner needs permission to read websites.');
    const page = await call<{ html: string; url: string }>(tab.id!, 'pageSource');
    return { html: page.html, base: page.url };
  }

  async function run(fn: () => Promise<void>) {
    setMsg(null);
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      setMsg({ tone: 'error', text: e?.message ?? String(e) });
    } finally {
      setBusy(false);
    }
  }

  const toMarkdown = () =>
    run(async () => {
      const { html: h, base } = await getHtml();
      const r = htmlToMarkdown(h, { mainOnly, baseUrl: base });
      setOut(r.markdown);
      setOutName(safeName(r.title || hostOf(base) || 'page') + '.md');
    });

  const findTables = () =>
    run(async () => {
      const { html: h } = await getHtml();
      const t = htmlTables(new DOMParser().parseFromString(h, 'text/html'));
      setTables(t);
      if (!t.length) setMsg({ tone: 'info', text: 'No tables with data found.' });
    });

  async function saveRows(name: string, rows: Record<string, string>[], headers?: string[]) {
    const ds = await saveDataset(newDataset('convert', name, '', colsOf(rows, headers), rows));
    setMsg({ tone: 'info', text: `Saved ${rows.length} rows as "${name}". Open it in Data to export to Excel, CSV or Google Sheets.` });
    return ds;
  }

  const readSheets = (files: FileList | null) =>
    run(async () => {
      const all: typeof sheets = [];
      for (const f of Array.from(files ?? [])) for (const s of await readSpreadsheet(f)) all.push({ file: f.name, ...s });
      setSheets(all);
      if (all[0]) {
        setOut(JSON.stringify(all[0].rows, null, 2));
        setOutName(safeName(all[0].file.replace(/\.\w+$/, '')) + '.json');
      }
    });

  const merge = () =>
    run(async () => {
      const inputs = [];
      for (const f of mergeFiles) {
        const all = await readSpreadsheet(f);
        for (const s of all) inputs.push({ name: all.length > 1 ? `${f.name} (${s.name})` : f.name, rows: s.rows });
      }
      const m = mergeTables(inputs, { dedupe, sourceColumn: sourceCol });
      const ds = await saveRows(`Merged ${mergeFiles.length} files`, m.rows, m.headers);
      setMsg({ tone: 'info', text: `Merged ${m.rows.length} rows from ${mergeFiles.length} files into "${ds.name}"${m.duplicates ? `, ${m.duplicates} duplicate rows dropped` : ''}.` });
    });

  return (
    <div className="flex flex-1 flex-col gap-5">
      <Section title="Convert">
        <Segmented
          label="Tool"
          value={mode}
          onChange={(m) => (setMode(m), setOut(''), setMsg(null))}
          options={[
            { value: 'markdown', label: 'HTML to Markdown' },
            { value: 'tables', label: 'HTML tables' },
            { value: 'sheet', label: 'Excel to JSON' },
            { value: 'json', label: 'JSON' },
            { value: 'merge', label: 'Merge files' },
          ]}
        />

        {(mode === 'markdown' || mode === 'tables') && (
          <>
            <p className="text-[12px] leading-relaxed text-muted">Paste HTML, or enter a page address. With both empty, the page open in this tab is used.</p>
            <Field label="Page address">{(id) => <input id={id} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." className={inputCls} />}</Field>
            <Field label="HTML">{(id) => <textarea id={id} rows={5} value={html} onChange={(e) => setHtml(e.target.value)} spellCheck={false} placeholder="<h1>...</h1>" className={inputCls + ' resize-y font-mono text-[12px]'} />}</Field>
          </>
        )}
        {mode === 'markdown' && (
          <>
            <Check checked={mainOnly} onChange={setMainOnly}>
              Main content only (leave out menus, ads and footers)
            </Check>
            <Button variant="primary" onClick={toMarkdown} disabled={busy}>
              Convert to Markdown
            </Button>
            <Output text={out} filename={outName} type="text/markdown" />
          </>
        )}
        {mode === 'tables' && (
          <>
            <Button variant="primary" onClick={findTables} disabled={busy}>
              Find tables
            </Button>
            {tables.length > 0 && (
              <ul className="flex flex-col gap-2">
                {tables.map((t) => (
                  <li key={t.index} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px]">
                    <span className="min-w-0 truncate">
                      <span className="font-mono tabular-nums">
                        {t.rows.length} x {t.headers.length}
                      </span>{' '}
                      <span className="text-muted">{t.headers.slice(0, 4).join(', ')}</span>
                    </span>
                    <Button onClick={() => saveRows(`Table ${t.index + 1}${t.caption ? ` ${t.caption.slice(0, 30)}` : ''}`, tableRows(t), t.headers).then((ds) => nav.openDataset(ds.id))}>
                      <FloppyDisk size={15} aria-hidden /> Save
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {mode === 'sheet' && (
          <>
            <Field label="Excel or CSV files" help="Each sheet becomes an array of objects, keyed by the header row.">
              {(id) => <input id={id} type="file" multiple accept=".xlsx,.xls,.csv,.tsv,.ods" onChange={(e) => readSheets(e.target.files)} className={inputCls} />}
            </Field>
            {sheets.length > 1 && (
              <select aria-label="Sheet" onChange={(e) => setOut(JSON.stringify(sheets[Number(e.target.value)].rows, null, 2))} className={inputCls}>
                {sheets.map((s, i) => (
                  <option key={i} value={i}>
                    {s.file} / {s.name} ({s.rows.length} rows)
                  </option>
                ))}
              </select>
            )}
            <Output text={out} filename={outName} type="application/json" />
            {sheets[0] && (
              <Button onClick={() => saveRows(sheets[0].file, sheets[0].rows, sheets[0].headers)}>
                <FloppyDisk size={15} aria-hidden /> Save as data
              </Button>
            )}
          </>
        )}

        {mode === 'json' && (
          <>
            <Field label="JSON">{(id) => <textarea id={id} rows={8} value={jsonText} onChange={(e) => setJsonText(e.target.value)} spellCheck={false} placeholder='{"name": "Toner", "price": 18}' className={inputCls + ' resize-y font-mono text-[12px]'} />}</Field>
            {json && !json.ok && (
              <Notice tone="error">
                {json.line ? `Line ${json.line}, column ${json.column}: ` : ''}
                {json.error}
              </Notice>
            )}
            {json?.ok && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Segmented label="Indent" value={indent} onChange={setIndent} options={[{ value: '2', label: '2 spaces' }, { value: '4', label: '4 spaces' }, { value: '0', label: 'Minify' }]} />
                  <Check checked={sortKeys} onChange={setSortKeys}>
                    Sort keys
                  </Check>
                </div>
                <Output text={formatJson(json.value, { indent: Number(indent), sortKeys })} filename="data.json" type="application/json" />
                <Button onClick={() => saveRows('JSON data', jsonToRows(json.value))}>
                  <FloppyDisk size={15} aria-hidden /> Save as a table
                </Button>
              </>
            )}
          </>
        )}

        {mode === 'merge' && (
          <>
            <Field label={`Files to merge${mergeFiles.length ? ` (${mergeFiles.length})` : ''}`} help="CSV and Excel files. Columns line up by name, even when their case or spacing differs.">
              {(id) => <input id={id} type="file" multiple accept=".xlsx,.xls,.csv,.tsv,.ods" onChange={(e) => setMergeFiles(Array.from(e.target.files ?? []))} className={inputCls} />}
            </Field>
            <Check checked={dedupe} onChange={setDedupe}>
              Drop rows that are exact duplicates
            </Check>
            <Check checked={sourceCol} onChange={setSourceCol}>
              Add a column with each row&apos;s file name
            </Check>
            <Button variant="primary" onClick={merge} disabled={busy || mergeFiles.length < 2}>
              Merge {mergeFiles.length || ''} files
            </Button>
          </>
        )}
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      </Section>
    </div>
  );
}
