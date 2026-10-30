import { browser } from 'wxt/browser';
import { ALARM_PREFIX, OPEN_KEY, getMonitor, listMonitors, patchMonitor, schedule, type MonitorResult } from '@/lib/monitor';
import { PRICE_ALARM_PREFIX, getTracker, listTrackers, patchTracker, scheduleTracker, type TrackerResult } from '@/lib/prices';
import { call, hasHostAccess, tabs, type TabOp } from '@/lib/tab';
import { classify, mergeFound, sizeFromHeaders, wholeFileUrl, type FoundMedia } from '@/lib/video/detect';
import { HELPER, helperHello } from '@/lib/video/youtube';
import type { Browser } from 'wxt/browser';

const OFFSCREEN = '/offscreen.html';

// ---------- Scrapling engine ----------
// One engine for the panel and scheduled monitors: the helper starts the Python server and keeps
// it running while this connection stays open.
let scraplingPort: Browser.runtime.Port | null = null;
let scraplingInfo: Promise<{ port: number; token: string; scrapling: string }> | null = null;

function startScrapling() {
  scraplingInfo ??= (async () => {
    // An older helper is replaced by the one in this build first (it learns the Scrapling commands)
    await helperHello().catch(() => {});
    const source = await fetch(browser.runtime.getURL('/helper/scrapling_server.py' as any)).then((r) => r.text());
    return new Promise<{ port: number; token: string; scrapling: string }>((resolve, reject) => {
      const p = browser.runtime.connectNative(HELPER);
      scraplingPort = p;
      p.onMessage.addListener((m: any) => {
        if (m.id !== 'engine') return;
        if (m.type === 'error') reject(new Error(m.message));
        else resolve({ port: m.port, token: m.token, scrapling: m.scrapling });
      });
      p.onDisconnect.addListener(() => {
        reject(new Error(browser.runtime.lastError?.message ?? 'The helper stopped.'));
        scraplingPort = null;
        scraplingInfo = null;
      });
      p.postMessage({ type: 'scrapling-start', id: 'engine', source });
    });
  })();
  scraplingInfo.catch(() => {
    scraplingPort?.disconnect();
    scraplingPort = null;
    scraplingInfo = null;
  });
  return scraplingInfo;
}
const NOTE_PREFIX = 'gleaner:';

