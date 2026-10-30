// Spotting videos: from the page (video tags, share tags, structured data) and from what the
// browser downloads while the page plays (streaming playlists and video files).

export type MediaKind = 'hls' | 'dash' | 'file' | 'audio' | 'subtitles' | 'youtube';

export interface FoundMedia {
  url: string;
  kind: MediaKind;
  /** Where it was found: the page itself, or watching what the page downloaded. */
  via: 'page' | 'network';
  title?: string;
  poster?: string;
  width?: number;
  height?: number;
  duration?: number;
  bytes?: number;
  mime?: string;
  lang?: string;
  at?: number;
}

const HLS_TYPES = /mpegurl/i;
const DASH_TYPES = /dash\+xml/i;
const FILE_EXT = /\.(mp4|m4v|webm|mov|mkv|ogv|flv|avi|3gp)$/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/i;
// Pieces of a stream, not videos on their own
const SEGMENT = /\.(ts|m4s|m4f|cmfv|cmfa|aac|vtt)$|[/_-](seg|segment|chunk|frag|fragment)[-_]?\d+|[?&](bytestart|byteend|range)=/i;

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split(/[?#]/)[0];
  }
};

/** What a URL (and its content type, when known) is, or null when it isn't a whole video. */
export function classify(url: string, contentType = ''): MediaKind | null {
  if (!/^https?:/i.test(url)) return null;
  const path = pathOf(url);
  const ct = contentType.split(';')[0].trim().toLowerCase();
  if (HLS_TYPES.test(ct) || /\.m3u8$/i.test(path)) return 'hls';
  if (DASH_TYPES.test(ct) || /\.mpd$/i.test(path)) return 'dash';
  if (/\.(vtt|srt)$/i.test(path) || ct === 'text/vtt') return 'subtitles';
  if (ct === 'video/mp2t' || ct === 'video/iso.segment' || ct === 'audio/mp2t') return null;
  if (SEGMENT.test(path) || /[?&](bytestart|byteend)=/i.test(url)) return null;
  if (ct.startsWith('video/') || FILE_EXT.test(path)) return 'file';
  if (ct.startsWith('audio/') || AUDIO_EXT.test(path)) return 'audio';
  return null;
}

/** Facebook-style progressive pieces ("...mp4?bytestart=0&byteend=999"): the whole file is the URL without them. */
export function wholeFileUrl(url: string): string {
  try {
    const u = new URL(url);
    let changed = false;
    for (const k of ['bytestart', 'byteend', 'range']) if (u.searchParams.has(k)) (u.searchParams.delete(k), (changed = true));
    return changed ? u.href : url;
  } catch {
    return url;
  }
}

