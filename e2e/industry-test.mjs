// E2E for the new tools: industry extractors, social posts, lead and website tools, data
// converter, PDF/OCR, marketplace search, and the image fallback for protected shop pictures.
// Local test pages cover everything; live checks against real public sources are marked "live".
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jsPDF } from 'jspdf';

const [extArg, shots] = process.argv.slice(2);
// Edge only loads an unpacked extension from an absolute path
const ext = path.resolve(extArg);
const live = !process.argv.includes('--offline');
fs.mkdirSync(shots, { recursive: true });
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const PORT = 8772;
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, [path.join(here, 'industry-fixture.mjs'), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));
const R = {};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-files-'));

// ---------- Files for the document and merge tools ----------
const pricePdf = path.join(tmp, 'price-list.pdf');
{
  const d = new jsPDF();
  d.setFontSize(14).text('Wholesale price list', 20, 20);
  d.setFontSize(11);
  const rows = [['Product', 'Size', 'Price'], ['Heartleaf Toner', '250ml', '$18.00'], ['Snail Essence', '100ml', '$21.50'], ['Rice Sunscreen', '50ml', '$15.00'], ['Relief Cream', '50ml', '$19.90']];
  rows.forEach((r, i) => r.forEach((c, j) => d.text(c, 20 + j * 60, 40 + i * 10)));
  fs.writeFileSync(pricePdf, Buffer.from(d.output('arraybuffer')));
}
const invoicePdf = path.join(tmp, 'invoice-0417.pdf');
{
  const d = new jsPDF();
  ['Glow Supply Co.', '123 Market St, Austin TX', 'INVOICE', 'Invoice No: INV-2026-0417', 'Invoice Date: 2026-10-01', 'Due Date: 2026-10-31', 'Subtotal  $180.00', 'Tax  $14.40', 'Shipping  $12.00', 'Total  $206.40'].forEach((t, i) => d.text(t, 20, 20 + i * 10));
  fs.writeFileSync(invoicePdf, Buffer.from(d.output('arraybuffer')));
}
fs.writeFileSync(path.join(tmp, 'a.csv'), 'SKU,Product Name\n1,Toner\n2,Serum\n');
fs.writeFileSync(path.join(tmp, 'b.csv'), 'sku,product_name,price\n2,Serum,\n3,Cream,9\n');

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gl-ind-')), {
  headless: true,
  channel: 'msedge',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1280, height: 900 },
});
// Only some steps, for quick reruns: --only=reddit,certificates
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const step = async (name, fn) => {
  if (only.length && !only.includes(name)) return;
  const t0 = Date.now();
  try {
    await fn();
  } catch (e) {
    R[name] = { failed: String(e?.message ?? e).split('\n')[0].slice(0, 300) };
  }
  console.log(`[step] ${name} ${Math.round((Date.now() - t0) / 1000)}s${R[name]?.failed ? ` FAILED: ${R[name].failed.slice(0, 120)}` : ''}`);
};

