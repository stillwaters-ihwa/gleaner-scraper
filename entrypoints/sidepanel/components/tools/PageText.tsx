import { useState } from 'react';
import { readableText } from '@/lib/dom/doc';
import { columnsFromRows, newDataset, saveDataset } from '@/lib/db';
import { normalizeUrls, runPool, withPage } from '@/lib/runner';
import { Section } from '../ui';
import { RunBar, UrlSource, hostOf, useJob } from '../run';
import { LoadOptions, defaultLoad } from './common';

export function PageText() {
  const [urls, setUrls] = useState('');
  const [load, setLoad] = useState(defaultLoad);
  const job = useJob();

  function start() {
    const list = normalizeUrls(urls);
    job.start(async ({ signal, progress, status }) => {
      status(`Reading ${list.length} pages`);
      const results = await runPool(list, (url) => withPage(url, load.mode, signal, (p) => p.run(readableText, 'text')), {
        concurrency: load.concurrency,
        delayMs: load.delay,
        signal,
        onProgress: (d, t, e) => progress(d, t, e),
      });
      const rows = results.map((r, i) => (r instanceof Error ? { url: list[i], error: r.message } : r)) as Record<string, string>[];
      const cols = columnsFromRows(rows, (k) => k.replace(/_/g, ' ')).filter((c) => rows.some((r) => r[c.key]));
      return saveDataset(newDataset('text', `Text ${hostOf(list[0])}`, list[0], cols, rows));
    });
  }

  const count = normalizeUrls(urls).length;
  return (
    <div className="flex flex-1 flex-col gap-5">
      <Section title="Pages">
        <UrlSource value={urls} onChange={setUrls} help="Articles, docs, blog posts or product pages. One URL per line." />
        <p className="text-[12px] leading-relaxed text-muted">Each row gets the title, author, site, language, word count and the main text, with menus, ads and footers removed.</p>
      </Section>
      <Section title="Loading">
        <LoadOptions value={load} onChange={setLoad} />
      </Section>
      <div className="flex-1" />
      <RunBar job={job} onStart={start} startLabel={count ? `Read ${count} ${count === 1 ? 'page' : 'pages'}` : 'Read pages'} disabled={!count} />
    </div>
  );
}
