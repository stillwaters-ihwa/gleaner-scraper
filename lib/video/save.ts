// Downloads a stream's pieces and puts them together into one file: transport-stream pieces
// (older HLS) are converted to MP4 with mux.js, MP4 pieces are joined as they are, and separate
// picture and sound tracks are combined into one MP4. Live HLS is recorded until you stop it.
import { boxes, concat, fragmentTicks, fragmentsOnly, mergeInits, setDurations, setFragmentTrackId, trackCount } from './mp4';
import { parseHlsMedia, type Part, type Rendition, type Track } from './manifest';

export interface SaveProgress {
  bytes: number;
  done: number;
  total: number;
  /** Seconds recorded so far, for live streams. */
  recorded?: number;
}

export interface SaveOptions {
  signal?: AbortSignal;
  /** For live streams: return true to finish the recording and save what was captured. */
  shouldStop?: () => boolean;
  onProgress?: (p: SaveProgress) => void;
  concurrency?: number;
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(new DOMException('Stopped', 'AbortError'))), { once: true });
  });

async function fetchPart(p: Part, o: SaveOptions): Promise<Uint8Array> {
  const f = o.fetcher ?? ((u, i) => fetch(u, i));
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await f(p.url, { credentials: 'include', signal: o.signal, headers: p.range ? { Range: `bytes=${p.range[0]}-${p.range[1]}` } : undefined });
      if (res.status === 403 || res.status === 401) throw Object.assign(new Error(`The site refused the download (HTTP ${res.status}). Reload the page, play the video for a moment, and try again.`), { final: true });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let b = new Uint8Array(await res.arrayBuffer());
      // A server that ignores Range sends the whole file
      if (p.range && res.status === 200 && b.length > p.range[1]) b = b.slice(p.range[0], p.range[1] + 1);
      return b;
    } catch (e) {
      if ((e as any)?.name === 'AbortError' || (e as any)?.final) throw e;
      last = e;
      await sleep(600 * (attempt + 1), o.signal);
    }
  }
  throw new Error(`A piece of the video failed to download (${(last as Error)?.message ?? 'network error'}).`);
}

/** Fetches pieces several at a time, handing them over in order. */
async function eachInOrder(parts: Part[], o: SaveOptions, use: (b: Uint8Array, i: number) => void | Promise<void>) {
  const n = Math.max(1, o.concurrency ?? 6);
  const pending = new Map<number, Promise<Uint8Array>>();
  let next = 0;
  const launch = () => {
    while (pending.size < n && next < parts.length) {
      const i = next++;
      const pr = fetchPart(parts[i], o);
      pr.catch(() => {}); // handled when awaited in order
      pending.set(i, pr);
    }
  };
  for (let i = 0; i < parts.length; i++) {
    launch();
    const b = await pending.get(i)!;
    pending.delete(i);
    await use(b, i);
  }
}

type MuxData = { initSegment: Uint8Array; data: Uint8Array };

async function transmuxer() {
  const mod: any = await import('mux.js');
  const muxjs = mod.default ?? mod;
  const t = new muxjs.mp4.Transmuxer({ remux: true });
  let init: Uint8Array | null = null;
  let out: Uint8Array[] = [];
  t.on('data', (d: MuxData) => {
    if (!init && d.initSegment?.length) init = new Uint8Array(d.initSegment);
    out.push(new Uint8Array(d.data));
  });
  return {
    push(b: Uint8Array) {
      t.push(b);
      t.flush();
      const got = out;
      out = [];
      return got;
    },
    init: () => init,
  };
}

interface Collected {
  init: Uint8Array | null;
  /** Fragments (moof + mdat), already converted to MP4 when needed. */
  chunks: Blob[];
  seconds: number;
  /** Play time per track number, added up from the fragments. */
  ticks: Map<number, number>;
}

/**
 * Downloads one track into MP4 fragments. `trackId` renumbers the fragments so the track can
 * be combined with another one.
 */
