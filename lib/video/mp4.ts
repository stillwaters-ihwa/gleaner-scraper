// Joins a picture-only and a sound-only fragmented MP4 (how DASH and modern HLS deliver video)
// into one file that plays with sound. Fragmented MP4 is a header (ftyp + moov) followed by
// self-contained moof + mdat pairs, so joining only needs one header that lists both tracks and
// each fragment pointing at the right track number. No re-encoding.

export interface Box {
  type: string;
  start: number;
  size: number;
  header: number;
}

const type4 = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** The boxes directly inside bytes [start, end). */
export function boxes(b: Uint8Array, start = 0, end = b.length): Box[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: Box[] = [];
  let o = start;
  while (o + 8 <= end) {
    let size = v.getUint32(o);
    let header = 8;
    if (size === 1) {
      size = Number(v.getBigUint64(o + 8));
      header = 16;
    } else if (size === 0) size = end - o;
    if (size < header || o + size > end) break;
    out.push({ type: type4(b, o + 4), start: o, size, header });
    o += size;
  }
  return out;
}

const child = (b: Uint8Array, box: Box, type: string) => boxes(b, box.start + box.header, box.start + box.size).find((x) => x.type === type);
const slice = (b: Uint8Array, box: Box) => b.slice(box.start, box.start + box.size);

function setU32(b: Uint8Array, o: number, n: number) {
  new DataView(b.buffer, b.byteOffset, b.byteLength).setUint32(o, n);
}

/** Byte offset of track_ID inside a tkhd / tfhd / trex box. */
function trackIdOffset(b: Uint8Array, box: Box): number {
  const body = box.start + box.header;
  if (box.type === 'tkhd') return body + 4 + (b[body] === 1 ? 16 : 8);
  return body + 4; // tfhd and trex: version/flags, then track_ID
}

/** Rewrites the track number of every fragment in a piece of fragmented MP4 (in place). */
export function setFragmentTrackId(b: Uint8Array, id: number): Uint8Array {
  for (const moof of boxes(b).filter((x) => x.type === 'moof')) {
    for (const traf of boxes(b, moof.start + moof.header, moof.start + moof.size).filter((x) => x.type === 'traf')) {
      const tfhd = child(b, traf, 'tfhd');
      if (tfhd) setU32(b, trackIdOffset(b, tfhd), id);
    }
  }
  return b;
}

/** Fragments only: drops headers and indexes (ftyp, moov, styp, sidx) that a joined file doesn't need. */
export function fragmentsOnly(b: Uint8Array): Uint8Array[] {
  return boxes(b)
    .filter((x) => x.type === 'moof' || x.type === 'mdat')
    .map((x) => b.subarray(x.start, x.start + x.size));
}

