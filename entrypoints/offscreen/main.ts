// Hidden page that runs scheduled monitors. The service worker has no DOM, which the
// extractors need, so it opens this page and hands it work. Tab access is relayed back
// through the worker (see lib/tab.ts).
import { browser } from 'wxt/browser';
import { runMonitor } from '@/lib/monitorRun';
import { runTracker } from '@/lib/trackerRun';

const running = new Set<string>();
// A stuck site should not hold the runner open forever
const TIME_LIMIT = 20 * 60 * 1000;

browser.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  if (msg?.type === 'offscreen:run') {
    sendResponse({ accepted: true });
    if (running.has(msg.id)) return;
    running.add(msg.id);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIME_LIMIT);
    runMonitor(msg.id, ctrl.signal)
      .catch((e) => ({ id: msg.id, name: '', ok: false, error: String(e?.message ?? e) }))
      .then((result) => {
        clearTimeout(timer);
        running.delete(msg.id);
        return browser.runtime.sendMessage({ type: 'monitor:done', result, idle: running.size === 0 });
      })
      .catch(() => {});
    return;
  }
  if (msg?.type === 'offscreen:tracker') {
    sendResponse({ accepted: true });
    const key = 'tracker:' + msg.id;
    if (running.has(key)) return;
    running.add(key);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIME_LIMIT);
    // Scheduled runs are not interactive: no one is there to focus a window
    runTracker(msg.id, { signal: ctrl.signal, status: () => {}, interactive: false })
      .catch((e) => ({ id: msg.id, name: '', ok: false, error: String(e?.message ?? e) }))
      .then((result) => {
        clearTimeout(timer);
        running.delete(key);
        return browser.runtime.sendMessage({ type: 'tracker:done', result, idle: running.size === 0 });
      })
      .catch(() => {});
    return;
  }
});
