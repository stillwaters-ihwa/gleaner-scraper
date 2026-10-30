// Job listings: from job pages and search results on any job board (schema.org JobPosting,
// embedded app data, or the cards on the page), and straight from companies' hiring systems
// through the public job-board feeds they publish for their own career pages.
import { absUrl, addressText, compact, dedupeRows, embeddedJson, htmlText, isoDate, isType, keyScore, ldNodes, numStr, pick, recordArrays, str, toNum, type Row } from './structured';

export const JOB_COLUMNS = [
  ['title', 'title'],
  ['company', 'company'],
  ['location', 'location'],
  ['workplace', 'workplace'],
  ['employment_type', 'employment type'],
  ['salary', 'salary'],
  ['salary_min', 'salary min'],
  ['salary_max', 'salary max'],
  ['salary_currency', 'salary currency'],
  ['salary_period', 'salary period'],
  ['date_posted', 'posted'],
  ['valid_through', 'closes'],
  ['department', 'department'],
  ['experience', 'experience'],
  ['description', 'description'],
  ['apply_url', 'apply link'],
  ['url', 'url'],
  ['source', 'found via'],
] as const;

const PERIOD: Record<string, string> = { hour: 'hour', hourly: 'hour', day: 'day', daily: 'day', week: 'week', weekly: 'week', month: 'month', monthly: 'month', year: 'year', yearly: 'year', annual: 'year', annually: 'year', annum: 'year' };
const period = (v: string) => PERIOD[v.toLowerCase().replace(/^per\s+/, '')] ?? '';

export function workplaceOf(...texts: string[]): string {
  const t = texts.join(' ').toLowerCase();
  if (/\bhybrid\b/.test(t)) return 'hybrid';
  if (/\b(remote|telecommute|work from home|wfh|anywhere)\b/.test(t)) return 'remote';
  if (/\b(on-?site|in-?office|in office|in person)\b/.test(t)) return 'on-site';
  return '';
}

const EMPLOYMENT: [RegExp, string][] = [
  [/full[\s_-]?time|fulltime|permanent/i, 'full-time'],
  [/part[\s_-]?time|parttime/i, 'part-time'],
  [/contract|contractor|freelance|temporary|temp\b/i, 'contract'],
  [/intern(ship)?/i, 'internship'],
];
export const employmentOf = (v: string) => [...new Set(EMPLOYMENT.filter(([re]) => re.test(v)).map(([, n]) => n))].join(', ');

/** "$80,000 - $120,000 a year" / "₩40M~60M" / "€25/hr" -> parts. */
export function parseSalary(text: string): { min: string; max: string; currency: string; period: string } {
  const out = { min: '', max: '', currency: '', period: '' };
  const t = str(text);
  if (!t) return out;
  const cur = t.match(/(US\$|C\$|A\$|[$€£¥₩₹]|\b(?:USD|EUR|GBP|KRW|JPY|CAD|AUD|INR)\b)/);
  const SYM: Record<string, string> = { $: 'USD', US$: 'USD', C$: 'CAD', A$: 'AUD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₩': 'KRW', '₹': 'INR' };
  if (cur) out.currency = SYM[cur[1]] ?? cur[1];
  const nums = [...t.matchAll(/(\d[\d,.]*)\s*([kKmM]|만|천)?/g)]
    .map((m) => {
      let n = parseFloat(m[1].replace(/,/g, ''));
      const u = m[2]?.toLowerCase();
      if (u === 'k' || u === '천') n *= u === 'k' ? 1000 : 1000;
      if (u === 'm') n *= 1_000_000;
      if (u === '만') n *= 10_000;
      return n;
    })
    .filter((n) => n > 0);
  if (!nums.length) return out;
  out.min = String(Math.min(...nums.slice(0, 2)));
  out.max = String(Math.max(...nums.slice(0, 2)));
  const p = t.match(/\b(?:per|a|an|\/)\s*(hour|hr|day|week|month|year|yr|annum)\b|\b(hourly|daily|weekly|monthly|yearly|annually|annual)\b/i);
  const word = (p?.[1] ?? p?.[2] ?? '').toLowerCase().replace(/^hr$/, 'hour').replace(/^yr$/, 'year');
  out.period = period(word) || (Number(out.max) >= 15000 ? 'year' : Number(out.max) < 300 ? 'hour' : '');
  return out;
}

