// Shared readers for the industry extractors. Most sites describe their listings twice: once
// for search engines (schema.org JSON-LD) and once for their own app (JSON embedded in the page,
// like Next.js __NEXT_DATA__). Reading those is more reliable than reading the visible layout,
// and works on fetched pages as well as live ones.

export type Row = Record<string, string>;

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Plain text from a value that may be a string, number, object with a name/value, or array. */
export function str(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return [...new Set(v.map(str).filter(Boolean))].join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return str(o.name ?? o.value ?? o.text ?? o['@value'] ?? o.label ?? o.displayName ?? '');
  }
  return clean(v);
}

/** Text with HTML tags and entities removed (job descriptions, article bodies). */
export function htmlText(v: unknown, max = 4000): string {
  const s = str(v);
  if (!/[<&]/.test(s)) return s.slice(0, max);
  const doc = new DOMParser().parseFromString(`<body>${s}</body>`, 'text/html');
  // Some feeds escape their HTML twice
  const once = clean(doc.body.textContent);
  const out = /<\w+[^>]*>/.test(once) ? clean(new DOMParser().parseFromString(`<body>${once}</body>`, 'text/html').body.textContent) : once;
  return out.slice(0, max);
}

export function absUrl(u: unknown, base: string): string {
  const s = str(u);
  if (!s) return '';
  try {
    return new URL(s, base).href;
  } catch {
    return '';
  }
}

// ---------- JSON-LD ----------

/** Every JSON-LD node on the page, with @graph, arrays and list items flattened. */
export function ldNodes(doc: Document): any[] {
  const out: any[] = [];
  const walk = (n: any, depth: number) => {
    if (!n || typeof n !== 'object' || depth > 6) return;
    if (Array.isArray(n)) return n.forEach((x) => walk(x, depth + 1));
    if (n['@type']) out.push(n);
    if (n['@graph']) walk(n['@graph'], depth + 1);
    // ItemList -> ListItem -> item
    if (n.itemListElement) walk(n.itemListElement, depth + 1);
    if (n.item && typeof n.item === 'object') walk(n.item, depth + 1);
    if (n.mainEntity) walk(n.mainEntity, depth + 1);
  };
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      walk(JSON.parse((s.textContent ?? '').trim().replace(/^<!--|-->$/g, '')), 0);
    } catch {
      /* broken JSON-LD is common; skip it */
    }
  }
  return out;
}

