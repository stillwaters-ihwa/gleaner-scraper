// The pop-up window open over a page, if any (Google's review window, a "See all reviews"
// modal...). While one is open, paging and "load more" belong to it: the page behind it has
// its own Next links that would navigate away. Runs in the page.
import { isVisible } from './list';

export function openDialog(doc: Document = document): HTMLElement | null {
  const found = (Array.from(doc.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"]')) as HTMLElement[]).filter((d) => {
    if (!isVisible(d)) return false;
    const r = d.getBoundingClientRect();
    return r.width >= 280 && r.height >= 200;
  });
  // Several can be open (a dialog inside a dialog): the innermost large one is on top
  return found.filter((d) => !found.some((o) => o !== d && d.contains(o))).sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0] ?? null;
}
