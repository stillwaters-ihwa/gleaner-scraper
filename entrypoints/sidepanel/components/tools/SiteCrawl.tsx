// Site crawler: every page of a website, with Scrapling's Spider running in Gleaner's helper on this
// computer. Same site only, robots.txt obeyed, a polite wait between pages; a stopped crawl can be
// continued later.
import { useEffect, useState } from 'react';
import { ArrowsClockwise, DownloadSimple } from '@phosphor-icons/react';
import { newDataset, saveDataset, type Column } from '@/lib/db';
import { crawlStatus, installScrapling, scraplingStatus, startCrawl, stopCrawl, type ScraplingStatus } from '@/lib/scrapling';
import { activeTab, isRestricted } from '@/lib/tab';
import { Button, Check, Field, Notice, NumberInput, Section, inputCls } from '../ui';
import { RunBar, hostOf, useJob } from '../run';

const COLUMNS: Column[] = [
  { key: 'url', label: 'url' },
  { key: 'status', label: 'status' },
  { key: 'depth', label: 'clicks from start' },
  { key: 'title', label: 'title' },
  { key: 'description', label: 'meta description' },
  { key: 'h1', label: 'h1' },
  { key: 'canonical', label: 'canonical' },
  { key: 'lang', label: 'language' },
  { key: 'words', label: 'words' },
  { key: 'links_internal', label: 'links to this site' },
  { key: 'links_external', label: 'links to other sites' },
];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Engine({ status, onRecheck }: { status: ScraplingStatus | null; onRecheck: (s: ScraplingStatus) => void }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  if (!status) return <p className="text-[12.5px] text-muted">Checking Gleaner's Scrapling engine…</p>;
  if (status.installed)
    return (
      <p className="text-[12.5px] text-muted">
        Runs on Scrapling {status.scrapling} in Gleaner's helper on this computer. Pages are read with your browser's own identity: no disguise, no CAPTCHA solving.
      </p>
    );
  if (!status.helper)
    return (
      <Notice tone="error">
        Gleaner's helper isn't set up on this computer. Run <b>Install Gleaner</b> (or <b>helper\install.cmd</b> in Gleaner's folder), then click Check again.
      </Notice>
    );
  const install = async () => {
    setError('');
    setBusy('Starting');
    try {
      onRecheck(await installScrapling(setBusy));
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <Notice>
        The Site crawler uses Scrapling, a Python scraping library. Gleaner installs it into its own folder on this computer (about 100 MB, a few minutes).
        {status.python === false && ' Python 3.10 or newer is needed first: run Install Gleaner, or in PowerShell: winget install Python.Python.3.12'}
      </Notice>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <Button variant="primary" onClick={install} disabled={!!busy || status.python === false}>
          <DownloadSimple size={15} aria-hidden /> {busy ? `${busy}…` : 'Install Scrapling'}
        </Button>
        <Button onClick={async () => onRecheck(await scraplingStatus())} disabled={!!busy}>
          <ArrowsClockwise size={15} aria-hidden /> Check again
        </Button>
      </div>
    </div>
  );
}

export function SiteCrawl() {
  const [status, setStatus] = useState<ScraplingStatus | null>(null);
  const [start, setStart] = useState('');
  const [maxPages, setMaxPages] = useState(200);
  const [depth, setDepth] = useState(3);
  const [delay, setDelay] = useState(500);
  const [concurrency, setConcurrency] = useState(4);
  const [robots, setRobots] = useState(true);
  const [resume, setResume] = useState(false);
  const job = useJob();

  useEffect(() => {
    scraplingStatus().then(setStatus, (e) => setStatus({ helper: false, installed: false, error: String(e?.message ?? e) }));
    activeTab()
      .then((t) => !isRestricted(t.url) && t.url && setStart((s) => s || new URL(t.url!).origin + '/'))
      .catch(() => {});
  }, []);

  function run() {
    job.start(
      async ({ signal, progress, status: say }) => {
        const url = start.trim();
        if (!/^https?:\/\//i.test(url)) throw new Error('Enter the address of a website, like https://example.com');
        say('Starting the crawl');
        const { id } = await startCrawl({ start_url: url, max_pages: maxPages, max_depth: depth, delay: delay / 1000, concurrency, obey_robots: robots, resume, ua: navigator.userAgent });
        const rows: Record<string, string>[] = [];
        let cursor = 0;
        let stopping = false;
        for (;;) {
          if (signal.aborted && !stopping) {
            stopping = true;
            say('Stopping: finishing the pages already asked for');
            await stopCrawl(id).catch(() => {});
          }
          const s = await crawlStatus(id, cursor);
          rows.push(...s.items);
          cursor = s.cursor;
          progress(rows.length, maxPages);
          if (!stopping) say(`Crawled ${rows.length} pages${s.robots_skipped ? `, ${s.robots_skipped} skipped by robots.txt` : ''}`);
          if (s.done) {
            if (s.error && !rows.length) throw new Error(`The crawl failed: ${s.error}`);
            const parts = [
              `${rows.length} pages crawled with Scrapling in ${Math.round(s.seconds)} s`,
              s.robots_skipped ? `${s.robots_skipped} left out because robots.txt asks crawlers not to visit them` : '',
              stopping ? 'Stopped early: run again with "Continue the last crawl of this site" to pick up where it left off' : rows.length >= maxPages ? `Reached the ${maxPages} page limit` : '',
              s.error ? `Note: ${s.error}` : '',
            ].filter(Boolean);
            return saveDataset({ ...newDataset('sitecrawl', `Site ${hostOf(url)}`, url, COLUMNS, rows), note: parts.join('. ') + '.' });
          }
          await wait(800);
        }
      },
      { needsHostAccess: false },
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <Section title="Scrapling engine">
        <Engine status={status} onRecheck={setStatus} />
      </Section>
      <Section title="Website">
        <Field label="Start page" help="Gleaner follows links from here to every page of the same site.">
          {(id) => <input id={id} className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} placeholder="https://example.com" />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Most pages">{(id) => <NumberInput id={id} value={maxPages} onChange={setMaxPages} min={1} max={20000} />}</Field>
          <Field label="Clicks from the start page">{(id) => <NumberInput id={id} value={depth} onChange={setDepth} min={0} max={20} />}</Field>
          <Field label="Wait between pages (ms)">{(id) => <NumberInput id={id} value={delay} onChange={setDelay} min={0} max={30000} />}</Field>
          <Field label="Pages at once">{(id) => <NumberInput id={id} value={concurrency} onChange={setConcurrency} min={1} max={8} />}</Field>
        </div>
        <Check checked={robots} onChange={setRobots}>
          Follow the site's robots.txt
          <span className="block text-[12px] text-muted">Leaves out the pages the site asks crawlers not to visit, and keeps to its crawl delay.</span>
        </Check>
        <Check checked={resume} onChange={setResume}>
          Continue the last crawl of this site
          <span className="block text-[12px] text-muted">Picks up a stopped crawl where it left off instead of starting again.</span>
        </Check>
      </Section>
      <RunBar job={job} onStart={run} startLabel="Crawl site" disabled={!status?.installed || !start.trim()} />
    </div>
  );
}
