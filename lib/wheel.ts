// Real mouse-wheel scrolling in a tab, for lists that only load more when a person scrolls
// (Google's review window ignores scrolling done by page scripts). Sends the same wheel input a
// mouse would, through the browser's debugging interface (lib/cdp.ts).
import { release, send } from './cdp';

/** Scrolls at a point in the page (CSS pixels from the top left of the visible area). */
export async function wheel(tabId: number, x: number, y: number, deltaY = 1200, times = 3): Promise<boolean> {
  try {
    // A small scroll up first: a list already at its end only loads more when it moves
    await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: -400 });
    await new Promise((r) => setTimeout(r, 150));
    for (let i = 0; i < times; i++) {
      await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
      await new Promise((r) => setTimeout(r, 120));
    }
    return true;
  } catch {
    // Another debugger (DevTools) is attached, or the tab went away
    return false;
  }
}

/** Ends real scrolling in this tab, so the browser's "debugging" bar goes away. */
export const releaseWheel = (tabId: number) => release(tabId);
