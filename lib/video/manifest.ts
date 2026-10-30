// Reads the two streaming formats video sites use: HLS playlists (.m3u8) and DASH manifests
// (.mpd). Both describe a video as many small pieces, often with the picture and the sound kept
// apart and offered at several qualities. Encrypted and DRM-protected streams are refused.

/** A piece of a stream: a URL, sometimes only a byte range of it (inclusive). */
export interface Part {
  url: string;
  range?: [number, number];
}

export type Container = 'ts' | 'aac' | 'fmp4' | 'file' | 'vtt';

export interface Track {
  kind: 'muxed' | 'video' | 'audio' | 'text';
  label: string;
  bandwidth: number;
  width?: number;
  height?: number;
  codecs?: string;
  lang?: string;
  container: Container;
  init?: Part;
  parts: Part[];
  /** Seconds, when the playlist says. */
  duration?: number;
  /** Still being broadcast: new pieces keep appearing in the playlist. */
  live?: boolean;
  /** For live HLS: where to read new pieces from. */
  playlistUrl?: string;
  mediaSequence?: number;
}

/** One quality the viewer can pick, with the sound and subtitles that go with it. */
export interface Rendition {
  label: string;
  video: Track;
  /** Separate sound tracks; empty when the sound is inside the video pieces. */
  audio: Track[];
}

export interface Resolved {
  kind: 'hls' | 'dash';
  renditions: Rendition[];
  audioOnly: Track[];
  subtitles: Track[];
  duration?: number;
  live: boolean;
}

/** Why a video can't be saved, in words for the person using the tool. */
export class Refusal extends Error {
  constructor(
    public reason: 'drm' | 'encrypted' | 'youtube' | 'unsupported',
    message: string,
  ) {
    super(message);
  }
}

export const DRM_MESSAGE = 'This video is protected with DRM (copy protection), so it can only be played on the site. Gleaner does not save protected videos.';
export const ENCRYPTED_MESSAGE = 'This stream is encrypted by the site, so Gleaner does not save it.';
export const YOUTUBE_MESSAGE = "YouTube doesn't allow downloading outside its own apps, so Gleaner doesn't save YouTube videos.";

const BLOCKED_HOSTS = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|googlevideo\.com|ytimg\.com)$/i;
export function isBlockedHost(url: string): boolean {
  try {
    return BLOCKED_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

const abs = (u: string, base: string) => {
  try {
    return new URL(u.trim(), base).href;
  } catch {
    return u.trim();
  }
};

/** HLS attribute lists: KEY=value,KEY="quoted, value" */
export function hlsAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) out[m[1]] = m[2].replace(/^"|"$/g, '');
  return out;
}

function containerOf(url: string, fallback: Container): Container {
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (/\.(m4s|mp4|m4v|m4a|cmfv|cmfa)$/.test(path)) return 'fmp4';
  if (/\.(aac|mp3|ac3|ec3)$/.test(path)) return 'aac';
  if (/\.(vtt|webvtt)$/.test(path)) return 'vtt';
  if (/\.ts$/.test(path)) return 'ts';
  return fallback;
}

export function isMasterPlaylist(text: string) {
  return /#EXT-X-STREAM-INF/.test(text);
}

export interface HlsMaster {
  variants: { url: string; bandwidth: number; width?: number; height?: number; codecs?: string; audio?: string; subtitles?: string; name?: string }[];
  media: { type: string; group: string; name: string; lang?: string; url?: string; default: boolean }[];
}

export function parseHlsMaster(text: string, base: string): HlsMaster {
  if (/#EXT-X-SESSION-KEY:.*METHOD=(?!NONE)/.test(text)) throw new Refusal(/SAMPLE-AES|KEYFORMAT/.test(text) ? 'drm' : 'encrypted', /SAMPLE-AES|KEYFORMAT/.test(text) ? DRM_MESSAGE : ENCRYPTED_MESSAGE);
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const variants: HlsMaster['variants'] = [];
  const media: HlsMaster['media'] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('#EXT-X-STREAM-INF:')) {
      const a = hlsAttrs(l.slice(18));
      let j = i + 1;
      while (j < lines.length && (!lines[j] || lines[j].startsWith('#'))) j++;
      if (j >= lines.length) break;
      const [w, h] = (a.RESOLUTION ?? '').split('x').map(Number);
      variants.push({ url: abs(lines[j], base), bandwidth: Number(a['AVERAGE-BANDWIDTH'] ?? a.BANDWIDTH) || 0, width: w || undefined, height: h || undefined, codecs: a.CODECS, audio: a.AUDIO, subtitles: a.SUBTITLES, name: a.NAME });
      i = j;
    } else if (l.startsWith('#EXT-X-MEDIA:')) {
      const a = hlsAttrs(l.slice(13));
      media.push({ type: a.TYPE, group: a['GROUP-ID'], name: a.NAME ?? a.LANGUAGE ?? a['GROUP-ID'], lang: a.LANGUAGE, url: a.URI ? abs(a.URI, base) : undefined, default: a.DEFAULT === 'YES' });
    }
  }
  // The same quality is often listed twice (different sound groups or backup servers)
  const seen = new Set<string>();
  return { variants: variants.filter((v) => (seen.has(v.url) ? false : (seen.add(v.url), true))), media };
}

