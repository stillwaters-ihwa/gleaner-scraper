// Video downloader E2E in Edge: spots a streamed video by watching what the page downloads,
// saves it as an MP4, joins a DASH stream's separate picture and sound, saves a plain file and
// subtitles, and refuses an encrypted stream. Saved files are checked with ffprobe and played back.
import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffprobe from 'ffprobe-static';

const [extArg, shots] = process.argv.slice(2);
// Edge only loads an unpacked extension from an absolute path
const ext = path.resolve(extArg);
fs.mkdirSync(shots, { recursive: true });
const PORT = 8770;
const BASE = `http://localhost:${PORT}`;
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const server = spawn(process.execPath, [path.join(here, 'video-fixture.mjs'), String(PORT)], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));
const R = {};
const errors = [];
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-vdl-'));
const log = (...a) => console.log('[v]', ...a);

const probe = (file) => {
  const j = JSON.parse(execFileSync(ffprobe.path, ['-v', 'error', '-count_packets', '-show_entries', 'stream=codec_type,codec_name,width,height,nb_read_packets:format=duration', '-of', 'json', file]).toString());
  return { streams: j.streams.map((s) => `${s.codec_type}:${s.codec_name}${s.height ? `:${s.height}p` : ''}:${s.nb_read_packets}pk`), seconds: Math.round(Number(j.format?.duration) * 10) / 10 };
};

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gl-v-')), {
  headless: true,
  channel: 'msedge',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--autoplay-policy=no-user-gesture-required'],
  viewport: { width: 1200, height: 900 },
  acceptDownloads: true,
  downloadsPath: dlDir,
});
let panel;
try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await (await import('./sw.mjs')).waitForSw(ctx);
  const id = new URL(sw.url()).host;
  const site = await ctx.newPage();
  panel = await ctx.newPage();
  await panel.setViewportSize({ width: 440, height: 1400 });
  panel.on('pageerror', (e) => errors.push(e.message));
  panel.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.getByRole('button', { name: /Video downloader/ }).click();
  await panel.evaluate(() => {
    const orig = chrome.downloads.download.bind(chrome.downloads);
    window.__names = [];
    chrome.downloads.download = (o, ...rest) => (window.__names.push(o.filename), orig(o, ...rest));
  });
  const names = () => panel.evaluate(() => window.__names.splice(0));
  const completed = async (n, ms = 240000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const d = await panel.evaluate(async () => (await chrome.downloads.search({ state: 'complete' })).map((x) => ({ file: x.filename, bytes: x.fileSize })));
      if (d.length >= n) return d;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('download did not finish');
  };
  const items = async () => (await panel.locator('li.rounded-xl').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 120));
  const plays = async (file) => {
    const p = await ctx.newPage();
    await p.goto(`${BASE}/play?p=${encodeURIComponent(file)}`);
    const r = await Promise.race([new Promise((res) => setTimeout(() => res({ error: 'timed out' }), 30000)), p.evaluate(async () => {
      const v = document.getElementById('v');
      if (v.readyState < 1) await new Promise((res, rej) => ((v.onloadedmetadata = res), (v.onerror = () => rej(new Error('media error ' + v.error?.code)))));
      await v.play();
      await new Promise((r) => setTimeout(r, 1500));
      const seek = new Promise((r) => (v.onseeked = r));
      v.currentTime = v.duration * 0.6;
      await seek;
      return { duration: Math.round(v.duration * 10) / 10, size: `${v.videoWidth}x${v.videoHeight}`, played: v.currentTime > 0, audio: v.webkitAudioDecodedByteCount > 0 || v.mozHasAudio || (v.audioTracks?.length ?? -1) };
    }).catch((e) => ({ error: e.message }))]);
    await p.close();
    return r;
  };

  // 1. A streamed video (hls.js, blob: address): found by watching the network
  await site.goto(`${BASE}/stream`);
  await site.bringToFront();
  await site.waitForTimeout(4000);
  await panel.getByRole('button', { name: 'Find videos on this page' }).click();
  await panel.getByText('Stream (HLS)').first().waitFor({ timeout: 20000 });
  R.streamList = await items();
  await panel.getByRole('button', { name: 'Choose quality' }).first().click();
  await panel.getByRole('group', { name: 'Quality' }).or(panel.locator('fieldset')).first().waitFor();
  R.qualities = (await panel.locator('fieldset label').allInnerTexts()).map((s) => s.replace(/\s+/g, ' '));
  await panel.locator('fieldset label').last().click();
  await panel.screenshot({ path: `${shots}/v1-stream.png`, fullPage: true });
  let t0 = Date.now();
  await panel.getByRole('button', { name: /^Save .* video$/ }).click();
  await panel.getByText(/^Saving /).first().waitFor();
  await panel.waitForTimeout(1500);
  await panel.screenshot({ path: `${shots}/v2-saving.png`, fullPage: true });
  let done = await completed(1);
  R.hls = { name: (await names())[0], seconds: Math.round((Date.now() - t0) / 1000), bytes: done[0].bytes, probe: probe(done[0].file), plays: await plays(done[0].file) };
  log('hls', R.hls);

  // 2. A page with a plain video file, subtitles, a DASH link and an encrypted stream
  await panel.evaluate(() => chrome.downloads.erase({}));
  await site.goto(`${BASE}/page`);
  await site.bringToFront();
  await panel.waitForTimeout(1000);
  await panel.getByRole('button', { name: 'Look again' }).click();
  await panel.getByText('Stream (DASH)').waitFor({ timeout: 15000 });
  R.pageList = await items();
  await panel.screenshot({ path: `${shots}/v3-page.png`, fullPage: true });

  // Plain file and subtitles
  await panel.getByRole('button', { name: 'Save video' }).first().click();
  await panel.getByRole('button', { name: 'Save subtitles' }).click();
  done = await completed(2, 60000);
  R.direct = { names: await names(), files: done.map((d) => ({ bytes: d.bytes, ext: path.extname(d.file) })) };

  // Encrypted stream: refused with a clear message
  await panel.locator('li', { hasText: 'Locked stream' }).getByRole('button', { name: 'Choose quality' }).click();
  R.locked = await panel.getByText(/encrypted by the site/).innerText({ timeout: 15000 });

  // DASH: separate picture and sound joined into one MP4
  await panel.evaluate(() => chrome.downloads.erase({}));
  await panel.locator('li', { hasText: 'dash.mpd' }).getByRole('button', { name: 'Choose quality' }).click();
  await panel.locator('li', { hasText: 'dash.mpd' }).locator('fieldset label').first().waitFor({ timeout: 20000 });
  R.dashQualities = (await panel.locator('li', { hasText: 'dash.mpd' }).locator('fieldset label').allInnerTexts()).map((s) => s.replace(/\s+/g, ' '));
  await panel.screenshot({ path: `${shots}/v4-dash.png`, fullPage: true });
  t0 = Date.now();
  await panel.locator('li', { hasText: 'dash.mpd' }).getByRole('button', { name: /^Save .* video$/ }).click();
  done = await completed(1);
  R.dash = { name: (await names())[0], seconds: Math.round((Date.now() - t0) / 1000), bytes: done[0].bytes, probe: probe(done[0].file), plays: await plays(done[0].file) };
  log('dash', R.dash);

  // Audio only from the DASH stream
  await panel.evaluate(() => chrome.downloads.erase({}));
  await panel.locator('li', { hasText: 'dash.mpd' }).getByRole('button', { name: /^Audio only/ }).first().click();
  done = await completed(1, 120000);
  R.audioOnly = { name: (await names())[0], probe: probe(done[0].file) };
  await panel.screenshot({ path: `${shots}/v5-done.png`, fullPage: true });
} catch (e) {
  R.failure = e.message.split('\n')[0];
  await panel?.screenshot?.({ path: `${shots}/v-fail.png`, fullPage: true }).catch(() => {});
} finally {
  R.errors = errors;
  console.log(JSON.stringify(R, null, 2));
  await ctx.close();
  server.kill();
}
