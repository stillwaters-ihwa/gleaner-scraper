// Sales lead tools: company lookup (a profile from each company's website and public records)
// and the email checker.
import { useEffect, useState } from 'react';
import { getDataset, listDatasets, newDataset, saveDataset } from '@/lib/db';
import { COMPANY_COLUMNS, lookupCompany } from '@/lib/web/company';
import { checkEmail } from '@/lib/web/email';
import { domainOf } from '@/lib/web/domain';
import { runPool } from '@/lib/runner';
import { Check, Field, NumberInput, Notice, Section, inputCls } from '../ui';
import { RunBar, useJob } from '../run';

const lines = (s: string) => [...new Set(s.split(/[\n,;\s]+/).map((x) => x.trim()).filter(Boolean))];

export function CompanyLookup() {
  const [input, setInput] = useState('');
  const [extra, setExtra] = useState(3);
  const [records, setRecords] = useState(true);
  const job = useJob();
  const domains = lines(input).filter((l) => domainOf(l).includes('.'));

  function start() {
    job.start(async ({ signal, progress, status }) => {
      status(`Looking up ${domains.length} ${domains.length === 1 ? 'company' : 'companies'}`);
      const res = await runPool(domains, (d) => lookupCompany(d, { extraPages: extra, records, signal }), { concurrency: 3, delayMs: 300, signal, onProgress: (d, t, e) => progress(d, t, e) });
      const rows = res.map((r, i) => (r instanceof Error ? { domain: domainOf(domains[i]), error: r.message } : r));
      const cols = COMPANY_COLUMNS.filter(([k]) => rows.some((r) => (r as any)[k])).map(([key, label]) => ({ key, label }));
      return saveDataset({ ...newDataset('company', `Companies ${domains.length === 1 ? domainOf(domains[0]) : `${domains.length} domains`}`, domains[0], cols, rows as any), note: `${rows.filter((r) => !(r as any).error).length} of ${rows.length} companies found.` });
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <Section title="Companies">
        <p className="text-[12.5px] leading-relaxed text-muted">
          A profile for each company from its own website and public records: name, description, published emails and phone numbers, address, social pages, the technology its site runs on, its email provider and domain age. Only business details are collected, not employees.
        </p>
        <Field label={`Websites or domains${domains.length ? ` (${domains.length})` : ''}`} help="One per line, for example glowrecipe.com">
          {(id) => <textarea id={id} rows={5} value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} placeholder={'glowrecipe.com\nhttps://www.cosrx.com'} className={inputCls + ' resize-y font-mono text-[12px] leading-relaxed'} />}
        </Field>
        <Field label="Contact and about pages to read per company">{(id) => <NumberInput id={id} value={extra} onChange={setExtra} min={0} max={10} />}</Field>
        <Check checked={records} onChange={setRecords}>
          Add domain age, registrar and email provider (public registration and DNS records)
        </Check>
      </Section>
      <div className="flex-1" />
      <RunBar job={job} onStart={start} startLabel={domains.length ? `Look up ${domains.length} ${domains.length === 1 ? 'company' : 'companies'}` : 'Look up companies'} disabled={!domains.length} />
    </div>
  );
}

export function EmailChecker() {
  const [input, setInput] = useState('');
  const [sets, setSets] = useState<Awaited<ReturnType<typeof listDatasets>>>([]);
  const job = useJob();
  useEffect(() => {
    listDatasets().then(setSets);
  }, []);
  const emails = [...new Set((input.match(/[^\s,;<>"']+@[^\s,;<>"']+/g) ?? []).map((e) => e.replace(/^mailto:/i, '').replace(/[.)]+$/, '')))];

  async function fromDataset(id: string) {
    const ds = await getDataset(id);
    if (!ds) return;
    const found = new Set<string>();
    for (const r of ds.rows) for (const v of Object.values(r)) for (const m of String(v).match(/[^\s,;<>"']+@[^\s,;<>"']+\.[a-z]{2,}/gi) ?? []) found.add(m.toLowerCase());
    setInput([...found].join('\n'));
  }

  function start() {
    job.start(
      async ({ signal, progress, status }) => {
        status(`Checking ${emails.length} addresses`);
        const cache = new Map<string, Promise<string[]>>();
        const res = await runPool(emails, (e) => checkEmail(e, cache, signal), { concurrency: 6, delayMs: 0, signal, onProgress: (d, t, e) => progress(d, t, e) });
        const rows = res.map((r, i) => (r instanceof Error ? { email: emails[i], verdict: 'risky', reason: r.message } : r)) as any[];
        const count = (v: string) => rows.filter((r) => r.verdict === v).length;
        const cols = ['email', 'verdict', 'reason', 'domain', 'mail_server', 'disposable', 'role_address', 'free_provider', 'suggestion'].filter((k) => rows.some((r) => r[k])).map((k) => ({ key: k, label: k.replace(/_/g, ' ') }));
        return saveDataset({ ...newDataset('emailcheck', `Email check ${emails.length} addresses`, '', cols, rows), note: `${count('valid domain')} valid domain, ${count('risky')} risky, ${count('no mail server')} no mail server, ${count('invalid')} invalid.` });
      },
      { needsHostAccess: false },
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <Section title="Email addresses">
        <p className="text-[12.5px] leading-relaxed text-muted">
          Checks each address is well formed, isn&apos;t a throwaway or typo, and that its domain can receive email. No email is sent. Whether one particular mailbox exists can only be confirmed by sending to it, so that isn&apos;t claimed.
        </p>
        <Field label={`Addresses${emails.length ? ` (${emails.length})` : ''}`} help="Paste a list, or any text with addresses in it.">
          {(id) => <textarea id={id} rows={6} value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} placeholder={'sales@company.com\nname@gmial.com'} className={inputCls + ' resize-y font-mono text-[12px] leading-relaxed'} />}
        </Field>
        {sets.length > 0 && (
          <select aria-label="Take emails from saved data" defaultValue="" onChange={(e) => e.target.value && fromDataset(e.target.value)} className={inputCls}>
            <option value="">Take emails from saved data</option>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <Notice>The domain check asks Cloudflare&apos;s public DNS service for each domain&apos;s mail servers. Only the domain names are sent.</Notice>
      </Section>
      <div className="flex-1" />
      <RunBar job={job} onStart={start} startLabel={emails.length ? `Check ${emails.length} ${emails.length === 1 ? 'address' : 'addresses'}` : 'Check emails'} disabled={!emails.length} />
    </div>
  );
}
