// Search a marketplace by keyword (Amazon, Walmart, eBay, Etsy, AliExpress, K-beauty shops...)
// or look up Amazon products by ASIN. Runs on the Store extractor's engine.
import { useState } from 'react';
import { saveDataset } from '@/lib/db';
import { runStore, type StoreSetup } from '@/lib/jobs';
import { MARKETPLACES, asinUrl, parseAsins } from '@/lib/marketplaces';
import { SPEEDS, type Speed } from '@/lib/listing';
import { sleep, tabs, waitForLoad } from '@/lib/tab';
import { Check, Field, NumberInput, Section, Segmented, inputCls } from '../ui';
import { RunBar, useJob } from '../run';

export function MarketplaceTool() {
  const [mode, setMode] = useState<'search' | 'asin'>('search');
  const [market, setMarket] = useState(MARKETPLACES[0].id);
  const [query, setQuery] = useState('');
  const [asinText, setAsinText] = useState('');
  const [pages, setPages] = useState(3);
  const [openEach, setOpenEach] = useState(false);
  const [speed, setSpeed] = useState<Speed>('gentle');
  const job = useJob();
  const m = MARKETPLACES.find((x) => x.id === market)!;
  const amazons = MARKETPLACES.filter((x) => x.id.startsWith('amazon'));
  const asins = parseAsins(asinText);
  const isAmazon = m.id.startsWith('amazon');

  function start() {
    job.start(async (ctx) => {
      const base: Omit<StoreSetup, 'method'> = {
        store: m.origin,
        output: 'products',
        maxProducts: mode === 'asin' ? asins.length : 5000,
        maxPages: pages,
        openEach,
        load: isAmazon ? 'tab' : 'auto',
        concurrency: isAmazon ? 1 : 3,
        urls: '',
        speed,
        wholesale: 'off',
      };
      let ds;
      if (mode === 'search') {
        // A visible tab: browsers pause infinite scroll and lazy-loading in hidden tabs
        const url = m.search(query.trim());
        ctx.status(`Opening ${m.name} search results`);
        const tab = await tabs.create({ url, active: true });
        await waitForLoad(tab.id!);
        await sleep(isAmazon ? 1800 : 1200);
        ds = await runStore({ ...base, method: 'listing', listingUrl: url }, ctx, { tabId: tab.id! });
      } else ds = await runStore({ ...base, method: 'urls', urls: asins.map((a) => asinUrl(m.origin, a)).join('\n') }, ctx);
      ds.name = mode === 'search' ? `${m.name} "${query.trim()}"` : `${m.name} ${asins.length} ASINs`;
      return saveDataset(ds);
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <Section title="Find products">
        <Segmented
          label="Mode"
          value={mode}
          onChange={(v) => {
            setMode(v);
            if (v === 'asin' && !market.startsWith('amazon')) setMarket('amazon-us');
          }}
          options={[
            { value: 'search', label: 'Keyword search' },
            { value: 'asin', label: 'ASIN lookup' },
          ]}
        />
        <Field label="Marketplace">
          {(id) => (
            <select id={id} value={market} onChange={(e) => setMarket(e.target.value)} className={inputCls}>
              {(mode === 'asin' ? amazons : MARKETPLACES).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        {mode === 'search' ? (
          <>
            <Field label="Search for">{(id) => <input id={id} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. snail mucin essence" className={inputCls} />}</Field>
            <Field label="Result pages to read">{(id) => <NumberInput id={id} value={pages} onChange={setPages} min={1} max={50} />}</Field>
            <p className="text-[12px] leading-relaxed text-muted">Opens the marketplace&apos;s own search results in a new tab and reads every product card, page after page (or as it scrolls): title, price, rating, reviews, image and link. Amazon adds the ASIN.</p>
          </>
        ) : (
          <Field label={`ASINs or Amazon links${asins.length ? ` (${asins.length})` : ''}`} help="One per line, or paste product links. Each product page is read for price, brand, rating, reviews, images and details.">
            {(id) => <textarea id={id} rows={5} value={asinText} onChange={(e) => setAsinText(e.target.value)} spellCheck={false} placeholder={'B0BRT7LZLN\nhttps://www.amazon.com/dp/B07N8NVV1C'} className={inputCls + ' resize-y font-mono text-[12px] leading-relaxed'} />}
          </Field>
        )}
      </Section>
      <Section title="Options">
        {mode === 'search' && (
          <Check checked={openEach} onChange={setOpenEach}>
            Open each product for its full details (slower)
          </Check>
        )}
        <Field label="Pace between pages" help={SPEEDS[speed].label + (isAmazon ? '. Amazon shows a check to fast visitors, so Gentle is the default.' : '')}>
          {() => <Segmented label="Pace" value={speed} onChange={setSpeed} options={[{ value: 'gentle', label: 'Gentle' }, { value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Fast' }]} />}
        </Field>
      </Section>
      <div className="flex-1" />
      <RunBar job={job} onStart={start} startLabel={mode === 'search' ? 'Search' : asins.length === 1 ? 'Look up 1 product' : asins.length ? `Look up ${asins.length} products` : 'Look up products'} disabled={mode === 'search' ? !query.trim() : !asins.length} />
    </div>
  );
}