function salaryFields(min: unknown, max: unknown, currency: unknown, unit: unknown, text = ''): Row {
  let lo = numStr(min);
  let hi = numStr(max);
  let cur = str(currency).toUpperCase();
  let per = period(str(unit));
  if ((!lo && !hi) || !cur || !per) {
    const p = parseSalary(text);
    lo ||= p.min;
    hi ||= p.max;
    cur ||= p.currency;
    per ||= p.period;
  }
  if (!lo && hi) lo = hi;
  if (!hi && lo) hi = lo;
  const fmt = (n: string) => Number(n).toLocaleString('en-US');
  const salary = text || (lo ? `${cur ? cur + ' ' : ''}${lo === hi ? fmt(lo) : `${fmt(lo)} - ${fmt(hi)}`}${per ? ` per ${per}` : ''}` : '');
  return { salary: str(salary), salary_min: lo, salary_max: hi, salary_currency: cur, salary_period: per };
}

/** One schema.org JobPosting node as a row. */
export function jobFromLd(n: any, url: string): Row {
  const locs = [].concat(n.jobLocation ?? []).map((l: any) => addressText(l?.address ?? l).full).filter(Boolean);
  const remote = /telecommute/i.test(str(n.jobLocationType)) || /remote/i.test(str(n.applicantLocationRequirements));
  const pay = n.baseSalary ?? n.estimatedSalary;
  const v = pay?.value ?? pay;
  return compact({
    title: str(n.title ?? n.name),
    company: str(n.hiringOrganization?.name ?? n.hiringOrganization),
    location: locs.join(' | ') || (remote ? 'Remote' : str(n.applicantLocationRequirements)),
    workplace: remote ? 'remote' : workplaceOf(str(n.title), locs.join(' '), str(n.jobLocationType)),
    employment_type: employmentOf(str(n.employmentType)) || str(n.employmentType).toLowerCase(),
    ...salaryFields(v?.minValue ?? v?.value, v?.maxValue ?? v?.value, pay?.currency ?? v?.currency, v?.unitText ?? pay?.unitText),
    date_posted: isoDate(n.datePosted),
    valid_through: isoDate(n.validThrough),
    experience: str(n.experienceRequirements?.monthsOfExperience ? `${Math.round(n.experienceRequirements.monthsOfExperience / 12)}+ years` : n.experienceRequirements),
    description: htmlText(n.description, 3000),
    apply_url: absUrl(n.directApply === true ? n.url : n.applicationContact?.url ?? n.url, url),
    url,
    source: 'job posting data',
  });
}

// Keys that a job record in a site's app data usually has
const JOB_KEYS = [
  ['title', 'jobTitle', 'positionTitle', 'name', 'displayTitle', 'normTitle'],
  ['company', 'companyName', 'employer', 'employerName', 'hiringOrganization', 'organization', 'truncatedCompany'],
  ['location', 'formattedLocation', 'jobLocation', 'locationName', 'city', 'locations'],
  ['salary', 'salarySnippet', 'compensation', 'pay', 'salaryText', 'estimatedSalary', 'baseSalary', 'datePosted', 'postedAt', 'pubDate', 'formattedRelativeTime', 'listingDate', 'jobkey', 'jobId'],
];

