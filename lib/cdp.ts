// The browser's debugging interface for a tab: real mouse-wheel input (lists that only load when
// a person scrolls), full-page screenshots and MHTML snapshots. While attached, Edge and Chrome
// show a "Gleaner started debugging this browser" bar, which goes away on release.
import { browser } from 'wxt/browser';

const attached = new Set<number>();

export async function attach(tabId: number) {
  if (attached.has(tabId)) return;
  if (!browser.debugger) throw new Error('This browser does not let extensions take full-page captures.');
  try {
    await browser.debugger.attach({ tabId }, '1.3');
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    if (/already attached/i.test(m)) throw new Error('Developer tools (or another extension) is debugging this tab. Close DevTools on this tab and try again.');
    if (/cannot access|chrome:\/\/|edge:\/\//i.test(m)) throw new Error('Browser pages (settings, new tab, the web store) cannot be captured.');
    throw e;
  }
  attached.add(tabId);
}

export async function send<T = any>(tabId: number, method: string, params: Record<string, unknown> = {}): Promise<T> {
  await attach(tabId);
  return (await browser.debugger.sendCommand({ tabId }, method, params)) as T;
}

/** Runs an expression in the page and returns its value (JSON-serialisable). */
export async function evaluate<T = any>(tabId: number, expression: string): Promise<T> {
  const r = await send<{ result: { value: T }; exceptionDetails?: { text: string } }>(tabId, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}

/** Ends the connection so the browser's "debugging" bar goes away. */
export async function release(tabId: number) {
  if (!attached.delete(tabId)) return;
  await browser.debugger.detach({ tabId }).catch(() => {});
}

// If the person closes the bar (or the tab), forget the connection
browser.debugger?.onDetach.addListener((source) => {
  if (source.tabId !== undefined) attached.delete(source.tabId);
});
