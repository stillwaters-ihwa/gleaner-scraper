// One screen for the industry extractors (jobs, properties, travel, businesses, articles,
// reviews): read the page open in the tab and the pages after it, a list of pages, or a
// source that only some industries have (company job boards, news feeds).
import { releaseWheel, wheel } from '@/lib/wheel';
import { useMemo, useState } from 'react';
import { newDataset, saveDataset, type Column } from '@/lib/db';
import { VERTICALS, type VerticalKind } from '@/lib/verticals';
import { crawlVertical } from '@/lib/verticals/crawl';
import { ATS_NAMES, atsJobs, resolveBoards, salaryNumber } from '@/lib/verticals/jobs';
import { articleFilter, articleLinks, extractArticle, feedLinks, parseFeed } from '@/lib/verticals/news';
import { summarizeReviews, type ReviewSummary } from '@/lib/verticals/reviews';
import { dedupeRows, type Row } from '@/lib/verticals/structured';
import { normalizeUrls, runPool, withPage } from '@/lib/runner';
import { activeTab, isRestricted } from '@/lib/tab';
import { compareWithEarlier, freshNote, NEW_COLUMN, scopeOf, seenKeys, type FreshMode } from '@/lib/seen';
import { SPEEDS, type Speed } from '@/lib/listing';
import { Check, Field, NumberInput, Section, Segmented, inputCls } from '../ui';
import { RunBar, UrlSource, hostOf, useJob } from '../run';
import { LoadOptions, defaultLoad } from './common';
import { PagingControls } from '../PagingControls';

type Source = 'tab' | 'urls' | 'boards' | 'feeds' | 'sections';

interface Config {
  kind: VerticalKind;
  /** What the tool reads, in one sentence. */
  intro: string;
  sources: { value: Source; label: string }[];
  /** Offer to open each result's own page for full details. */
  openEach?: string;
  filters?: 'jobs' | 'articles';
}

export const VERTICAL_CONFIG: Record<string, Config> = {
  jobs: {
    kind: 'jobs',
    intro: 'Job titles, companies, locations, salaries and posting dates from job boards (Indeed, Glassdoor, Monster, Wellfound and others) or straight from companies’ own hiring systems.',
    sources: [
      { value: 'tab', label: 'This page' },
      { value: 'boards', label: 'Company job boards' },
      { value: 'urls', label: 'List of pages' },
    ],
    openEach: 'Open each job for its full description and salary',
    filters: 'jobs',
  },
  realestate: {
    kind: 'realestate',
    intro: 'Prices, beds, baths, area, status, broker and location for every home on a search or listing page (Zillow, Redfin, Realtor.com, Trulia, Apartments.com and others).',
    sources: [
      { value: 'tab', label: 'This page' },
      { value: 'urls', label: 'List of pages' },
    ],
    openEach: 'Open each listing for year built, lot size and more',
  },
  travel: {
    kind: 'travel',
    intro: 'Hotels, restaurants, attractions and tours with ratings, review counts, prices, addresses and amenities (Tripadvisor, Viator, Priceline, Trivago, hotel chains and others).',
    sources: [
      { value: 'tab', label: 'This page' },
      { value: 'urls', label: 'List of pages' },
    ],
    openEach: 'Open each place for amenities, hours and contact details',
  },
  business: {
    kind: 'business',
    intro: 'Business names, categories, phone numbers, addresses, websites and ratings from directories (Yellow Pages, Manta and others) and business pages.',
    sources: [
      { value: 'tab', label: 'This page' },
      { value: 'urls', label: 'List of pages' },
    ],
    openEach: 'Open each listing for email, hours and website',
  },
  articles: {
    kind: 'articles',
    intro: 'Headlines, authors, dates, publishers and clean text with a sentiment score, from articles, news sections and RSS feeds.',
    sources: [
      { value: 'sections', label: 'News or blog pages' },
      { value: 'feeds', label: 'RSS feeds' },
      { value: 'urls', label: 'Article links' },
    ],
    filters: 'articles',
  },
  reviews: {
    kind: 'reviews',
    intro: 'Customer reviews from product and place pages (Amazon and any site that marks up its reviews), with the rating spread, sentiment, and what people praise or complain about. Reviewer names are not collected.',
    sources: [
      { value: 'tab', label: 'This page' },
      { value: 'urls', label: 'List of pages' },
    ],
  },
};

