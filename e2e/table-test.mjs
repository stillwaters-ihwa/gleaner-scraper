// E2E for the full-page data table: real data, a 30k-row stress test, exports and copy formats.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [extArg, shots] = process.argv.slice(2);
// Edge only loads an unpacked extension from an absolute path
const ext = path.resolve(extArg);
fs.mkdirSync(shots, { recursive: true });
const log = (...a) => console.log('[t]', ...a);
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gl-t-')), {
  headless: true,
  channel: 'msedge',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1320, height: 860 },
  acceptDownloads: true,
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await (await import('./sw.mjs')).waitForSw(ctx);
const id = new URL(sw.url()).host;
const origin = `chrome-extension://${id}`;
// clipboardRead comes from the E2E manifest
const R = {};

// Seed two datasets straight into IndexedDB: realistic products with pictures, and 30,000 rows
const page = await ctx.newPage();
page.on('pageerror', (e) => log('page error:', e.message));
page.on('console', (m) => m.type() === 'error' && log('console error:', m.text().slice(0, 200)));
await page.goto(`${origin}/table.html`);
await page.evaluate(async () => {
  const imgs = ['https://books.toscrape.com/media/cache/2c/da/2cdad67c44b002e7ead0cc35693c0e8b.jpg', 'https://books.toscrape.com/media/cache/26/0c/260c6ae16bce31c8f8c95daddd9f4a1c.jpg', 'https://books.toscrape.com/media/cache/3e/ef/3eef99c9d9adef34639f510662022830.jpg', 'https://books.toscrape.com/media/cache/32/51/3251cf3a3412f53f339e42cac2134093.jpg'];
  const brands = ['Medicube', 'ANUA', 'Dr.Althea', 'TOCOBO', 'Beauty of Joseon', 'Skin1004'];
  const cols = [
    { key: 'image', label: 'image' },
    { key: 'title', label: 'title' },
    { key: 'brand', label: 'brand' },
    { key: 'price', label: 'price' },
    { key: 'sku', label: 'sku' },
    { key: 'url', label: 'url' },
  ];
  const mk = (n) =>
    Array.from({ length: n }, (_, i) => ({
      image: imgs[i % imgs.length],
      title: `${['PDRN Pink Collagen', 'Heartleaf Pore Control', 'Zero Pore Serum', 'Relief Cream', 'Bio Watery Sun Screen'][i % 5]} ${i + 1} 50ml`,
      brand: brands[i % brands.length],
      price: (9.5 + ((i * 37) % 400) / 10).toFixed(2),
      sku: `SKU-${String(100000 + i)}`,
      url: `https://example-store.test/products/item-${i + 1}`,
    }));
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('gleaner');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const put = (ds) =>
    new Promise((res, rej) => {
      const tx = db.transaction('datasets', 'readwrite');
      tx.objectStore('datasets').put(ds);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  const now = Date.now();
  await put({ id: 'big', name: 'Stress test 30k', tool: 'store', source: 'https://example-store.test/', createdAt: now - 1000, updatedAt: now - 1000, columns: cols, rows: mk(30000) });
  await put({ id: 'small', name: 'Products wholesale.stylekorean.com', tool: 'list', source: 'https://stylekoreankbeautywholesale.com/Product/BestProduct', createdAt: now, updatedAt: now, columns: cols, rows: mk(20) });
});

// Real-size table
let t0 = Date.now();
await page.goto(`${origin}/table.html?id=small`);
await page.getByRole('grid').waitFor();
await page.waitForTimeout(1500);
R.smallLoadMs = Date.now() - t0;
R.headers = (await page.locator('[role=columnheader]').allInnerTexts()).map((s) => s.trim());
await page.screenshot({ path: `${shots}/t1-light.png` });
await page.getByRole('button', { name: /Theme/ }).click(); // system -> dark
await page.waitForTimeout(300);
await page.screenshot({ path: `${shots}/t2-dark.png` });

// Sort by price, descending
await page.getByRole('button', { name: /^price/ }).click();
await page.getByRole('button', { name: /^price/ }).click();
R.sortedFirstPrice = (await page.locator('[role=row]').nth(1).innerText()).split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 6).join(' | ');

// Row drawer
const box = await page.locator('[role=row]').nth(2).boundingBox();
R.rowBox = box;
R.hit = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e?.tagName + '.' + String(e?.className).slice(0, 60) + ' role=' + e?.getAttribute('role'); }, [box.x + box.width / 2, box.y + box.height / 2]);
await page.screenshot({ path: `${shots}/t2b-before-click.png` });
await page.locator('[role=row]').nth(2).click({ position: { x: 24, y: 20 } });
await page.getByRole('dialog').waitFor({ timeout: 10000 });
R.drawer = (await page.getByRole('dialog').innerText()).replace(/\s+/g, ' ').slice(0, 160);
await page.screenshot({ path: `${shots}/t3-drawer.png` });
await page.keyboard.press('Escape');

// Export menu
await page.getByRole('button', { name: 'Export' }).click();
await page.getByRole('menu').waitFor();
await page.getByRole('menuitem', { name: /Copy to clipboard/ }).click();
await page.screenshot({ path: `${shots}/t4-export.png` });
await page.keyboard.press('Escape');

