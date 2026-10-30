// "Which pages to go through" for tools that read a listing: all pages, or up to N,
// plus a check that shows what Gleaner will use to move to the next page.
import { useState } from 'react';
import { ArrowRight, MagnifyingGlass } from '@phosphor-icons/react';
import { describePager, type PagerInfo } from '@/lib/listing';
import { activeTab, call, isRestricted, requestHostAccess } from '@/lib/tab';
import { Button, Field, NumberInput, Segmented } from './ui';

export function PagingControls({ maxPages, onChange }: { maxPages: number; onChange: (n: number) => void }) {
  const [upTo, setUpTo] = useState(maxPages > 0 ? maxPages : 10);
  const [found, setFound] = useState<{ count: number; pager: PagerInfo } | null | 'none'>(null);
  const [checking, setChecking] = useState(false);
  const all = maxPages === 0;

  async function check() {
    if (!(await requestHostAccess())) return;
    setChecking(true);
    try {
      const tab = await activeTab();
      if (isRestricted(tab.url)) return setFound('none');
      const grid = await call<{ itemSelector: string; count: number } | null>(tab.id!, 'findProductList');
      if (!grid) return setFound('none');
      await call(tab.id!, 'showList', grid.itemSelector);
      setFound({ count: grid.count, pager: await describePager(tab.id!) });
    } catch {
      setFound('none');
    } finally {
      setChecking(false);
    }
  }

  const pagerText = (p: PagerInfo) =>
    !p ? 'No next page found, so only this page will be read.'
    : p.kind === 'number' ? 'Then clicks the next page number, page after page.'
    : p.kind === 'load-more' ? `Then clicks "${p.label}" until no more products load.`
    : p.kind === 'url' ? 'Then moves to the next page by changing the page number in the address.'
    : `Then clicks "${p.label}" on every page.`;

  return (
    <div className="flex flex-col gap-3">
      <Field label="Pages to go through" help={all ? 'Keeps going to the next page until the last one. Stops early only if a page adds no new products.' : undefined}>
        {() => (
          <Segmented
            label="Pages to go through"
            value={all ? 'all' : 'some'}
            onChange={(v) => onChange(v === 'all' ? 0 : upTo)}
            options={[
              { value: 'all', label: 'All pages' },
              { value: 'some', label: 'Up to a number' },
            ]}
          />
        )}
      </Field>
      {!all && (
        <Field label="Number of pages">
          {(id) => (
            <NumberInput
              id={id}
              value={maxPages}
              min={1}
              max={1000}
              onChange={(n) => {
                setUpTo(n);
                onChange(n);
              }}
            />
          )}
        </Field>
      )}
      <div className="flex items-start justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2">
        <p className="min-w-0 text-[12.5px] leading-snug">
          {found === null && <span className="text-muted">Check the page in this tab to see how Gleaner will move to the next page.</span>}
          {found === 'none' && <span className="text-danger">No product grid on the page in this tab. Open a search or category page first.</span>}
          {found && found !== 'none' && (
            <>
              <span className="font-mono tabular-nums">{found.count}</span> products on this page.{' '}
              <span className={found.pager ? 'text-ink' : 'text-muted'}>
                {found.pager && <ArrowRight size={12} className="mr-1 inline align-[-1px] text-accent-text" aria-hidden />}
                {pagerText(found.pager)}
              </span>
            </>
          )}
        </p>
        <Button variant="ghost" onClick={check} disabled={checking} className="shrink-0">
          <MagnifyingGlass size={14} aria-hidden /> {checking ? 'Checking' : 'Check'}
        </Button>
      </div>
    </div>
  );
}