function jobFromRecord(o: any, base: string): Row {
  const salaryObj = pick(o, ['salarySnippet', 'salary', 'compensation', 'estimatedSalary', 'baseSalary', 'pay'], 1);
  const salaryText = typeof salaryObj === 'string' ? salaryObj : str(pick(salaryObj, ['text', 'salaryTextFormatted', 'formatted', 'summary'], 1));
  const loc = pick(o, ['formattedLocation', 'location', 'jobLocation', 'locationName', 'locations', 'city'], 1);
  const link = pick(o, ['url', 'jobUrl', 'link', 'viewJobLink', 'detailUrl', 'applyUrl', 'canonicalUrl', 'jobViewUrl', 'href'], 1);
  const id = str(pick(o, ['jobkey', 'jobKey', 'jobId', 'id'], 0));
  return compact({
    title: str(pick(o, ['title', 'jobTitle', 'displayTitle', 'positionTitle', 'name', 'normTitle'], 0)),
    company: str(pick(o, ['company', 'companyName', 'employerName', 'employer', 'truncatedCompany', 'hiringOrganization', 'organization'], 1)),
    location: typeof loc === 'object' && !Array.isArray(loc) ? addressText(loc).full || str(loc) : str(loc),
    workplace: workplaceOf(str(pick(o, ['remoteLocation', 'workplaceType', 'remote', 'isRemote', 'locationType'], 1)), str(loc)),
    employment_type: employmentOf(str(pick(o, ['jobTypes', 'employmentType', 'jobType', 'commitment', 'type'], 1))),
    ...salaryFields(
      pick(salaryObj, ['min', 'minValue', 'salaryMin', 'from'], 1),
      pick(salaryObj, ['max', 'maxValue', 'salaryMax', 'to'], 1),
      pick(salaryObj, ['currency', 'currencyCode'], 1),
      pick(salaryObj, ['period', 'unit', 'unitText', 'interval', 'type'], 1),
      salaryText,
    ),
    date_posted: isoDate(pick(o, ['datePosted', 'postedAt', 'pubDate', 'publishedAt', 'createDate', 'createdAt', 'listingDate', 'formattedRelativeTime', 'postedDate'], 1)),
    url: absUrl(link, base) || (id && /indeed\./.test(base) ? new URL(`/viewjob?jk=${id}`, base).href : ''),
    source: 'page data',
  });
}

/** Job cards read from the visible page (live pages only). */
function jobsFromCards(doc: Document, base: string): Row[] {
  if (typeof (globalThis as any).__gleanerFindLists !== 'function') return [];
  const lists: { items: Element[] }[] = (globalThis as any).__gleanerFindLists(6);
  const out: Row[] = [];
  for (const l of lists) {
    const rows = l.items.map((item) => {
      const text = (item as HTMLElement).innerText ?? item.textContent ?? '';
      const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
      const link = item.querySelector('a[href*="job"], a[href*="career"], a[href*="position"], h2 a, h3 a, a[href]') as HTMLAnchorElement | null;
      const title = str(item.querySelector('h2, h3, [class*="title" i]')?.textContent) || str(link?.textContent) || lines[0] || '';
      const company = str(item.querySelector('[class*="company" i], [data-testid*="company" i], [class*="employer" i]')?.textContent);
      const loc = str(item.querySelector('[class*="location" i], [data-testid*="location" i]')?.textContent);
      const salaryLine = lines.find((s) => /(?:[$€£₩¥]|USD|KRW|EUR)\s?\d|\d\s?(?:k|K)\s?[-–~]|per (hour|year|month)|an hour|a year/.test(s)) ?? '';
      const posted = lines.find((s) => /\bago\b|^posted|^today$|^just posted$|^\d+\+? days?/i.test(s)) ?? '';
      return compact({
        title,
        company,
        location: loc,
        workplace: workplaceOf(text),
        employment_type: employmentOf(text),
        ...(salaryLine ? salaryFields('', '', '', '', salaryLine) : {}),
        date_posted: isoDate(posted.replace(/^posted\s*/i, '')),
        url: link?.href ?? '',
        source: 'listing cards',
      });
    });
    // A list counts as jobs when most items have a title and a company or location
    const good = rows.filter((r) => r.title && (r.company || r.location || r.salary));
    if (good.length >= Math.max(3, rows.length * 0.5)) out.push(...good);
    if (out.length) break;
  }
  return out;
}

