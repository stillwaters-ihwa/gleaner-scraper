// Image downloader E2E: size classes, product/SKU names, size folders, ZIP, saved data, full-size upgrade.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [extArg, shots] = process.argv.slice(2);
// Edge only loads an unpacked extension from an absolute path
const ext = path.resolve(extArg);
fs.mkdirSync(shots, { recursive: true });
const PORT = 8766;
const BASE = `http://localhost:${PORT}`;
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const server = spawn(process.execPath, [path.join(here, 'fixture-store.mjs'), String(PORT)], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));
await fetch(`${BASE}/__control?fail=${encodeURIComponent('{}')}&gap=0`);
const R = {};
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-dl-'));

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gl-i-')), {
  headless: true,
  channel: 'msedge',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1200, height: 900 },
  acceptDownloads: true,
  downloadsPath: dlDir,
});
try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await (await import('./sw.mjs')).waitForSw(ctx);
  const id = new URL(sw.url()).host;
  const site = await ctx.newPage();
  const panel = await ctx.newPage();
  panel.setViewportSize({ width: 440, height: 1400 });
  panel.on('pageerror', (e) => console.log('[panel error]', e.message));
  panel.on('console', (m) => m.type() === 'error' && console.log('[panel console]', m.text().slice(0, 200)));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.getByRole('button', { name: /Image downloader/ }).click();

  const downloads = () =>
    panel.evaluate(async () => (await chrome.downloads.search({})).map((d) => ({ file: d.filename.split(/[\\/]/).slice(-3).join('/'), state: d.state, bytes: d.fileSize })));
  const clearDownloads = () => panel.evaluate(async () => chrome.downloads.erase({}));
  const waitDownloads = async (n) => {
    for (let i = 0; i < 60; i++) {
      const d = await downloads();
      if (d.filter((x) => x.state === 'complete').length >= n) return d;
      await new Promise((r) => setTimeout(r, 500));
    }
    return downloads();
  };
  const countSets = () => panel.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('gleaner'); r.onsuccess = () => res(r.result); });
    return new Promise((res) => { const q = db.transaction('datasets').objectStore('datasets').count(); q.onsuccess = () => res(q.result); });
  });
  const find = async () => {
    const before = await countSets();
    await panel.getByRole('button', { name: /^(Find pictures|Find again)$/ }).click();
    for (let i = 0; i < 240 && (await countSets()) <= before; i++) await new Promise((r) => setTimeout(r, 500));
    await panel.waitForTimeout(800);
  };
  // Record the file names Gleaner asks for (Playwright renames saved files)
  await panel.evaluate(() => {
    const orig = chrome.downloads.download.bind(chrome.downloads);
    window.__names = [];
    chrome.downloads.download = (o, ...rest) => (window.__names.push(o.filename), orig(o, ...rest));
  });
  const names = () => panel.evaluate(() => window.__names.splice(0));
  const chips = async () => (await panel.getByRole('group', { name: 'Filter by size' }).getByRole('button').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  const preview = () => panel.locator('p.font-mono').first().innerText();

  // 1. Listing page: 20 product cards, 4 picture sizes
  await site.goto(`${BASE}/Product/Best`);
  await site.bringToFront();
  await find();
  R.listing = {
    heading: await panel.getByRole('heading', { name: /^\d+ pictures$/ }).innerText(),
    chips: await chips(),
    naming: await panel.getByLabel('File names').inputValue(),
    preview: await preview(),
    note: await panel.locator('[aria-live=polite] span').first().innerText(),
  };
  await panel.screenshot({ path: `${shots}/i1-listing.png`, fullPage: true });

  // Filter to Large + Extra large, size folders, ZIP
  await panel.getByRole('button', { name: /^Large \d/ }).click();
  await panel.getByRole('button', { name: /^Extra large \d/ }).click();
  R.filtered = await panel.getByRole('heading', { name: /^\d+ pictures$/ }).innerText();
  await panel.getByText('Put each size in its own folder').click();
  await panel.getByRole('radio', { name: 'One ZIP with a list' }).click();
  await clearDownloads();
  await panel.getByRole('button', { name: /^Download (all )?\d+ pictures/ }).click();
  const z = await waitDownloads(1);
  R.zip = z;
  const zipFile = fs.readdirSync(dlDir).map((f) => path.join(dlDir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  const { unzipSync, strFromU8 } = await import('fflate');
  const entries = unzipSync(fs.readFileSync(zipFile));
  R.zipEntries = Object.keys(entries).slice(0, 6).concat(`... ${Object.keys(entries).length} entries`);
  R.zipCsv = strFromU8(entries['pictures.csv']).split('\n').slice(0, 3);
  R.msg = await panel.getByRole('status').last().innerText();
  await panel.screenshot({ path: `${shots}/i2-zip.png`, fullPage: true });

  // 2. Product page: gallery tied to the product, related item and logo not
  await site.goto(`${BASE}/Detail/SKU10001-A`);
  await site.bringToFront();
  await find();
  await panel.getByText(/Hide icons and tiny/).click(); // show the logo too
  R.detail = {
    heading: await panel.getByRole('heading', { name: /^\d+ pictures$/ }).innerText(),
    chips: await chips(),
    tiles: await panel.locator('ul li button').evaluateAll((els) => els.map((e) => e.getAttribute('title').replace(/\n/g, ' | '))),
  };
  await panel.getByLabel('File names').selectOption('custom');
  await panel.getByLabel('Name pattern').fill('{brand}-{sku}-{size}');
  R.detailPreview = await preview();
  await panel.getByRole('radio', { name: 'Separate files' }).click();
  await panel.getByLabel('Format').selectOption('png');
  await clearDownloads();
  await panel.getByRole('button', { name: /^Download (all )?\d+ pictures/ }).click();
  R.detailFiles = (await waitDownloads(3)).map((d) => `${d.bytes} bytes`);
  R.detailNames = await names();

  // 3. Saved data: rows with SKU and picture links
  await panel.evaluate(async (base) => {
    const db = await new Promise((res) => { const r = indexedDB.open('gleaner'); r.onsuccess = () => res(r.result); });
    const rows = Array.from({ length: 12 }, (_, i) => ({ title: `Relief Sun Rice Probiotics ${i + 1}`, sku: `BOJ-${700 + i}`, brand: 'Beauty of Joseon', images: `${base}/img/${3000 + i}.svg?s=${[300, 1200, 2400][i % 3]} | ${base}/img/${4000 + i}.svg?s=800`, url: `${base}/Detail/SKU${10000 + i}-A` }));
    await new Promise((res) => { const tx = db.transaction('datasets', 'readwrite'); tx.objectStore('datasets').put({ id: 'imgs', name: 'Products saved', tool: 'store', source: base, createdAt: Date.now(), updatedAt: Date.now(), columns: [{ key: 'title', label: 'title' }, { key: 'sku', label: 'sku' }, { key: 'brand', label: 'brand' }, { key: 'images', label: 'images' }, { key: 'url', label: 'url' }], rows }); tx.oncomplete = res; });
  }, BASE);
  await panel.getByRole('radio', { name: 'Saved data' }).click();
  await panel.getByLabel('Saved data').selectOption({ label: 'Products saved (12 rows)' });
  await panel.waitForTimeout(400);
  await find();
  R.saved = { heading: await panel.getByRole('heading', { name: /^\d+ pictures$/ }).innerText(), chips: await chips(), naming: await panel.getByLabel('File names').inputValue() };
  await panel.getByLabel('File names').selectOption('sku');
  R.savedPreview = await preview();
  await panel.getByLabel('Format').selectOption('original');
  await clearDownloads();
  await panel.getByRole('button', { name: /^Download (all )?\d+ pictures/ }).click();
  R.savedCount = (await waitDownloads(24)).filter((d) => d.state === 'complete').length;
  R.savedNames = (await names()).sort().slice(0, 6);
  await panel.screenshot({ path: `${shots}/i3-saved.png`, fullPage: true });

  // 4. Real Shopify product page: full-size versions and product names
  await site.goto('https://www.allbirds.com/products/mens-tree-runners', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await site.waitForTimeout(4000);
  await site.bringToFront();
  await panel.getByRole('radio', { name: 'This page' }).click();
  await find();
  R.shopify = {
    heading: await panel.getByRole('heading', { name: /^\d+ pictures$/ }).innerText(),
    chips: await chips(),
    note: await panel.locator('[aria-live=polite] span').first().innerText(),
    naming: await panel.getByLabel('File names').inputValue(),
    preview: await preview(),
    sample: await panel.locator('ul li button').evaluateAll((els) => els.slice(0, 4).map((e) => e.getAttribute('title').replace(/\n/g, ' | '))),
  };
  await panel.screenshot({ path: `${shots}/i4-shopify.png`, fullPage: true });
} catch (e) {
  console.log('FAILED', e.message);
  await ctx.pages()[1]?.screenshot({ path: `${shots}/fail.png`, fullPage: true }).catch(() => {});
} finally {
  console.log(JSON.stringify(R, null, 2));
  await ctx.close();
  server.kill();
}