export interface HlsMedia {
  parts: Part[];
  init?: Part;
  duration: number;
  live: boolean;
  mediaSequence: number;
  targetDuration: number;
  container: Container;
}

export function parseHlsMedia(text: string, base: string): HlsMedia {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const parts: Part[] = [];
  let init: Part | undefined;
  let duration = 0;
  let segDur = 0;
  let pendingRange: string | undefined;
  const lastEnd = new Map<string, number>();
  let mediaSequence = 0;
  let targetDuration = 6;
  const range = (spec: string, url: string): [number, number] => {
    const [len, off] = spec.split('@').map(Number);
    const start = Number.isFinite(off) ? off : lastEnd.get(url) ?? 0;
    lastEnd.set(url, start + len);
    return [start, start + len - 1];
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    if (l.startsWith('#EXT-X-KEY:')) {
      const a = hlsAttrs(l.slice(11));
      if (a.METHOD && a.METHOD !== 'NONE') throw new Refusal(a.METHOD === 'AES-128' && !a.KEYFORMAT ? 'encrypted' : 'drm', a.METHOD === 'AES-128' && !a.KEYFORMAT ? ENCRYPTED_MESSAGE : DRM_MESSAGE);
    } else if (l.startsWith('#EXT-X-MAP:')) {
      const a = hlsAttrs(l.slice(11));
      const url = abs(a.URI, base);
      init = { url, range: a.BYTERANGE ? range(a.BYTERANGE, url) : undefined };
    } else if (l.startsWith('#EXTINF:')) {
      segDur = parseFloat(l.slice(8)) || 0;
    } else if (l.startsWith('#EXT-X-BYTERANGE:')) {
      pendingRange = l.slice(17);
    } else if (l.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      mediaSequence = Number(l.slice(22)) || 0;
    } else if (l.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = Number(l.slice(22)) || 6;
    } else if (!l.startsWith('#')) {
      const url = abs(l, base);
      parts.push({ url, range: pendingRange ? range(pendingRange, url) : undefined });
      duration += segDur;
      segDur = 0;
      pendingRange = undefined;
    }
  }
  const live = !/#EXT-X-ENDLIST/.test(text) && !/#EXT-X-PLAYLIST-TYPE:VOD/.test(text);
  const container: Container = init ? 'fmp4' : parts[0] ? containerOf(parts[0].url, 'ts') : 'ts';
  return { parts, init, duration, live, mediaSequence, targetDuration, container };
}

const heightLabel = (h?: number, bw?: number) => (h ? `${h}p` : bw ? `${Math.round(bw / 1000)} kbps` : 'Default');