/** Every job on a page: detail page or search results, from the best source available. */
export function extractJobs(doc: Document, url: string): Row[] {
  const fromLd = ldNodes(doc).filter((n) => isType(n, ['jobposting'])).map((n) => jobFromLd(n, url));
  if (fromLd.length) {
    // On a detail page the posting's own URL is this page
    if (fromLd.length === 1) fromLd[0].url = url;
    return dedupeRows(fromLd, (r) => r.url + '|' + r.title);
  }
  const arrays = recordArrays(embeddedJson(doc), (o) => (pick(o, JOB_KEYS[0], 0) !== undefined ? keyScore(o, JOB_KEYS) : 0), 3);
  const fromData = arrays.flatMap((a) => a.map((o) => jobFromRecord(o, url))).filter((r) => r.title && (r.company || r.location));
  if (fromData.length >= 2) return dedupeRows(fromData, (r) => r.url || `${r.title}|${r.company}|${r.location}`);
  return dedupeRows(jobsFromCards(doc, url), (r) => r.url || `${r.title}|${r.company}`);
}

// ---------- Company hiring systems ----------

export type Ats = 'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters' | 'recruitee' | 'workable';
export const ATS_NAMES: Record<Ats, string> = { greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', smartrecruiters: 'SmartRecruiters', recruitee: 'Recruitee', workable: 'Workable' };

/** Which hiring system and company a careers link points at, or null. */
export function detectAts(input: string): { ats: Ats; slug: string } | null {
  const s = input.trim();
  const tests: [Ats, RegExp][] = [
    ['greenhouse', /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([\w-]+)/i],
    ['greenhouse', /boards-api\.greenhouse\.io\/v1\/boards\/([\w-]+)/i],
    ['lever', /jobs\.(?:eu\.)?lever\.co\/([\w.-]+)/i],
    ['ashby', /jobs\.ashbyhq\.com\/([\w.%-]+)/i],
    ['smartrecruiters', /(?:jobs|careers)\.smartrecruiters\.com\/([\w-]+)/i],
    ['recruitee', /([\w-]+)\.recruitee\.com/i],
    ['workable', /apply\.workable\.com\/([\w-]+)/i],
  ];
  for (const [ats, re] of tests) {
    const m = s.match(re);
    if (m && !/^(embed|api|v\d|jobs?)$/i.test(m[1])) return { ats, slug: decodeURIComponent(m[1]) };
  }
  // "greenhouse:airbnb" shorthand
  const short = s.match(/^(greenhouse|lever|ashby|smartrecruiters|recruitee|workable)\s*[:/]\s*([\w.-]+)$/i);
  return short ? { ats: short[1].toLowerCase() as Ats, slug: short[2] } : null;
}

/** Hiring-system links on a company's own careers page (embedded boards and "View jobs" links). */
export function atsLinksInPage(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/https?:\/\/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=)?[\w-]+|https?:\/\/jobs\.(?:eu\.)?lever\.co\/[\w.-]+|https?:\/\/jobs\.ashbyhq\.com\/[\w.%-]+|https?:\/\/(?:jobs|careers)\.smartrecruiters\.com\/[\w-]+|https?:\/\/[\w-]+\.recruitee\.com|https?:\/\/apply\.workable\.com\/[\w-]+/gi)) {
    if (detectAts(m[0])) out.add(m[0]);
  }
  return [...out];
}

async function getJson(url: string, signal?: AbortSignal, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { signal, ...init, headers: { accept: 'application/json', ...(init?.headers ?? {}) } });
  if (res.status === 404) throw new Error('No job board found for that company name.');
  if (!res.ok) throw new Error(`The job board answered with HTTP ${res.status}.`);
  return res.json();
}