export function VerticalTool({ config }: { config: Config }) {
  const v = VERTICALS[config.kind];
  const [source, setSource] = useState<Source>(config.sources[0].value);
  const [urls, setUrls] = useState('');
  const [boards, setBoards] = useState('');
  const [maxPages, setMaxPages] = useState(config.kind === 'reviews' ? 10 : 5);
  const [maxItems, setMaxItems] = useState(2000);
  const [speed, setSpeed] = useState<Speed>('normal');
  const [openEach, setOpenEach] = useState(false);
  const [fresh, setFresh] = useState<FreshMode>('all');
  const [load, setLoad] = useState(defaultLoad);
  // Filters
  const [keyword, setKeyword] = useState('');
  const [workplace, setWorkplace] = useState<'any' | 'remote' | 'hybrid' | 'on-site'>('any');
  const [days, setDays] = useState(0);
  const [minSalary, setMinSalary] = useState(0);
  const [since, setSince] = useState('');
  const [minWords, setMinWords] = useState(0);
  const [perSection, setPerSection] = useState(30);
  const [fullText, setFullText] = useState(true);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const job = useJob();

  const inputs = useMemo(() => (source === 'boards' ? boards.split('\n').map((s) => s.trim()).filter(Boolean) : normalizeUrls(urls)), [source, boards, urls]);

  /** Read one page and return what the industry reader finds on it. */
  const readPage = (url: string, signal: AbortSignal) => withPage(url, load.mode, signal, (p) => p.run((d, x) => v.extract(d, x), 'vertical', config.kind));

  function filterRows(rows: Row[]): Row[] {
    if (config.filters === 'jobs') {
      const kw = keyword.trim().toLowerCase();
      const cutoff = days ? new Date(Date.now() - days * 8.64e7).toISOString().slice(0, 10) : '';
      return rows.filter(
        (r) =>
          (!kw || `${r.title} ${r.company} ${r.description ?? ''}`.toLowerCase().includes(kw)) &&
          (workplace === 'any' || r.workplace === workplace) &&
          (!cutoff || !r.date_posted || r.date_posted >= cutoff) &&
          (!minSalary || (salaryNumber(r) ?? 0) >= minSalary),
      );
    }
    if (config.filters === 'articles') return rows.filter(articleFilter({ since, minWords, keyword }));
    return rows;
  }

  function start() {
    setSummary(null);
    job.start(async ({ signal, progress, status, interactive, onBotCheck }) => {
      let rows: Row[] = [];
      let note = '';
      let name = '';

      if (source === 'tab') {
        const tab = await activeTab();
        if (isRestricted(tab.url)) throw new Error('Open a search or listing page on a normal website first.');
        name = hostOf(tab.url!);
        const wheelAt = (x: number, y: number) => wheel(tab.id!, x, y);
        const known = fresh !== 'all' ? await seenKeys(scopeOf(config.kind, source, [name])) : null;
        const res = await crawlVertical(tab.id!, config.kind, { maxPages: maxPages || 500, maxItems, speed, signal, status, progress, interactive, onBotCheck, wheel: wheelAt, known }).finally(() => releaseWheel(tab.id!));
        rows = res.rows;
        note = `${res.stopped}. ${rows.length} ${v.label} from ${res.pages} ${res.pages === 1 ? 'page' : 'pages'}${res.loads ? `, loading more ${res.loads} ${res.loads === 1 ? 'time' : 'times'}` : ''}.`;
      } else if (source === 'boards') {
        name = inputs.length === 1 ? hostOf(inputs[0]) || inputs[0] : `${inputs.length} companies`;
        const found: string[] = [];
        const failed: string[] = [];
        for (const [i, input] of inputs.entries()) {
          if (signal.aborted) break;
          status(`Finding the job board for ${input}`);
          try {
            const list = await resolveBoards(input, signal);
            if (!list.length) throw new Error('no supported job board found on that page');
            for (const b of list) {
              status(`Reading ${ATS_NAMES[b.ats]} jobs for ${b.slug}`);
              const jobs = await atsJobs(b.ats, b.slug, signal);
              rows.push(...jobs);
              found.push(`${b.slug} (${ATS_NAMES[b.ats]}, ${jobs.length})`);
            }
          } catch (e: any) {
            failed.push(`${input}: ${e?.message ?? e}`);
          }
          progress(i + 1, inputs.length, failed.length);
        }
        if (!rows.length && failed.length) throw new Error(`No jobs found. ${failed.join('. ')}`);
        note = `${rows.length} jobs from ${found.join(', ')}.${failed.length ? ` Not found: ${failed.join('; ')}.` : ''}`;
      } else if (source === 'feeds') {
        name = inputs.length === 1 ? hostOf(inputs[0]) : `${inputs.length} feeds`;
        const res = await runPool(
          inputs,
          async (u) => {
            let res = await fetch(u, { signal });
            let text = await res.text();
            // A site address instead of a feed: use the feed it advertises
            if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(text.slice(0, 2000))) {
              const doc = new DOMParser().parseFromString(text, 'text/html');
              const feed = feedLinks(doc, res.url || u)[0];
              if (!feed) throw new Error(`${hostOf(u)} doesn't advertise an RSS feed`);
              res = await fetch(feed, { signal });
              text = await res.text();
            }
            return parseFeed(text, res.url || u);
          },
          { concurrency: 3, delayMs: 200, signal, onProgress: (d, t, e) => progress(d, t, e) },
        );
        rows = res.flatMap((r) => (r instanceof Error ? [] : r));
        const errs = res.filter((r) => r instanceof Error) as Error[];
        if (!rows.length) throw new Error(errs[0]?.message ?? 'No articles in these feeds.');
        if (fullText) {
          status(`Reading ${rows.length} articles in full`);
          const full = await runPool(rows, (r) => withPage(r.url, load.mode, signal, (p) => p.run((d, x) => extractArticle(d, x), 'vertical', 'articles').then((a: any) => (Array.isArray(a) ? a[0] : a))), {
            concurrency: load.concurrency,
            delayMs: load.delay,
            signal,
            onProgress: (d, t, e) => progress(d, t, e),
          });
          rows = rows.map((r, i) => (full[i] instanceof Error ? r : { ...r, ...Object.fromEntries(Object.entries(full[i] as Row).filter(([, val]) => val)) }));
        }
        note = `${rows.length} articles from ${inputs.length} ${inputs.length === 1 ? 'feed' : 'feeds'}.${errs.length ? ` ${errs.length} feeds couldn't be read.` : ''}`;
      } else if (source === 'sections') {
        name = inputs.length === 1 ? hostOf(inputs[0]) : `${inputs.length} pages`;
        status('Finding articles on these pages');
        const lists = await runPool(inputs, (u) => withPage(u, load.mode, signal, (p) => p.run((d, x) => articleLinks(d, x, perSection), 'articleLinks', perSection)), {
          concurrency: load.concurrency,
          delayMs: load.delay,
          signal,
          onProgress: (d, t, e) => progress(d, t, e),
        });
        const links = [...new Set(lists.flatMap((l) => (l instanceof Error ? [] : (l as { url: string }[]).slice(0, perSection).map((x) => x.url))))];
        if (!links.length) throw new Error('No article links found on these pages. Paste article links directly, or use the site’s RSS feed.');
        status(`Reading ${links.length} articles`);
        const res = await runPool(links, (u) => readPage(u, signal), { concurrency: load.concurrency, delayMs: load.delay, signal, onProgress: (d, t, e) => progress(d, t, e) });
        rows = res.flatMap((r) => (r instanceof Error ? [] : r));
        note = `${rows.length} articles from ${links.length} links on ${inputs.length} ${inputs.length === 1 ? 'page' : 'pages'}.`;
      } else {
        name = inputs.length === 1 ? hostOf(inputs[0]) : `${inputs.length} pages`;
        status(`Reading ${inputs.length} pages`);
        const res = await runPool(inputs, (u) => readPage(u, signal), { concurrency: load.concurrency, delayMs: load.delay, signal, onProgress: (d, t, e) => progress(d, t, e) });
        rows = res.flatMap((r) => (r instanceof Error ? [] : r));
        const errs = res.filter((r) => r instanceof Error).length;
        note = `${rows.length} ${v.label} from ${inputs.length - errs} of ${inputs.length} pages.`;
      }

      rows = dedupeRows(rows, v.key);
      if (!rows.length) throw new Error(`No ${v.label} found. ${source === 'tab' ? 'Open a search results page or a single listing, then run again.' : ''}`);

      // Full details from each result's own page
      if (openEach && config.openEach) {
        const withUrl = rows.filter((r) => r.url && /^https?:/.test(r.url));
        status(`Opening ${withUrl.length} ${v.label} for full details`);
        const detail = await runPool(withUrl, (r) => readPage(r.url, signal), { concurrency: load.concurrency, delayMs: Math.max(load.delay, 500), signal, onProgress: (d, t, e) => progress(d, t, e) });
        const byUrl = new Map(withUrl.map((r, i) => [r.url, detail[i]]));
        rows = rows.map((r) => {
          const d = byUrl.get(r.url);
          const best = d && !(d instanceof Error) ? (d as Row[]).find((x) => x.url === r.url) ?? (d as Row[])[0] : null;
          // The card's values stay; the page fills in what the card didn't show
          return best ? { ...best, ...Object.fromEntries(Object.entries(r).filter(([, val]) => val)), source: `${r.source}, detail page` } : r;
        });
      }

      const before = rows.length;
      rows = filterRows(rows);
      if (before !== rows.length) note += ` ${before - rows.length} left out by your filters.`;
      if (fresh !== 'all') {
        const total = rows.length;
        const r = await compareWithEarlier(scopeOf(config.kind, source, source === 'tab' ? [name] : inputs), rows, v.key, fresh);
        rows = r.rows;
        note += freshNote(fresh, r, total, v.label);
      }

      const keys = new Set(rows.flatMap((r) => Object.keys(r)));
      const columns: Column[] = [
        ...(keys.has(NEW_COLUMN) ? [{ key: NEW_COLUMN, label: 'new since last run' }] : []),
        ...v.columns.filter(([k]) => keys.has(k)).map(([key, label]) => ({ key, label })),
        ...[...keys].filter((k) => k !== NEW_COLUMN && !v.columns.some(([c]) => c === k)).map((k) => ({ key: k, label: k.replace(/_/g, ' ') })),
      ];
      if (config.kind === 'reviews') {
        const s = summarizeReviews(rows);
        setSummary(s);
        note += ` Average ${s.average} from ${s.count} reviews; ${s.positive} positive, ${s.negative} negative.`;
      }
      const label = { jobs: 'Jobs', realestate: 'Properties', travel: 'Places', business: 'Businesses', articles: 'Articles', reviews: 'Reviews' }[config.kind];
      return saveDataset({ ...newDataset(config.kind, `${label} ${name}`, source === 'tab' ? name : inputs[0] ?? '', columns, rows), note: note.trim() });
    });
  }

  const ready = source === 'tab' || inputs.length > 0;
  const plural = (n: number, one: string, many: string) => (n ? `${n} ${n === 1 ? one : many}` : many);
  const startLabel =
    source === 'tab' ? `Read ${v.label}` : source === 'boards' ? `Read ${plural(inputs.length, 'job board', 'job boards')}` : source === 'feeds' ? `Read ${plural(inputs.length, 'feed', 'feeds')}` : `Read ${plural(inputs.length, 'page', 'pages')}`;

  return (
    <div className="flex flex-1 flex-col gap-5">
      <Section title="Source">
        <p className="text-[12.5px] leading-relaxed text-muted">{config.intro}</p>
        {config.sources.length > 1 && <Segmented label="Source" value={source} onChange={setSource} options={config.sources} />}
        {source === 'tab' && (
          <>
            <p className="text-[12px] leading-relaxed text-muted">Open a search results page (or one listing) in this tab. Gleaner reads it, then moves through the next pages.</p>
            <PagingControls maxPages={maxPages} onChange={setMaxPages} />
            <Field label="Pace between pages" help={SPEEDS[speed].label}>
              {() => (
                <Segmented
                  label="Pace between pages"
                  value={speed}
                  onChange={setSpeed}
                  options={[
                    { value: 'gentle', label: 'Gentle' },
                    { value: 'normal', label: 'Normal' },
                    { value: 'fast', label: 'Fast' },
                  ]}
                />
              )}
            </Field>
          </>
        )}
        {source === 'boards' && (
          <Field
            label={`Companies${inputs.length ? ` (${inputs.length})` : ''}`}
            help="One per line: a careers page (acme.com/careers) or a job board link. Works with Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee and Workable, which publish their job lists for career pages."
          >
            {(id) => <textarea id={id} rows={5} value={boards} onChange={(e) => setBoards(e.target.value)} spellCheck={false} placeholder={'https://boards.greenhouse.io/airbnb\nhttps://jobs.lever.co/palantir\nhttps://www.example.com/careers'} className={inputCls + ' resize-y font-mono text-[12px] leading-relaxed'} />}
          </Field>
        )}
        {(source === 'urls' || source === 'feeds' || source === 'sections') && (
          <UrlSource
            value={urls}
            onChange={setUrls}
            help={source === 'feeds' ? 'RSS or Atom feed addresses, or a site’s homepage (its feed is found for you).' : source === 'sections' ? 'News homepages, section pages or blog indexes. The articles linked from them are read.' : config.kind === 'articles' ? 'Article links, one per line.' : 'Search results or listing pages, one per line.'}
          />
        )}
        {source === 'sections' && <Field label="Articles per page">{(id) => <NumberInput id={id} value={perSection} onChange={setPerSection} min={1} max={200} />}</Field>}
        {source === 'feeds' && (
          <Check checked={fullText} onChange={setFullText}>
            Read each article in full (author, word count, full text)
          </Check>
        )}
      </Section>

      {config.filters === 'jobs' && (
        <Section title="Filters">
          <Field label="Keyword in title or description">{(id) => <input id={id} value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="e.g. cosmetic, python" className={inputCls} />}</Field>
          <Segmented
            label="Workplace"
            value={workplace}
            onChange={setWorkplace}
            options={[
              { value: 'any', label: 'Any' },
              { value: 'remote', label: 'Remote' },
              { value: 'hybrid', label: 'Hybrid' },
              { value: 'on-site', label: 'On-site' },
            ]}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Posted within (days)" help="0 means any date">{(id) => <NumberInput id={id} value={days} onChange={setDays} min={0} max={365} />}</Field>
            <Field label="Minimum salary" help="Jobs without a salary are left out">{(id) => <NumberInput id={id} value={minSalary} onChange={setMinSalary} min={0} />}</Field>
          </div>
        </Section>
      )}
      {config.filters === 'articles' && (
        <Section title="Filters">
          <Field label="Keyword">{(id) => <input id={id} value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="e.g. sunscreen" className={inputCls} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Published on or after">{(id) => <input id={id} type="date" value={since} onChange={(e) => setSince(e.target.value)} className={inputCls} />}</Field>
            <Field label="Minimum words">{(id) => <NumberInput id={id} value={minWords} onChange={setMinWords} min={0} />}</Field>
          </div>
        </Section>
      )}

      <Section title="Options">
        {config.openEach && (
          <Check checked={openEach} onChange={setOpenEach}>
            {config.openEach}
          </Check>
        )}
        <p className="text-[12px] font-medium first-letter:uppercase">{v.label} from earlier runs</p>
        <Segmented
          label={`${v.label} from earlier runs`}
          value={fresh}
          onChange={setFresh}
          options={[
            { value: 'all', label: 'Keep all' },
            { value: 'mark', label: 'Mark new' },
            { value: 'only', label: 'Only new' },
          ]}
        />
        <p className="text-[12px] leading-snug text-muted">
          {fresh === 'all'
            ? 'Every run keeps everything it finds.'
            : `Compares with earlier runs of this search: ${fresh === 'mark' ? 'keeps everything and marks what is new' : 'keeps only what is new'}.${config.kind === 'reviews' ? ' Sort the reviews by newest first, and Gleaner stops as soon as it reaches the ones you already have.' : ''}`}
        </p>
        <Field label={`Most ${v.label} to keep`}>{(id) => <NumberInput id={id} value={maxItems} onChange={setMaxItems} min={1} max={100000} />}</Field>
        {source !== 'tab' && source !== 'boards' && <LoadOptions value={load} onChange={setLoad} />}
      </Section>

      {summary && summary.count > 0 && (
        <section aria-label="Review summary" className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-display text-[15px] font-semibold tracking-tight">What reviewers say</h3>
            <span className="font-mono text-[12px] tabular-nums text-muted">
              {summary.average || '-'} average, {summary.count} reviews
            </span>
          </div>
          <ul className="flex flex-col gap-1" aria-label="Rating spread">
            {(['5', '4', '3', '2', '1'] as const).map((n) => {
              const c = summary.distribution[n];
              const pct = summary.count ? Math.round((c / summary.count) * 100) : 0;
              return (
                <li key={n} className="grid grid-cols-[3.5rem_1fr_3rem] items-center gap-2 text-[12px]">
                  <span className="whitespace-nowrap font-mono tabular-nums text-muted">{n} star</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="text-right font-mono tabular-nums text-muted">{pct}%</span>
                </li>
              );
            })}
          </ul>
          <p className="text-[12px] text-muted">
            Sentiment: {summary.positive} positive, {summary.neutral} neutral, {summary.negative} negative{summary.verified ? `. ${summary.verified} verified purchases.` : '.'}
          </p>
          {summary.praise.length > 0 && (
            <p className="text-[12.5px]">
              <span className="font-medium">Praised:</span> <span className="text-muted">{summary.praise.join(', ')}</span>
            </p>
          )}
          {summary.complaints.length > 0 && (
            <p className="text-[12.5px]">
              <span className="font-medium">Complaints:</span> <span className="text-muted">{summary.complaints.join(', ')}</span>
            </p>
          )}
        </section>
      )}

      <div className="flex-1" />
      <RunBar job={job} onStart={start} startLabel={startLabel} disabled={!ready} />
    </div>
  );
}