/** A whole HLS stream: every quality, sound track and subtitle, with their pieces listed. */
export async function resolveHls(url: string, get: (u: string) => Promise<string>): Promise<Resolved> {
  const text = await get(url);
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Refusal('unsupported', "That address isn't an HLS playlist.");
  if (!isMasterPlaylist(text)) {
    const m = parseHlsMedia(text, url);
    const track: Track = { kind: 'muxed', label: 'Default', bandwidth: 0, container: m.container, init: m.init, parts: m.parts, duration: m.duration, live: m.live, playlistUrl: url, mediaSequence: m.mediaSequence };
    return { kind: 'hls', renditions: [{ label: 'Default', video: track, audio: [] }], audioOnly: [], subtitles: [], duration: m.duration, live: m.live };
  }
  const master = parseHlsMaster(text, url);
  const media = async (u: string) => parseHlsMedia(await get(u), u);
  const audioTracks = new Map<string, Track>();
  const audioFor = async (group?: string): Promise<Track[]> => {
    const list = master.media.filter((m) => m.type === 'AUDIO' && m.group === group && m.url);
    // Pick the default sound (or the first); other languages are offered as audio-only downloads
    const pick = list.find((m) => m.default) ?? list[0];
    if (!pick?.url) return [];
    if (!audioTracks.has(pick.url)) {
      const m = await media(pick.url);
      audioTracks.set(pick.url, { kind: 'audio', label: pick.name, lang: pick.lang, bandwidth: 0, container: m.container, init: m.init, parts: m.parts, duration: m.duration, live: m.live, playlistUrl: pick.url, mediaSequence: m.mediaSequence });
    }
    return [audioTracks.get(pick.url)!];
  };
  const videoVariants = master.variants.filter((v) => !(v.codecs && !/avc|hvc|hev|vp0?9|av01|mp4v/.test(v.codecs) && /mp4a|ac-3|ec-3|opus/.test(v.codecs)));
  const renditions: Rendition[] = [];
  for (const v of videoVariants.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || b.bandwidth - a.bandwidth)) {
    const m = await media(v.url);
    const audio = await audioFor(v.audio);
    const label = heightLabel(v.height, v.bandwidth);
    renditions.push({
      label,
      video: { kind: audio.length ? 'video' : 'muxed', label, bandwidth: v.bandwidth, width: v.width, height: v.height, codecs: v.codecs, container: m.container, init: m.init, parts: m.parts, duration: m.duration, live: m.live, playlistUrl: v.url, mediaSequence: m.mediaSequence },
      audio,
    });
  }
  const audioOnly: Track[] = [];
  for (const a of master.media.filter((m) => m.type === 'AUDIO' && m.url)) {
    if (audioOnly.some((t) => t.playlistUrl === a.url)) continue;
    const t: Track = audioTracks.get(a.url!) ?? (await media(a.url!).then((m): Track => ({ kind: 'audio' as const, label: a.name, lang: a.lang, bandwidth: 0, container: m.container, init: m.init, parts: m.parts, duration: m.duration, live: m.live, playlistUrl: a.url })));
    audioOnly.push(t);
  }
  const subtitles: Track[] = [];
  for (const s of master.media.filter((m) => m.type === 'SUBTITLES' && m.url)) {
    const m = await media(s.url!).catch(() => null);
    if (m) subtitles.push({ kind: 'text', label: s.name, lang: s.lang, bandwidth: 0, container: 'vtt', parts: m.parts, duration: m.duration });
  }
  const first = renditions[0]?.video;
  return { kind: 'hls', renditions, audioOnly, subtitles, duration: first?.duration, live: !!first?.live };
}

/** "PT1H2M3.5S" to seconds */
export function isoDuration(s: string | null | undefined): number {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/.exec(s ?? '');
  if (!m) return 0;
  return (Number(m[1] ?? 0) * 86400) + (Number(m[2] ?? 0) * 3600) + (Number(m[3] ?? 0) * 60) + Number(m[4] ?? 0);
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\$(RepresentationID|Number|Time|Bandwidth)(?:%0(\d+)d)?\$/g, (_, k, w) => {
    const v = String(vars[k] ?? '');
    return w ? v.padStart(Number(w), '0') : v;
  }).replace(/\$\$/g, '$');
}

const kids = (el: Element, name: string) => Array.from(el.children).filter((c) => c.localName === name);
const kid = (el: Element | null | undefined, name: string) => (el ? kids(el, name)[0] : undefined);

