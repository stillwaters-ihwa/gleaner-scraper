// Sitemap discovery and parsing: robots.txt Sitemap lines, sitemap indexes followed
// recursively, gzip sitemaps unpacked with DecompressionStream. No page access needed.

export const MAX_URLS = 50_000;
const MAX_FILES = 2_000;

export interface SitemapEntry {
  url: string;
  lastmod: string;
  /** The sitemap file this URL was listed in. */
  sitemap: string;
}

export interface SitemapResult {
  entries: SitemapEntry[];
  files: { url: string; urls: number; error?: string }[];
  /** True when MAX_URLS was reached and more URLs were left unread. */
  capped: boolean;
}

/** Turn "example.com", "https://example.com/some/page" or a sitemap URL into where to start. */
export function sitemapStart(input: string): { origin: string; sitemap?: string } {
  const t = input.trim();
  const u = new URL(/^https?:\/\//i.test(t) ? t : 'https://' + t);
  if (!u.hostname.includes('.') && u.hostname !== 'localhost') throw new Error('Enter a domain like example.com');
  const isSitemap = /\.xml(\.gz)?$|sitemap/i.test(u.pathname) && u.pathname !== '/';
  return { origin: u.origin, sitemap: isSitemap ? u.href : undefined };
}

/** Sitemap URLs listed in robots.txt (empty when there is none). */
export async function robotsSitemaps(origin: string, signal?: AbortSignal): Promise<string[]> {
  try {
    const res = await fetch(`${origin}/robots.txt`, { signal });
    if (!res.ok) return [];
    const text = await res.text();
    const out: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*sitemap\s*:\s*(\S+)/i);
      if (m) {
        try {
          out.push(new URL(m[1], origin).href);
        } catch {
          /* bad line */
        }
      }
    }
    return [...new Set(out)];
  } catch (e) {
    if (signal?.aborted) throw e;
    return [];
  }
}

/** Fetch a sitemap as text, unpacking gzip when the bytes are still compressed. */
export async function fetchSitemapText(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  // Servers often send .xml.gz with Content-Encoding: gzip, which fetch already undid,
  // so check the gzip magic bytes rather than the file name.
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  return new TextDecoder().decode(buf);
}

/** Split one sitemap file into child sitemaps and page URLs. Plain-text sitemaps are one URL per line. */
export function parseSitemap(text: string, base: string): { sitemaps: string[]; urls: { url: string; lastmod: string }[] } {
  const abs = (s: string) => {
    try {
      return new URL(s.trim(), base).href;
    } catch {
      return '';
    }
  };
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('<')) {
    const urls = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^https?:\/\//i.test(l))
      .map((url) => ({ url, lastmod: '' }));
    return { sitemaps: [], urls };
  }
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Not a valid sitemap (XML did not parse)');
  const loc = (el: Element) => el.getElementsByTagNameNS('*', 'loc')[0]?.textContent ?? '';
  const sitemaps = [...doc.getElementsByTagNameNS('*', 'sitemap')].map((el) => abs(loc(el))).filter(Boolean);
  const urls = [...doc.getElementsByTagNameNS('*', 'url')]
    .map((el) => ({ url: abs(loc(el)), lastmod: el.getElementsByTagNameNS('*', 'lastmod')[0]?.textContent?.trim() ?? '' }))
    .filter((u) => u.url);
  return { sitemaps, urls };
}

/** Read every sitemap reachable from `start`, breadth first, up to MAX_URLS page URLs. */
export async function crawlSitemaps(
  start: string[],
  opts: { signal?: AbortSignal; onProgress?: (files: number, urls: number, current: string) => void; maxUrls?: number } = {},
): Promise<SitemapResult> {
  const max = opts.maxUrls ?? MAX_URLS;
  const queue = [...new Set(start)];
  const seenFiles = new Set(queue);
  const seenUrls = new Set<string>();
  const entries: SitemapEntry[] = [];
  const files: SitemapResult['files'] = [];
  let capped = false;

  while (queue.length && !opts.signal?.aborted && files.length < MAX_FILES) {
    if (entries.length >= max) {
      capped = true;
      break;
    }
    const url = queue.shift()!;
    opts.onProgress?.(files.length, entries.length, url);
    try {
      const { sitemaps, urls } = parseSitemap(await fetchSitemapText(url, opts.signal), url);
      for (const s of sitemaps) if (!seenFiles.has(s)) (seenFiles.add(s), queue.push(s));
      let added = 0;
      for (const u of urls) {
        if (seenUrls.has(u.url)) continue;
        if (entries.length >= max) {
          capped = true;
          break;
        }
        seenUrls.add(u.url);
        entries.push({ ...u, sitemap: url });
        added++;
      }
      files.push({ url, urls: added });
    } catch (e: any) {
      if (opts.signal?.aborted) break;
      files.push({ url, urls: 0, error: e?.message ?? String(e) });
    }
  }
  opts.onProgress?.(files.length, entries.length, '');
  return { entries, files, capped };
}

// ---------- Tree ----------

export interface TreeNode {
  /** Path from the root, unique per node. */
  id: string;
  label: string;
  /** Indexes into the entries array of URLs that end exactly here. */
  own: number[];
  children: TreeNode[];
  /** Number of URLs in this subtree. */
  total: number;
}

/** Group URLs by host and path segment. Chains of single-child folders are merged into one row. */
export function buildTree(entries: { url: string }[], indexes: number[]): TreeNode {
  type Raw = { label: string; own: number[]; kids: Map<string, Raw> };
  const root: Raw = { label: '', own: [], kids: new Map() };
  const hosts = new Set<string>();
  const parsed = indexes.map((i) => {
    try {
      const u = new URL(entries[i].url);
      hosts.add(u.host);
      return { i, u };
    } catch {
      return { i, u: null };
    }
  });
  const multiHost = hosts.size > 1;
  for (const { i, u } of parsed) {
    const parts = u ? u.pathname.split('/').filter(Boolean).map(safeDecode) : [entries[i].url];
    if (u && u.search) parts.push((parts.pop() ?? '') + u.search);
    if (u && multiHost) parts.unshift(u.host);
    let node = root;
    for (const p of parts) {
      let next = node.kids.get(p);
      if (!next) node.kids.set(p, (next = { label: p, own: [], kids: new Map() }));
      node = next;
    }
    node.own.push(i);
  }

  const finish = (raw: Raw, id: string): TreeNode => {
    let label = raw.label;
    let cur = raw;
    // Merge a/b/c when each folder only holds the next one
    while (cur !== root && cur.own.length === 0 && cur.kids.size === 1) {
      const only = [...cur.kids.values()][0];
      if (only.kids.size === 0) break;
      label += '/' + only.label;
      cur = only;
    }
    const nid = id + '/' + label;
    const children = [...cur.kids.values()].map((k) => finish(k, nid));
    // Folders first, then pages, each alphabetically
    children.sort((a, b) => Number(b.children.length > 0) - Number(a.children.length > 0) || a.label.localeCompare(b.label, undefined, { numeric: true }));
    const total = cur.own.length + children.reduce((n, c) => n + c.total, 0);
    return { id: nid, label, own: cur.own, children, total };
  };
  return finish(root, '');
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Every entry index in a subtree. */
export function subtreeIndexes(node: TreeNode, out: number[] = []): number[] {
  out.push(...node.own);
  for (const c of node.children) subtreeIndexes(c, out);
  return out;
}