async function collect(track: Track, o: SaveOptions, count: (bytes: number) => void, trackId?: number): Promise<Collected> {
  const chunks: Blob[] = [];
  const ticks = new Map<number, number>();
  let init: Uint8Array | null = null;
  const mux = track.container === 'ts' || track.container === 'aac' ? await transmuxer() : null;
  if (track.init) init = await fetchPart(track.init, o);
  // One whole file per track (DASH SegmentBase): its header is the init, the rest are fragments
  const whole = track.container === 'file' && !track.init;
  const take = (b: Uint8Array) => {
    count(b.length);
    if (whole && !init) {
      const top = boxes(b);
      if (!top.some((x) => x.type === 'moof')) throw new Error('This site sends the picture and sound as two separate whole files, which Gleaner can only save one at a time. Use "Audio only" for the sound.');
      init = concat(top.filter((x) => x.type === 'ftyp' || x.type === 'moov').map((x) => b.subarray(x.start, x.start + x.size)));
    }
    const frags = mux ? mux.push(b) : [b];
    if (mux && !init) init = mux.init();
    // Renumber only a single-track stream; one that already holds picture and sound stays as is
    const renumber = !!trackId && !!init && trackCount(init) === 1;
    for (const f of frags) {
      const pieces = fragmentsOnly(f);
      // A plain progressive MP4 has no fragments: keep it whole
      const parts = pieces.length ? pieces : [f];
      if (renumber) for (const p of parts) setFragmentTrackId(p, trackId!);
      for (const p of parts) fragmentTicks(p, ticks);
      chunks.push(new Blob(parts as BlobPart[]));
    }
  };
  await eachInOrder(track.parts, o, (b) => take(b));
  let seconds = track.duration ?? 0;

  // Live HLS: keep reading the playlist for new pieces until told to stop
  if (track.live && track.playlistUrl) {
    let seq = (track.mediaSequence ?? 0) + track.parts.length;
    while (!o.shouldStop?.() && !o.signal?.aborted) {
      const res = await (o.fetcher ?? fetch)(track.playlistUrl, { credentials: 'include', signal: o.signal });
      const m = parseHlsMedia(await res.text(), track.playlistUrl);
      const fresh = m.parts.slice(Math.max(0, seq - m.mediaSequence));
      seq = m.mediaSequence + m.parts.length;
      await eachInOrder(fresh, o, (b) => take(b));
      seconds += (m.duration / Math.max(1, m.parts.length)) * fresh.length;
      if (!m.live) break;
      await sleep(Math.max(1000, (m.targetDuration * 1000) / 2), o.signal).catch(() => {});
    }
  }
  return { init, chunks, seconds, ticks };
}

/** Picture and sound pieces side by side, so a player can start before reaching the end. */
function interleave(a: Blob[], b: Blob[]): Blob[] {
  const out: Blob[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (j >= b.length || (i < a.length && i / a.length <= j / b.length)) out.push(a[i++]);
    else out.push(b[j++]);
  }
  return out;
}

/** One quality of a stream as a single MP4 (with sound). */
export async function saveRendition(r: Rendition, o: SaveOptions = {}): Promise<Blob> {
  const parts = r.video.parts.length + r.audio.reduce((s, a) => s + a.parts.length, 0);
  let done = 0;
  let bytes = 0;
  const count = (n: number) => {
    bytes += n;
    done++;
    o.onProgress?.({ bytes, done, total: parts, recorded: r.video.live ? done * ((r.video.duration ?? 0) / Math.max(1, r.video.parts.length)) : undefined });
  };
  const audio = r.audio[0];
  if (r.video.container === 'file' && !audio) {
    const [b] = await Promise.all(r.video.parts.map((p) => fetchPart(p, o)));
    count(b.length);
    return new Blob([b as BlobPart], { type: 'video/mp4' });
  }
  if (!audio) {
    const v = await collect(r.video, o, count);
    return new Blob([...(v.init ? [setDurations(v.init, v.ticks)] : []), ...v.chunks] as BlobPart[], { type: 'video/mp4' });
  }
  const [v, a] = await Promise.all([collect(r.video, o, count, 1), collect(audio, o, count, 2)]);
  if (!v.init || !a.init) throw new Error('The stream is missing its MP4 header, so the picture and sound could not be joined.');
  // A video track that already carries sound doesn't need the extra one
  if (trackCount(v.init) > 1) return new Blob([setDurations(v.init, v.ticks), ...v.chunks] as BlobPart[], { type: 'video/mp4' });
  const ticks = new Map([...v.ticks, ...a.ticks]);
  return new Blob([setDurations(mergeInits(v.init, a.init), ticks), ...interleave(v.chunks, a.chunks)] as BlobPart[], { type: 'video/mp4' });
}

/** One track on its own: sound only (.m4a) or picture only. */
export async function saveTrack(t: Track, o: SaveOptions = {}): Promise<Blob> {
  let done = 0;
  let bytes = 0;
  const count = (n: number) => {
    bytes += n;
    done++;
    o.onProgress?.({ bytes, done, total: t.parts.length });
  };
  const type = t.kind === 'audio' ? 'audio/mp4' : 'video/mp4';
  if (t.container === 'file') {
    const b = await fetchPart(t.parts[0], o);
    count(b.length);
    return new Blob([b as BlobPart], { type });
  }
  const c = await collect(t, o, count);
  return new Blob([...(c.init ? [setDurations(c.init, c.ticks)] : []), ...c.chunks] as BlobPart[], { type });
}

/** Subtitles split into pieces, joined into one WebVTT file. */
export async function saveSubtitles(t: Track, o: SaveOptions = {}): Promise<Blob> {
  const texts: string[] = [];
  await eachInOrder(t.parts, o, (b, i) => {
    let s = new TextDecoder().decode(b).replace(/^﻿/, '');
    if (i > 0) s = s.replace(/^WEBVTT[^\n]*\n(?:[^\n]+\n)*\n?/, '').replace(/^X-TIMESTAMP-MAP[^\n]*\n/m, '');
    texts.push(s.trim());
  });
  return new Blob([texts.join('\n\n') + '\n'], { type: 'text/vtt' });
}

export { concat };
