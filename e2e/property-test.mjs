// E2E for the Property viewer: facts, map, floor plan, 3D tour, the to-scale room chart, and the
// on-device photo labeler running for real on Wikimedia Commons room photos (the first run
// downloads the model, so this test needs the internet and takes a minute or two).
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [extArg, shots] = process.argv.slice(2);
// Edge only loads an unpacked extension from an absolute path
const ext = path.resolve(extArg);
fs.mkdirSync(shots, { recursive: true });
const log = (...a) => console.log('[p]', ...a);

// Real room photos to label
const queries = { kitchen: 'modern kitchen', bathroom: 'modern bathroom', pool: 'swimming pool backyard', bedroom: 'modern bedroom design' };
const photos = [];
for (const [want, q] of Object.entries(queries)) {
  const api = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url&iiurlwidth=448&format=json`;
  for (let attempt = 0; attempt < 4; attempt++) {
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    try {
      const data = JSON.parse(await (await fetch(api, { headers: { 'user-agent': 'GleanerDev/1.0 (e2e test)' } })).text());
      const urls = Object.values(data.query?.pages ?? {}).map((p) => p.imageinfo?.[0]?.thumburl).filter((u) => u && /\.jpe?g$/i.test(u.split('?')[0]) &&!/drawing|engraving|painting|page\d/i.test(decodeURIComponent(u)));
      for (const u of urls.slice(0, 2)) photos.push({ want, url: u });
      break;
    } catch {
      /* rate limited: wait longer */
    }
  }
}
log('photos', photos.length);

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gl-p-')), {
  headless: true,
  channel: 'msedge',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1320, height: 900 },
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await (await import('./sw.mjs')).waitForSw(ctx);
const origin = `chrome-extension://${new URL(sw.url()).host}`;
const R = { photos: photos.length };
const errors = [];

const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_BLOCKED|net::/.test(m.text()) && errors.push(m.text().slice(0, 200)));
await page.goto(`${origin}/property.html`);
await page.evaluate(async (photos) => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('gleaner');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const rooms = [
    { name: 'Living room', length_m: 5.5, width_m: 3.9, area_m2: 21.5, as_written: 'Living room 5.5m x 3.9m' },
    { name: 'Kitchen', length_m: 4.2, width_m: 3.1, area_m2: 13, as_written: 'Kitchen 4.20m x 3.10m' },
    { name: 'Bedroom 1', length_m: 3.6, width_m: 3.2, area_m2: 11.5, as_written: 'Bedroom 1 3.6 x 3.2 m' },
    { name: 'Bathroom', length_m: 2.1, width_m: 1.9, area_m2: 4, as_written: 'Bathroom 2.1m x 1.9m' },
  ];
  const row = {
    address: '12 Harbour Road', city: 'Seaview', region: 'CA', price: '895000', currency: 'USD', status: 'for sale', beds: '3', baths: '2', area: '1650', area_unit: 'sqft', year_built: '1998',
    latitude: '34.05', longitude: '-118.24',
    images: photos.map((p) => p.url).join(' | '),
    floor_plan: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/Sample_Floorplan.jpg/640px-Sample_Floorplan.jpg',
    virtual_tour: 'https://my.matterport.com/show/?m=SxQL3iGyoDo',
    rooms: JSON.stringify(rooms),
    description: 'Bright three bedroom home with a swimming pool, double garage and ocean views. Recently renovated kitchen.',
    url: 'https://homes.example.com/listing/12-harbour-road',
  };
  const cols = Object.keys(row).map((key) => ({ key, label: key }));
  await new Promise((res, rej) => {
    const tx = db.transaction('datasets', 'readwrite');
    tx.objectStore('datasets').put({ id: 'home', name: 'Real estate 12 Harbour Road', tool: 'realestate', source: row.url, createdAt: Date.now(), updatedAt: Date.now(), columns: cols, rows: [row, { ...row, address: '9 Hill St', rooms: '', floor_plan: '', virtual_tour: '', latitude: '', longitude: '', images: '' }] });
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}, photos);

await page.goto(`${origin}/property.html?id=home`);
await page.getByRole('heading', { name: '12 Harbour Road' }).waitFor();
R.price = await page.getByText('$895,000').first().isVisible();
R.facts = (await page.locator('dl dt').allInnerTexts()).join(', ');
R.map = await page.locator('iframe[title="Map of the property"]').getAttribute('src');
R.features = (await page.locator('section[aria-labelledby=features] li').allInnerTexts()).map((s) => s.split('\n')[0]);
await page.waitForTimeout(1500);
R.floorPlan = (await page.getByAltText('Floor plan 1 from the listing').isVisible()) || (await page.getByText(/Floor plan 1 didn't load here/).isVisible());
R.chartTitle = await page.getByText('Sizes to scale, layout not shown.').isVisible();
R.chartRooms = await page.locator('svg[role=img] rect[stroke]').count();
await page.screenshot({ path: `${shots}/p1-top.png` });
await page.locator('#room-sizes').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${shots}/p2-rooms.png`, fullPage: true });
await page.getByRole('button', { name: 'Feet' }).click();
R.feetTable = await page.locator('table tbody tr').first().innerText();

// Label photos with the on-device model
const t0 = Date.now();
await page.getByRole('button', { name: 'Label photos' }).click();
const status = page.locator('section[aria-labelledby=by-room] p[aria-live]');
for (let s = 0; s < 60; s++) {
  if (await page.getByRole('button', { name: /Label the rest again/ }).isVisible()) break;
  if (/could not load/.test(await status.innerText().catch(() => ''))) break;
  if (s % 3 === 0) log('labeler:', (await status.innerText().catch(() => '')).slice(0, 140), errors.slice(-2));
  await page.waitForTimeout(5000);
}
R.labelSeconds = Math.round((Date.now() - t0) / 1000);
R.status = await page.locator('#by-room ~ p, section[aria-labelledby=by-room] p').first().innerText();
const got = await page.evaluate(async () => {
  const db = await new Promise((res) => {
    const r = indexedDB.open('gleaner');
    r.onsuccess = () => res(r.result);
  });
  const ds = await new Promise((res) => {
    const g = db.transaction('datasets').objectStore('datasets').get('home');
    g.onsuccess = () => res(g.result);
  });
  return JSON.parse(ds.rows[0].photo_rooms ?? '{}');
});
let right = 0;
R.labels = photos.map((p) => {
  const room = got[p.url]?.room ?? '-';
  right += room === p.want;
  return `${p.want} -> ${room}`;
});
R.accuracy = `${right}/${photos.length}`;
R.groups = await page.locator('section[aria-labelledby=by-room] h3').allInnerTexts();
await page.locator('section[aria-labelledby=by-room]').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${shots}/p3-labeled.png`, fullPage: true });

// Correct one photo by hand; it should stick after a reload
const first = page.getByLabel('Room in this photo').first();
await first.selectOption('garage');
await page.waitForTimeout(500);
await page.reload();
await page.getByRole('heading', { name: '12 Harbour Road' }).waitFor();
R.correctionKept = await page.getByRole('heading', { name: /^Garage/ }).isVisible();
R.featuresAfter = (await page.locator('section[aria-labelledby=features] li').allInnerTexts()).map((s) => s.replace('\n', ' '));

// Second property: no plan, tour, rooms or photos
await page.getByRole('button', { name: 'Next property' }).click();
await page.getByRole('heading', { name: '9 Hill St' }).waitFor();
R.emptyStates = await page.getByText("didn't publish a floor plan").isVisible() && await page.getByText('Gleaner never guesses them').isVisible();
await page.screenshot({ path: `${shots}/p4-second.png`, fullPage: true });

// Mobile width
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole('button', { name: 'Previous property' }).click();
await page.waitForTimeout(600);
R.mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
await page.screenshot({ path: `${shots}/p5-mobile.png`, fullPage: true });

R.errors = errors;
console.log(JSON.stringify(R, null, 2));
await ctx.close();
