// Website and domain tools: what a site is built with, and a domain's registration, DNS and email
// setup, certificates and subdomains.
import { useState } from 'react';
import { newDataset, saveDataset, type Column } from '@/lib/db';
import { detectTech, type Tech } from '@/lib/web/tech';
import { certificates, dnsSummary, domainOf, rdap } from '@/lib/web/domain';
import { normalizeUrls, runPool } from '@/lib/runner';
import { activeTab, call, isRestricted, withBackgroundTab } from '@/lib/tab';
import { Check, Field, Notice, Section, Segmented, inputCls } from '../ui';
import { RunBar, UrlSource, hostOf, useJob } from '../run';

const CATEGORY_ORDER = ['E-commerce', 'CMS', 'Site builder', 'Framework', 'Library', 'UI framework', 'Analytics', 'Tag manager', 'Advertising', 'Marketing automation', 'Email marketing', 'Live chat', 'Customer support', 'Payments', 'Reviews', 'Hosting', 'CDN', 'Web server', 'Language', 'Security', 'Fonts', 'Cookie consent'];
const catKey = (c: string) => c.toLowerCase().replace(/[^a-z]+/g, '_');

/** One row per site: a column per category, listing what was found. */
function techRow(url: string, techs: Tech[]): Record<string, string> {
  const row: Record<string, string> = { website: url, count: String(techs.length) };
  for (const t of techs) {
    const k = catKey(t.category);
    row[k] = [row[k], t.name + (t.version ? ` ${t.version}` : '')].filter(Boolean).join(', ');
  }
  row.evidence = techs.map((t) => `${t.name}: ${t.evidence}`).join(' | ');
  return row;
}

