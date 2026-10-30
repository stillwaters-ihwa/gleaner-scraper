// Seller Central inventory: the seller's own listings from Manage All Inventory, read page by
// page in the tab they are signed in to.
import { useState } from 'react';
import { newDataset, saveDataset, type Column } from '@/lib/db';
import { SELLER_COLUMNS, crawlSellerInventory } from '@/lib/sellerCrawl';
import { activeTab } from '@/lib/tab';
import { Field, NumberInput, Section } from '../ui';
import { RunBar, hostOf, useJob } from '../run';

export function SellerInventory() {
  const [maxPages, setMaxPages] = useState(100);
  const job = useJob();

  function start() {
    job.start(async ({ signal, progress, status }) => {
      const tab = await activeTab();
      if (!/sellercentral(-europe|-japan)?\.amazon\./.test(tab.url ?? '')) throw new Error('Open Seller Central, Inventory > Manage All Inventory in this tab, then run again.');
      const res = await crawlSellerInventory(tab.id!, { maxPages: maxPages || 1000, signal, status, progress });
      if (!res.rows.length) throw new Error('No listings found on this page. Open Inventory > Manage All Inventory, wait for the list to show, then run again.');
      const keys = new Set(res.rows.flatMap((r) => Object.keys(r)));
      const columns: Column[] = [
        ...SELLER_COLUMNS.filter(([k]) => keys.has(k)).map(([key, label]) => ({ key, label })),
        ...[...keys].filter((k) => !SELLER_COLUMNS.some(([c]) => c === k)).map((k) => ({ key: k, label: k.replace(/_/g, ' ') })),
      ];
      const note = `${res.stopped}. ${res.rows.length} listings from ${res.pages} ${res.pages === 1 ? 'page' : 'pages'}.`;
      return saveDataset({ ...newDataset('seller', `Seller inventory ${hostOf(tab.url!)}`, tab.url!, columns, res.rows), note });
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <Section title="Source">
        <p className="text-[12.5px] leading-relaxed text-muted">
          Your own listings from Seller Central: status, ASIN, SKU, FNSKU, price, fees, stock (on hand, available, inbound, reserved, unfulfillable), 30-day sales, units, page views and sales rank.
        </p>
        <ol className="list-decimal pl-5 text-[12px] leading-relaxed text-muted">
          <li>In this tab, open Seller Central, Inventory &gt; Manage All Inventory.</li>
          <li>Set it to show 250 results per page, so there are fewer pages to go through.</li>
          <li>Click Read listings. Gleaner reads each page and clicks Next until the last one.</li>
        </ol>
        <Field label="Most pages to read">{(id) => <NumberInput id={id} value={maxPages} onChange={setMaxPages} min={1} max={1000} />}</Field>
        <p className="text-[12px] leading-relaxed text-muted">Nothing is changed in your account: Gleaner only reads what the page shows.</p>
      </Section>
      <div className="flex-1" />
      <RunBar job={job} onStart={start} startLabel="Read listings" />
    </div>
  );
}
