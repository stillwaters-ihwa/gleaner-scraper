// Live check: the Review analyzer on Google's review window (search results), which loads 10
// reviews at a time as it scrolls. Read-only: it only opens and scrolls the public reviews.
//   node e2e/google-reviews-test.mjs .output/chrome-mv3-e2e e2e/shots [max reviews]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [extArg, shots, maxArg] = process.argv.slice(2);
const ext = path.resolve(extArg);
const MAX = Number(maxArg ?? 120);
const PAGE = 'https://www.google.com/search?q=mizpah+wellness+spa&hl=en#lrd=0x3397d3e1128f019f:0x111eff5dd24f3a81,1,,,,';
const R = { errors: [] };
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gl-g-')), {
  headless: true,
  channel: 'msedge',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1300, height: 900 },
});
let panel;
try {
  const sw = await (await import('./sw.mjs')).waitForSw(ctx);
  const id = new URL(sw.url()).host;
  const site = await ctx.newPage();
  await site.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await site.waitForTimeout(4000);
  R.google = { title: await site.title(), sorry: /sorry|unusual traffic/i.test(await site.content()), dialog: await site.locator('div.bwb7ce').count() };
  await site.screenshot({ path: `${shots}/g1-google.png` });
  if (R.google.sorry || !R.google.dialog) throw new Error(`Google didn't show the review window to this test browser (${R.google.title})`);
  panel = await ctx.newPage();
  await panel.setViewportSize({ width: 440, height: 1300 });
  panel.on('pageerror', (e) => R.errors.push(e.message));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await site.bringToFront();
  await panel.getByRole('button', { name: /Review analyzer/ }).click();
  await panel.getByLabel(/^Most reviews to keep/).filter({ visible: true }).fill(String(MAX)).catch(() => {});
  const countSets = () => panel.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('gleaner'); r.onsuccess = () => res(r.result); });
    return new Promise((res) => { const q = db.transaction('datasets').objectStore('datasets').getAll(); q.onsuccess = () => res(q.result); });
  });
  const t0 = Date.now();
  await panel.getByRole('button', { name: /^Read reviews$/ }).filter({ visible: true }).last().click();
  let ds = null;
  for (let i = 0; i < 600 && !ds; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const all = await countSets();
    if (all.length) ds = all[all.length - 1];
    if (i % 15 === 0) console.log('[g]', Math.round((Date.now() - t0) / 1000), 's', (await panel.locator('[aria-live]').allInnerTexts().catch(() => [])).join(' | ').slice(0, 140));
  }
  R.seconds = Math.round((Date.now() - t0) / 1000);
  R.stillOnReviews = /lrd=/.test(site.url());
  R.rows = ds.rows.length;
  R.note = ds.note;
  R.unique = new Set(ds.rows.map((r) => r.review_id || r.text)).size;
  R.withId = ds.rows.filter((r) => r.review_id).length;
  R.ratings = Object.entries(ds.rows.reduce((m, r) => ((m[r.rating] = (m[r.rating] ?? 0) + 1), m), {}));
  R.withPhotos = ds.rows.filter((r) => r.photos).length;
  R.photoSample = ds.rows.find((r) => r.photos)?.photos.split(' | ')[0];
  R.metaAsText = ds.rows.filter((r) => /^\d+ reviews?\b|local guide/i.test(r.text ?? '')).length;
  R.columns = ds.columns.map((c) => c.label);
  await panel.screenshot({ path: `${shots}/g2-reviews.png`, fullPage: true });
} catch (e) {
  R.failure = e.message.split('\n')[0];
} finally {
  console.log(JSON.stringify(R, null, 2));
  await ctx.close();
}
