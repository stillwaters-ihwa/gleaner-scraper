// Waits for the extension's background worker. Newer Edge builds can start it before Playwright
// listens for the event, or only once a page is open, so poll and nudge with a blank page.
export async function waitForSw(ctx, ms = 45000) {
  const end = Date.now() + ms;
  let nudged = null;
  while (Date.now() < end) {
    const [sw] = ctx.serviceWorkers();
    if (sw) {
      await nudged?.close();
      return sw;
    }
    if (!nudged && Date.now() > end - ms + 3000) nudged = await ctx.newPage().then(async (p) => (await p.goto('about:blank'), p));
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('The extension did not start in Edge');
}
