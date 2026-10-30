// The production build on a fresh install, before any site access is granted: the background
// worker must start without errors (Edge's log is read for console errors from the extension).
//   DEBUG=pw:browser node e2e/fresh-install-test.mjs .output/chrome-mv3 2>&1
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { waitForSw } from './sw.mjs';

const ext = path.resolve(process.argv[2] ?? '.output/chrome-mv3');
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'gl-f-')), {
  headless: true,
  channel: 'msedge',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--enable-logging=stderr', '--v=0'],
});
const sw = await waitForSw(ctx);
await new Promise((r) => setTimeout(r, 2500));
const state = await sw.evaluate(async () => ({ access: await chrome.permissions.contains({ origins: ['<all_urls>'] }), sniffing: chrome.webRequest.onHeadersReceived.hasListeners() }));
console.log('STATE', JSON.stringify(state));
if (process.argv.includes('--prove')) {
  // What the old code did at startup, to show this test notices the error
  await sw.evaluate(() => chrome.webRequest.onHeadersReceived.addListener(() => {}, { urls: ['<all_urls>'] }));
  await new Promise((r) => setTimeout(r, 1000));
}
await ctx.close();
