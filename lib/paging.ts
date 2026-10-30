// Moving a tab to the next page of results and waiting until the new results are in.
import { call, sleep, tabs, waitForLoad } from './tab';

/** Wait until the list on the page changes (new page loaded, or new items appended). */
export async function waitForListChange(tabId: number, itemSelector: string, before: string, signal: AbortSignal, timeoutMs = 20000): Promise<boolean> {
  const start = Date.now();
  // Short polls instead of fixed waits: a fast site's next page counts the moment it is there
  await sleep(250);
  while (Date.now() - start < timeoutMs && !signal.aborted) {
    try {
      const t = await tabs.get(tabId);
      if (t.status === 'loading') {
        await waitForLoad(tabId);
        await sleep(300);
      }
      if ((await call<string>(tabId, 'signature', itemSelector)) !== before) return true;
    } catch {
      /* page is mid-navigation */
    }
    await sleep(300);
  }
  return false;
}

export interface NextControl {
  selector: string;
  label: string;
  kind: 'next' | 'number' | 'load-more';
}

/** Click through to the next page. Returns false when there is no next page. */
export async function goToNextPage(tabId: number, itemSelector: string, signal: AbortSignal): Promise<boolean> {
  const next = await call<NextControl | null>(tabId, 'findNextControl');
  if (!next) return false;
  const before = await call<string>(tabId, 'signature', itemSelector);
  if (!(await call<boolean>(tabId, 'clickNext', next.selector))) return false;
  return waitForListChange(tabId, itemSelector, before, signal);
}
