// Video downloader on YouTube, in Edge. Without the helper installed it checks the setup steps;
// with it (run helper\install.cmd from this build's folder once) it saves a real YouTube video,
// its sound and its subtitles through yt-dlp, and checks the files with ffprobe.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [extArg, shots] = process.argv.slice(2);
// Edge only loads an unpacked extension from an absolute path
const ext = path.resolve(extArg);
fs.mkdirSync(shots, { recursive: true });
const VIDEO = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // "Me at the zoo", 19 s
const R = { errors: [] };
const ffprobe = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links', 'ffprobe.exe');
const probe = (f) => {
  const j = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,height:format=duration', '-of', 'json', f]).toString());
  return { streams: j.streams.map((s) => `${s.codec_type}:${s.codec_name}${s.height ? `:${s.height}p` : ''}`), seconds: Math.round(Number(j.format.duration)) };
};

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gl-y-')), {
  headless: true,
  channel: 'msedge',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 1200, height: 900 },
});
let panel;
try {
  const sw = await (await import('./sw.mjs')).waitForSw(ctx);
  const id = new URL(sw.url()).host;
  R.extensionId = id;
  const site = await ctx.newPage();
  panel = await ctx.newPage();
  await panel.setViewportSize({ width: 440, height: 1400 });
  panel.on('pageerror', (e) => R.errors.push(e.message));
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.getByRole('button', { name: /Video downloader/ }).click();

  // A page with an embedded YouTube player lists it
  await site.route('https://embed.test/**', (r) => r.fulfill({ contentType: 'text/html', body: `<title>Story</title><iframe title="Zoo clip" src="https://www.youtube.com/embed/jNQXAC9IVRw"></iframe>` }));
  await site.goto('https://embed.test/story');
  await site.bringToFront();
  await panel.getByRole('button', { name: 'Find videos on this page' }).click();
  await panel.getByText('YouTube video').first().waitFor({ timeout: 15000 });
  R.embedListed = (await panel.locator('li.rounded-xl').first().innerText()).replace(/\s+/g, ' ').slice(0, 80);

  // YouTube itself
  await site.goto(VIDEO, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await site.bringToFront();
  await panel.waitForTimeout(2500);
  const setup = panel.getByText('Set up YouTube saving (once)');
  const quality = panel.locator('fieldset label').first();
  await Promise.race([setup.waitFor({ timeout: 60000 }), quality.waitFor({ timeout: 60000 })]).catch(() => {});
  await panel.screenshot({ path: `${shots}/y1-youtube.png`, fullPage: true });
  if (await setup.isVisible()) {
    R.helper = 'not installed';
    R.setupSteps = (await panel.locator('ol li').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').slice(0, 90));
    R.setupCode = await panel.getByText(/^install\.cmd [a-p]{32}$/).innerText();
  } else {
    R.helper = 'installed';
    R.title = await panel.locator('p.line-clamp-2').innerText();
    R.qualities = (await panel.locator('fieldset label').allInnerTexts()).map((s) => s.replace(/\s+/g, ' '));
    const saved = async (label) => {
      await panel.getByRole('button', { name: label }).click();
      const before = await panel.locator('[aria-label="Saved YouTube files"] li').count().catch(() => 0);
      for (let i = 0; i < 120; i++) {
        if ((await panel.locator('[aria-label="Saved YouTube files"] li').count().catch(() => 0)) > before) break;
        const err = await panel.locator('[role=alert]').first().innerText().catch(() => '');
        if (err) throw new Error(err);
        await panel.waitForTimeout(1000);
      }
      return panel.locator('[aria-label="Saved YouTube files"] li span').first().getAttribute('title');
    };
    await panel.locator('fieldset label').last().click();
    const video = await saved(/^Save .*p video$/);
    await panel.screenshot({ path: `${shots}/y2-saved.png`, fullPage: true });
    const mp3 = await saved(/^MP3$/);
    const subs = await saved(/^Subtitles/).catch((e) => `error: ${e.message}`);
    // "Show" opens Explorer with the file selected; the helper reports an error if it can't
    await panel.locator('[aria-label="Saved YouTube files"] button', { hasText: 'Show' }).first().click();
    await panel.waitForTimeout(1500);
    R.showError = await panel.locator('[role=alert]').first().innerText().catch(() => '');
    R.video = { file: path.basename(video), probe: probe(video) };
    R.mp3 = { file: path.basename(mp3), probe: probe(mp3) };
    R.subtitles = subs?.startsWith('error') ? subs : { file: path.basename(subs), start: fs.readFileSync(subs, 'utf8').slice(0, 50) };
    for (const f of [video, mp3, subs]) if (f && fs.existsSync(f)) fs.rmSync(f);

    // Paste a link: a YouTube link (sizes differ by quality), another yt-dlp site, a direct file, an HLS stream
    await panel.getByRole('radio', { name: 'Paste a link' }).click();
    const paste = async (u) => {
      await panel.getByLabel('Video link').fill(u);
      await panel.getByRole('button', { name: 'Get video' }).click();
      await panel.waitForTimeout(500);
    };
    await paste('https://youtu.be/dQw4w9WgXcQ');
    await panel.locator('fieldset label').nth(2).waitFor({ timeout: 60000 });
    const sizes = (await panel.locator('fieldset label').allInnerTexts()).map((s) => s.replace(/\s+/g, ' '));
    R.linkYouTube = { title: await panel.locator('p.line-clamp-2').innerText(), sizes, distinctSizes: new Set(sizes.map((s) => s.split('≈')[1])).size, firstSubtitle: await panel.getByLabel('Subtitle language').locator('option').first().innerText() };
    await panel.screenshot({ path: `${shots}/y3-link.png`, fullPage: true });
    await paste('https://archive.org/details/BigBuckBunny_124');
    await panel.getByText('Big Buck Bunny', { exact: true }).waitFor({ timeout: 60000 }).catch(() => {});
    R.linkArchive = (await panel.locator('fieldset label').allInnerTexts()).map((s) => s.replace(/\s+/g, ' '));
    await paste('https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4');
    R.linkFile = await panel.getByRole('button', { name: /^Save video/ }).innerText().catch(() => '');
    await paste('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8');
    await panel.locator('fieldset label').nth(4).waitFor({ timeout: 30000 });
    R.linkHls = (await panel.locator('fieldset label').allInnerTexts()).length;
  }
} catch (e) {
  R.failure = e.message.split('\n')[0];
  await panel?.screenshot({ path: `${shots}/y-fail.png`, fullPage: true }).catch(() => {});
} finally {
  console.log(JSON.stringify(R, null, 2));
  await ctx.close();
}
