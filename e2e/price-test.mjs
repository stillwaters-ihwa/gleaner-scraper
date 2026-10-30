// E2E: competitor price tracking + MAP violation evidence, and pause-on-bot-check resume.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [extArg, shots] = process.argv.slice(2);
// Edge only loads an unpacked extension from an absolute path
const ext = path.resolve(extArg);
fs.mkdirSync(shots, { recursive: true });
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const PORT = 8770;
const BASE = `http://localhost:${PORT}`;
const SPORT = 8771; // the k-beauty-style store fixture for the bot-check test
const SBASE = `http://localhost:${SPORT}`;
const price = spawn(process.execPath, [path.join(here, 'price-fixture.mjs'), String(PORT)], { stdio: 'inherit' });
const store = spawn(process.execPath, [path.join(here, 'fixture-store.mjs'), String(SPORT)], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 900));
const set = (q) => fetch(`${BASE}/__set?${q}`).then((r) => r.json());
await fetch(`${SBASE}/__control?fail=${encodeURIComponent('{}')}&gap=0`);
const R = {};

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gl-p-')), {
  headless: true,
  channel: 'msedge',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1280, height: 900 },
});
try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await (await import('./sw.mjs')).waitForSw(ctx);
  const id = new URL(sw.url()).host;
  const panel = await ctx.newPage();
  panel.setViewportSize({ width: 460, height: 1600 });
  panel.on('pageerror', (e) => console.log('[panel error]', e.message));
  panel.on('console', (m) => m.type() === 'error' && console.log('[panel console]', m.text().slice(0, 200)));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);

  const tracker = () =>
    panel.evaluate(async () => {
      const db = await new Promise((res) => { const r = indexedDB.open('gleaner'); r.onsuccess = () => res(r.result); });
      const all = await new Promise((res) => { const q = db.transaction('trackers').objectStore('trackers').getAll(); q.onsuccess = () => res(q.result); });
      return all[0];
    });
  const shotCount = () =>
    panel.evaluate(async () => {
      const db = await new Promise((res) => { const r = indexedDB.open('gleaner'); r.onsuccess = () => res(r.result); });
      return new Promise((res) => { const q = db.transaction('shots').objectStore('shots').count(); q.onsuccess = () => res(q.result); });
    });

  // ---------- Price tracking ----------
  await panel.getByRole('button', { name: /Price tracking/ }).click();
  await panel.getByRole('button', { name: /Track a product/ }).first().click();
  await panel.getByLabel('Name for this tracker').fill('Heartleaf Cleanser 150ml');
  await panel.getByLabel('Product name').fill('ANUA Heartleaf Pore Control Cleanser 150ml');
  await panel.getByLabel('Brand').fill('ANUA');
  await panel.getByLabel('SKU').fill('ANUA-HC-150');
  await panel.getByLabel('Your price').fill('16.00');
  await panel.getByLabel('MAP', { exact: true }).fill('12.00');
  await panel.getByLabel('Currency').fill('USD');
  await panel.getByLabel('Competitor product pages').fill(['a', 'b', 'c', 'd'].map((k) => `${BASE}/store-${k}/product`).join('\n'));
  // keep evidence on (default)
  await panel.getByRole('button', { name: /Start tracking/ }).click();
  await new Promise((r) => setTimeout(r, 1500));
  R.formError = await panel.getByRole('alert').first().innerText().catch(() => '');
  R.trackerCount = await panel.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('gleaner'); r.onsuccess = () => res(r.result); });
    return new Promise((res) => { const q = db.transaction('trackers').objectStore('trackers').count(); q.onsuccess = () => res(q.result); });
  });
  await panel.screenshot({ path: `${shots}/p0-aftersave.png`, fullPage: true });

  // The first check runs automatically; wait for both sources to report
  await panel.waitForFunction(() => !!document.querySelector('[id^="tracker-"]'), null, { timeout: 20000 });
  for (let i = 0; i < 60; i++) {
    const t = await tracker();
    if (t?.sources?.every((s) => s.checkedAt) && t.lastStatus === 'ok') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  let t = await tracker();
  R.firstRun = {
    status: t.lastStatus,
    message: t.lastMessage,
    sources: t.sources.map((s) => ({ url: s.url.split('/').slice(-2, -1)[0], price: s.lastPrice, cur: s.lastCurrency, matched: s.matched, by: s.matchBy, score: s.matchScore, comparable: s.comparable, inStock: s.lastInStock, violation: s.violation, shot: !!s.shotId, err: s.error })),
    history: t.history.length,
    lastAlert: t.lastAlert,
  };
  R.shotsAfterFirst = await shotCount();
  await panel.screenshot({ path: `${shots}/p1-tracked.png`, fullPage: true });

  // Store A drops below MAP and store B restocks; check again -> new violation + restock + drop alert
  await set('a_price=10.5&b_stock=50');
  await panel.getByRole('button', { name: /Check .* now/ }).first().click();
  for (let i = 0; i < 60; i++) {
    t = await tracker();
    if (t.lastStatus === 'ok' && t.sources.some((s) => s.lastPrice === 10.5)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  t = await tracker();
  R.secondRun = {
    sources: t.sources.map((s) => ({ url: s.url.split('/').slice(-2, -1)[0], price: s.lastPrice, violation: s.violation, inStock: s.lastInStock, shot: !!s.shotId })),
    history: t.history.length,
    lastAlert: t.lastAlert,
  };
  R.shotsAfterSecond = await shotCount();

  // The 300ml page didn't match: mark it as a different product from the panel
  await panel.getByRole('button', { name: 'Not this product' }).first().click();
  for (let i = 0; i < 20; i++) {
    t = await tracker();
    if (t.sources.some((s) => s.decision === 'rejected')) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  R.rejected = t.sources.filter((s) => s.decision).map((s) => ({ url: s.url.split('/').slice(-2, -1)[0], decision: s.decision }));
  await panel.screenshot({ path: `${shots}/p1b-decided.png`, fullPage: true });

  // Evidence screenshot opens and is a real JPEG data URL
  R.shotOk = await panel.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('gleaner'); r.onsuccess = () => res(r.result); });
    const all = await new Promise((res) => { const q = db.transaction('shots').objectStore('shots').getAll(); q.onsuccess = () => res(q.result); });
    const s = all[0];
    return s ? { store: s.store, price: s.price, map: s.map, isJpeg: s.dataUrl.startsWith('data:image/jpeg'), bytes: s.dataUrl.length } : null;
  });

  // ---------- Pause on bot check, then resume ----------
  // Pages 3+ return a bot check from the start. The interactive crawl should read pages 1-2,
  // pause on page 3 asking for a human, and resume once the check clears.
  await fetch(`${SBASE}/__control?botFrom=3&gap=0`);
  const site = await ctx.newPage();
  await site.goto(`${SBASE}/Product/Best`);
  await site.bringToFront();
  await panel.getByRole('button', { name: 'Tools', exact: true }).click();
  await panel.getByRole('button', { name: /Store extractor/ }).click();
  await panel.getByLabel('Store address').fill(`${SBASE}/Product/Best`);
  await panel.getByRole('button', { name: 'Check' }).filter({ visible: true }).first().click();
  await panel.getByText(/ runs on /).filter({ visible: true }).first().waitFor({ timeout: 30000 });
  await panel.getByRole('radio', { name: 'This page' }).click();
  await panel.getByRole('radio', { name: 'Up to a number' }).click();
  await panel.getByLabel('Number of pages').fill('6');
  await panel.getByRole('radio', { name: 'Fast' }).click();

  const countSets = () => panel.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('gleaner'); r.onsuccess = () => res(r.result); });
    return new Promise((res) => { const q = db.transaction('datasets').objectStore('datasets').count(); q.onsuccess = () => res(q.result); });
  });
  const before = await countSets();
  await panel.getByRole('button', { name: /Extract products/ }).click();

  // Wait until the status says it's waiting for a human (paused on the bot check)
  let sawPause = false;
  for (let i = 0; i < 40; i++) {
    const msg = await panel.locator('[aria-live=polite] .text-muted, [aria-live=polite] span').first().innerText().catch(() => '');
    if (/needs a human|verify you are human|solve the check/i.test(msg)) { sawPause = true; R.pauseMsg = msg; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  R.sawBotPause = sawPause;
  await panel.screenshot({ path: `${shots}/p2-botpause.png`, fullPage: true });

  // Clear the bot check and reload the page, as solving a real CAPTCHA would. The crawl is
  // polling the page's health, so it should see the page recover and carry on.
  await fetch(`${SBASE}/__control?botFrom=0`);
  await site.reload().catch(() => {});
  for (let i = 0; i < 90; i++) {
    if ((await countSets()) > before) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const ds = await panel.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('gleaner'); r.onsuccess = () => res(r.result); });
    const all = await new Promise((res) => { const q = db.transaction('datasets').objectStore('datasets').getAll(); q.onsuccess = () => res(q.result); });
    all.sort((a, b) => b.createdAt - a.createdAt);
    return all[0];
  });
  R.resumed = { rows: ds?.rows?.length ?? 0, note: ds?.note ?? '' };
} catch (e) {
  console.log('FAILED', e.message, e.stack?.split('\n').slice(0, 3).join(' | '));
  await ctx.pages()[0]?.screenshot({ path: `${shots}/pfail.png`, fullPage: true }).catch(() => {});
} finally {
  console.log(JSON.stringify(R, null, 2));
  await ctx.close();
  price.kill();
  store.kill();
}
