// Email extractor and social link extractor: visit each site, optionally follow its contact/about pages.
import { useState } from 'react';
import { contactLinks, findEmails, findPhones, findSocials, SOCIAL_NETWORKS } from '@/lib/dom/doc';
import { newDataset, saveDataset, type Column } from '@/lib/db';
import { normalizeUrls, runPool, withPage } from '@/lib/runner';
import { Check, Field, NumberInput, Section } from '../ui';
import { RunBar, UrlSource, hostOf, useJob } from '../run';
import { LoadOptions, defaultLoad } from './common';

type Kind = 'emails' | 'social';

export function SiteCrawler({ kind }: { kind: Kind }) {
  const [urls, setUrls] = useState('');
  const [deep, setDeep] = useState(true);
  const [maxDeep, setMaxDeep] = useState(4);
  const [onePerEmail, setOnePerEmail] = useState(false);
  const [withPhones, setWithPhones] = useState(true);
  const [load, setLoad] = useState(defaultLoad);
  const job = useJob();

  function start() {
    const list = normalizeUrls(urls);
    job.start(async ({ signal, progress, status }) => {
      status(`Scanning ${list.length} sites`);
      const results = await runPool(
        list,
        async (url) => {
          const emails = new Set<string>();
          const phones = new Set<string>();
          const socials: Record<string, string> = {};
          let scanned = 0;
          const scan = (u: string) =>
            withPage(u, load.mode, signal, async (p) => {
              scanned++;
              if (kind === 'emails') {
                (await p.run(findEmails, 'emails')).forEach((e: string) => emails.add(e));
                if (withPhones) (await p.run(findPhones, 'phones')).forEach((t: string) => phones.add(t));
              }
              else for (const [k, v] of Object.entries(await p.run(findSocials, 'socials'))) socials[k] ??= v as string;
              return deep ? ((await p.run((d, x) => contactLinks(d, x, maxDeep), 'contactLinks')) as string[]) : [];
            });
          const more = await scan(url);
          for (const link of more.slice(0, maxDeep)) {
            if (signal.aborted) break;
            if (kind === 'social' && SOCIAL_NETWORKS.every((n) => socials[n.name])) break;
            await scan(link).catch(() => {});
          }
          return { url, emails: [...emails], phones: [...phones], socials, scanned };
        },
        { concurrency: load.concurrency, delayMs: load.delay, signal, onProgress: (d, t, e) => progress(d, t, e) },
      );

      let columns: Column[];
      let rows: Record<string, string>[];
      if (kind === 'emails') {
        columns = onePerEmail
          ? [{ key: 'website', label: 'website' }, { key: 'email', label: 'email' }]
          : [{ key: 'website', label: 'website' }, { key: 'emails', label: 'emails' }, { key: 'count', label: 'email count' }, { key: 'phones', label: 'phones' }, { key: 'pages', label: 'pages scanned' }, { key: 'error', label: 'error' }];
        rows = results.flatMap((r, i): Record<string, string>[] => {
          if (r instanceof Error) return onePerEmail ? [] : [{ website: list[i], error: r.message }];
          if (onePerEmail) return r.emails.map((email) => ({ website: r.url, email }));
          return [{ website: r.url, emails: r.emails.join('; '), count: String(r.emails.length), phones: r.phones.join('; '), pages: String(r.scanned) }];
        });
      } else {
        columns = [{ key: 'website', label: 'website' }, ...SOCIAL_NETWORKS.map((n) => ({ key: n.name, label: n.name })), { key: 'error', label: 'error' }];
        rows = results.map((r, i): Record<string, string> => (r instanceof Error ? { website: list[i], error: r.message } : { website: r.url, ...r.socials }));
      }
      columns = columns.filter((c) => c.key === 'website' || rows.some((r) => r[c.key]));
      const name = `${kind === 'emails' ? 'Contacts' : 'Social links'} ${list.length > 1 ? `${list.length} sites` : hostOf(list[0])}`;
      return saveDataset(newDataset(kind, name, list[0], columns, rows));
    });
  }

  const count = normalizeUrls(urls).length;
  return (
    <div className="flex flex-1 flex-col gap-5">
      <Section title="Websites">
        <UrlSource value={urls} onChange={setUrls} help="Homepages or any page on each site. One per line." />
      </Section>
      <Section title="Scan">
        <Check checked={deep} onChange={setDeep}>
          Also check contact, about and team pages on each site
        </Check>
        {deep && <Field label="Extra pages per site">{(id) => <NumberInput id={id} value={maxDeep} onChange={setMaxDeep} min={1} max={15} />}</Field>}
        {kind === 'emails' && (
          <Check checked={withPhones} onChange={setWithPhones}>
            Also collect phone numbers
          </Check>
        )}
        {kind === 'emails' && (
          <Check checked={onePerEmail} onChange={setOnePerEmail}>
            One row per email address
          </Check>
        )}
      </Section>
      <Section title="Loading">
        <LoadOptions value={load} onChange={setLoad} />
      </Section>
      <div className="flex-1" />
      <RunBar job={job} onStart={start} startLabel={count ? `Scan ${count} ${count === 1 ? 'site' : 'sites'}` : 'Scan'} disabled={!count} />
    </div>
  );
}
