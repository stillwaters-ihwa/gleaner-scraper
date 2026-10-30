// Side panel <-> page bridge: inject the command script into a tab and call commands on it.
import { browser, type Browser } from 'wxt/browser';

export class TabError extends Error {}

// The offscreen document that runs scheduled monitors has no tabs or scripting API.
// There, tab work is relayed to the background service worker (see entrypoints/background.ts).
const remote = typeof browser.tabs === 'undefined';

async function viaWorker<T>(op: TabOp, ...args: any[]): Promise<T> {
  const res = await browser.runtime.sendMessage({ type: 'gleaner:tab', op, args });
  if (res?.error) throw new TabError(res.error);
  return res?.result as T;
}

export type TabOp = 'get' | 'create' | 'remove' | 'call' | 'show' | 'capture';

/** Bring a tab to the front and focus its window, so the user can see and act on it. */
async function showTab(id: number): Promise<void> {
  const tab = await browser.tabs.update(id, { active: true });
  if (tab?.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true }).catch(() => {});
}

/** A JPEG screenshot of a tab (activated first, since only the visible tab can be captured). */
async function captureTab(id: number): Promise<string> {
  const tab = await browser.tabs.update(id, { active: true });
  if (tab?.windowId === undefined) throw new TabError('Could not focus the tab to screenshot it.');
  await sleep(500); // let it paint after becoming visible
  return browser.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
}

/** Tab primitives that work in the side panel, the service worker and the offscreen document. */
export const tabs = {
  get: (id: number) => (remote ? viaWorker<Browser.tabs.Tab>('get', id) : browser.tabs.get(id)),
  create: (props: { url: string; active: boolean }) => (remote ? viaWorker<Browser.tabs.Tab>('create', props) : browser.tabs.create(props)),
  remove: (id: number) => (remote ? viaWorker<void>('remove', id) : browser.tabs.remove(id)),
  show: (id: number) => (remote ? viaWorker<void>('show', id) : showTab(id)),
  capture: (id: number) => (remote ? viaWorker<string>('capture', id) : captureTab(id)),
};

const RESTRICTED = /^(chrome|edge|brave|about|chrome-extension|moz-extension|view-source|devtools):|chromewebstore\.google\.com|microsoftedge\.microsoft\.com\/addons/;

export async function activeTab() {
  let [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  // When the panel is opened as a normal tab (e.g. in tests), use the last focused web page instead.
  if (tab?.url?.startsWith(browser.runtime.getURL('/'))) {
    const others = await browser.tabs.query({ active: true });
    tab = others.find((t) => t.url && !t.url.startsWith(browser.runtime.getURL('/'))) ?? tab;
  }
  if (!tab?.id) throw new TabError('No active tab found.');
  return tab;
}

export function isRestricted(url?: string) {
  return !url || RESTRICTED.test(url);
}

export async function hasHostAccess(): Promise<boolean> {
  return browser.permissions.contains({ origins: ['<all_urls>'] });
}

/** Must be called from a click handler: the browser only shows the prompt after a user gesture. */
export async function requestHostAccess(): Promise<boolean> {
  if (await hasHostAccess()) return true;
  return browser.permissions.request({ origins: ['<all_urls>'] });
}

async function ensureInjected(tabId: number) {
  const [probe] = await browser.scripting.executeScript({
    target: { tabId },
    func: () => !!(globalThis as any).__gleaner,
  });
  if (!probe?.result) {
    await browser.scripting.executeScript({ target: { tabId }, files: ['/injected.js'] });
  }
}

/** Call a command from entrypoints/injected.ts inside the tab and return its result. */
export async function call<T = any>(tabId: number, command: string, ...args: any[]): Promise<T> {
  if (remote) return viaWorker<T>('call', tabId, command, ...args);
  try {
    await ensureInjected(tabId);
    const [res] = await browser.scripting.executeScript({
      target: { tabId },
      // Results come back as a JSON string: Chrome sorts object keys when it converts
      // script results, which would scramble column order.
      func: async (cmd: string, a: any[]) => JSON.stringify((await (globalThis as any).__gleaner[cmd](...a)) ?? null),
      args: [command, args],
    });
    return JSON.parse((res?.result as string) ?? 'null') as T;
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (/cannot access|cannot be scripted|extensions gallery|chrome:\/\//i.test(msg)) {
      throw new TabError("This page can't be read by extensions. Open a normal website and try again.");
    }
    throw new TabError(msg);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until the tab has finished loading. */
export async function waitForLoad(tabId: number, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await tabs.get(tabId);
    if (t.status === 'complete') return;
    await sleep(250);
  }
}

/** Open a URL in a background tab, run `fn` on it, then close it. */
export async function withBackgroundTab<T>(url: string, fn: (tabId: number) => Promise<T>, settleMs = 1200): Promise<T> {
  const tab = await tabs.create({ url, active: false });
  try {
    await waitForLoad(tab.id!);
    await sleep(settleMs);
    return await fn(tab.id!);
  } finally {
    tabs.remove(tab.id!).catch(() => {});
  }
}
