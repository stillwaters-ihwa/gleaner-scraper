// "Analyze first": read a sample before scraping and choose exactly which columns to create.
import { useState } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import type { Product } from '@/lib/product';
import { addWholesale, looksWholesale, productColumns } from '@/lib/productColumns';
import { productFromUrl, type ProductLoad } from '@/lib/store';
import { activeTab, call, isRestricted, requestHostAccess } from '@/lib/tab';
import { Button, Notice, Segmented } from './ui';

export type Wholesale = 'auto' | 'on' | 'off';

export interface PlannedColumn {
  key: string;
  label: string;
  fill: number;
  sample: string;
}

interface Props {
  /** Where the sample comes from. */
  source: 'listing' | 'urls';
  urls: string[];
  openEach: boolean;
  load: ProductLoad;
  wholesale: Wholesale;
  onWholesale: (w: Wholesale) => void;
  plan: PlannedColumn[] | null;
  onPlan: (plan: PlannedColumn[] | null) => void;
  chosen: Set<string>;
  onChosen: (keys: Set<string>) => void;
}

/** Products found in the sample, with the columns they would produce. */
function planFrom(products: Product[], wholesale: Wholesale): PlannedColumn[] {
  const withExtras = wholesale === 'on' || (wholesale === 'auto' && looksWholesale(products)) ? addWholesale(products) : products;
  return productColumns(withExtras, { attrThreshold: 0.3 })
    .filter((c) => c.key !== 'error' && c.key !== 'source')
    .map((c) => {
      const values = withExtras.map((p) => p[c.key]).filter(Boolean);
      return { key: c.key, label: c.label, fill: values.length / Math.max(1, withExtras.length), sample: values[0] ?? '' };
    });
}

export function ColumnPlanner({ source, urls, openEach, load, wholesale, onWholesale, plan, onPlan, chosen, onChosen }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [found, setFound] = useState('');

  async function analyze() {
    setError('');
    if (!(await requestHostAccess())) return setError('Gleaner needs permission to read websites.');
    setBusy(true);
    try {
      let products: Product[] = [];
      let pageUrl = '';
      if (source === 'listing') {
        const tab = await activeTab();
        if (isRestricted(tab.url)) throw new Error('Open a listing page of the store in this tab first.');
        const grid = await call<{ itemSelector: string; count: number } | null>(tab.id!, 'findProductList');
        if (!grid) throw new Error("Couldn't find a product grid on this page.");
        await call(tab.id!, 'showList', grid.itemSelector);
        products = await call<Product[]>(tab.id!, 'extractCards', grid.itemSelector);
        pageUrl = openEach ? products.find((p) => p.url)?.url ?? '' : '';
      } else pageUrl = urls[0] ?? '';

      // One product page shows what "open each product page" would add
      if (pageUrl) {
        const page = await productFromUrl(pageUrl, load, new AbortController().signal).catch(() => null);
        if (page && !page.error) {
          if (products.length) products[0] = { ...products[0], ...Object.fromEntries(Object.entries(page).filter(([, v]) => v)) };
          else products = [page];
        }
      }
      if (!products.length) throw new Error('No products found in the sample.');
      const next = planFrom(products, wholesale);
      onPlan(next);
      onChosen(new Set(next.map((c) => c.key)));
      setFound(`${products.length} ${products.length === 1 ? 'product' : 'products'} sampled${pageUrl ? ', plus one product page' : ''}. Untick anything you don't need.`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (key: string) => {
    const n = new Set(chosen);
    n.has(key) ? n.delete(key) : n.add(key);
    onChosen(n);
  };

  return (
    <div className="flex flex-col gap-3">
      <Segmented
        label="Wholesale details"
        value={wholesale}
        onChange={onWholesale}
        options={[
          { value: 'auto', label: 'Wholesale: auto' },
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ]}
      />
      <p className="text-[12px] leading-snug text-muted">
        Adds "1 box = 48 ea", "1 carton = 240 ea" and the price of a full box when products list MOQ, box or carton quantities. Auto turns it on only when those details exist.
      </p>
      <Button onClick={analyze} disabled={busy}>
        <MagnifyingGlass size={15} aria-hidden /> {busy ? 'Analyzing' : plan ? 'Analyze again' : 'Analyze first'}
      </Button>
      {error && <Notice tone="error">{error}</Notice>}
      {!plan && !error && <p className="text-[12px] text-muted">Optional. Without it, Gleaner keeps every column it finds.</p>}
      {plan && (
        <>
          <p className="text-[12px] text-muted">{found}</p>
          <ul className="flex max-h-[320px] flex-col overflow-y-auto rounded-lg border border-line bg-surface">
            {plan.map((c) => (
              <li key={c.key} className="border-b border-line last:border-b-0">
                <label className="flex cursor-pointer items-start gap-2.5 px-2.5 py-2 hover:bg-surface-2">
                  <input type="checkbox" checked={chosen.has(c.key)} onChange={() => toggle(c.key)} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-medium">{c.label}</span>
                      <span className={`shrink-0 font-mono text-[11px] tabular-nums ${c.fill < 0.5 ? 'text-muted' : 'text-ok'}`}>{Math.round(c.fill * 100)}%</span>
                    </span>
                    <span className="block truncate text-[11.5px] text-muted" title={c.sample}>
                      {c.sample || 'empty in the sample'}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex justify-between text-[12px]">
            <button className="cursor-pointer text-accent-text hover:underline" onClick={() => onChosen(new Set(plan.map((c) => c.key)))}>
              Select all
            </button>
            <button className="cursor-pointer text-muted hover:text-ink" onClick={() => onPlan(null)}>
              Forget the plan, keep everything
            </button>
          </div>
        </>
      )}
    </div>
  );
}
