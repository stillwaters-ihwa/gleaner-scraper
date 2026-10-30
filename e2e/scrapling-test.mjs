// Scrapling in Edge, through Gleaner's real helper and the Scrapling engine installed on this
// computer (%LOCALAPPDATA%\Gleaner\scrapling): the Site crawler (robots.txt, page limit, stop and
// continue) and lists that find themselves again after a site's layout changes.
//   node e2e/scrapling-test.mjs .output/chrome-mv3-e2e e2e/shots
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [extArg, shots] = process.argv.slice(2);
const ext = path.resolve(extArg);
fs.mkdirSync(shots, { recursive: true });
const PORT = 8790;
const BASE = `http://127.0.0.1:${PORT}`;
const R = { errors: [] };
const log = (...a) => console.log('[s]', ...a);

// ---------- test site ----------
let layout = 1;
const PAGES = 40;
const items = Array.from({ length: 12 }, (_, i) => ({ name: `Heartleaf Toner ${i + 1}`, price: `$${(15 + i).toFixed(2)}`, url: `/p/${i + 1}` }));
const shop = () => {
  const inner = (cls) => items.map((it) => `<div class="${cls}"><h3 class="name">${it.name}</h3><span class="price">${it.price}</span><a href="${it.url}">View</a></div>`).join('');
  const body =
    layout === 1 ? `<div id="list">${inner('product')}</div>` : layout === 2 ? `<div id="products">${inner('product-card tile')}</div>` : `<main><section class="catalog">${inner('catalog-entry')}</section></main>`;
  return `<!doctype html><html><head><title>Toners | Glow Shop</title></head><body><header><a href="/">Glow Shop</a></header><h1>Toners</h1>${body}<footer>Glow Shop</footer></body></html>`;
};
const sitePage = (n, ua) =>
  `<!doctype html><html lang="en"><head><title>Guide ${n}</title><meta name="description" content="Guide page ${n}"></head><body><h1>Guide ${n}</h1><p>Seen as: ${ua}</p>${Array.from({ length: 3 }, (_, k) => n + k + 1)
    .filter((k) => k < PAGES)
    .map((k) => `<a href="/site/page/${k}">Guide ${k}</a>`)
    .join(' ')} <a href="/site/private/admin">Admin</a> <a href="https://example.org/elsewhere">Elsewhere</a></body></html>`;