export const typesOf = (n: any): string[] => [].concat(n?.['@type'] ?? []).map((t: string) => String(t).toLowerCase().replace(/^https?:\/\/schema\.org\//, ''));
export const isType = (n: any, types: string[]) => typesOf(n).some((t) => types.includes(t));

// ---------- JSON embedded in the page ----------

const MAX_SCRIPT = 6_000_000;

/** Parse the JSON object that starts at `start` (a "{" or "["), matching braces outside strings. */
function balancedJson(s: string, start: number): any | undefined {
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length && i - start < MAX_SCRIPT; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open || (open === '{' && c === '[') || (open === '[' && c === '{')) depth++;
    else if (c === close || (open === '{' && c === ']') || (open === '[' && c === '}')) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/**
 * App data embedded in the page: Next.js and Nuxt state, JSON script tags, and
 * `window.something = {...}` assignments. Bounded, so a huge page can't stall the reader.
 */
export function embeddedJson(doc: Document): any[] {
  const out: any[] = [];
  for (const s of Array.from(doc.querySelectorAll('script'))) {
    const type = (s.getAttribute('type') ?? '').toLowerCase();
    if (type === 'application/ld+json') continue;
    const text = s.textContent ?? '';
    if (text.length < 200 || text.length > MAX_SCRIPT) continue;
    if (type === 'application/json' || s.id === '__NEXT_DATA__' || type === 'text/x-magento-init') {
      try {
        out.push(JSON.parse(text.trim()));
        continue;
      } catch {
        /* fall through to the assignment scan */
      }
    }
    if (!/"\s*:/.test(text)) continue;
    // window.__STATE__ = {...};  window.mosaic.providerData["x"] = {...};  var data = {...}
    const re = /(?:^|[;\s])(?:window\.|var\s+|let\s+|const\s+|self\.)?[\w$.[\]"'-]{2,120}\s*=\s*(?=[{[])/g;
    let m: RegExpExecArray | null;
    let found = 0;
    while ((m = re.exec(text)) && found < 12) {
      const start = m.index + m[0].length;
      const val = balancedJson(text, start);
      if (val && typeof val === 'object') {
        out.push(val);
        found++;
        re.lastIndex = start + 1;
      }
    }
  }
  return out;
}

/**
 * Arrays of records anywhere in some JSON, ranked by how well their items fit `score`
 * (0 to 1 per item). Used to find the listings array inside an app's page data.
 */
export function recordArrays(roots: any[], score: (o: any) => number, minLen = 2): any[][] {
  const found: { arr: any[]; s: number }[] = [];
  let visited = 0;
  const seen = new Set<any>();
  const walk = (n: any, depth: number) => {
    if (!n || typeof n !== 'object' || depth > 14 || visited > 250_000 || seen.has(n)) return;
    seen.add(n);
    visited++;
    if (Array.isArray(n)) {
      const objs = n.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
      if (objs.length >= minLen) {
        const sample = objs.slice(0, 8);
        const s = sample.reduce((a, o) => a + score(o), 0) / sample.length;
        if (s >= 0.5) found.push({ arr: objs, s: s + Math.min(0.3, objs.length / 100) });
      }
      for (const x of n) walk(x, depth + 1);
      return;
    }
    for (const v of Object.values(n)) walk(v, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  found.sort((a, b) => b.s - a.s);
  // Keep the best array plus any other strong ones that aren't the same items
  const out: any[][] = [];
  for (const f of found) {
    if (out.some((o) => o === f.arr || o.includes(f.arr[0]))) continue;
    if (out.length && f.s < found[0].s * 0.8) break;
    out.push(f.arr);
    if (out.length >= 3) break;
  }
  return out;
}

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The first value for any of `names` in `obj`, also looking one or two levels into nested
 * objects ("address.city", "hdpData.homeInfo.bedrooms"). Names are matched loosely
 * (case and punctuation ignored).
 */
export function pick(obj: any, names: string[], depth = 2): any {
  if (!obj || typeof obj !== 'object') return undefined;
  const want = names.map(norm);
  const level = (o: any, d: number): any => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return undefined;
    for (const w of want) for (const [k, v] of Object.entries(o)) if (norm(k) === w && v != null && v !== '' && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length)) return v;
    if (d <= 0) return undefined;
    for (const v of Object.values(o)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const r = level(v, d - 1);
        if (r !== undefined) return r;
      }
    }
    return undefined;
  };
  return level(obj, depth);
}

/** How many of the key groups an object has (each group is a set of synonyms), 0 to 1. */
export function keyScore(o: any, groups: string[][], depth = 1): number {
  if (!o || typeof o !== 'object') return 0;
  let hit = 0;
  for (const g of groups) if (pick(o, g, depth) !== undefined) hit++;
  return hit / groups.length;
}

// ---------- Numbers ----------

/** "1,234.5" / "$450K" / "1.2M" -> number, or null. */
export function toNum(v: unknown): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = str(v).replace(/,/g, '');
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  let n = parseFloat(m[0]);
  const suffix = s.slice((m.index ?? 0) + m[0].length).trim().charAt(0).toUpperCase();
  if (suffix === 'K') n *= 1_000;
  else if (suffix === 'M') n *= 1_000_000;
  else if (suffix === 'B') n *= 1_000_000_000;
  return n;
}

export const numStr = (v: unknown) => {
  const n = toNum(v);
  return n == null ? '' : String(Math.round(n * 100) / 100);
};

/** Date in YYYY-MM-DD from ISO strings, timestamps (s or ms) or "3 days ago". */
export function isoDate(v: unknown, now = Date.now()): string {
  if (v == null || v === '') return '';
  if (typeof v === 'number' || /^\d{10,13}$/.test(String(v))) {
    const n = Number(v);
    const d = new Date(n < 1e12 ? n * 1000 : n);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }
  const s = str(v);
  const rel = s.match(/(\d+|an?|one)\+?\s*(minute|hour|day|week|month|year)s?\s+ago/i);
  if (rel) {
    const n = /^\d/.test(rel[1]) ? Number(rel[1]) : 1;
    const ms = { minute: 6e4, hour: 3.6e6, day: 8.64e7, week: 6.048e8, month: 2.592e9, year: 3.1536e10 }[rel[2].toLowerCase() as 'day'];
    return new Date(now - n * ms).toISOString().slice(0, 10);
  }
  if (/^(today|just posted|just now)$/i.test(s)) return new Date(now).toISOString().slice(0, 10);
  if (/^yesterday$/i.test(s)) return new Date(now - 8.64e7).toISOString().slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) || d.getFullYear() < 1990 ? '' : d.toISOString().slice(0, 10);
}

/** "123 Main St, Austin, TX 78701" from a schema.org PostalAddress or any address-like object. */
export function addressText(a: any): { full: string; street: string; city: string; region: string; postal: string; country: string } {
  if (!a) return { full: '', street: '', city: '', region: '', postal: '', country: '' };
  if (typeof a === 'string') return { full: clean(a), street: '', city: '', region: '', postal: '', country: '' };
  const street = str(pick(a, ['streetAddress', 'street', 'addressLine1', 'line1', 'addressStreet', 'streetLine'], 0));
  const city = str(pick(a, ['addressLocality', 'city', 'locality', 'addressCity', 'town'], 0));
  const region = str(pick(a, ['addressRegion', 'state', 'stateCode', 'region', 'province', 'addressState'], 0));
  const postal = str(pick(a, ['postalCode', 'zip', 'zipcode', 'postcode', 'addressZipcode', 'postal'], 0));
  const country = str(pick(a, ['addressCountry', 'country', 'countryCode'], 0));
  const full = [street, city, [region, postal].filter(Boolean).join(' '), country].filter(Boolean).join(', ') || str(pick(a, ['formattedAddress', 'full', 'line', 'display'], 0));
  return { full, street, city, region, postal, country };
}

/** Rows deduplicated by `key`, keeping the first and filling its empty fields from later copies. */
export function dedupeRows(rows: Row[], key: (r: Row) => string): Row[] {
  const out = new Map<string, Row>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    const prev = out.get(k);
    if (!prev) out.set(k, { ...r });
    else for (const [f, v] of Object.entries(r)) if (v && !prev[f]) prev[f] = v;
  }
  return [...out.values()];
}

/** Drop empty fields so rows stay small. */
export const compact = (r: Row): Row => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== '' && v != null));

/** The first image URL from a schema.org image value (string, ImageObject, or a list of either). */
export function firstImage(v: unknown, base: string): string {
  const first: any = Array.isArray(v) ? v[0] : v;
  return absUrl(first && typeof first === 'object' ? first.url ?? first.contentUrl : first, base);
}
