// "Only new since last run": remembers which items a search already returned, so the next run can
// keep just the new ones (new jobs, new listings, new articles). Stored per search in the browser.
import { browser } from 'wxt/browser';

const CAP = 20000;
const keyFor = (scope: string) => `gleaner:seen:${scope}`;

/** A stable name for a search, from what it reads. */
export function scopeOf(kind: string, source: string, inputs: string[]): string {
  const text = `${kind}|${source}|${inputs.map((s) => s.trim().toLowerCase()).sort().join('\n')}`;
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return `${kind}:${(h >>> 0).toString(36)}`;
}

/** Keep the items not seen before, then remember all of them for next time. */
export async function onlyNew<T>(scope: string, items: T[], key: (t: T) => string): Promise<{ fresh: T[]; firstRun: boolean }> {
  const k = keyFor(scope);
  const stored = (await browser.storage.local.get(k))[k] as string[] | undefined;
  const seen = new Set(stored ?? []);
  const fresh = items.filter((i) => !seen.has(key(i)));
  const all = [...seen, ...fresh.map(key)].slice(-CAP);
  await browser.storage.local.set({ [k]: all });
  return { fresh, firstRun: !stored };
}

/** What earlier runs of this search already returned. */
export async function seenKeys(scope: string): Promise<Set<string> | null> {
  const k = keyFor(scope);
  const stored = (await browser.storage.local.get(k))[k] as string[] | undefined;
  return stored ? new Set(stored) : null;
}

export type FreshMode = 'all' | 'mark' | 'only';
export const NEW_COLUMN = 'new_since_last_run';

/**
 * Compare with earlier runs: "mark" keeps every row and fills a "new since last run" column,
 * "only" keeps just the new rows. Either way the rows are remembered for next time.
 */
export async function compareWithEarlier<T extends Record<string, string>>(scope: string, rows: T[], key: (t: T) => string, mode: FreshMode): Promise<{ rows: T[]; fresh: number; firstRun: boolean }> {
  if (mode === 'all') return { rows, fresh: rows.length, firstRun: false };
  const before = await seenKeys(scope);
  const { fresh, firstRun } = await onlyNew(scope, rows, key);
  if (mode === 'only') return { rows: fresh, fresh: fresh.length, firstRun };
  const isNew = new Set(fresh.map(key));
  return { rows: rows.map((r) => ({ ...r, [NEW_COLUMN]: before && isNew.has(key(r)) ? 'new' : '' })), fresh: fresh.length, firstRun };
}

/** A sentence for the run's note. */
export function freshNote(mode: FreshMode, r: { fresh: number; firstRun: boolean }, total: number, label: string): string {
  if (mode === 'all') return '';
  if (r.firstRun) return ` First run of this search: next time Gleaner ${mode === 'only' ? 'keeps only' : 'marks'} the new ${label}.`;
  return r.fresh ? ` ${r.fresh} new ${label} since the last run${mode === 'mark' ? ' (marked in "new since last run")' : ''}.` : ` Nothing new since the last run (${total} already seen).`;
}

export async function forget(scope: string) {
  await browser.storage.local.remove(keyFor(scope));
}
