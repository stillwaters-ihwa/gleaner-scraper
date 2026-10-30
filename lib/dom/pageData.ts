// Tables and links read from a page. Kept apart from the converters so the script that runs
// inside web pages stays small.
export type Row = Record<string, string>;

// ---------- HTML tables ----------

export interface HtmlTable {
  index: number;
  caption: string;
  headers: string[];
  rows: string[][];
}

const cellText = (c: Element) => (c.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Every table in some HTML, with colspan and rowspan expanded into a plain grid. */
export function htmlTables(doc: Document): HtmlTable[] {
  return Array.from(doc.querySelectorAll('table'))
    .filter((t) => !t.querySelector('table')) // nested layout tables: use the inner ones
    .map((t, index) => {
      const grid: string[][] = [];
      const trs = Array.from(t.querySelectorAll('tr'));
      trs.forEach((tr, r) => {
        grid[r] ??= [];
        let c = 0;
        for (const cell of Array.from(tr.children).filter((el) => el.tagName === 'TD' || el.tagName === 'TH')) {
          while (grid[r][c] !== undefined) c++;
          const cs = Math.min(50, Number(cell.getAttribute('colspan')) || 1);
          const rs = Math.min(500, Number(cell.getAttribute('rowspan')) || 1);
          for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) {
            grid[r + dr] ??= [];
            grid[r + dr][c + dc] = cellText(cell);
          }
          c += cs;
        }
      });
      const width = Math.max(0, ...grid.map((g) => g.length));
      const filled = grid.map((g) => Array.from({ length: width }, (_, i) => g[i] ?? '')).filter((g) => g.some(Boolean));
      const headIsTh = trs[0] && Array.from(trs[0].children).every((c) => c.tagName === 'TH');
      const hasHead = !!t.querySelector('thead') || headIsTh;
      const headers = hasHead && filled.length ? filled[0].map((h, i) => h || `column ${i + 1}`) : Array.from({ length: width }, (_, i) => `column ${i + 1}`);
      return { index, caption: cellText(t.querySelector('caption') ?? t), headers: uniq(headers), rows: hasHead ? filled.slice(1) : filled };
    })
    .filter((t) => t.rows.length > 0 && (t.headers.length >= 2 || t.rows.length >= 2))
    .map((t) => ({ ...t, caption: t.caption.slice(0, 80) }));
}

export function uniq(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = n.toLowerCase();
    const c = (seen.get(k) ?? 0) + 1;
    seen.set(k, c);
    return c > 1 ? `${n} ${c}` : n;
  });
}

export const tableRows = (t: HtmlTable): Row[] => t.rows.map((r) => Object.fromEntries(t.headers.map((h, i) => [h, r[i] ?? ''])));

// ---------- Links ----------

export interface LinkRow extends Row {
  url: string;
  text: string;
  type: 'internal' | 'external' | 'email' | 'phone' | 'file';
  rel: string;
  found_on: string;
}

/** Every link on a page, classified, without duplicates. */
export function pageLinks(doc: Document, pageUrl: string): LinkRow[] {
  const origin = new URL(pageUrl).origin;
  const out = new Map<string, LinkRow>();
  for (const a of Array.from(doc.querySelectorAll('a[href], area[href]'))) {
    const raw = a.getAttribute('href')!.trim();
    if (!raw || raw.startsWith('#') || /^javascript:/i.test(raw)) continue;
    let url: string;
    try {
      url = new URL(raw, pageUrl).href.split('#')[0];
    } catch {
      continue;
    }
    if (out.has(url)) continue;
    const type: LinkRow['type'] = /^mailto:/i.test(url) ? 'email' : /^tel:/i.test(url) ? 'phone' : /\.(pdf|docx?|xlsx?|csv|zip|pptx?|txt|jpe?g|png|gif|webp|mp4|mp3)(\?|$)/i.test(url) ? 'file' : url.startsWith(origin) ? 'internal' : 'external';
    out.set(url, { url, text: (a.textContent ?? a.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim().slice(0, 200), type, rel: a.getAttribute('rel') ?? '', found_on: pageUrl });
  }
  return [...out.values()];
}
