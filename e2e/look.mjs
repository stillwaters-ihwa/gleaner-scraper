// Screenshots of the main screens in Edge, dark and light, for checking the look by eye.
//   node e2e/look.mjs .output/chrome-mv3-e2e e2e/shots/look
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [extArg, outArg] = process.argv.slice(2);
const ext = path.resolve(extArg);
const out = path.resolve(outArg ?? 'e2e/shots/look');
fs.mkdirSync(out, { recursive: true });
for (const scheme of ['dark', 'light']) {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gl-look-')), {
    headless: true,
    channel: 'msedge',
    colorScheme: scheme,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    viewport: { width: 420, height: 1000 },
  });
  const sw = await (await import('./sw.mjs')).waitForSw(ctx);
  const id = new URL(sw.url()).host;
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${id}/sidepanel.html`);
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/${scheme}-home.png`, fullPage: true });
  for (const tool of ['Store extractor', 'Image downloader', 'Page capture', 'Site crawler']) {
    await p.getByRole('button', { name: new RegExp('^' + tool) }).first().click();
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${out}/${scheme}-${tool.split(' ')[0].toLowerCase()}.png`, fullPage: true });
    await p.getByRole('button', { name: 'Back to tools' }).click();
  }
  await ctx.close();
}
console.log('saved to', out);