/** Every open job a company lists in its hiring system. */
export async function atsJobs(ats: Ats, slug: string, signal?: AbortSignal): Promise<Row[]> {
  const via = `${ATS_NAMES[ats]} job board`;
  if (ats === 'greenhouse') {
    const [data, board] = await Promise.all([
      getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`, signal),
      getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}`, signal).catch(() => null),
    ]);
    return (data.jobs ?? []).map((j: any) =>
      compact({
        title: str(j.title),
        company: str(board?.name ?? j.company_name ?? slug),
        location: str(j.location?.name),
        workplace: workplaceOf(str(j.location?.name), str(j.title)),
        department: str((j.departments ?? []).map((d: any) => d.name)),
        ...salaryFields('', '', '', '', ((j.metadata ?? []) as any[]).filter((m) => /salary|pay|compensation/i.test(m.name)).map((m) => str(m.value)).join(' ')),
        date_posted: isoDate(j.first_published ?? j.updated_at),
        description: htmlText(j.content, 3000),
        apply_url: str(j.absolute_url),
        url: str(j.absolute_url),
        source: via,
      }),
    );
  }
  if (ats === 'lever') {
    const data: any[] = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`, signal);
    return data.map((j) =>
      compact({
        title: str(j.text),
        company: slug,
        location: str(j.categories?.allLocations?.length ? j.categories.allLocations : j.categories?.location),
        workplace: str(j.workplaceType).replace('onsite', 'on-site').replace('unspecified', '') || workplaceOf(str(j.categories?.location)),
        employment_type: employmentOf(str(j.categories?.commitment)) || str(j.categories?.commitment).toLowerCase(),
        department: str(j.categories?.team ?? j.categories?.department),
        ...salaryFields(j.salaryRange?.min, j.salaryRange?.max, j.salaryRange?.currency, str(j.salaryRange?.interval).replace(/^per-/, '')),
        date_posted: isoDate(j.createdAt),
        description: str(j.descriptionPlain).slice(0, 3000),
        apply_url: str(j.applyUrl),
        url: str(j.hostedUrl),
        source: via,
      }),
    );
  }
  if (ats === 'ashby') {
    const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`, signal);
    return (data.jobs ?? []).map((j: any) => {
      const comp = j.compensation?.summaryComponents?.find((c: any) => /salary/i.test(c.compensationType)) ?? {};
      return compact({
        title: str(j.title),
        company: slug,
        location: [str(j.location), ...((j.secondaryLocations ?? []) as any[]).map((l) => str(l.location))].filter(Boolean).join(' | '),
        workplace: j.isRemote ? 'remote' : str(j.workplaceType).toLowerCase().replace('onsite', 'on-site'),
        employment_type: employmentOf(str(j.employmentType)),
        department: str(j.department ?? j.team),
        ...salaryFields(comp.minValue, comp.maxValue, comp.currencyCode, str(comp.interval).replace(/^1\s*/, ''), str(j.compensation?.compensationTierSummary)),
        date_posted: isoDate(j.publishedAt),
        description: str(j.descriptionPlain).slice(0, 3000),
        apply_url: str(j.applyUrl),
        url: str(j.jobUrl),
        source: via,
      });
    });
  }
  if (ats === 'smartrecruiters') {
    const out: Row[] = [];
    for (let offset = 0; offset < 2000; offset += 100) {
      const data = await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=100&offset=${offset}`, signal);
      for (const j of data.content ?? []) {
        const loc = j.location ?? {};
        out.push(
          compact({
            title: str(j.name),
            company: str(j.company?.name ?? slug),
            location: [loc.city, loc.region, loc.country?.toUpperCase?.()].filter(Boolean).join(', '),
            workplace: loc.remote ? 'remote' : loc.hybrid ? 'hybrid' : '',
            employment_type: employmentOf(str(j.typeOfEmployment?.label)),
            department: str(j.department?.label ?? j.function?.label),
            experience: str(j.experienceLevel?.label),
            date_posted: isoDate(j.releasedDate),
            url: `https://jobs.smartrecruiters.com/${encodeURIComponent(slug)}/${j.id}`,
            apply_url: `https://jobs.smartrecruiters.com/${encodeURIComponent(slug)}/${j.id}`,
            source: via,
          }),
        );
      }
      if (!data.content?.length || out.length >= (data.totalFound ?? 0)) break;
    }
    return out;
  }
  if (ats === 'recruitee') {
    const data = await getJson(`https://${encodeURIComponent(slug)}.recruitee.com/api/offers/`, signal);
    return (data.offers ?? []).map((j: any) =>
      compact({
        title: str(j.title),
        company: str(j.company_name ?? slug),
        location: str(j.location ?? [j.city, j.country].filter(Boolean).join(', ')),
        workplace: j.remote ? 'remote' : j.hybrid ? 'hybrid' : '',
        employment_type: employmentOf(str(j.employment_type_code)),
        department: str(j.department),
        ...salaryFields(j.salary?.min, j.salary?.max, j.salary?.currency, j.salary?.period),
        date_posted: isoDate(j.published_at ?? j.created_at),
        description: htmlText(j.description, 3000),
        apply_url: str(j.careers_apply_url ?? j.careers_url),
        url: str(j.careers_url),
        source: via,
      }),
    );
  }
  // Workable's public board endpoint takes a POST with an empty filter
  const out: Row[] = [];
  let token: string | undefined;
  for (let page = 0; page < 30; page++) {
    const data = await getJson(`https://apply.workable.com/api/v3/accounts/${encodeURIComponent(slug)}/jobs`, signal, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(token ? { token } : {}),
    });
    for (const j of data.results ?? []) {
      out.push(
        compact({
          title: str(j.title),
          company: slug,
          location: str([j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(', ')),
          workplace: j.remote ? 'remote' : str(j.workplace).toLowerCase().replace('on_site', 'on-site'),
          employment_type: employmentOf(str(j.type)),
          department: str(j.department),
          date_posted: isoDate(j.published),
          url: `https://apply.workable.com/${encodeURIComponent(slug)}/j/${j.shortcode}/`,
          apply_url: `https://apply.workable.com/${encodeURIComponent(slug)}/j/${j.shortcode}/apply/`,
          source: via,
        }),
      );
    }
    token = data.nextPage;
    if (!token) break;
  }
  return out;
}