const download = async (name) => {
  await page.getByRole('button', { name: 'Export' }).click();
  const dl = page.waitForEvent('download', { timeout: 90000 });
  await page.getByRole('menuitem', { name: new RegExp('^' + name) }).click();
  const d = await dl;
  const file = `${shots}/x-${d.suggestedFilename()}`;
  await d.saveAs(file);
  return `${d.suggestedFilename()} ${fs.statSync(file).size} bytes`;
};
R.csv = await download('CSV');
R.xlsx = await download('Excel Microsoft');
R.json = await download('JSON');
R.xlsxPics = await download('Excel with pictures');
R.pdf = await download('PDF');

const copy = async (label) => {
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: /Copy to clipboard/ }).click();
  await page.getByRole('menuitem', { name: new RegExp('^' + label) }).last().click();
  await page.waitForTimeout(300);
  return page.evaluate(() => navigator.clipboard.readText());
};
R.copySheet = (await copy('For Excel or Sheets')).split('\n').slice(0, 2).join(' / ').slice(0, 200);
R.copyMarkdown = (await copy('Markdown')).split('\n').slice(0, 3).join(' / ').slice(0, 200);
R.copyJson = (await copy('JSON')).slice(0, 120).replace(/\s+/g, ' ');
await copy('Formatted table');
R.copyRich = await page.evaluate(async () => {
  const items = await navigator.clipboard.read();
  const types = items[0].types.join(',');
  const plain = await (await items[0].getType('text/plain')).text();
  return types + ' | plain starts: ' + plain.slice(0, 40);
}).catch((e) => 'read failed: ' + e.message);

// Google Sheets: new tab to sheets.new + clipboard with IMAGE() formulas
await page.getByRole('button', { name: 'Export' }).click();
const popup = ctx.waitForEvent('page', { timeout: 15000 });
await page.getByRole('menuitem', { name: /^Google Sheets/ }).click();
const sheet = await popup;
R.sheetsUrl = sheet.url();
await sheet.close();
R.sheetsClipboard = (await page.evaluate(() => navigator.clipboard.readText())).split('\n')[1]?.slice(0, 140);
R.toast = await page.locator('[aria-live=polite] p').innerText().catch(() => '');

// Search
await page.getByLabel('Search rows').fill('anua serum');
await page.waitForTimeout(400);
R.searchRows = await page.getByText(/ of 20/).first().innerText().catch(() => 'n/a');

// Inline edit persists
await page.getByLabel('Search rows').fill('');
await page.waitForTimeout(300);
const cell = page.locator('[role=row]').nth(1).locator('[role=gridcell]').nth(2);
await cell.dblclick();
await page.keyboard.press('Control+A');
await page.keyboard.type('Edited Brand');
await page.keyboard.press('Enter');
await page.waitForTimeout(1200);
await page.reload();
await page.getByRole('grid').waitFor();
await page.waitForTimeout(800);
await page.getByLabel('Search rows').fill('Edited Brand');
await page.waitForTimeout(400);
R.editPersisted = (await page.getByText(/ of 20/).first().innerText().catch(() => 'none')) + ' rows match after reload';

// Clean panel: extract the digits of the SKU into a new column
await page.getByLabel('Search rows').fill('');
await page.getByRole('button', { name: 'Clean data' }).click();
await page.locator('aside[aria-label="Clean data"] select').first().selectOption({ label: 'sku' });
await page.locator('aside[aria-label="Clean data"] select').nth(1).selectOption('extract');
await page.locator('aside[aria-label="Clean data"] input').first().fill(String.raw`SKU-(\d+)`);
await page.getByText('Put the result in a new column').click();
await page.getByLabel('New column name').fill('sku number');
R.cleanPreview = (await page.locator('aside[aria-label="Clean data"] li').first().innerText()).replace(/s+/g, ' ');
await page.getByRole('button', { name: /^Apply to all/ }).click();
await page.waitForTimeout(800);
R.cleanResult = (await page.locator('[role=columnheader]').allInnerTexts()).map((x) => x.trim()).join(' | ');
R.cleanCell = (await page.locator("[role=row]").nth(1).locator("[role=gridcell]").nth(5).innerText()).trim();
await page.getByRole('button', { name: 'Clean data' }).click();

// Stress: 30,000 rows
t0 = Date.now();
await page.goto(`${origin}/table.html?id=big`);
await page.getByRole('grid').waitFor();
await page.locator('[role=row]').nth(5).waitFor();
R.bigLoadMs = Date.now() - t0;
R.bigDomRows = await page.locator('[role=row]').count();
t0 = Date.now();
await page.getByRole('button', { name: /^price/ }).click();
await page.locator('[role=row]').nth(1).waitFor();
R.bigSortMs = Date.now() - t0;
t0 = Date.now();
await page.getByLabel('Search rows').fill('relief 2999');
await page.waitForFunction(() => document.querySelectorAll('[role=row]').length < 40);
R.bigSearchMs = Date.now() - t0;
await page.getByLabel('Search rows').fill('');
R.scroll = await page.evaluate(async () => {
  const g = document.querySelector('[role=grid]');
  const frames = [];
  let last = performance.now();
  for (let i = 0; i < 120; i++) {
    g.scrollTop += 400;
    await new Promise((r) => requestAnimationFrame(r));
    const now = performance.now();
    frames.push(now - last);
    last = now;
  }
  frames.sort((a, b) => a - b);
  return { medianFrameMs: +frames[60].toFixed(1), p95FrameMs: +frames[114].toFixed(1), domRows: document.querySelectorAll('[role=row]').length };
});
await page.screenshot({ path: `${shots}/t5-big.png` });

console.log(JSON.stringify(R, null, 2));
await ctx.close();
