// "Report a problem": one ZIP that shows what went wrong in a run, so it can be fixed in one
// round. It holds what the run said step by step, how it ended, a picture of the page, and what
// Gleaner found on the page (the product grid, the Next button, the page numbers, scrolling
// areas, pop-up windows). It is saved to Downloads for the person to look at and share.
import { browser } from 'wxt/browser';
import { zipSync, strToU8 } from 'fflate';
import { activeTab, call, isRestricted } from './tab';

export interface LogLine {
  at: string;
  tool: string;
  text: string;
}

const MAX_LINES = 400;
const lines: LogLine[] = [];

/** Notes a step of a run (kept in memory for the next report). */
export function logEvent(tool: string, text: string) {
  if (lines.length && lines[lines.length - 1].text === text && lines[lines.length - 1].tool === tool) return;
  lines.push({ at: new Date().toISOString(), tool, text: text.slice(0, 500) });
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
}

export const activity = () => lines.slice();

export interface ReportInput {
  /** The tool the report is about ('' for the home screen). */
  tool: string;
  /** How the last run ended, if there was one. */
  run?: { message?: string; error?: string; done?: number; total?: number; errors?: number; running?: boolean; rows?: number; dataset?: string };
  /** The person's own words: what they expected and what happened. */
  description?: string;
}

const safe = <T>(p: Promise<T>) => p.catch((e) => ({ failed: String((e as Error)?.message ?? e) }) as unknown as T);

/** What Gleaner can see on the page: the same checks the tools make, side by side. */
async function inspectPage(tabId: number) {
  const [facts] = await browser.scripting
    .executeScript({
      target: { tabId },
      func: () => {
        const doc = document.scrollingElement || document.documentElement;
        const scrollers = (Array.from(document.querySelectorAll('body *')) as HTMLElement[])
          .filter((el) => el.clientHeight >= 150 && el.scrollHeight > el.clientHeight + 40 && /auto|scroll|overlay/.test(getComputedStyle(el).overflowY))
          .slice(0, 5)
          .map((el) => ({ tag: el.tagName.toLowerCase(), id: el.id, class: String(el.className).slice(0, 80), height: el.clientHeight, contentHeight: el.scrollHeight, scrolledTo: Math.round(el.scrollTop) }));
        const pager = Array.from(document.querySelectorAll('nav, [class*="pagination" i], [class*="pager" i], [role="navigation"]'))
          .map((n) => (n as HTMLElement).innerText.replace(/\s+/g, ' ').trim())
          .filter((t) => /\d/.test(t) && t.length < 300)
          .slice(0, 3);
        return {
          url: location.href,
          title: document.title,
          readyState: document.readyState,
          window: { width: innerWidth, height: innerHeight, zoom: devicePixelRatio },
          page: { height: doc.scrollHeight, scrolledTo: Math.round(doc.scrollTop) },
          counts: { links: document.links.length, images: document.images.length, iframes: document.querySelectorAll('iframe').length, dialogs: document.querySelectorAll('[role="dialog"], dialog[open]').length },
          scrollers,
          pagerText: pager,
          language: document.documentElement.lang,
        };
      },
    })
    .catch((e) => [{ result: { failed: String(e?.message ?? e) } }]);
  return {
    ...(facts?.result as object),
    productGrid: await safe(call(tabId, 'findProductList')),
    pageHealth: await safe(call(tabId, 'pageHealth')),
    nextControl: await safe(call(tabId, 'findNextControl')),
    pagerForm: await safe(call(tabId, 'formPager')),
    googleLimitedView: await safe(call(tabId, 'limitedView')),
  };
}