export function TechChecker() {
  const [source, setSource] = useState<'tab' | 'urls'>('tab');
  const [urls, setUrls] = useState('');
  const job = useJob();
  const list = normalizeUrls(urls);

  function start() {
    job.start(async ({ signal, progress, status }) => {
      let rows: Record<string, string>[];
      if (source === 'tab') {
        const tab = await activeTab();
        if (isRestricted(tab.url)) throw new Error('Open a normal website first.');
        status('Checking this page');
        const page = await call<{ html: string; url: string; globals: string[] }>(tab.id!, 'pageSource');
        // Response headers show the server and CDN; fetch them separately
        const headers = await fetch(page.url, { method: 'HEAD', credentials: 'include' }).then((r) => Object.fromEntries(r.headers.entries())).catch(() => ({}));
        rows = [techRow(page.url, detectTech(page.html, headers, page.globals))];
      } else {
        const res = await runPool(
          list,
          async (u) => {
            let html = '';
            let headers: Record<string, string> = {};
            let finalUrl = u;
            try {
              const r = await fetch(u, { signal, credentials: 'include' });
              html = await r.text();
              headers = Object.fromEntries(r.headers.entries());
              finalUrl = r.url || u;
            } catch {
              /* blocked fetch: fall back to a tab below */
            }
            if (html.length < 500) {
              const page = await withBackgroundTab(u, (id) => call<{ html: string; url: string; globals: string[] }>(id, 'pageSource'));
              return techRow(page.url, detectTech(page.html, headers, page.globals));
            }
            return techRow(finalUrl, detectTech(html, headers));
          },
          { concurrency: 3, delayMs: 200, signal, onProgress: (d, t, e) => progress(d, t, e) },
        );
        rows = res.map((r, i) => (r instanceof Error ? { website: list[i], error: r.message } : r));
      }
      const cats = CATEGORY_ORDER.filter((c) => rows.some((r) => r[catKey(c)]));
      const cols: Column[] = [{ key: 'website', label: 'website' }, ...cats.map((c) => ({ key: catKey(c), label: c.toLowerCase() })), { key: 'count', label: 'technologies' }, { key: 'evidence', label: 'how it was found' }, ...(rows.some((r) => r.error) ? [{ key: 'error', label: 'error' }] : [])];
      return saveDataset(newDataset('tech', `Technology ${rows.length === 1 ? hostOf(rows[0].website) : `${rows.length} sites`}`, rows[0]?.website ?? '', cols, rows));
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <Section title="Websites">
        <p className="text-[12.5px] leading-relaxed text-muted">What a site is built with: store platform, CMS, frameworks, analytics and ad pixels, chat, payments, reviews, hosting and CDN. Each finding lists the code that gave it away.</p>
        <Segmented label="Source" value={source} onChange={setSource} options={[{ value: 'tab', label: 'This page' }, { value: 'urls', label: 'List of sites' }]} />
        {source === 'urls' && <UrlSource value={urls} onChange={setUrls} help="Homepages, one per line." />}
      </Section>
      <div className="flex-1" />
      <RunBar job={job} onStart={start} startLabel={source === 'tab' ? 'Check this site' : list.length === 1 ? 'Check 1 site' : list.length ? `Check ${list.length} sites` : 'Check sites'} disabled={source === 'urls' && !list.length} />
    </div>
  );
}

export function DomainLookup() {
  const [input, setInput] = useState('');
  const [reg, setReg] = useState(true);
  const [dnsOn, setDnsOn] = useState(true);
  const [certs, setCerts] = useState(true);
  const job = useJob();
  const domains = [...new Set(input.split(/[\n,;\s]+/).map(domainOf).filter((d) => d.includes('.')))];

  function start() {
    job.start(async ({ signal, progress, status }) => {
      const subRows: Record<string, string>[] = [];
      const res = await runPool(
        domains,
        async (d) => {
          status(`Looking up ${d}`);
          const row: Record<string, string> = { domain: d };
          const notes: string[] = [];
          const [r, n, c] = await Promise.allSettled([reg ? rdap(d, signal) : Promise.resolve(null), dnsOn ? dnsSummary(d, signal) : Promise.resolve(null), certs ? certificates(d, signal) : Promise.resolve(null)]);
          if (r.status === 'fulfilled' && r.value) Object.assign(row, { registrar: r.value.registrar, created: r.value.created, expires: r.value.expires, age_years: r.value.age_years, nameservers: r.value.nameservers, status: r.value.status, dnssec: r.value.dnssec });
          else if (r.status === 'rejected') notes.push(r.reason?.message ?? String(r.reason));
          if (n.status === 'fulfilled' && n.value) Object.assign(row, { ip: n.value.a, ipv6: n.value.aaaa, mail_servers: n.value.mx, mail_provider: n.value.mail_provider, spf: n.value.spf, dmarc: n.value.dmarc });
          else if (n.status === 'rejected') notes.push(n.reason?.message ?? String(n.reason));
          if (c.status === 'fulfilled' && c.value) {
            Object.assign(row, { certificate_issuer: c.value.issuer, certificate_valid_from: c.value.valid_from, certificate_valid_to: c.value.valid_to, certificate_days_left: c.value.days_left, subdomains_found: String(c.value.subdomains.length) });
            for (const s of c.value.subdomains) subRows.push({ domain: d, subdomain: s, url: `https://${s}` });
          } else if (c.status === 'rejected') notes.push(c.reason?.message ?? String(c.reason));
          if (notes.length) row.note = notes.join(' ');
          return row;
        },
        { concurrency: 2, delayMs: 500, signal, onProgress: (d, t, e) => progress(d, t, e) },
      );
      const rows = res.map((r, i) => (r instanceof Error ? { domain: domains[i], note: r.message } : r));
      if (subRows.length) await saveDataset(newDataset('subdomains', `Subdomains ${domains.length === 1 ? domains[0] : `${domains.length} domains`}`, domains[0], [{ key: 'domain', label: 'domain' }, { key: 'subdomain', label: 'subdomain' }, { key: 'url', label: 'url' }], subRows));
      const order = ['domain', 'registrar', 'created', 'expires', 'age_years', 'status', 'nameservers', 'dnssec', 'ip', 'ipv6', 'mail_servers', 'mail_provider', 'spf', 'dmarc', 'certificate_issuer', 'certificate_valid_from', 'certificate_valid_to', 'certificate_days_left', 'subdomains_found', 'note'];
      const cols = order.filter((k) => rows.some((r) => (r as any)[k])).map((k) => ({ key: k, label: k.replace(/_/g, ' ') }));
      return saveDataset({ ...newDataset('domain', `Domains ${domains.length === 1 ? domains[0] : `${domains.length} domains`}`, domains[0], cols, rows as any), note: subRows.length ? `${subRows.length} subdomains saved as their own data.` : undefined });
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <Section title="Domains">
        <p className="text-[12.5px] leading-relaxed text-muted">Registration dates and registrar, DNS and email setup (mail provider, SPF, DMARC), the current SSL certificate and how long it has left, and subdomains seen in public certificate logs.</p>
        <Field label={`Domains${domains.length ? ` (${domains.length})` : ''}`} help="One per line, or paste website addresses.">
          {(id) => <textarea id={id} rows={4} value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} placeholder={'example.com\nshop.example.co.kr'} className={inputCls + ' resize-y font-mono text-[12px] leading-relaxed'} />}
        </Field>
        <Check checked={reg} onChange={setReg}>Registration (RDAP, the successor to WHOIS)</Check>
        <Check checked={dnsOn} onChange={setDnsOn}>DNS and email setup</Check>
        <Check checked={certs} onChange={setCerts}>SSL certificate and subdomains</Check>
        <Notice>These come from public services: rdap.org for registration, Cloudflare DNS, and the crt.sh certificate log. Only the domain names are sent. Registrant contact details are not collected.</Notice>
      </Section>
      <div className="flex-1" />
      <RunBar job={job} onStart={start} startLabel={domains.length ? `Look up ${domains.length} ${domains.length === 1 ? 'domain' : 'domains'}` : 'Look up domains'} disabled={!domains.length || (!reg && !dnsOn && !certs)} />
    </div>
  );
}
