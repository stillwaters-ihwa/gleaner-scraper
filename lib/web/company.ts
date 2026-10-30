// Company lookup: a profile of a business from its own website and public records. It reads the
// homepage and a few contact/about pages, plus registration and mail-server records. It collects
// business details only (company emails, phones, address, socials), not employees.
import { responseText } from '../charset';
import { contactLinks, findEmails, findPhones, findSocials, SOCIAL_NETWORKS } from '../dom/doc';
import { addressText, isType, ldNodes, str, type Row } from '../verticals/structured';
import { detectTech } from './tech';
import { dnsSummary, domainOf, rdap } from './domain';
import { call, withBackgroundTab } from '../tab';

export const COMPANY_COLUMNS: [string, string][] = [
  ['domain', 'domain'],
  ['name', 'company'],
  ['description', 'description'],
  ['industry', 'industry'],
  ['emails', 'emails'],
  ['phones', 'phones'],
  ['address', 'address'],
  ['country', 'country'],
  ['founded', 'founded'],
  ['employees', 'employees'],
  ...SOCIAL_NETWORKS.map((n) => [n.name, n.name] as [string, string]),
  ['tech', 'technology'],
  ['ecommerce', 'e-commerce platform'],
  ['mail_provider', 'email provider'],
  ['registrar', 'registrar'],
  ['domain_created', 'domain created'],
  ['domain_age', 'domain age (years)'],
  ['language', 'site language'],
  ['logo', 'logo'],
  ['pages_read', 'pages read'],
  ['url', 'website'],
  ['error', 'error'],
];

const TLD_COUNTRY: Record<string, string> = { kr: 'South Korea', jp: 'Japan', cn: 'China', tw: 'Taiwan', uk: 'United Kingdom', de: 'Germany', fr: 'France', it: 'Italy', es: 'Spain', nl: 'Netherlands', au: 'Australia', ca: 'Canada', in: 'India', br: 'Brazil', mx: 'Mexico', sg: 'Singapore', ph: 'Philippines', vn: 'Vietnam', th: 'Thailand', id: 'Indonesia', my: 'Malaysia', nz: 'New Zealand', se: 'Sweden', ch: 'Switzerland', pl: 'Poland', tr: 'Turkey', ae: 'United Arab Emirates', sa: 'Saudi Arabia', za: 'South Africa', ru: 'Russia', hk: 'Hong Kong' };

interface Fetched {
  html: string;
  url: string;
  headers: Record<string, string>;
}

async function load(url: string, signal?: AbortSignal): Promise<Fetched> {
  try {
    const res = await fetch(url, { signal, credentials: 'include', redirect: 'follow' });
    const html = await responseText(res);
    if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
    // A page that is just a JavaScript shell needs a real tab to show its content
    if (html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '').trim().length > 200 || res.status === 404) {
      return { html, url: res.url || url, headers: Object.fromEntries(res.headers.entries()) };
    }
  } catch (e) {
    if (signal?.aborted) throw e;
  }
  const page = await withBackgroundTab(url, (tabId) => call<{ html: string; url: string }>(tabId, 'pageSource'));
  return { html: page.html, url: page.url, headers: {} };
}

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

/** Everything public about one company, from its domain. */
export async function lookupCompany(input: string, opts: { extraPages: number; records: boolean; signal?: AbortSignal }): Promise<Row> {
  const domain = domainOf(input);
  if (!domain) return { domain: input, error: 'Not a website address' };
  const start = /^https?:\/\//i.test(input) ? input : `https://${domain}`;
  const home = await load(start, opts.signal);
  const doc = parse(home.html);
  const nodes = ldNodes(doc);
  const org = nodes.find((n) => isType(n, ['organization', 'corporation', 'localbusiness', 'store', 'onlinestore', 'onlinebusiness'])) ?? {};
  const meta = (n: string) => doc.querySelector(`meta[property="${n}"], meta[name="${n}"]`)?.getAttribute('content')?.trim() ?? '';

  const emails = new Set<string>(findEmails(doc));
  const phones = new Set<string>(findPhones(doc));
  const socials: Record<string, string> = findSocials(doc, home.url);
  let pages = 1;
  for (const link of contactLinks(doc, home.url, opts.extraPages).slice(0, opts.extraPages)) {
    if (opts.signal?.aborted) break;
    try {
      const p = await load(link, opts.signal);
      const d = parse(p.html);
      findEmails(d).forEach((e) => emails.add(e));
      findPhones(d).forEach((t) => phones.add(t));
      for (const [k, v] of Object.entries(findSocials(d, p.url))) socials[k] ??= v;
      if (!org.address) {
        const a = ldNodes(d).find((n) => n.address)?.address;
        if (a) org.address = a;
      }
      pages++;
    } catch {
      /* one missing contact page shouldn't stop the lookup */
    }
  }

  const addr = addressText([].concat(org.address ?? [])[0] ?? org.location?.address);
  const tech = detectTech(home.html, home.headers);
  const platform = tech.find((t) => t.category === 'E-commerce')?.name ?? '';
  const tld = domain.split('.').pop() ?? '';
  const titleName = str(doc.title).split(/\s[|\-–—:·]\s/)[0];
  const row: Row = {
    domain,
    name: str(org.name) || meta('og:site_name') || meta('application-name') || titleName,
    description: (str(org.description) || meta('description') || meta('og:description')).slice(0, 500),
    industry: str(org.knowsAbout ?? org.industry ?? org['@type']).replace(/^(Organization|Corporation)$/i, ''),
    emails: [...emails].filter((e) => e.endsWith(domain) || !/@(example|sentry|wixpress|domain)\./i.test(e)).slice(0, 10).join('; '),
    phones: [...phones].slice(0, 5).join('; '),
    address: addr.full,
    country: addr.country || TLD_COUNTRY[tld] || '',
    founded: str(org.foundingDate).slice(0, 4),
    employees: str(org.numberOfEmployees?.value ?? org.numberOfEmployees),
    ...socials,
    tech: tech.filter((t) => !['Fonts', 'Cookie consent'].includes(t.category)).map((t) => t.name + (t.version ? ` ${t.version}` : '')).join(', '),
    ecommerce: platform,
    language: doc.documentElement.getAttribute('lang') ?? '',
    logo: (() => {
      const l = org.logo?.url ?? org.logo ?? doc.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') ?? meta('og:image');
      try {
        return l ? new URL(str(l), home.url).href : '';
      } catch {
        return '';
      }
    })(),
    pages_read: String(pages),
    url: home.url,
  };
  if (opts.records) {
    const [reg, mail] = await Promise.allSettled([rdap(domain, opts.signal), dnsSummary(domain, opts.signal)]);
    if (reg.status === 'fulfilled') Object.assign(row, { registrar: reg.value.registrar, domain_created: reg.value.created, domain_age: reg.value.age_years });
    if (mail.status === 'fulfilled') row.mail_provider = mail.value.mail_provider;
  }
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v));
}