function markdown(r: Record<string, any>, input: ReportInput, log: LogLine[]) {
  const L = [
    '# Gleaner problem report',
    '',
    `- Tool: ${input.tool || 'home screen'}`,
    `- When: ${r.when}`,
    `- Gleaner ${r.version}, ${r.browser}`,
    `- Page: ${r.page?.url ?? 'not readable'}`,
  ];
  if (input.description) L.push('', '## What happened (in your words)', '', input.description);
  if (input.run) {
    L.push('', '## How the run ended', '');
    if (input.run.error) L.push(`- Error: ${input.run.error}`);
    if (input.run.message) L.push(`- Last message: ${input.run.message}`);
    if (input.run.rows !== undefined) L.push(`- Rows saved: ${input.run.rows}${input.run.dataset ? ` (${input.run.dataset})` : ''}`);
    if (input.run.total) L.push(`- Progress: ${input.run.done} of ${input.run.total}${input.run.errors ? `, ${input.run.errors} failed` : ''}`);
    if (input.run.running) L.push('- The run was still going when this report was made.');
  }
  const p = r.page ?? {};
  if (!p.failed) {
    L.push('', '## What Gleaner sees on the page', '');
    L.push(`- Product grid: ${p.productGrid && !p.productGrid.failed ? `${p.productGrid.count} items (${p.productGrid.itemSelector})` : 'none found'}`);
    L.push(`- Next control: ${p.nextControl && !p.nextControl.failed ? `${p.nextControl.kind} "${p.nextControl.label}"` : 'none found'}`);
    L.push(`- Page check: ${p.pageHealth?.ok ? 'looks fine' : (p.pageHealth?.reason ?? 'unknown')}`);
    if (p.pagerText?.length) L.push(`- Pager text: ${p.pagerText.join(' / ')}`);
    if (p.scrollers?.length) L.push(`- Scrolling areas: ${p.scrollers.map((s: any) => `${s.tag}${s.id ? '#' + s.id : ''} ${s.height}/${s.contentHeight}px`).join(', ')}`);
    if (p.googleLimitedView === true) L.push('- Google Maps limited view (not signed in)');
  }
  L.push('', `## Last ${Math.min(log.length, 60)} steps`, '');
  for (const l of log.slice(-60)) L.push(`- ${l.at.slice(11, 19)} [${l.tool}] ${l.text}`);
  return L.join('\n') + '\n';
}

/** Builds the report ZIP and saves it to Downloads/Gleaner. Returns the file name. */
export async function saveReport(input: ReportInput): Promise<string> {
  const tab = await activeTab().catch(() => null);
  const readable = !!tab?.id && !isRestricted(tab.url);
  const page = readable ? await inspectPage(tab!.id!) : { failed: 'Browser pages and the web store cannot be read' };
  let shot: Uint8Array | null = null;
  if (readable) {
    try {
      const url = await browser.tabs.captureVisibleTab(tab!.windowId!, { format: 'png' });
      shot = new Uint8Array(await (await fetch(url)).arrayBuffer());
    } catch {
      /* the page may not allow screenshots */
    }
  }
  const log = activity();
  const r = {
    when: new Date().toString(),
    version: browser.runtime.getManifest().version,
    browser: navigator.userAgent,
    tool: input.tool,
    description: input.description ?? '',
    run: input.run ?? null,
    page,
  };
  const files: Record<string, Uint8Array> = {
    'README-FIRST.txt': strToU8(
      'This ZIP describes a problem in a Gleaner run, to send to whoever fixes Gleaner.\n\n' +
        'report.md: what happened, in plain words. report.json: the same for software.\n' +
        'activity.log: every step the tools reported, oldest first.\n' +
        (shot ? 'page.png: a picture of the page as it was. It may show personal details: look before you share.\n' : '') +
        '\nNothing has been sent anywhere. The page address is included.\n',
    ),
    'report.md': strToU8(markdown(r, input, log)),
    'report.json': strToU8(JSON.stringify(r, null, 2)),
    'activity.log': strToU8(log.map((l) => `${l.at}\t${l.tool}\t${l.text}`).join('\n') + '\n'),
  };
  if (shot) files['page.png'] = shot;
  const host = (() => {
    try {
      return new URL(tab?.url ?? '').hostname.replace(/^www\./, '') || 'gleaner';
    } catch {
      return 'gleaner';
    }
  })();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const name = `problem-report_${host}_${stamp}.zip`;
  const blob = new Blob([zipSync(files) as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  try {
    await browser.downloads.download({ url, filename: `Gleaner/${name}`, conflictAction: 'uniquify' });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  return name;
}