/** A careers link or page, turned into the hiring-system boards it uses. */
export async function resolveBoards(input: string, signal?: AbortSignal): Promise<{ ats: Ats; slug: string }[]> {
  const direct = detectAts(input);
  if (direct) return [direct];
  const url = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const res = await fetch(url, { signal });
  const html = await res.text();
  const found = new Map<string, { ats: Ats; slug: string }>();
  for (const link of atsLinksInPage(html + ' ' + res.url)) {
    const d = detectAts(link);
    if (d) found.set(`${d.ats}:${d.slug.toLowerCase()}`, d);
  }
  return [...found.values()];
}

/** Experience level hints from a title, for filtering ("senior", "junior"...). */
export function seniorityOf(title: string): string {
  const t = title.toLowerCase();
  if (/\b(intern|internship)\b/.test(t)) return 'intern';
  if (/\b(junior|jr\.?|entry|graduate|associate)\b/.test(t)) return 'junior';
  if (/\b(principal|staff|distinguished)\b/.test(t)) return 'principal';
  if (/\b(senior|sr\.?|lead)\b/.test(t)) return 'senior';
  if (/\b(head of|director|vp|vice president|chief|cto|ceo|cfo)\b/.test(t)) return 'leadership';
  return '';
}

export const salaryNumber = (r: Row) => toNum(r.salary_max || r.salary_min);