/** A whole DASH presentation: every quality and sound track, with their pieces listed. */
export function parseMpd(xml: string, url: string): Resolved {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const mpd = doc.documentElement;
  if (!mpd || mpd.localName !== 'MPD') throw new Refusal('unsupported', "That address isn't a DASH manifest.");
  if (doc.getElementsByTagNameNS('*', 'ContentProtection').length || /ContentProtection/.test(xml)) throw new Refusal('drm', DRM_MESSAGE);
  const live = mpd.getAttribute('type') === 'dynamic';
  if (live) throw new Refusal('unsupported', 'This is a live DASH broadcast. Gleaner can record live HLS streams, but not live DASH.');
  const duration = isoDuration(mpd.getAttribute('mediaPresentationDuration'));
  const baseOf = (el: Element | undefined, base: string) => {
    const b = kid(el, 'BaseURL')?.textContent?.trim();
    return b ? abs(b, base) : base;
  };
  const period = kids(mpd, 'Period')[0];
  if (!period) throw new Refusal('unsupported', 'The DASH manifest has no content.');
  const periodDur = isoDuration(period.getAttribute('duration')) || duration;
  const pBase = baseOf(period, baseOf(mpd, url));
  const tracks: Track[] = [];
  for (const set of kids(period, 'AdaptationSet')) {
    const setBase = baseOf(set, pBase);
    const setType = (set.getAttribute('contentType') || set.getAttribute('mimeType') || '').split('/')[0];
    for (const rep of kids(set, 'Representation')) {
      const mime = rep.getAttribute('mimeType') || set.getAttribute('mimeType') || '';
      const type = (rep.getAttribute('contentType') || mime || setType).split('/')[0] || setType;
      const kind = type === 'video' ? 'video' : type === 'audio' ? 'audio' : type === 'text' || /vtt|ttml/.test(mime) ? 'text' : null;
      if (!kind) continue;
      const base = baseOf(rep, setBase);
      const id = rep.getAttribute('id') ?? '';
      const bandwidth = Number(rep.getAttribute('bandwidth')) || 0;
      const vars = { RepresentationID: id, Bandwidth: bandwidth };
      const height = Number(rep.getAttribute('height') || set.getAttribute('height')) || undefined;
      const width = Number(rep.getAttribute('width') || set.getAttribute('width')) || undefined;
      const lang = set.getAttribute('lang') ?? undefined;
      const common = { kind, bandwidth, width, height, codecs: rep.getAttribute('codecs') || set.getAttribute('codecs') || undefined, lang, duration: periodDur } as const;
      const label = kind === 'video' ? heightLabel(height, bandwidth) : kind === 'audio' ? [lang, `${Math.round(bandwidth / 1000)} kbps`].filter(Boolean).join(' ') : lang || 'Subtitles';
      // SegmentTemplate can sit on the set and be refined on the representation
      const tpls = [kid(set, 'SegmentTemplate'), kid(rep, 'SegmentTemplate')].filter(Boolean) as Element[];
      const tAttr = (n: string) => tpls.map((t) => t.getAttribute(n)).filter((v) => v !== null).pop() ?? null;
      const list = kid(rep, 'SegmentList') ?? kid(set, 'SegmentList');
      if (tpls.length && tAttr('media')) {
        const timescale = Number(tAttr('timescale')) || 1;
        const start = Number(tAttr('startNumber') ?? 1);
        const media = tAttr('media')!;
        const initT = tAttr('initialization');
        const timeline = tpls.map((t) => kid(t, 'SegmentTimeline')).filter(Boolean).pop();
        const parts: Part[] = [];
        if (timeline) {
          let t = 0;
          let n = start;
          for (const s of kids(timeline, 'S')) {
            if (s.getAttribute('t') !== null) t = Number(s.getAttribute('t'));
            const d = Number(s.getAttribute('d'));
            let r = Number(s.getAttribute('r') ?? 0);
            if (r < 0) r = Math.max(0, Math.ceil((periodDur * timescale - t) / d) - 1);
            for (let k = 0; k <= r; k++) {
              parts.push({ url: abs(fill(media, { ...vars, Number: n++, Time: t }), base) });
              t += d;
            }
          }
        } else {
          const d = Number(tAttr('duration'));
          const count = d ? Math.ceil((periodDur * timescale) / d) : 0;
          for (let k = 0; k < count; k++) parts.push({ url: abs(fill(media, { ...vars, Number: start + k, Time: k * d }), base) });
        }
        tracks.push({ ...common, label, container: kind === 'text' ? 'vtt' : 'fmp4', init: initT ? { url: abs(fill(initT, vars), base) } : undefined, parts });
      } else if (list) {
        const initEl = kid(list, 'Initialization');
        const range = (s: string | null): [number, number] | undefined => (s ? (s.split('-').map(Number) as [number, number]) : undefined);
        const init = initEl ? { url: abs(initEl.getAttribute('sourceURL') ?? '', base), range: range(initEl.getAttribute('range')) } : undefined;
        const parts = kids(list, 'SegmentURL').map((s) => ({ url: abs(s.getAttribute('media') ?? '', base), range: range(s.getAttribute('mediaRange')) }));
        tracks.push({ ...common, label, container: kind === 'text' ? 'vtt' : 'fmp4', init: init && (init.url !== base || init.range) ? init : undefined, parts });
      } else {
        // One file per representation (SegmentBase): the whole file is the track
        tracks.push({ ...common, label, container: kind === 'text' ? 'vtt' : 'file', parts: [{ url: base }] });
      }
    }
  }
  const videos = tracks.filter((t) => t.kind === 'video').sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || b.bandwidth - a.bandwidth);
  const audios = tracks.filter((t) => t.kind === 'audio').sort((a, b) => b.bandwidth - a.bandwidth);
  // Best sound in the main language goes with every quality
  const mainAudio = audios[0];
  const seen = new Set<string>();
  const renditions = videos
    .filter((v) => (seen.has(v.label) ? false : (seen.add(v.label), true)))
    .map((v) => ({ label: v.label, video: v, audio: mainAudio ? [mainAudio] : [] }));
  return { kind: 'dash', renditions, audioOnly: audios, subtitles: tracks.filter((t) => t.kind === 'text'), duration, live: false };
}

/** Rough size in bytes from the bitrates, for showing before downloading. */
export function estimateBytes(r: Rendition, duration?: number): number {
  const d = duration ?? r.video.duration ?? 0;
  const bw = r.video.bandwidth + r.audio.reduce((s, a) => s + a.bandwidth, 0);
  return d && bw ? Math.round((bw * d) / 8) : 0;
}