/** Sizes the network gave: Content-Length, or the total in Content-Range. */
export function sizeFromHeaders(headers: { name: string; value?: string }[]): number | undefined {
  const h = (n: string) => headers.find((x) => x.name.toLowerCase() === n)?.value;
  const total = h('content-range')?.match(/\/(\d+)$/)?.[1];
  const len = total ?? h('content-length');
  const n = Number(len);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Keeps one entry per URL, merging what each sighting knew. */
export function mergeFound(list: FoundMedia[], add: FoundMedia): FoundMedia[] {
  const i = list.findIndex((m) => m.url === add.url);
  if (i === -1) return [...list, add].slice(-200);
  const next = list.slice();
  next[i] = { ...add, ...Object.fromEntries(Object.entries(list[i]).filter(([, v]) => v !== undefined && v !== '')), via: list[i].via === 'page' ? 'page' : add.via };
  return next;
}

/** Videos the page itself names. Runs inside the page. */
export function scanPage(doc: Document, pageUrl: string): FoundMedia[] {
  let out: FoundMedia[] = [];
  const abs = (u: string | null | undefined) => {
    if (!u) return '';
    try {
      return new URL(u, pageUrl).href;
    } catch {
      return '';
    }
  };
  const title = (doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || doc.title || '').trim();
  for (const v of Array.from(doc.querySelectorAll('video, audio')) as HTMLMediaElement[]) {
    let srcs = [v.getAttribute('src'), ...Array.from(v.querySelectorAll('source')).map((s) => s.getAttribute('src'))].map(abs).filter(Boolean);
    if (!srcs.length && v.currentSrc) srcs = [abs(v.currentSrc)];
    for (const u of new Set(srcs)) {
      const type = v.querySelector(`source[src="${CSS.escape(u)}"]`)?.getAttribute('type') ?? '';
      const kind = classify(u, type) ?? (v.tagName === 'AUDIO' ? 'audio' : 'file');
      out = mergeFound(out, { url: u, kind, via: 'page', title, poster: abs(v.getAttribute('poster')) || undefined, width: (v as HTMLVideoElement).videoWidth || undefined, height: (v as HTMLVideoElement).videoHeight || undefined, duration: Number.isFinite(v.duration) && v.duration > 0 ? Math.round(v.duration) : undefined });
    }
    for (const t of Array.from(v.querySelectorAll('track[src]')) as HTMLTrackElement[]) {
      const u = abs(t.getAttribute('src'));
      if (u) out = mergeFound(out, { url: u, kind: 'subtitles', via: 'page', title: t.label || t.srclang || 'Subtitles', lang: t.srclang || undefined });
    }
  }
  for (const m of Array.from(doc.querySelectorAll('meta[property^="og:video"], meta[name^="twitter:player:stream"]'))) {
    const prop = m.getAttribute('property') ?? m.getAttribute('name') ?? '';
    if (/:(type|width|height|duration)$/.test(prop) && !/stream$/.test(prop)) continue;
    const u = abs(m.getAttribute('content'));
    const kind = u && classify(u, doc.querySelector('meta[property="og:video:type"]')?.getAttribute('content') ?? '');
    if (u && kind) out = mergeFound(out, { url: u, kind, via: 'page', title });
  }
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    let data: any;
    try {
      data = JSON.parse(s.textContent ?? '');
    } catch {
      continue;
    }
    const walk = (o: any, depth: number) => {
      if (!o || typeof o !== 'object' || depth > 8) return;
      if (Array.isArray(o)) return o.forEach((x) => walk(x, depth + 1));
      if (/VideoObject/i.test(String(o['@type'])) && typeof o.contentUrl === 'string') {
        const u = abs(o.contentUrl);
        const kind = classify(u) ?? 'file';
        if (u) out = mergeFound(out, { url: u, kind, via: 'page', title: o.name || title, poster: typeof o.thumbnailUrl === 'string' ? abs(o.thumbnailUrl) : undefined });
      }
      for (const v of Object.values(o)) walk(v, depth + 1);
    };
    walk(data, 0);
  }
  // YouTube players embedded in the page (saved through yt-dlp)
  for (const f of Array.from(doc.querySelectorAll('iframe[src*="youtube.com/embed/"], iframe[src*="youtube-nocookie.com/embed/"]'))) {
    const id = /\/embed\/([\w-]{11})/.exec(f.getAttribute('src') ?? '')?.[1];
    if (id) out = mergeFound(out, { url: `https://www.youtube.com/watch?v=${id}`, kind: 'youtube', via: 'page', title: f.getAttribute('title') || title, poster: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` });
  }
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    const u = abs(a.getAttribute('href'));
    const kind = classify(u);
    if (kind && kind !== 'subtitles') out = mergeFound(out, { url: u, kind, via: 'page', title: (a.textContent ?? '').trim().slice(0, 120) || title });
  }
  return out;
}

/** True when a page plays a video we can't see a source for (streamed through blob: URLs). */
export function hasStreamedVideo(doc: Document): boolean {
  return Array.from(doc.querySelectorAll('video')).some((v) => (v as HTMLVideoElement).currentSrc.startsWith('blob:'));
}
