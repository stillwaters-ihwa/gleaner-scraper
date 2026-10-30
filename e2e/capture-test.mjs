// Page capture E2E in Edge: every "use this page for" action, full-page capture of a page that
// grows as it scrolls and of an app that scrolls an inner panel, and Capture Studio editing and
// saving (PNG, A4 PDF, record ZIP, evidence packs), finishing an existing PDF with the check before
// filing, and the EN / 日本語 switch. Saved files are opened and checked.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { jsPDF } from 'jspdf';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const [extArg, shots] = process.argv.slice(2);
const ext = path.resolve(extArg);
fs.mkdirSync(shots, { recursive: true });
const PORT = 8780;
const BASE = `http://localhost:${PORT}`;
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const server = spawn(process.execPath, [path.join(here, 'capture-fixture.mjs'), String(PORT)], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));
const R = { errors: [] };
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-cdl-'));
const log = (...a) => console.log('[c]', ...a);

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gl-c-')), {
  headless: true,
  channel: 'msedge',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1280, height: 860 },
  acceptDownloads: true,
  downloadsPath: dlDir,
});
let panel;
const step = async (name, fn) => {
  const t0 = Date.now();
  try {
    await fn();
  } catch (e) {
    R[name] = { failed: String(e?.message ?? e).split('\n')[0].slice(0, 300) };
    await panel?.screenshot({ path: `${shots}/c-fail-${name}.png`, fullPage: true }).catch(() => {});
  }
  log(name, `${Math.round((Date.now() - t0) / 1000)}s`, R[name]?.failed ?? '');
};
try {
  const sw = await (await import('./sw.mjs')).waitForSw(ctx);
  const id = new URL(sw.url()).host;
  const site = await ctx.newPage();
  panel = await ctx.newPage();
  // No viewport emulation on the panel: in one window it disturbs screenshots of the page tab
  panel.on('pageerror', (e) => R.errors.push(e.message));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.getByRole('button', { name: /^Page capture/ }).click();
  // Record the file names Gleaner asks for (Playwright renames saved files)
  const watchNames = (pg) => pg.evaluate(() => {
    const orig = chrome.downloads.download.bind(chrome.downloads);
    window.__names = [];
    chrome.downloads.download = (o, ...rest) => (window.__names.push(o.filename), orig(o, ...rest));
  });
  await watchNames(panel);
  let namesFrom = panel;
  const lastDownload = async (timeout = 60000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const d = await panel.evaluate(async () => (await chrome.downloads.search({ orderBy: ['-startTime'], limit: 1 }))[0]);
      if (d && d.state === 'complete' && !(await panel.evaluate((x) => (window.__seen ??= new Set()).has(x), d.id))) {
        await panel.evaluate((x) => window.__seen.add(x), d.id);
        const name = await namesFrom.evaluate(() => window.__names.at(-1)).catch(() => '');
        return { file: d.filename, name };
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error('no download');
  };
  const readZip = (file) => unzipSync(new Uint8Array(fs.readFileSync(file)));
  const note = () => panel.locator('[role=status], [role=alert]').last().innerText().catch(() => '');
  const act = async (title) => {
    await site.bringToFront();
    await panel.getByRole('button', { name: new RegExp(`^${title}`) }).first().click();
  };

  await site.goto(`${BASE}/landing`);

  await step('ai', async () => {
    await act('Text and pictures for AI');
    const d = await lastDownload();
    const z = readZip(d.file);
    const md = strFromU8(z['page.md']);
    R.ai = { name: d.name, files: Object.keys(z).sort(), headings: (md.match(/^#{1,3} .+$/gm) ?? []).slice(0, 6), localImages: (md.match(/\]\(images\/\d+\.\w+\)/g) ?? []).length, note: await note() };
  });

  await step('structure', async () => {
    await act('Page structure and calls to action');
    const d = await lastDownload();
    const z = readZip(d.file);
    const s = JSON.parse(strFromU8(z['structure.json']));
    R.structure = { order: s.sections.map((x) => x.kind), ctas: s.ctas.map((c) => `${c.label}:${c.kind}:${c.count}`), notes: s.notes, md: strFromU8(z['structure.md']).split('\n').find((l) => l.includes('→')), note: await note() };
  });

  await step('design', async () => {
    await act('Design specification');
    const d = await lastDownload();
    const z = readZip(d.file);
    const css = strFromU8(z['tokens.css']);
    R.design = { files: Object.keys(z).sort(), primary: /--color-primary: (#[0-9a-f]{6})/.exec(css)?.[1], brandVar: /--brand: ([^;]+);/.exec(css)?.[1], radius: /--radius-1: ([^;]+);/.exec(css)?.[1], breakpoints: JSON.parse(strFromU8(z['tokens.json'])).source.breakpoints, tailwind: strFromU8(z['tailwind.config.js']).includes('"primary"') };
  });

  await step('component', async () => {
    await act('One component');
    await site.bringToFront();
    // Wait until the picker is showing its hint on the page
    await site.waitForFunction(() => document.querySelector('gleaner-overlay')?.shadowRoot?.textContent?.includes('Enter'), null, { timeout: 15000 });
    await site.locator('#pick-me').scrollIntoViewIfNeeded();
    await site.waitForTimeout(200);
    const box = await site.locator('#pick-me h3').boundingBox();
    await site.mouse.move(box.x + 2, box.y + 2);
    await site.mouse.move(box.x + 6, box.y + 6);
    await site.waitForTimeout(250);
    await site.keyboard.press('ArrowUp'); // the card around the heading
    await site.waitForTimeout(150);
    await site.keyboard.press('Enter');
    const d = await lastDownload();
    const z = readZip(d.file);
    const html = strFromU8(z['component.html']);
    // Keep the preview, and open the exported component on its own to see it still looks right
    const cdir = path.join(shots, 'component');
    fs.mkdirSync(cdir, { recursive: true });
    for (const f of ['preview.png', 'component.html', 'component.css']) if (z[f]) fs.writeFileSync(path.join(cdir, f), z[f]);
    const view = await ctx.newPage();
    await view.goto(new URL(`file:///${path.resolve(cdir, 'component.html').split(path.sep).join('/')}`).href);
    await view.screenshot({ path: path.join(shots, 'c5-component-alone.png') });
    await view.close();
    const copies = await (async () => { const v = await ctx.newPage(); await v.goto(new URL(`file:///${path.resolve(cdir, 'component.html').split(path.sep).join('/')}`).href); const n = await v.getByText('Focus timer').count(); const underline = await v.getByText('Try the timer').evaluate((a) => getComputedStyle(a).textDecorationLine); await v.close(); return { n, underline }; })();
    R.component = { copies, files: Object.keys(z).sort(), hasButton: html.includes('Try the timer'), cssHasRadius: /border-top-left-radius: 14px/.test(strFromU8(z['component.css'])), previewBytes: z['preview.png']?.length ?? 0, note: await note() };
  });

  await step('quote', async () => {
    await site.bringToFront();
    await site.evaluate(() => {
      const p = document.getElementById('quote-me').firstChild;
      const r = document.createRange();
      r.setStart(p, 0);
      r.setEnd(p, 'Teams that plan on Monday finish thirty percent more'.length);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    });
    await panel.getByRole('button', { name: /^Selected text with its source/ }).click();
    const d = await lastDownload();
    const md = fs.readFileSync(d.file, 'utf8');
    R.quote = { starts: md.split('\n')[0], link: /#:~:text=[^)\s]+/.exec(md)?.[0], note: await note() };
  });

  await step('pack', async () => {
    await site.bringToFront();
    await panel.getByRole('checkbox', { name: 'Full-page picture' }).click();
    await panel.getByRole('button', { name: 'Save reference pack (ZIP)' }).click();
    const d = await lastDownload(120000);
    const z = readZip(d.file);
    const sums = strFromU8(z['SHA256SUMS.txt']).trim().split('\n');
    const ok = sums.every((l) => {
      const [h, p] = l.split('  ');
      return crypto.createHash('sha256').update(z[p]).digest('hex') === h;
    });
    R.pack = { files: Object.keys(z).sort(), start: strFromU8(z['START-HERE.md']).split('\n').filter((l) => /^\d\./.test(l)), sumsOk: ok };
  });

  // Full page capture of a page that grows as it scrolls
  let studio;
  await step('fullPage', async () => {
    await site.goto(`${BASE}/landing`);
    await site.bringToFront();
    const startHeight = await site.evaluate(() => document.body.scrollHeight);
    const opened = ctx.waitForEvent('page', { timeout: 120000 });
    await panel.getByRole('button', { name: /^Whole page Loads/ }).click();
    studio = await opened;
    studio.on('pageerror', (e) => R.errors.push('studio: ' + e.message));
    await studio.waitForLoadState();
    await watchNames(studio);
    namesFrom = studio;
    await studio.getByText('Capture Studio').first().waitFor();
    await studio.locator('img[alt="The captured page"]').waitFor();
    await studio.waitForTimeout(800);
    const img = await studio.evaluate(() => { const i = document.querySelector('img[alt="The captured page"]'); return { w: i.naturalWidth, h: i.naturalHeight }; });
    const after = await site.evaluate(() => ({ h: document.body.scrollHeight, lazyLoaded: [...document.querySelectorAll('img.lazy')].every((i) => i.src) }));
    R.fullPage = { startHeight, endHeight: after.h, image: img, lazyLoaded: after.lazyLoaded, note: await note() };
    await studio.screenshot({ path: `${shots}/c1-studio.png` });
  });

  await step('studio', async () => {
    // The secret's position in the picture: same as on the page (full width, 1x)
    const secret = await site.evaluate(() => { const r = document.getElementById('secret').getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; });
    await studio.bringToFront();
    const svg = studio.locator('svg[aria-label="Drawing area"]');
    const sb = await svg.boundingBox();
    const imgW = await studio.evaluate(() => document.querySelector('img[alt="The captured page"]').naturalWidth);
    const k = sb.width / imgW;
    // Scroll the secret into view inside the stage, then black it out
    await studio.evaluate((y) => document.querySelector('svg[aria-label="Drawing area"]').parentElement.parentElement.scrollTo(0, y), secret.y * k - 200);
    await studio.waitForTimeout(300);
    const sb2 = await svg.boundingBox();
    await studio.getByRole('button', { name: /^Black out/ }).click();
    await studio.mouse.move(sb2.x + (secret.x - 4) * k, sb2.y + (secret.y - 4) * k);
    await studio.mouse.down();
    await studio.mouse.move(sb2.x + (secret.x + secret.w + 4) * k, sb2.y + (secret.y + secret.h + 4) * k, { steps: 5 });
    await studio.mouse.up();
    // A text note, then change its words
    await studio.getByRole('button', { name: /^Text/ }).click();
    await studio.mouse.click(sb2.x + 40 * k, sb2.y + (secret.y + 60) * k);
    await studio.locator('#edit-text').fill('Invoice address hidden');
    await studio.locator('#edit-text').blur();
    // Undo and redo the text
    await studio.keyboard.press('Control+z');
    await studio.keyboard.press('Control+Shift+z');
    const marks = await studio.locator('aside').innerText();
    R.studio = { marks: /(\d+) marks?/.exec(marks)?.[1], history: /(\d+) steps/.exec(marks)?.[1] };
    await studio.screenshot({ path: `${shots}/c2-edited.png` });

    // PNG: the secret's pixels are black
    await studio.getByRole('button', { name: 'Save picture (PNG)' }).click();
    const png = await lastDownload();
    R.png = { name: png.name };
    R.png.secretPixels = await studio.evaluate(async ({ b64, s }) => {
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const x = c.getContext('2d');
      x.drawImage(bmp, 0, 0);
      const d = x.getImageData(Math.round(s.x + s.w / 2) - 20, Math.round(s.y + s.h / 2), 40, 1).data;
      let black = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 10 && d[i + 1] < 10 && d[i + 2] < 10) black++;
      return { black, of: d.length / 4, size: `${bmp.width}x${bmp.height}` };
    }, { b64: fs.readFileSync(png.file).toString('base64'), s: secret });

    // A4 PDF
    await studio.getByRole('button', { name: 'Save A4 PDF' }).click();
    const pdf = await lastDownload(120000);
    fs.copyFileSync(pdf.file, path.join(shots, 'c-page.pdf'));
    const pdfText = fs.readFileSync(pdf.file, 'latin1');
    R.pdf = { name: pdf.name, pages: (pdfText.match(/\/Type \/Page[^s]/g) ?? []).length, bytes: fs.statSync(pdf.file).size, hasUrl: pdfText.includes('localhost') };

    // Record ZIP: original kept apart, fingerprints all correct
    await studio.getByRole('button', { name: 'Save record ZIP' }).click();
    const rz = await lastDownload(120000);
    const z = readZip(rz.file);
    const sums = strFromU8(z['SHA256SUMS.txt']).trim().split('\n');
    R.record = {
      files: Object.keys(z).sort(),
      sumsOk: sums.every((l) => { const [h, p] = l.split('  '); return crypto.createHash('sha256').update(z[p]).digest('hex') === h; }),
      originalDiffers: Buffer.compare(Buffer.from(z['original/page.png'] ?? []), Buffer.from(z['edited/page-edited.png'] ?? [])) !== 0,
      reportSays: strFromU8(z['report.md']).split('\n').filter((l) => /End of page|blacked out|Loading/.test(l)),
      historyActions: JSON.parse(strFromU8(z['history.json'])).history.map((h) => h.action),
    };

    // Evidence: submission pack has no original and an exhibit label
    await studio.getByRole('button', { name: /Evidence pack/ }).click();
    await studio.getByRole('button', { name: '甲第1号証' }).click();
    await studio.getByLabel('Title').fill('Brightloom pricing page');
    await studio.getByRole('button', { name: 'Save submission pack (to share)' }).click();
    const sz = await lastDownload(120000);
    const ez = readZip(sz.file);
    const exhibitPdf = Object.keys(ez).find((f) => !f.includes('/') && f.endsWith('.pdf'));
    fs.writeFileSync(path.join(shots, 'c-exhibit.pdf'), ez[exhibitPdf]);
    R.evidence = { name: sz.name, exhibitPdf, files: Object.keys(ez).sort(), csv: strFromU8(ez['evidence-list.csv']).split('\r\n')[1], hasOriginal: Object.keys(ez).some((k) => k.startsWith('original/') || k.endsWith('.mhtml')) };
    await studio.screenshot({ path: `${shots}/c3-evidence.png` });
  });

  // An app that scrolls an inner panel
  await step('innerPanel', async () => {
    namesFrom = panel;
    await site.goto(`${BASE}/app`);
    await site.bringToFront();
    const opened = ctx.waitForEvent('page', { timeout: 120000 });
    await panel.getByRole('button', { name: /^Whole page Loads/ }).click();
    const s2 = await opened;
    await s2.locator('img[alt="The captured page"]').waitFor();
    await s2.waitForTimeout(500);
    R.innerPanel = { image: await s2.evaluate(() => { const i = document.querySelector('img[alt="The captured page"]'); return { w: i.naturalWidth, h: i.naturalHeight }; }), pageRestored: await site.evaluate(() => getComputedStyle(document.querySelector('.list')).overflowY) };
    await s2.close();
  });

  await step('visible', async () => {
    await site.goto(`${BASE}/article`);
    await site.bringToFront();
    const opened = ctx.waitForEvent('page', { timeout: 60000 });
    await panel.getByRole('button', { name: /^Visible area/ }).click();
    const s3 = await opened;
    await s3.locator('img[alt="The captured page"]').waitFor();
    R.visible = await s3.evaluate(() => { const i = document.querySelector('img[alt="The captured page"]'); return { w: i.naturalWidth, h: i.naturalHeight }; });
    await s3.close();
    await panel.screenshot({ path: `${shots}/c4-panel.png`, fullPage: true });
    R.recent = await panel.locator('section', { hasText: 'Recent captures' }).locator('li').count();
  });

  // A site where the browser refuses the debugging interface: whole page screen by screen
  await step('noDebugger', async () => {
    namesFrom = panel;
    await panel.evaluate(() => chrome.storage.local.set({ e2eNoDebugger: true }));
    await site.goto(`${BASE}/sticky`);
    await site.bringToFront();
    const opened = ctx.waitForEvent('page', { timeout: 180000 });
    await panel.getByRole('button', { name: /^Whole page Loads/ }).click();
    const s5 = await opened;
    s5.on('pageerror', (e) => R.errors.push('fallback studio: ' + e.message));
    await s5.locator('img[alt="The captured page"]').waitFor({ timeout: 60000 });
    await s5.waitForTimeout(500);
    const pic = await s5.evaluate(async () => {
      const i = document.querySelector('img[alt="The captured page"]');
      const bmp = await createImageBitmap(await (await fetch(i.src)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const x = c.getContext('2d');
      x.drawImage(bmp, 0, 0);
      const k = bmp.width / 1280;
      // Rows (in CSS pixels) where the red top bar shows at the left edge
      let redRows = 0;
      for (let y = 0; y < bmp.height; y += Math.round(10 * k)) {
        const [r, g, b] = x.getImageData(Math.round(5 * k), y, 1, 1).data;
        if (r > 200 && g < 60 && b < 60) redRows++;
      }
      return { w: bmp.width, h: bmp.height, k, redRows };
    });
    const rec = await panel.evaluate(async () => {
      const db = await new Promise((res) => { const r = indexedDB.open('gleaner'); r.onsuccess = () => res(r.result); });
      const all = await new Promise((res) => { const q = db.transaction('captures').objectStore('captures').getAll(); q.onsuccess = () => res(q.result); });
      const last = all.sort((a, b) => b.createdAt - a.createdAt)[0];
      return { method: last.report.method, height: last.report.pageSize.height, reachedBottom: last.report.reachedBottom };
    });
    await s5.screenshot({ path: `${shots}/c9-no-debugger.png` });
    await s5.close();
    await panel.evaluate(() => chrome.storage.local.remove('e2eNoDebugger'));
    R.noDebugger = { pic, rec, note: await note() };
  });

  // Finish a PDF: an A4 page with a secret on it and a US Letter page (which mints would refuse)
  await step('pdfFinish', async () => {
    namesFrom = panel;
    const src = new jsPDF({ unit: 'pt', format: 'a4' });
    src.setFontSize(18);
    src.text('Contract summary', 60, 80);
    src.setFillColor(40, 90, 200);
    src.rect(60, 200, 300, 40, 'F');
    src.text('Account 1234-5678', 70, 225);
    src.addPage('letter', 'portrait');
    src.text('Appendix on Letter paper', 60, 80);
    const srcBytes = Buffer.from(src.output('arraybuffer'));
    const srcFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gl-pdf-')), 'contract.pdf');
    fs.writeFileSync(srcFile, srcBytes);

    await panel.bringToFront();
    const opened = ctx.waitForEvent('page', { timeout: 120000 });
    await panel.getByLabel('PDF to finish').setInputFiles(srcFile);
    const s4 = await opened;
    s4.on('pageerror', (e) => R.errors.push('pdf studio: ' + e.message));
    await watchNames(s4);
    namesFrom = s4;
    await s4.locator('img[alt="The captured page"]').waitFor();
    await s4.waitForTimeout(500);
    const header = await s4.locator('header').innerText();
    const img = await s4.evaluate(() => { const i = document.querySelector('img[alt="The captured page"]'); return { w: i.naturalWidth, h: i.naturalHeight }; });
    const cropShown = await s4.getByRole('button', { name: /^Crop/ }).count();
    // Black out the blue account box: PDF points x 200/72 dpi = picture pixels
    const k0 = 200 / 72;
    const svg = s4.locator('svg[aria-label="Drawing area"]');
    const sb = await svg.boundingBox();
    const k = (sb.width / img.w) * k0;
    await s4.getByRole('button', { name: /^Black out/ }).click();
    await s4.mouse.move(sb.x + 56 * k, sb.y + 196 * k);
    await s4.mouse.down();
    await s4.mouse.move(sb.x + 364 * k, sb.y + 244 * k, { steps: 5 });
    await s4.mouse.up();
    await s4.getByRole('button', { name: '甲第1号証' }).click();
    await s4.getByLabel('Title').fill('契約概要');
    await s4.getByRole('checkbox', { name: /masked copy/ }).check();
    const filingName = await s4.locator('aside p.font-mono').innerText();
    await s4.getByRole('button', { name: 'Check before filing (mints)' }).click();
    await s4.locator('ul[aria-label="Check results"] li').first().waitFor({ timeout: 60000 });
    const checks = await s4.locator('ul[aria-label="Check results"] li').evaluateAll((ls) => ls.map((l) => `${l.querySelector('svg')?.getAttribute('aria-label')}: ${l.querySelector('.font-medium')?.textContent}`));
    await s4.screenshot({ path: `${shots}/c6-pdf-studio.png` });

    // Submission pack: the finished PDF at the top, named for filing, with the check results
    await s4.getByRole('button', { name: 'Save submission pack (to share)' }).click();
    const sub = await lastDownload(120000);
    const z = readZip(sub.file);
    const rootPdf = Object.keys(z).find((f) => !f.includes('/') && f.endsWith('.pdf'));
    fs.writeFileSync(path.join(shots, 'c-finished.pdf'), z[rootPdf]);
    const doc = await pdfjs.getDocument({ data: new Uint8Array(z[rootPdf]), isEvalSupported: false }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i);
      const v = pg.getViewport({ scale: 1 });
      pages.push({ w: Math.round(v.width), h: Math.round(v.height), text: (await pg.getTextContent()).items.map((t) => t.str).join(' ') });
    }
    // The secret's pixels in the edited page picture are black
    const editedPng = Object.keys(z).find((f) => f.startsWith('edited/') && f.endsWith('.png'));
    const sharp = (await import('sharp')).default;
    const px = editedPng ? [...(await sharp(Buffer.from(z[editedPng])).extract({ left: Math.round(210 * k0), top: Math.round(220 * k0), width: 1, height: 1 }).removeAlpha().raw().toBuffer())] : null;
    const black = px ? px.every((v) => v < 10) : 'no edited picture';
    const json = JSON.parse(strFromU8(z['check-before-filing.json']));
    R.pdfFinish = {
      header: header.split('\n').find((l) => l.includes('contract.pdf')),
      image: img,
      cropShown,
      filingName,
      checks,
      sub: { files: Object.keys(z).sort(), rootPdf, pages, hasUrl: Buffer.from(z[rootPdf]).toString('latin1').includes('localhost'), hasOriginal: Object.keys(z).some((f) => f.startsWith('original/')), black },
      json: { file: json.file, failed: json.checks.filter((c) => c.status === 'fail').map((c) => c.id), rules: json.rules },
      note: await s4.locator('[role=status], [role=alert]').last().innerText().catch(() => ''),
    };

    // Preservation pack: the PDF exactly as opened, and a report that says so
    await s4.getByRole('button', { name: 'Save preservation pack (keep)' }).click();
    const pre = await lastDownload(120000);
    const pz = readZip(pre.file);
    R.pdfFinish.pre = {
      sourceSame: pz['original/source.pdf'] ? Buffer.compare(Buffer.from(pz['original/source.pdf']), srcBytes) === 0 : false,
      originalPngs: Object.keys(pz).filter((f) => f.startsWith('original/') && f.endsWith('.png')).length,
      report: strFromU8(pz['report.md']).split('\n').filter((l) => /PDF|SHA-256|Pages/i.test(l)).slice(0, 6),
    };

    // The language switch: Japanese in the Studio, remembered and shown in the side panel too
    await s4.getByRole('button', { name: '日本語' }).click();
    await s4.waitForTimeout(300);
    const studioJa = { save: await s4.getByRole('button', { name: 'PDFを保存' }).count(), check: await s4.getByRole('button', { name: '提出前チェック（mints）' }).count(), lang: await s4.evaluate(() => document.documentElement.lang), firstCheck: await s4.locator('ul li .font-medium').first().innerText().catch(() => '') };
    await s4.screenshot({ path: `${shots}/c7-studio-ja.png` });
    await panel.bringToFront();
    await panel.waitForTimeout(500);
    const panelJa = { heading: await panel.getByText('このページの使い道').count(), finish: await panel.getByRole('button', { name: /手元のPDFを仕上げる/ }).count() };
    await panel.screenshot({ path: `${shots}/c8-panel-ja.png`, fullPage: true });
    const stored = await panel.evaluate(async () => (await chrome.storage.local.get('captureLang')).captureLang);
    // Reopen the panel: the choice is still Japanese
    await panel.reload();
    await panel.getByRole('button', { name: /^Page capture/ }).click();
    const afterReload = await panel.getByText('このページの使い道').waitFor({ timeout: 10000 }).then(() => 1, () => 0);
    await panel.getByRole('button', { name: 'EN' }).click();
    await panel.waitForTimeout(300);
    R.lang = { studioJa, panelJa, stored, afterReload, backToEn: await s4.getByRole('button', { name: 'Save PDF' }).count() };
    await s4.close();
  });
} catch (e) {
  R.failure = e.message.split('\n')[0];
} finally {
  console.log(JSON.stringify(R, null, 2));
  await ctx.close();
  server.kill();
}
