// Domain lookups from public services: registration (RDAP, the official successor to WHOIS),
// DNS records (DNS over HTTPS), and certificates and subdomains (Certificate Transparency logs
// via crt.sh). Only the domain name is sent to these services.

export function domainOf(input: string): string {
  const s = input.trim().toLowerCase();
  if (!s) return '';
  try {
    const host = new URL(/^https?:\/\//.test(s) ? s : `https://${s}`).hostname;
    return host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** The registrable domain ("shop.example.co.kr" -> "example.co.kr") for registration lookups. */
export function rootDomain(host: string): string {
  const parts = host.split('.');
  // Common two-part public suffixes
  const two = /^(co|com|net|org|gov|edu|ac|or|ne|go|re|pe|kg|es|mil)\.[a-z]{2}$/;
  if (parts.length > 2 && two.test(parts.slice(-2).join('.'))) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

async function json(url: string, signal?: AbortSignal, accept = 'application/json') {
  const res = await fetch(url, { signal, headers: { accept } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export interface Registration {
  domain: string;
  registrar: string;
  created: string;
  updated: string;
  expires: string;
  age_years: string;
  status: string;
  nameservers: string;
  dnssec: string;
}

/** Registration details from RDAP. Registrant contact details are not collected. */
export async function rdap(domain: string, signal?: AbortSignal): Promise<Registration> {
  const root = rootDomain(domain);
  const d = await json(`https://rdap.org/domain/${encodeURIComponent(root)}`, signal, 'application/rdap+json, application/json').catch((e) => {
    throw new Error(/404/.test(String(e)) ? `${root} isn't registered, or its registry doesn't offer RDAP.` : `The registration lookup failed (${e.message}).`);
  });
  const event = (name: string) => (d.events ?? []).find((e: any) => e.eventAction === name)?.eventDate?.slice(0, 10) ?? '';
  const registrar = (d.entities ?? []).find((e: any) => (e.roles ?? []).includes('registrar'));
  const fn = registrar?.vcardArray?.[1]?.find((v: any) => v[0] === 'fn')?.[3] ?? registrar?.publicIds?.[0]?.identifier ?? '';
  const created = event('registration');
  return {
    domain: root,
    registrar: String(fn),
    created,
    updated: event('last changed'),
    expires: event('expiration'),
    age_years: created ? String(Math.floor((Date.now() - Date.parse(created)) / 3.15576e10)) : '',
    status: (d.status ?? []).join(', '),
    nameservers: (d.nameservers ?? []).map((n: any) => String(n.ldhName).toLowerCase()).join(', '),
    dnssec: d.secureDNS?.delegationSigned ? 'signed' : d.secureDNS ? 'not signed' : '',
  };
}

export type RecordType = 'A' | 'AAAA' | 'MX' | 'NS' | 'TXT' | 'CNAME' | 'CAA';

/** DNS records over HTTPS (Cloudflare's public resolver). */
export async function dns(name: string, type: RecordType, signal?: AbortSignal): Promise<string[]> {
  const d = await json(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, signal, 'application/dns-json');
  return (d.Answer ?? []).filter((a: any) => a.type === { A: 1, AAAA: 28, MX: 15, NS: 2, TXT: 16, CNAME: 5, CAA: 257 }[type]).map((a: any) => String(a.data).replace(/^"|"$/g, '').replace(/"\s*"/g, '').replace(/\.$/, ''));
}

export interface DnsSummary {
  a: string;
  aaaa: string;
  mx: string;
  ns: string;
  spf: string;
  dmarc: string;
  mail_provider: string;
}

const MAIL_PROVIDERS: [RegExp, string][] = [
  [/google\.com|googlemail\.com/i, 'Google Workspace'],
  [/outlook\.com|protection\.outlook/i, 'Microsoft 365'],
  [/zoho\./i, 'Zoho Mail'],
  [/mimecast/i, 'Mimecast'],
  [/pphosted|proofpoint/i, 'Proofpoint'],
  [/secureserver\.net/i, 'GoDaddy'],
  [/mail\.protonmail|protonmail\.ch/i, 'Proton Mail'],
  [/yandex/i, 'Yandex'],
  [/daum\.net|hanmail/i, 'Daum / Kakao'],
  [/naver\.com/i, 'Naver Works'],
  [/mxroute|emailsrvr|rackspace/i, 'Rackspace'],
  [/amazonaws\.com|awsapps/i, 'Amazon WorkMail / SES'],
];

export async function dnsSummary(domain: string, signal?: AbortSignal): Promise<DnsSummary> {
  const [a, aaaa, mx, ns, txt, dmarc] = await Promise.all([
    dns(domain, 'A', signal).catch(() => []),
    dns(domain, 'AAAA', signal).catch(() => []),
    dns(domain, 'MX', signal).catch(() => []),
    dns(domain, 'NS', signal).catch(() => []),
    dns(domain, 'TXT', signal).catch(() => []),
    dns(`_dmarc.${domain}`, 'TXT', signal).catch(() => []),
  ]);
  const mxHosts = mx.map((m) => m.split(' ').pop()!).filter(Boolean);
  return {
    a: a.join(', '),
    aaaa: aaaa.join(', '),
    mx: mxHosts.join(', '),
    ns: ns.join(', '),
    spf: txt.find((t) => /^v=spf1/i.test(t)) ?? '',
    dmarc: dmarc.find((t) => /^v=DMARC1/i.test(t)) ?? '',
    mail_provider: MAIL_PROVIDERS.find(([re]) => mxHosts.some((h) => re.test(h)))?.[1] ?? (mxHosts.length ? 'other' : ''),
  };
}

export interface CertInfo {
  /** The newest certificate issued for the domain itself. */
  issuer: string;
  valid_from: string;
  valid_to: string;
  days_left: string;
  certificates_seen: string;
  subdomains: string[];
}

/** Certificates and subdomains from Certificate Transparency logs (crt.sh). */
export async function certificates(domain: string, signal?: AbortSignal): Promise<CertInfo> {
  const root = rootDomain(domain);
  let rows: any[];
  try {
    rows = await json(`https://crt.sh/?q=${encodeURIComponent('%.' + root)}&output=json&exclude=expired`, signal);
  } catch (e: any) {
    throw new Error(`The certificate log (crt.sh) didn't answer (${e.message}). It's often slow; try again in a minute.`);
  }
  const subs = new Set<string>();
  for (const r of rows) for (const n of String(r.name_value ?? '').split('\n')) {
    const h = n.trim().toLowerCase().replace(/^\*\./, '');
    if (h.endsWith(root) && h !== root && !h.includes('*')) subs.add(h);
  }
  const own = rows.filter((r) => String(r.name_value).split('\n').some((n: string) => n.trim().toLowerCase().replace(/^\*\./, '') === domain || n.trim() === `*.${rootDomain(domain)}`));
  own.sort((a, b) => String(b.not_before).localeCompare(String(a.not_before)));
  const latest = own[0] ?? rows[0];
  const to = latest ? String(latest.not_after).slice(0, 10) : '';
  return {
    issuer: latest ? (String(latest.issuer_name).match(/O=([^,]+)/)?.[1] ?? String(latest.issuer_name)).replace(/^"|"$/g, '') : '',
    valid_from: latest ? String(latest.not_before).slice(0, 10) : '',
    valid_to: to,
    days_left: to ? String(Math.round((Date.parse(to) - Date.now()) / 8.64e7)) : '',
    certificates_seen: String(rows.length),
    subdomains: [...subs].sort(),
  };
}
