// Guardrail + wholesale E2E against the local fixture store.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [extArg, shots] = process.argv.slice(2);
// Edge only loads an unpacked extension from an absolute path
const ext = path.resolve(extArg);
const only = process.argv[4] ?? 'all';
fs.mkdirSync(shots, { recursive: true });
const PORT = 8765;
const BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), 'fixture-store.mjs'), String(PORT)], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));
const control = async (q) => (await fetch(`${BASE}/__control?${q}`)).json();
const R = {};

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gl-w-')), {
  headless: true,
  channel: 'msedge',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1200, height: 900 },
});
try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await (await import('./sw.mjs')).waitForSw(ctx);
  const id = new URL(sw.url()).host;
  const site = await ctx.newPage();
  await site.goto(`${BASE}/Product/Best`);
  const panel = await ctx.newPage();
  panel.setViewportSize({ width: 440, height: 900 });
  panel.on('pageerror', (e) => console.log('[panel error]', e.message));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await site.bringToFront();

  const latest = () =>
    panel.evaluate(async () => {
      const db = await new Promise((res) => {
        const r = indexedDB.open('gleaner');
        r.onsuccess = () => res(r.result);
      });
      const all = await new Promise((res) => {
        const q = db.transaction('datasets').objectStore('datasets').getAll();
        q.onsuccess = () => res(q.result);
      });
      all.sort((a, b) => b.createdAt - a.createdAt);
      const ds = all[0];
      return { name: ds.name, note: ds.note, columns: ds.columns.map((c) => c.label), rows: ds.rows };
    });

  const countSets = () => panel.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('gleaner'); r.onsuccess = () => res(r.result); });
    return new Promise((res) => { const q = db.transaction('datasets').objectStore('datasets').count(); q.onsuccess = () => res(q.result); });
  });
  let before = 0;
  const markStart = async () => { before = await countSets(); };
  const waitDone = async (timeout) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if ((await countSets()) > before) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('run did not finish');
  };

  await panel.getByRole('button', { name: /Store extractor/ }).click();
  await panel.getByRole('button', { name: 'Check' }).filter({ visible: true }).first().click();
  await panel.getByText(/ runs on /).filter({ visible: true }).first().waitFor({ timeout: 30000 });
  await panel.getByRole('radio', { name: 'This page' }).click();

  // Analyze first
  await site.bringToFront();
  await panel.getByRole('button', { name: 'Analyze first' }).click();
  await panel.getByText(/products? sampled/).waitFor({ timeout: 30000 });
  R.plan = (await panel.locator('section:has(h3:text("Columns")) li').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
  await panel.screenshot({ path: `${shots}/w1-plan.png`, fullPage: true });

  if (only === 'all' || only === 'full') {
    // Full run, all pages, Fast pace, with planned failures on pages 12 and 41
    await control(`fail=${encodeURIComponent(JSON.stringify({ 12: 1, 41: 2 }))}&gap=350`);
    await panel.getByRole('radio', { name: 'Fast' }).click();
    const t0 = Date.now();
    await markStart();
    await panel.getByRole('button', { name: 'Extract products' }).click();
    await waitDone(600000);
    R.fullSeconds = Math.round((Date.now() - t0) / 1000);
    const ds = await latest();
    const skus = new Set(ds.rows.map((r) => r.sku));
    const missing = [];
    for (let i = 0; i < 900; i++) if (!skus.has(`SKU${10000 + i}-A`)) missing.push(i);
    R.full = { rows: ds.rows.length, uniqueSkus: skus.size, missingCount: missing.length, firstMissing: missing.slice(0, 10), note: ds.note, columns: ds.columns };
    R.fullSample = ds.rows[0];
    const log = (await control('')).log;
    R.serverFailures = log.filter((l) => l.result !== 'ok').map((l) => `${l.page}:${l.result}`);
    await panel.screenshot({ path: `${shots}/w2-done.png`, fullPage: true });
  }

  if (only === 'all' || only === 'resume') {
    // A page that never recovers: stop cleanly, then resume from that page
    await site.goto(`${BASE}/Product/Best`);
    await site.bringToFront();
    await control(`fail=${encodeURIComponent(JSON.stringify({ 30: 999 }))}&gap=0`);
    await markStart();
    await panel.getByRole('button', { name: 'Extract products' }).click();
    await waitDone(600000);
    const a = await latest();
    R.stopped = { rows: a.rows.length, note: a.note };
    await control(`fail=${encodeURIComponent('{}')}&gap=0`);
    await site.goto(`${BASE}/Product/Best`);
    await site.bringToFront();
    await panel.getByLabel('Start from page').fill('30');
    await markStart();
    await panel.getByRole('button', { name: 'Extract products' }).click();
    await waitDone(600000);
    const b = await latest();
    const all = new Set([...a.rows, ...b.rows].map((r) => r.sku));
    R.resumed = { rows: b.rows.length, firstSku: b.rows[0]?.sku, note: b.note, combinedUnique: all.size };
  }
} finally {
  console.log(JSON.stringify(R, null, 2));
  await ctx.close();
  server.kill();
}