function box(type: string, ...content: Uint8Array[]): Uint8Array {
  const size = 8 + content.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(size);
  setU32(out, 0, size);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let o = 8;
  for (const c of content) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export function trackCount(init: Uint8Array): number {
  const moov = boxes(init).find((x) => x.type === 'moov');
  return moov ? boxes(init, moov.start + moov.header, moov.start + moov.size).filter((x) => x.type === 'trak').length : 0;
}

/**
 * One header for both tracks: the picture's ftyp and movie header, the picture track as track 1
 * and the sound track as track 2. Fragments must then be renumbered with setFragmentTrackId.
 */
export function mergeInits(video: Uint8Array, audio: Uint8Array): Uint8Array {
  const vTop = boxes(video);
  const aTop = boxes(audio);
  const vMoov = vTop.find((x) => x.type === 'moov');
  const aMoov = aTop.find((x) => x.type === 'moov');
  if (!vMoov || !aMoov) throw new Error('The video pieces are missing their MP4 header.');
  const ftyp = vTop.find((x) => x.type === 'ftyp');
  const vKids = boxes(video, vMoov.start + vMoov.header, vMoov.start + vMoov.size);
  const aKids = boxes(audio, aMoov.start + aMoov.header, aMoov.start + aMoov.size);
  const vTrak = vKids.find((x) => x.type === 'trak');
  const aTrak = aKids.find((x) => x.type === 'trak');
  if (!vTrak || !aTrak) throw new Error('The video pieces are missing their track description.');

  const mvhdBox = vKids.find((x) => x.type === 'mvhd')!;
  const mvhd = slice(video, mvhdBox);
  // next_track_ID is the last field of mvhd
  setU32(mvhd, mvhd.length - 4, 3);

  const retrack = (src: Uint8Array, trak: Box, id: number) => {
    const t = slice(src, trak);
    const tkhd = boxes(t, 8, t.length).find((x) => x.type === 'tkhd');
    if (tkhd) setU32(t, trackIdOffset(t, tkhd), id);
    return t;
  };
  const trexOf = (src: Uint8Array, kidsList: Box[], id: number) => {
    const mvex = kidsList.find((x) => x.type === 'mvex');
    const trex = mvex && child(src, mvex, 'trex');
    if (trex) {
      const t = slice(src, trex);
      setU32(t, 12, id);
      return t;
    }
    // A plain default: one sample description, nothing else preset
    const t = new Uint8Array(32);
    setU32(t, 0, 32);
    t.set([116, 114, 101, 120], 4); // 'trex'
    setU32(t, 12, id);
    setU32(t, 16, 1);
    return t;
  };
  const vMvex = vKids.find((x) => x.type === 'mvex');
  const mehd = vMvex && child(video, vMvex, 'mehd');
  const mvex = box('mvex', ...(mehd ? [slice(video, mehd)] : []), trexOf(video, vKids, 1), trexOf(audio, aKids, 2));
  const moov = box('moov', mvhd, retrack(video, vTrak, 1), retrack(audio, aTrak, 2), mvex);
  return ftyp ? concat([slice(video, ftyp), moov]) : moov;
}

const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** Play time in each fragment, per track number, in that track's own time units. */
export function fragmentTicks(b: Uint8Array, into = new Map<number, number>()): Map<number, number> {
  const v = dv(b);
  for (const moof of boxes(b).filter((x) => x.type === 'moof')) {
    for (const traf of boxes(b, moof.start + moof.header, moof.start + moof.size).filter((x) => x.type === 'traf')) {
      const kids = boxes(b, traf.start + traf.header, traf.start + traf.size);
      const tfhd = kids.find((x) => x.type === 'tfhd');
      if (!tfhd) continue;
      let o = tfhd.start + tfhd.header;
      const tf = v.getUint32(o) & 0xffffff;
      const id = v.getUint32(o + 4);
      o += 8;
      if (tf & 0x01) o += 8;
      if (tf & 0x02) o += 4;
      const defDur = tf & 0x08 ? v.getUint32(o) : 0;
      let ticks = 0;
      for (const trun of kids.filter((x) => x.type === 'trun')) {
        let p = trun.start + trun.header;
        const rf = v.getUint32(p) & 0xffffff;
        const count = v.getUint32(p + 4);
        p += 8;
        if (rf & 0x001) p += 4;
        if (rf & 0x004) p += 4;
        const per = ((rf & 0x100) && 4) + ((rf & 0x200) && 4) + ((rf & 0x400) && 4) + ((rf & 0x800) && 4);
        if (rf & 0x100) for (let i = 0; i < count; i++) ticks += v.getUint32(p + i * per);
        else ticks += defDur * count;
      }
      into.set(id, (into.get(id) ?? 0) + ticks);
    }
  }
  return into;
}

/**
 * Writes the real length into the header. Stream headers often say "unknown" (fine while
 * streaming, but a saved file would then show a wrong length and seek badly).
 */
export function setDurations(init: Uint8Array, ticksByTrack: Map<number, number>): Uint8Array {
  const out = init.slice();
  const v = dv(out);
  const moov = boxes(out).find((x) => x.type === 'moov');
  if (!moov) return out;
  const kids = boxes(out, moov.start + moov.header, moov.start + moov.size);
  const mvhd = kids.find((x) => x.type === 'mvhd');
  if (!mvhd) return out;
  const mvBody = mvhd.start + mvhd.header;
  const mv1 = out[mvBody] === 1;
  const movieScale = v.getUint32(mvBody + 4 + (mv1 ? 16 : 8));
  const put = (o: number, wide: boolean, n: number) => (wide ? v.setBigUint64(o, BigInt(Math.round(n))) : v.setUint32(o, Math.min(0xfffffffe, Math.round(n))));
  let longest = 0;
  for (const trak of kids.filter((x) => x.type === 'trak')) {
    const tk = boxes(out, trak.start + trak.header, trak.start + trak.size);
    const tkhd = tk.find((x) => x.type === 'tkhd');
    const mdia = tk.find((x) => x.type === 'mdia');
    const mdhd = mdia && child(out, mdia, 'mdhd');
    if (!tkhd || !mdhd) continue;
    const id = v.getUint32(trackIdOffset(out, tkhd));
    const ticks = ticksByTrack.get(id);
    if (!ticks) continue;
    const mdBody = mdhd.start + mdhd.header;
    const md1 = out[mdBody] === 1;
    const scale = v.getUint32(mdBody + 4 + (md1 ? 16 : 8));
    if (!scale) continue;
    put(mdBody + 4 + (md1 ? 20 : 12), md1, ticks);
    const seconds = ticks / scale;
    const tkBody = tkhd.start + tkhd.header;
    const tk1 = out[tkBody] === 1;
    put(tkBody + 4 + (tk1 ? 24 : 16), tk1, seconds * movieScale);
    longest = Math.max(longest, seconds);
  }
  if (longest) put(mvBody + 4 + (mv1 ? 20 : 12), mv1, longest * movieScale);
  // mehd (fragment duration) uses the movie time scale too
  const mvex = kids.find((x) => x.type === 'mvex');
  const mehd = mvex && child(out, mvex, 'mehd');
  if (mehd && longest) {
    const b = mehd.start + mehd.header;
    put(b + 4, out[b] === 1, longest * movieScale);
  }
  return out;
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