const seenUa = new Set();
const server = http
  .createServer((req, res) => {
    const u = new URL(req.url, BASE);
    const send = (type, body, code = 200) => (res.writeHead(code, { 'content-type': type }), res.end(body));
    if (u.pathname === '/robots.txt') return send('text/plain', 'User-agent: *\nDisallow: /site/private\n');
    if (u.pathname === '/__layout') return (layout = Number(u.searchParams.get('v'))), send('text/plain', 'ok');
    if (u.pathname === '/shop') return send('text/html', shop());
    if (u.pathname.startsWith('/site/private')) return send('text/html', '<title>Admin</title>');
    if (u.pathname === '/site/' || u.pathname.startsWith('/site/page/')) {
      seenUa.add(req.headers['user-agent'] ?? '');
      // A little slow, so a crawl can be stopped part way
      return setTimeout(() => send('text/html', sitePage(Number(u.pathname.split('/').pop()) || 0, req.headers['user-agent'] ?? '')), 120);
    }
    send('text/html', '<h1>Not here</h1>', 404);
  })
  .listen(PORT);

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gl-s-')), {
  headless: true,
  channel: 'msedge',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1280, height: 900 },
});
let panel;
const step = async (name, fn) => {
  const t0 = Date.now();
  try {
    await fn();
  } catch (e) {
    R[name] = { ...(R[name] ?? {}), failed: String(e?.message ?? e).split('\n')[0].slice(0, 300) };
    await panel?.screenshot({ path: `${shots}/s-fail-${name}.png`, fullPage: true }).catch(() => {});
  }
  log(name, `${Math.round((Date.now() - t0) / 1000)}s`, R[name]?.failed ?? '');
};
try {
  const sw = await (await import('./sw.mjs')).waitForSw(ctx);
  const id = new URL(sw.url()).host;
  const site = await ctx.newPage();
  panel = await ctx.newPage();
  panel.on('pageerror', (e) => R.errors.push(e.message));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  const db = (store) =>
    panel.evaluate(async (s) => {
      const d = await new Promise((r) => { const q = indexedDB.open('gleaner'); q.onsuccess = () => r(q.result); });
      return new Promise((r) => { const q = d.transaction(s).objectStore(s).getAll(); q.onsuccess = () => r(q.result); });
    }, store);
  const run = async (label, timeout = 240000) => {
    const before = (await db('datasets')).length;
    await panel.getByRole('button', { name: label }).filter({ visible: true }).last().click();
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const all = await db('datasets');
      if (all.length > before) return all.sort((a, b) => b.createdAt - a.createdAt)[0];
      const err = await panel.locator('[role=alert]').filter({ visible: true }).first().innerText().catch(() => '');
      if (err) throw new Error('run error: ' + err);
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('timed out');
  };
  const openTool = async (name) => {
    await panel.getByRole('button', { name: 'Tools', exact: true }).click();
    await panel.getByRole('button', { name: new RegExp('^' + name) }).first().click();
  };

  // ---------- The engine: the helper updates itself, then starts Scrapling ----------
  await step('engine', async () => {
    await site.goto(`${BASE}/site/`);
    await site.bringToFront();
    await openTool('Site crawler');
    await panel.getByText(/Runs on Scrapling|Install Scrapling|helper isn't set up/).filter({ visible: true }).first().waitFor({ timeout: 90000 });
    R.engine = { text: await panel.getByText(/Runs on Scrapling/).first().innerText().catch(() => (panel.getByText(/Install Scrapling|helper isn't set up/).first().innerText())) };
    await panel.screenshot({ path: `${shots}/s1-site-crawler.png`, fullPage: true });
  });

  // ---------- A crawl: same site, robots.txt, page limit ----------
  await step('crawl', async () => {
    await panel.getByLabel('Start page', { exact: true }).fill(`${BASE}/site/`);
    await panel.getByLabel('Most pages', { exact: true }).fill('20');
    await panel.getByLabel('Clicks from the start page', { exact: true }).fill('20');
    await panel.getByLabel('Wait between pages (ms)', { exact: true }).fill('0');
    const ds = await run(/^Crawl site$/);
    R.crawl = {
      rows: ds.rows.length,
      unique: new Set(ds.rows.map((r) => r.url)).size,
      private: ds.rows.some((r) => /private/.test(r.url)),
      offsite: ds.rows.some((r) => !r.url.startsWith(BASE)),
      first: ds.rows.find((r) => r.url === `${BASE}/site/`),
      columns: ds.columns.map((c) => c.key),
      note: ds.note,
      uaIsBrowser: [...seenUa].every((u) => /Edg\//.test(u)),
    };
  });

  // ---------- Stop part way, then continue where it left off ----------
  await step('resume', async () => {
    await panel.getByLabel('Most pages', { exact: true }).fill('200');
    await panel.getByLabel('Pages at once', { exact: true }).fill('1');
    await panel.getByLabel('Wait between pages (ms)', { exact: true }).fill('300');
    const before = (await db('datasets')).length;
    await panel.getByRole('button', { name: /^Crawl site$/ }).click();
    await panel.getByText(/Crawled [4-9] pages|Crawled 1\d pages/).first().waitFor({ timeout: 60000 });
    await panel.getByRole('button', { name: /^Stop$/ }).click();
    let a;
    for (let i = 0; i < 120 && !a; i++) {
      const all = await db('datasets');
      if (all.length > before) a = all.sort((x, y) => y.createdAt - x.createdAt)[0];
      else await new Promise((r) => setTimeout(r, 500));
    }
    await panel.getByText('Continue the last crawl of this site').click();
    await panel.getByLabel('Pages at once', { exact: true }).fill('4');
    await panel.getByLabel('Wait between pages (ms)', { exact: true }).fill('0');
    const b = await run(/^Crawl site$/);
    const firstUrls = new Set(a.rows.map((r) => r.url));
    R.resume = { first: a.rows.length, firstNote: a.note, second: b.rows.length, overlap: b.rows.filter((r) => firstUrls.has(r.url)).length, together: new Set([...a.rows, ...b.rows].map((r) => r.url)).size, secondNote: b.note };
  });

  // ---------- A list that finds itself again after the site's layout changes ----------
  await step('heal', async () => {
    await fetch(`${BASE}/__layout?v=1`);
    await site.goto(`${BASE}/shop`);
    await site.bringToFront();
    await openTool('List extractor');
    await panel.getByRole('button', { name: 'Find list' }).click();
    await panel.getByText(/12\s*items/).first().waitFor({ timeout: 30000 });
    const first = await run(/^Extract$/);
    await panel.getByRole('button', { name: 'Save recipe' }).first().click();
    await panel.getByLabel('Recipe name', { exact: true }).fill('Glow toners');
    await panel.locator('form').getByRole('button', { name: 'Save recipe' }).click();
    await panel.getByText(/Saved recipe/).waitFor({ timeout: 10000 });
    const saved = (await db('recipes')).find((r) => r.name === 'Glow toners');

    // The shop renames its classes and its list
    await fetch(`${BASE}/__layout?v=2`);
    await site.reload();
    await site.bringToFront();
    // Run the saved recipe from Recipes, as on another day
    await panel.getByRole('button', { name: 'Back to tools' }).click();
    await panel.getByRole('button', { name: /^Recipes/ }).click();
    const beforeRun = (await db('datasets')).length;
    await panel.getByRole('button', { name: 'Run Glow toners' }).click();
    await panel.getByText(/found the list of "Glow toners" again with Scrapling/).waitFor({ timeout: 60000 });
    const afterUse = (await db('recipes')).find((r) => r.name === 'Glow toners');
    let second;
    for (let i = 0; i < 120 && !second; i++) {
      const all = await db('datasets');
      if (all.length > beforeRun) second = all.sort((x, y) => y.createdAt - x.createdAt)[0];
      else await new Promise((r) => setTimeout(r, 500));
    }

    // And again, mid-run: the list moves into a new section
    await fetch(`${BASE}/__layout?v=3`);
    await site.reload();
    await site.bringToFront();
    const third = await run(/^Extract$/);
    R.heal = {
      first: first.rows.length,
      savedSelector: saved?.itemSelector,
      healedSelector: afterUse?.itemSelector,
      adaptiveId: afterUse?.adaptiveId,
      second: second.rows.length,
      secondNames: second.rows.map((r) => Object.values(r).find((v) => /Heartleaf/.test(v))).filter(Boolean).length,
      third: third.rows.length,
      thirdNote: third.note,
    };
    await panel.screenshot({ path: `${shots}/s2-healed.png`, fullPage: true });
  });
} catch (e) {
  R.failure = String(e?.message ?? e).split('\n')[0];
} finally {
  console.log(JSON.stringify(R, null, 2));
  await ctx.close();
  server.close();
}