try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await (await import('./sw.mjs')).waitForSw(ctx);
  const id = new URL(sw.url()).host;
  const site = await ctx.newPage();
  const panel = await ctx.newPage();
  panel.setViewportSize({ width: 460, height: 1800 });
  panel.on('pageerror', (e) => console.log('[panel error]', e.message));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);

  // OCR image: a table rendered by the browser, saved as PNG
  const ocrPng = path.join(tmp, 'menu-photo.png');
  {
    const p = await ctx.newPage();
    await p.setContent('<body style="margin:30px;font:32px Arial;background:#fff"><table cellpadding="14"><tr><th align=left>Product</th><th align=left>Price</th></tr><tr><td>Heartleaf Toner</td><td>$18.00</td></tr><tr><td>Snail Essence</td><td>$21.50</td></tr></table></body>');
    await p.screenshot({ path: ocrPng });
    await p.close();
  }

  const db = (fn) => panel.evaluate(fn);
  const countSets = () => db(async () => {
    const d = await new Promise((res) => { const r = indexedDB.open('gleaner'); r.onsuccess = () => res(r.result); });
    return new Promise((res) => { const q = d.transaction('datasets').objectStore('datasets').count(); q.onsuccess = () => res(q.result); });
  });
  const latest = (n = 1) => db(async (n) => {
    const d = await new Promise((res) => { const r = indexedDB.open('gleaner'); r.onsuccess = () => res(r.result); });
    const all = await new Promise((res) => { const q = d.transaction('datasets').objectStore('datasets').getAll(); q.onsuccess = () => res(q.result); });
    all.sort((a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt);
    return all.slice(0, n).map((ds) => ({ name: ds.name, note: ds.note, columns: ds.columns.map((c) => c.key), rows: ds.rows }));
  }, n);
  const openTool = async (name) => {
    await panel.getByRole('button', { name: 'Tools', exact: true }).click();
    await panel.getByRole('button', { name: new RegExp('^' + name) }).first().click();
  };
  /** Click the run button and wait for a new dataset (or an error in the run bar). */
  const run = async (label, timeout = 120000, expectSets = 1) => {
    const before = await countSets();
    await panel.getByRole('button', { name: label }).filter({ visible: true }).last().click();
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if ((await countSets()) >= before + expectSets) {
        await panel.waitForTimeout(300);
        return (await latest(expectSets))[0];
      }
      const err = await panel.locator('[role=alert]').filter({ visible: true }).first().innerText().catch(() => '');
      if (err && !/permission/i.test(err)) throw new Error('run error: ' + err);
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('timed out');
  };
  const pick = (ds, keys) => ds.rows.slice(0, 2).map((r) => Object.fromEntries(keys.map((k) => [k, r[k]])));

  // ---------- Home ----------
  await step('home', async () => {
    const groups = await panel.locator('main h2').allInnerTexts();
    await panel.getByRole('searchbox', { name: 'Find a tool' }).fill('zillow');
    const found = await panel.locator('main li button').allInnerTexts();
    await panel.getByRole('searchbox', { name: 'Find a tool' }).fill('');
    await panel.screenshot({ path: `${shots}/n0-home.png`, fullPage: true });
    R.home = { groups, zillow: found.map((t) => t.split('\n')[0]) };
  });

  // ---------- Jobs: job board search, 3 pages, then open each job ----------
  await step('jobs', async () => {
    await site.goto(`${BASE}/jobs/search?page=1`);
    await site.bringToFront();
    await openTool('Job listings');
    await panel.getByRole('radio', { name: 'Fast' }).click();
    const ds = await run(/^Read jobs$/);
    R.jobs = { name: ds.name, rows: ds.rows.length, note: ds.note, sample: pick(ds, ['title', 'company', 'location', 'workplace', 'salary_min', 'salary_max', 'salary_period', 'date_posted', 'url']) };
    await site.goto(`${BASE}/jobs/search?page=1`);
    await panel.getByText('Open each job for its full description and salary').click();
    await panel.getByLabel('Keyword in title or description').fill('chemist');
    const ds2 = await run(/^Read jobs$/);
    R.jobsDetail = { rows: ds2.rows.length, titles: ds2.rows.map((r) => r.title).slice(0, 6), description: ds2.rows[0]?.description?.slice(0, 60), valid_through: ds2.rows[0]?.valid_through, note: ds2.note };
    await panel.getByText('Open each job for its full description and salary').click();
    await panel.getByLabel('Keyword in title or description').fill('');
    await panel.screenshot({ path: `${shots}/n1-jobs.png`, fullPage: true });
  });

  if (live)
    await step('jobBoards', async () => {
      await panel.getByRole('radio', { name: 'Company job boards' }).click();
      await panel.getByLabel(/^Companies/).fill('https://boards.greenhouse.io/airbnb\nhttps://jobs.lever.co/palantir\nhttps://jobs.ashbyhq.com/openai');
      const ds = await run(/^Read 3 job boards$/, 180000);
      const by = {};
      for (const r of ds.rows) by[r.source] = (by[r.source] ?? 0) + 1;
      R.jobBoards = { rows: ds.rows.length, bySource: by, note: ds.note.slice(0, 200), sample: pick(ds, ['title', 'company', 'location', 'workplace', 'department', 'date_posted', 'url']) };
    });

  // ---------- Real estate: 2 pages of search data, then listing pages ----------
  await step('realestate', async () => {
    await site.goto(`${BASE}/homes?page=1`);
    await site.bringToFront();
    await openTool('Real estate listings');
    await panel.getByRole('radio', { name: 'Fast' }).click();
    await panel.getByText('Open each listing for year built, lot size and more').click();
    const ds = await run(/^Read properties$/);
    R.realestate = { rows: ds.rows.length, note: ds.note, sample: pick(ds, ['address', 'city', 'price', 'status', 'beds', 'baths', 'area', 'price_per_area', 'year_built', 'broker', 'url']) };
  });

  // ---------- Travel: hotel list page from a list of pages ----------
  await step('travel', async () => {
    await openTool('Travel and places');
    await panel.getByRole('radio', { name: 'List of pages' }).click();
    await panel.getByLabel(/^Page URLs/).filter({ visible: true }).fill(`${BASE}/hotels`);
    const ds = await run(/^Read 1 page$/);
    R.travel = { rows: ds.rows.length, sample: pick(ds, ['name', 'type', 'rating', 'review_count', 'stars', 'price_range', 'city', 'country', 'url']) };
  });

  // ---------- Business listings: a directory with only visible cards ----------
  await step('business', async () => {
    await site.goto(`${BASE}/directory`);
    await site.bringToFront();
    await openTool('Business listings');
    const ds = await run(/^Read businesses$/);
    R.business = { rows: ds.rows.length, sample: pick(ds, ['name', 'category', 'phone', 'address', 'rating', 'review_count', 'website', 'url']) };
  });

  // ---------- News: section page, then the RSS feed ----------
  await step('newsSections', async () => {
    await openTool('News and articles');
    await panel.getByLabel(/^Page URLs/).filter({ visible: true }).fill(`${BASE}/news`);
    const ds = await run(/^Read 1 page$/);
    R.newsSections = { rows: ds.rows.length, titles: ds.rows.map((r) => r.title), sentiment: ds.rows.map((r) => r.sentiment), sample: pick(ds, ['author', 'published', 'publisher', 'word_count', 'keywords']) };
  });
  await step('newsFeed', async () => {
    await panel.getByRole('radio', { name: 'RSS feeds' }).click();
    await panel.getByLabel(/^Page URLs/).filter({ visible: true }).fill(`${BASE}/news`); // a site address: its feed is found
    await panel.getByLabel('Published on or after').fill('2026-10-11');
    const ds = await run(/^Read 1 feed$/);
    R.newsFeed = { rows: ds.rows.length, note: ds.note, published: ds.rows.map((r) => r.published), hasText: ds.rows.every((r) => (r.text ?? '').length > 100) };
  });

  // ---------- Reviews: 2 pages of Amazon-style reviews ----------
  await step('reviews', async () => {
    await site.goto(`${BASE}/reviews?page=1`);
    await site.bringToFront();
    await openTool('Review analyzer');
    await panel.getByRole('radio', { name: 'Fast' }).click();
    const ds = await run(/^Read reviews$/);
    const summary = await panel.locator('section[aria-label="Review summary"]').innerText().catch(() => '');
    R.reviews = { rows: ds.rows.length, note: ds.note, ratings: ds.rows.map((r) => r.rating), hasNames: JSON.stringify(ds.rows).includes('Shopper Name'), summary: summary.replace(/\s+/g, ' ').slice(0, 300) };
    await panel.screenshot({ path: `${shots}/n2-reviews.png`, fullPage: true });
  });

  // ---------- Reviews that load as a panel scrolls (Google style: star icons, "More" links) ----------
  await step('reviewsScroll', async () => {
    await site.goto(`${BASE}/reviews-scroll`);
    await site.bringToFront();
    await openTool('Review analyzer');
    await panel.getByRole('radio', { name: 'Browser tab' }).click().catch(() => {});
    const ds = await run(/^Read reviews$/, 180000);
    R.reviewsScroll = {
      rows: ds.rows.length,
      note: ds.note,
      ratings: [...new Set(ds.rows.map((r) => r.rating))].sort(),
      expanded: ds.rows.filter((r) => /hot stone add-on/.test(r.text ?? r.review ?? '')).length,
      ownerReplyAsReview: ds.rows.some((r) => /Thank you for visiting/.test(JSON.stringify(r))),
      followedLink: !/reviews-scroll/.test(await site.url()),
    };
  });
  // ---------- Google-style review window: loads only on a real mouse wheel ----------
  await step('reviewsWheel', async () => {
    await site.goto(`${BASE}/reviews-wheel`);
    await site.bringToFront();
    await openTool('Review analyzer');
    const ds = await run(/^Read reviews$/, 240000);
    R.reviewsWheel = {
      rows: ds.rows.length,
      note: ds.note,
      ids: new Set(ds.rows.map((r) => r.review_id)).size,
      starsOnly: ds.rows.filter((r) => !r.text).length,
      metaAsText: ds.rows.filter((r) => /\d+ reviews?|photos?$/i.test(r.text ?? '')).length,
      withPhotos: ds.rows.filter((r) => r.photo_count === '2').length,
      photo: ds.rows.find((r) => r.photos)?.photos.split(' | ')[0],
      avatarAsPhoto: ds.rows.some((r) => /avatar/.test(r.photos ?? '')),
      stayed: /reviews-wheel/.test(site.url()),
    };
  });
  // ---------- Reviews behind a "Show 10 more reviews" button ----------
  await step('reviewsMore', async () => {
    await site.goto(`${BASE}/reviews-more`);
    await site.bringToFront();
    await openTool('Review analyzer');
    const ds = await run(/^Read reviews$/, 180000);
    R.reviewsMore = { rows: ds.rows.length, note: ds.note, unique: new Set(ds.rows.map((r) => r.text ?? r.review)).size };
  });
  // ---------- A shop grid that loads more products as you scroll ----------
  await step('shopScroll', async () => {
    await site.goto(`${BASE}/shop-scroll`);
    await site.bringToFront();
    await openTool('Store extractor');
    await panel.getByRole('button', { name: 'Check' }).filter({ visible: true }).first().click();
    await panel.getByText(/ runs on /).filter({ visible: true }).first().waitFor({ timeout: 30000 });
    await panel.getByRole('radio', { name: 'This page' }).click();
    const ds = await run(/^Extract products$/, 180000);
    R.shopScroll = { rows: ds.rows.length, note: ds.note, unique: new Set(ds.rows.map((r) => r.url)).size, last: ds.rows.at(-1)?.title };
  });
  // ---------- A shop with 13 pages, each growing as you scroll; the grid moves from page 4 ----------
  await step('shopPages', async () => {
    await site.goto(`${BASE}/shop-pages?page=1`);
    await site.bringToFront();
    await openTool('Store extractor');
    await panel.getByRole('button', { name: 'Check' }).filter({ visible: true }).first().click();
    await panel.getByText(/ runs on /).filter({ visible: true }).first().waitFor({ timeout: 30000 });
    await panel.getByRole('radio', { name: 'This page' }).click();
    await panel.getByRole('radio', { name: /^Fast/ }).click().catch(() => {});
    const ds = await run(/^Extract products$/, 900000);
    const perPage = {};
    for (const r of ds.rows) {
      const pg = r.url?.match(/\/p\/(\d+)-/)?.[1];
      if (pg) perPage[pg] = (perPage[pg] ?? 0) + 1;
    }
    R.shopPages = { rows: ds.rows.length, unique: new Set(ds.rows.map((r) => r.url)).size, perPage, note: ds.note, endedOn: site.url() };
  });

  // ---------- Image downloader: small thumbnails opened to get their big pictures ----------
  await step('galleryThumbs', async () => {
    await site.goto(`${BASE}/gallery-thumbs`);
    await site.bringToFront();
    await openTool('Image downloader');
    const ds = await run(/^(Find pictures|Find again)$/, 240000);
    const byKey = {};
    for (const r of ds.rows) {
      const m = r.src.match(/\/img\/(\w)-(\d+)\.png/);
      if (m) byKey[m[1]] = Math.max(byKey[m[1]] ?? 0, Number(r.width) || 0);
    }
    R.galleryThumbs = { rows: ds.rows.length, byKey, note: ds.note, stayed: /gallery-thumbs/.test(site.url()), lightboxClosed: await site.evaluate(() => document.getElementById('box').hidden) };
  });

  // ---------- Google's review window: loads only when the list moves, some requests come back empty ----------
  await step('reviewsGoogle', async () => {
    await site.goto(`${BASE}/reviews-google`);
    await site.bringToFront();
    await openTool('Review analyzer');
    const ds = await run(/^Read reviews$/, 300000);
    R.reviewsGoogle = { rows: ds.rows.length, ids: new Set(ds.rows.map((r) => r.review_id)).size, note: ds.note, expanded: ds.rows.filter((r) => /detailed account/.test(r.text ?? '')).length, stayed: /reviews-google/.test(site.url()) };
  });

  // ---------- Store extractor: one row per variant, from three kinds of shop data ----------
  await step('storeVariants', async () => {
    await site.goto(`${BASE}/variant/shopify`);
    await site.bringToFront();
    await openTool('Store extractor');
    await panel.getByLabel('Store address').fill(BASE);
    await panel.getByRole('button', { name: 'Check' }).filter({ visible: true }).first().click();
    await panel.getByText(/ runs on /).filter({ visible: true }).first().waitFor({ timeout: 30000 });
    await panel.getByRole('radio', { name: 'Product links' }).click();
    await panel.getByLabel(/^Page URLs/).filter({ visible: true }).fill(['shopify', 'woo', 'schema'].map((k) => `${BASE}/variant/${k}`).join('\n'));
    await panel.getByText('One row per variant (colour, size, scent)').click();
    const ds = await run(/^Extract products$/, 180000);
    R.storeVariants = { rows: ds.rows.map((r) => [r.title, r.variant, r.variant_sku, r.variant_price, r.variant_available, (r.variant_image ?? '').replace(BASE, '')].join('|')), columns: ds.columns.map((c) => c.key ?? c), note: ds.note };
    // Report a problem, from the run bar: a ZIP with the steps, the page and what Gleaner found
    await panel.getByRole('button', { name: 'Report a problem' }).filter({ visible: true }).last().click();
    await panel.getByLabel(/What did you expect/).fill('Testing the report');
    await panel.getByRole('button', { name: 'Save report (ZIP)' }).click();
    const file = await panel
      .getByText(/Saved problem-report_/)
      .waitFor({ timeout: 30000 })
      .then(() =>
        panel.evaluate(async () => {
          // Playwright saves downloads under its own names: take the newest finished one
          for (let i = 0; i < 40; i++) {
            const [d] = await chrome.downloads.search({ orderBy: ['-startTime'], limit: 1 });
            if (d?.state === 'complete') return d.filename;
            await new Promise((r) => setTimeout(r, 250));
          }
          return '';
        }),
      )
      .finally(() => panel.getByRole('dialog').getByRole('button', { name: 'Close' }).click().catch(() => {}));
    const { unzipSync, strFromU8 } = await import('fflate');
    const z = unzipSync(new Uint8Array(fs.readFileSync(file)));
    const rep = JSON.parse(strFromU8(z['report.json']));
    R.report = { files: Object.keys(z).sort(), tool: rep.tool, description: rep.description, page: rep.page.url?.replace(BASE, ''), runMessage: rep.run?.message, logLines: strFromU8(z['activity.log']).trim().split('\n').length, logHasFinish: /Finished:/.test(strFromU8(z['activity.log'])), md: strFromU8(z['report.md']).split('\n').slice(0, 3) };
  });

  // ---------- Image downloader: each variant's picture by choosing each colour ----------
  await step('variantClick', async () => {
    await site.goto(`${BASE}/variant/click`);
    await site.bringToFront();
    await openTool('Image downloader');
    const ds = await run(/^(Find pictures|Find again)$/, 240000);
    R.variantClick = { rows: ds.rows.filter((r) => r.variant).map((r) => `${r.variant}:${r.src.replace(BASE, '')}`).sort(), product: ds.rows.find((r) => r.variant)?.product, note: ds.note };
  });

  // ---------- Reviews: mark new ones, and stop at last run's reviews when sorted newest first ----------
  await step('reviewsNew', async () => {
    await site.goto(`${BASE}/reviews-newest`);
    await site.bringToFront();
    await openTool('Review analyzer');
    await panel.getByRole('radio', { name: 'Mark new' }).filter({ visible: true }).click();
    await panel.getByLabel(/^Most reviews to keep/).filter({ visible: true }).fill('30');
    const first = await run(/^Read reviews$/, 300000);
    await site.goto(`${BASE}/reviews-newest`);
    await site.bringToFront();
    const t0 = Date.now();
    const second = await run(/^Read reviews$/, 300000);
    R.reviewsNew = { first: { rows: first.rows.length, note: first.note, marked: first.rows.filter((r) => r.new_since_last_run).length }, second: { rows: second.rows.length, note: second.note, marked: second.rows.filter((r) => r.new_since_last_run === 'new').length, seconds: Math.round((Date.now() - t0) / 1000) } };
  });

  // ---------- Store extractor: new products since the last run ----------
  await step('storeNew', async () => {
    const once = async () => {
      await site.goto(`${BASE}/shop-scroll`);
      await site.bringToFront();
      await openTool('Store extractor');
      await panel.getByLabel('Store address').fill(`${BASE}/shop-scroll`);
      await panel.getByRole('button', { name: 'Check' }).filter({ visible: true }).first().click();
      await panel.getByText(/ runs on /).filter({ visible: true }).first().waitFor({ timeout: 30000 });
      await panel.getByRole('radio', { name: 'This page' }).click();
      await panel.getByRole('radio', { name: 'Mark new' }).filter({ visible: true }).click();
      return run(/^Extract products$/, 180000);
    };
    const a = await once();
    const b = await once();
    R.storeNew = { first: { rows: a.rows.length, note: a.note }, second: { rows: b.rows.length, note: b.note, marked: b.rows.filter((r) => r.new_since_last_run === 'new').length} };
  });

  // ---------- Google Maps signed out: says so instead of quietly stopping ----------
  await step('mapsLimited', async () => {
    await site.goto(`${BASE}/maps-limited`);
    await site.bringToFront();
    await openTool('Review analyzer');
    const ds = await run(/^Read reviews$/, 180000);
    R.mapsLimited = { rows: ds.rows.length, note: ds.note };
  });

  // ---------- Image downloader: a shop that refuses outside requests for its pictures ----------
  await step('protectedImages', async () => {
    await site.goto(`${BASE}/gallery`);
    await site.bringToFront();
    await openTool('Image downloader');
    const ds = await run(/^(Find pictures|Find again)$/);
    R.protectedImages = { rows: ds.rows.length, note: ds.note, first: pick(ds, ['src', 'size', 'width', 'height', 'file_size']) };
  });

  // ---------- Company lookup ----------
  await step('company', async () => {
    await openTool('Company lookup');
    await panel.getByLabel(/^Websites or domains/).fill(`${BASE}/company`);
    await panel.getByText('Add domain age, registrar and email provider').click(); // a local address has no registration
    const ds = await run(/^Look up 1 company$/);
    R.company = ds.rows[0];
  });

  // ---------- Technology checker (local page) ----------
  await step('tech', async () => {
    await openTool('Technology checker');
    await panel.getByRole('radio', { name: 'List of sites' }).click();
    await panel.getByLabel(/^Page URLs/).filter({ visible: true }).fill(`${BASE}/company`);
    const ds = await run(/^Check 1 site$/);
    R.tech = { columns: ds.columns, row: ds.rows[0] };
  });

  // ---------- Link extractor ----------
  await step('links', async () => {
    await site.goto(`${BASE}/company`);
    await site.bringToFront();
    await openTool('Link extractor');
    const ds = await run(/^Get links$/);
    R.links = ds.rows.map((r) => `${r.type} ${r.url}`);
  });

  // ---------- Data converter ----------
  await step('convert', async () => {
    await openTool('Data converter');
    await panel.getByLabel('Page address').fill(`${BASE}/news/2026/10/10/k-beauty-exports-hit-record-high-this-year`);
    await panel.getByRole('button', { name: 'Convert to Markdown' }).click();
    await panel.getByLabel('Result').waitFor({ timeout: 20000 });
    const md = await panel.getByLabel('Result').inputValue();
    await panel.getByRole('radio', { name: 'HTML tables' }).click();
    await panel.getByLabel('Page address').fill(`${BASE}/tables`);
    await panel.getByRole('button', { name: 'Find tables' }).click();
    await panel.getByRole('button', { name: 'Save' }).first().waitFor({ timeout: 20000 });
    const tablesFound = await panel.locator('main li').filter({ hasText: ' x ' }).allInnerTexts();
    await panel.getByRole('radio', { name: 'JSON', exact: true }).click();
    await panel.getByLabel('JSON', { exact: true }).fill('{"name": "Toner",\n "price": 18,}');
    const jsonError = await panel.locator('[role=alert]').filter({ visible: true }).first().innerText();
    await panel.getByRole('radio', { name: 'Merge files' }).click();
    await panel.getByLabel(/^Files to merge/).setInputFiles([path.join(tmp, 'a.csv'), path.join(tmp, 'b.csv')]);
    const before = await countSets();
    await panel.getByRole('button', { name: /^Merge 2 files$/ }).click();
    for (let i = 0; i < 40 && (await countSets()) <= before; i++) await new Promise((r) => setTimeout(r, 250));
    const merged = (await latest())[0];
    // The Markdown step re-opens a tool; go back to Tools after
    R.convert = { markdownStart: md.slice(0, 80), markdownHasHeading: md.startsWith('# '), tablesFound, jsonError, merged: { name: merged.name, columns: merged.columns, rows: merged.rows } };
  });

  // ---------- PDF and image to data ----------
  await step('documents', async () => {
    await openTool('PDF and image to data');
    await panel.getByLabel(/^PDF or image files/).setInputFiles([pricePdf]);
    const t = await run(/^Read 1 file$/, 120000);
    await panel.getByRole('radio', { name: 'Invoice fields' }).click();
    await panel.getByLabel(/^PDF or image files/).setInputFiles([invoicePdf]);
    const inv = await run(/^Read 1 file$/, 120000);
    await panel.getByRole('radio', { name: 'Text' }).click();
    await panel.getByLabel(/^PDF or image files/).setInputFiles([ocrPng]);
    const ocr = await run(/^Read 1 file$/, 240000);
    R.documents = {
      pdfTable: { columns: t.columns, rows: t.rows.map((r) => [r.Product, r.Size, r.Price].join(' | ')) },
      invoice: inv.rows[0],
      ocr: { method: ocr.rows[0]?.method, confidence: ocr.rows[0]?.confidence, text: (ocr.rows[0]?.text ?? '').replace(/\s+/g, ' ').slice(0, 120) },
    };
    await panel.screenshot({ path: `${shots}/n3-documents.png`, fullPage: true });
  });

  if (live) {
    await step('telegram', async () => {
      await openTool('Social posts');
      await panel.getByLabel(/^Public channels/).fill('https://t.me/s/durov');
      await panel.getByLabel('Most posts per source').fill('25');
      const ds = await run(/^Read 1 source$/, 90000);
      R.telegram = { rows: ds.rows.length, sample: pick(ds, ['channel', 'date', 'views', 'url']), hasText: ds.rows.some((r) => r.text) };
    });
    await step('reddit', async () => {
      await panel.getByRole('radio', { name: 'Reddit' }).click();
      await panel.getByLabel(/^Communities, searches or threads/).fill('r/AsianBeauty');
      const ds = await run(/^Read 1 source$/, 90000);
      R.reddit = { rows: ds.rows.length, sample: pick(ds, ['channel', 'title', 'score', 'comments', 'date']) };
    });
    await step('emailcheck', async () => {
      await openTool('Email checker');
      await panel.getByLabel(/^Addresses/).fill('sales@shopify.com\nsomeone@gmial.com\nx@mailinator.com\nnot-an-email\ninfo@no-such-domain-gleaner-test.com');
      const ds = await run(/^Check 4 addresses$/, 60000);
      R.emailcheck = ds.rows.map((r) => `${r.email}: ${r.verdict} (${r.reason})`);
    });
    await step('domain', async () => {
      await openTool('Domain lookup');
      await panel.getByLabel(/^Domains/).fill('example.com');
      await panel.getByRole('checkbox', { name: 'SSL certificate and subdomains' }).uncheck(); // crt.sh is slow; checked separately below
      const ds = await run(/^Look up 1 domain$/, 90000);
      R.domain = ds.rows[0];
    });
    await step('certificates', async () => {
      await openTool('Domain lookup');
      await panel.getByRole('checkbox', { name: 'Registration (RDAP, the successor to WHOIS)' }).uncheck();
      await panel.getByRole('checkbox', { name: 'DNS and email setup' }).uncheck();
      await panel.getByRole('checkbox', { name: 'SSL certificate and subdomains' }).check();
      await panel.getByLabel(/^Domains/).fill('allbirds.com');
      // Subdomains are saved as their own data, so two datasets appear
      const ds = await run(/^Look up 1 domain$/, 200000, 2);
      R.certificates = ds.rows.map((r) => ({ domain: r.domain, issuer: r.certificate_issuer, days_left: r.certificate_days_left, subdomains: r.subdomains_found, note: (r.note ?? '').slice(0, 120) }));
    });
    await step('liveTech', async () => {
      await openTool('Technology checker');
      await panel.getByLabel(/^Page URLs/).filter({ visible: true }).fill('https://www.allbirds.com');
      const ds = await run(/^Check 1 site$/, 90000);
      R.liveTech = Object.fromEntries(Object.entries(ds.rows[0]).filter(([k]) => k !== 'evidence'));
    });
    await step('marketplace', async () => {
      await openTool('Marketplace search');
      await panel.getByLabel('Search for').fill('snail mucin essence');
      await panel.getByLabel('Result pages to read').fill('3');
      const ds = await run(/^Search$/, 300000);
      R.marketplace = { name: ds.name, rows: ds.rows.length, note: ds.note, unique: new Set(ds.rows.map((r) => r.asin || r.url)).size, sample: pick(ds, ['title', 'price', 'rating', 'asin']) };
    });
  }
  await panel.getByRole('button', { name: 'Tools', exact: true }).click();
  await panel.screenshot({ path: `${shots}/n4-home-end.png`, fullPage: true });
} catch (e) {
  console.log('FAILED', e.message);
} finally {
  console.log(JSON.stringify(R, null, 2));
  await ctx.close();
  server.kill();
}