export default defineBackground(() => {
  // Clicking the toolbar icon opens the side panel next to the page.
  browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  // Clear page highlights in any tab when the panel closes.
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'sidepanel') return;
    port.onDisconnect.addListener(async () => {
      const tabs = await browser.tabs.query({});
      for (const t of tabs) {
        if (!t.id) continue;
        browser.scripting
          .executeScript({ target: { tabId: t.id }, func: () => (globalThis as any).__gleaner?.clear() })
          .catch(() => {});
      }
    });
  });

  // ---------- Scheduled monitors ----------

  // Alarms survive restarts, but re-sync in case monitors changed while the browser was closed.
  const syncAlarms = async () => {
    const monitors = await listMonitors();
    const ids = new Set(monitors.map((m) => ALARM_PREFIX + m.id));
    for (const a of await browser.alarms.getAll()) if (a.name.startsWith(ALARM_PREFIX) && !ids.has(a.name)) await browser.alarms.clear(a.name);
    for (const m of monitors) await schedule(m);
    // A run that was cut off by a browser restart is no longer running
    for (const m of monitors) if (m.lastStatus === 'running') await patchMonitor(m.id, { lastStatus: 'error', lastMessage: 'The run was interrupted. It will try again at the next scheduled time.' });

    const trackers = await listTrackers();
    const tids = new Set(trackers.map((t) => PRICE_ALARM_PREFIX + t.id));
    for (const a of await browser.alarms.getAll()) if (a.name.startsWith(PRICE_ALARM_PREFIX) && !tids.has(a.name)) await browser.alarms.clear(a.name);
    for (const t of trackers) await scheduleTracker(t);
    for (const t of trackers) if (t.lastStatus === 'running') await patchTracker(t.id, { lastStatus: 'error', lastMessage: 'The run was interrupted. It will try again at the next scheduled time.' });
  };
  browser.runtime.onInstalled.addListener(() => void syncAlarms());
  browser.runtime.onStartup.addListener(() => void syncAlarms());

  async function ensureOffscreen() {
    const contexts = await (browser.runtime as any).getContexts?.({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (contexts?.length) return;
    try {
      await browser.offscreen.createDocument({ url: OFFSCREEN, reasons: ['DOM_PARSER'], justification: 'Read web pages for scheduled monitors' });
    } catch (e: any) {
      if (!/single offscreen|already/i.test(String(e?.message ?? e))) throw e;
    }
  }

  async function startRun(id: string) {
    const m = await getMonitor(id);
    if (!m) return void (await browser.alarms.clear(ALARM_PREFIX + id));
    if (!(await hasHostAccess())) {
      await patchMonitor(id, { lastStatus: 'error', lastMessage: 'Gleaner needs permission to read websites. Open a tool in Gleaner and choose Allow.' });
      return;
    }
    await ensureOffscreen();
    // The offscreen page may still be loading its script: retry until it answers
    for (let i = 0; i < 20; i++) {
      try {
        const res = await browser.runtime.sendMessage({ type: 'offscreen:run', id });
        if (res?.accepted) return;
      } catch {
        /* no listener yet */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    await patchMonitor(id, { lastStatus: 'error', lastMessage: 'The background runner did not start. Try Run now.' });
  }

  async function startTrackerRun(id: string) {
    const t = await getTracker(id);
    if (!t) return void (await browser.alarms.clear(PRICE_ALARM_PREFIX + id));
    if (!(await hasHostAccess())) {
      await patchTracker(id, { lastStatus: 'error', lastMessage: 'Gleaner needs permission to read websites. Open a tool in Gleaner and choose Allow.' });
      return;
    }
    await ensureOffscreen();
    for (let i = 0; i < 20; i++) {
      try {
        const res = await browser.runtime.sendMessage({ type: 'offscreen:tracker', id });
        if (res?.accepted) return;
      } catch {
        /* no listener yet */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    await patchTracker(id, { lastStatus: 'error', lastMessage: 'The background runner did not start. Try Check now.' });
  }

  async function onAlarm(alarm: { name: string }) {
    if (alarm.name.startsWith(PRICE_ALARM_PREFIX)) {
      const id = alarm.name.slice(PRICE_ALARM_PREFIX.length);
      const t = await getTracker(id);
      if (t && !t.paused) await startTrackerRun(id);
      return;
    }
    if (!alarm.name.startsWith(ALARM_PREFIX)) return;
    const id = alarm.name.slice(ALARM_PREFIX.length);
    const m = await getMonitor(id);
    if (!m || m.paused) return;
    await startRun(id);
  }
  browser.alarms.onAlarm.addListener((a) => void onAlarm(a));

  async function onDone(r: MonitorResult, idle: boolean) {
    if (idle) await browser.offscreen.closeDocument().catch(() => {});
    if (!r.alert && !r.error) return;
    await browser.notifications.create(NOTE_PREFIX + (r.openId ?? r.id), {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icons/128.png'),
      title: r.alert ? `${r.name}: ${r.alert.message}` : `${r.name} could not run`,
      message: r.alert ? r.alert.detail : r.error!,
      priority: 1,
    });
  }

  const TRACKER_NOTE = 'gleaner:tracker:';

  async function onTrackerDone(r: TrackerResult, idle: boolean) {
    if (idle) await browser.offscreen.closeDocument().catch(() => {});
    if (!r.alert && !r.error) return;
    await browser.notifications.create(TRACKER_NOTE + r.id, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icons/128.png'),
      title: r.alert ? `${r.name}: ${r.alert.message}` : `${r.name} price check`,
      message: r.alert ? r.alert.detail : r.error!,
      priority: r.alert?.violations.length ? 2 : 1,
    });
  }

  // Clicking an alert opens the side panel on the change report, or on the price tracker.
  async function onNotificationClick(noteId: string) {
    if (noteId.startsWith(TRACKER_NOTE)) {
      const trackerId = noteId.slice(TRACKER_NOTE.length);
      browser.notifications.clear(noteId);
      await browser.storage.local.set({ [OPEN_KEY]: { trackerId, at: Date.now() } });
      const win = await browser.windows.getLastFocused().catch(() => null);
      try {
        if (!win?.id) throw new Error('no window');
        await browser.sidePanel.open({ windowId: win.id });
      } catch {
        await browser.tabs.create({ url: browser.runtime.getURL(`/sidepanel.html?tracker=${encodeURIComponent(trackerId)}`) });
      }
      return;
    }
    if (!noteId.startsWith(NOTE_PREFIX)) return;
    const datasetId = noteId.slice(NOTE_PREFIX.length);
    browser.notifications.clear(noteId);
    await browser.storage.local.set({ [OPEN_KEY]: { datasetId, at: Date.now() } });
    const win = await browser.windows.getLastFocused().catch(() => null);
    try {
      if (!win?.id) throw new Error('no window');
      await browser.sidePanel.open({ windowId: win.id });
    } catch {
      // Opening the side panel needs a window; fall back to the panel in a tab
      await browser.tabs.create({ url: browser.runtime.getURL(`/sidepanel.html?dataset=${encodeURIComponent(datasetId)}`) });
    }
  }
  browser.notifications.onClicked.addListener((id) => void onNotificationClick(id));

  async function tabOp(op: TabOp, args: any[]) {
    switch (op) {
      case 'get':
        return tabs.get(args[0]);
      case 'create':
        return tabs.create(args[0]);
      case 'remove':
        return tabs.remove(args[0]);
      case 'show':
        return tabs.show(args[0]);
      case 'capture':
        return tabs.capture(args[0]);
      case 'call':
        return call(args[0], args[1], ...args.slice(2));
    }
  }

  browser.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
    if (msg?.type === 'gleaner:tab') {
      // Tab work for the offscreen runner, which has no tabs API of its own
      tabOp(msg.op, msg.args).then(
        (result) => sendResponse({ result }),
        (e) => sendResponse({ error: e?.message ?? String(e) }),
      );
      return true;
    }
    if (msg?.type === 'scrapling:start') {
      startScrapling().then(sendResponse, (e) => sendResponse({ error: String(e?.message ?? e) }));
      return true;
    }
    if (msg?.type === 'scrapling:ready') {
      browser.storage.local.get('scraplingReady').then((r) => sendResponse(!!r.scraplingReady));
      return true;
    }
    if (msg?.type === 'scrapling:reset') {
      scraplingPort?.disconnect();
      scraplingPort = null;
      scraplingInfo = null;
      sendResponse({ ok: true });
      return false;
    }
    if (msg?.type === 'monitor:run') {
      startRun(msg.id).then(() => sendResponse({ ok: true }), (e) => sendResponse({ error: String(e?.message ?? e) }));
      return true;
    }
    if (msg?.type === 'monitor:done') {
      onDone(msg.result, msg.idle).finally(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg?.type === 'tracker:run') {
      startTrackerRun(msg.id).then(() => sendResponse({ ok: true }), (e) => sendResponse({ error: String(e?.message ?? e) }));
      return true;
    }
    if (msg?.type === 'videos:list') {
      videosFor(msg.tabId).then((list) => sendResponse({ list }));
      return true;
    }
    if (msg?.type === 'tracker:done') {
      onTrackerDone(msg.result, msg.idle).finally(() => sendResponse({ ok: true }));
      return true;
    }
  });

  // ---------- Video downloader: videos each tab downloads while it plays ----------
  // Kept in session storage so they survive the background worker going to sleep.
  const VIDEO_KEY = (tabId: number) => `videos:${tabId}`;
  const videoCache = new Map<number, FoundMedia[]>();
  async function videosFor(tabId: number): Promise<FoundMedia[]> {
    if (!videoCache.has(tabId)) {
      const got = await browser.storage.session.get(VIDEO_KEY(tabId));
      videoCache.set(tabId, (got[VIDEO_KEY(tabId)] as FoundMedia[]) ?? []);
    }
    return videoCache.get(tabId)!;
  }
  async function rememberVideo(tabId: number, m: FoundMedia) {
    const next = mergeFound(await videosFor(tabId), m);
    videoCache.set(tabId, next);
    await browser.storage.session.set({ [VIDEO_KEY(tabId)]: next });
  }
  function forgetVideos(tabId: number) {
    videoCache.delete(tabId);
    browser.storage.session.remove(VIDEO_KEY(tabId)).catch(() => {});
  }
  // Watching requests needs site access, which is optional and granted on first use. Listening
  // before that is refused by the browser, so start once access exists (now or when it's granted).
  const onMediaResponse = (d: Browser.webRequest.OnHeadersReceivedDetails): undefined => {
    if (d.tabId < 0 || d.statusCode >= 400) return;
    const type = d.responseHeaders?.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? '';
    const url = wholeFileUrl(d.url);
    const kind = classify(url, type);
    if (!kind || kind === 'subtitles') return;
    void rememberVideo(d.tabId, { url, kind, via: 'network', mime: type.split(';')[0] || undefined, bytes: kind === 'file' || kind === 'audio' ? sizeFromHeaders(d.responseHeaders ?? []) : undefined, at: Date.now() });
  };
  const startSniffing = async () => {
    if (!browser.webRequest || browser.webRequest.onHeadersReceived.hasListener(onMediaResponse) || !(await hasHostAccess())) return;
    browser.webRequest.onHeadersReceived.addListener(onMediaResponse, { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other', 'object'] }, ['responseHeaders']);
  };
  void startSniffing();
  browser.permissions.onAdded.addListener(() => void startSniffing());
  browser.permissions.onRemoved.addListener(async () => {
    if (!(await hasHostAccess())) browser.webRequest?.onHeadersReceived.removeListener(onMediaResponse);
  });
  browser.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'loading' && info.url) forgetVideos(tabId);
  });
  browser.tabs.onRemoved.addListener((tabId) => forgetVideos(tabId));

  // Lets tests fire a monitor's or tracker's alarm without waiting for it.
  if (import.meta.env.MODE === 'e2e') (globalThis as any).__gleanerMonitors = { onAlarm, syncAlarms, onNotificationClick, startTrackerRun };
});
