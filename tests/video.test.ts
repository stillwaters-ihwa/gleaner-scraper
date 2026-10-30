// @vitest-environment happy-dom
// Video downloader: reading HLS and DASH, refusing protected streams, spotting videos, and
// joining separate picture and sound MP4 tracks.
import { describe, expect, it } from 'vitest';
import { estimateBytes, isBlockedHost, isoDuration, parseHlsMaster, parseHlsMedia, parseMpd, Refusal, resolveHls } from '@/lib/video/manifest';
import { boxes, mergeInits, setFragmentTrackId, trackCount } from '@/lib/video/mp4';
import { classify, mergeFound, scanPage, sizeFromHeaders, wholeFileUrl } from '@/lib/video/detect';

const MASTER = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="audio/en.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Español",LANGUAGE="es",URI="audio/es.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="subs/en.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2",AUDIO="aud",SUBTITLES="subs"
v360/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="aud",SUBTITLES="subs"
v720/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="aud"
v720/index.m3u8
`;
const MEDIA_FMP4 = `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-MAP:URI="init.mp4"
#EXTINF:4.0,
seg0.m4s
#EXTINF:4.0,
seg1.m4s
#EXTINF:2.5,
seg2.m4s
#EXT-X-ENDLIST
`;

describe('HLS', () => {
  it('reads every quality once, with its sound and subtitles', () => {
    const m = parseHlsMaster(MASTER, 'https://cdn.test/v/master.m3u8');
    expect(m.variants.map((v) => v.height)).toEqual([360, 720]);
    expect(m.variants[1].url).toBe('https://cdn.test/v/v720/index.m3u8');
    expect(m.media.filter((x) => x.type === 'AUDIO').map((x) => x.lang)).toEqual(['en', 'es']);
  });

  it('reads pieces, the MP4 header and the length', () => {
    const m = parseHlsMedia(MEDIA_FMP4, 'https://cdn.test/v/v720/index.m3u8');
    expect(m.parts.map((p) => p.url.split('/').pop())).toEqual(['seg0.m4s', 'seg1.m4s', 'seg2.m4s']);
    expect(m.init?.url).toBe('https://cdn.test/v/v720/init.mp4');
    expect(m).toMatchObject({ duration: 10.5, live: false, container: 'fmp4' });
  });

  it('follows byte ranges inside one file', () => {
    const m = parseHlsMedia('#EXTM3U\n#EXTINF:5,\n#EXT-X-BYTERANGE:1000@0\nall.ts\n#EXTINF:5,\n#EXT-X-BYTERANGE:800\nall.ts\n#EXT-X-ENDLIST', 'https://cdn.test/a/p.m3u8');
    expect(m.parts.map((p) => p.range)).toEqual([[0, 999], [1000, 1799]]);
    expect(m.container).toBe('ts');
  });

  it('knows a live broadcast', () => {
    expect(parseHlsMedia('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:120\n#EXTINF:6,\na.ts\n#EXTINF:6,\nb.ts', 'https://cdn.test/live.m3u8')).toMatchObject({ live: true, mediaSequence: 120 });
  });

  it('refuses encrypted and DRM streams', () => {
    expect(() => parseHlsMedia('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:6,\na.ts', 'https://x.test/p.m3u8')).toThrowError(/encrypted/);
    expect(() => parseHlsMedia('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x",KEYFORMAT="com.apple.streamingkeydelivery"\n#EXTINF:6,\na.ts', 'https://x.test/p.m3u8')).toThrowError(/DRM/);
    expect(() => parseHlsMaster('#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="skd://x",KEYFORMAT="com.apple.streamingkeydelivery"\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv.m3u8', 'https://x.test/m.m3u8')).toThrow(Refusal);
    // Unencrypted marker is fine
    expect(parseHlsMedia('#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:6,\na.ts\n#EXT-X-ENDLIST', 'https://x.test/p.m3u8').parts).toHaveLength(1);
  });

  it('resolves a whole stream: qualities best first, default sound, other languages, subtitles', async () => {
    const files: Record<string, string> = {
      'https://cdn.test/v/master.m3u8': MASTER,
      'https://cdn.test/v/v360/index.m3u8': MEDIA_FMP4,
      'https://cdn.test/v/v720/index.m3u8': MEDIA_FMP4,
      'https://cdn.test/v/audio/en.m3u8': MEDIA_FMP4,
      'https://cdn.test/v/audio/es.m3u8': MEDIA_FMP4,
      'https://cdn.test/v/subs/en.m3u8': '#EXTM3U\n#EXTINF:10,\nen0.vtt\n#EXT-X-ENDLIST',
    };
    const r = await resolveHls('https://cdn.test/v/master.m3u8', async (u) => files[u]);
    expect(r.renditions.map((x) => x.label)).toEqual(['720p', '360p']);
    expect(r.renditions[0].audio.map((a) => a.lang)).toEqual(['en']);
    expect(r.renditions[0].video.kind).toBe('video');
    expect(r.audioOnly.map((a) => a.label)).toEqual(['English', 'Español']);
    expect(r.subtitles[0]).toMatchObject({ kind: 'text', lang: 'en', container: 'vtt' });
    expect(estimateBytes(r.renditions[0], 10)).toBe(3000000);
  });
});

const MPD = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT0M9.6S">
  <BaseURL>https://cdn.test/dash/</BaseURL>
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <SegmentTemplate timescale="1000" duration="4000" startNumber="1" initialization="$RepresentationID$/init.mp4" media="$RepresentationID$/seg-$Number%03d$.m4s"/>
      <Representation id="v1080" bandwidth="5000000" width="1920" height="1080" codecs="avc1.640028"/>
      <Representation id="v480" bandwidth="1000000" width="854" height="480" codecs="avc1.4d401e"/>
    </AdaptationSet>
    <AdaptationSet contentType="audio" mimeType="audio/mp4" lang="en">
      <SegmentTemplate timescale="48000" initialization="a/init.mp4" media="a/$Time$.m4s">
        <SegmentTimeline><S t="0" d="192000" r="1"/><S d="76800"/></SegmentTimeline>
      </SegmentTemplate>
      <Representation id="a128" bandwidth="128000" codecs="mp4a.40.2"/>
    </AdaptationSet>
    <AdaptationSet contentType="text" mimeType="text/vtt" lang="fr">
      <Representation id="fr" bandwidth="100"><BaseURL>subs/fr.vtt</BaseURL></Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

describe('DASH', () => {
  it('builds every piece from templates and timelines', () => {
    const r = parseMpd(MPD, 'https://cdn.test/manifest.mpd');
    expect(r.renditions.map((x) => x.label)).toEqual(['1080p', '480p']);
    const v = r.renditions[0].video;
    expect(v.init?.url).toBe('https://cdn.test/dash/v1080/init.mp4');
    expect(v.parts.map((p) => p.url.split('/').pop())).toEqual(['seg-001.m4s', 'seg-002.m4s', 'seg-003.m4s']);
    const a = r.renditions[0].audio[0];
    expect(a.parts.map((p) => p.url.split('/').pop())).toEqual(['0.m4s', '192000.m4s', '384000.m4s']);
    expect(r.subtitles[0]).toMatchObject({ lang: 'fr', container: 'vtt', parts: [{ url: 'https://cdn.test/dash/subs/fr.vtt' }] });
    expect(r.duration).toBeCloseTo(9.6);
  });

  it('refuses DRM and live DASH', () => {
    expect(() => parseMpd(MPD.replace('<Representation id="v1080"', '<ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/><Representation id="v1080"'), 'https://x.test/m.mpd')).toThrowError(/DRM/);
    expect(() => parseMpd(MPD.replace('type="static"', 'type="dynamic"'), 'https://x.test/m.mpd')).toThrowError(/live/);
  });

  it('reads ISO durations', () => {
    expect(isoDuration('PT1H2M3.5S')).toBe(3723.5);
    expect(isoDuration('PT0M9.6S')).toBeCloseTo(9.6);
  });
});

describe('spotting videos', () => {
  it('tells streams and files from stream pieces', () => {
    expect(classify('https://v.test/a/master.m3u8?token=1')).toBe('hls');
    expect(classify('https://v.test/play', 'application/vnd.apple.mpegurl')).toBe('hls');
    expect(classify('https://v.test/x.mpd')).toBe('dash');
    expect(classify('https://v.test/clip.mp4')).toBe('file');
    expect(classify('https://v.test/stream', 'video/webm')).toBe('file');
    expect(classify('https://v.test/seg-00012.ts')).toBeNull();
    expect(classify('https://v.test/chunk_3.m4s')).toBeNull();
    expect(classify('https://v.test/x', 'video/mp2t')).toBeNull();
    expect(classify('https://v.test/song.mp3')).toBe('audio');
    expect(classify('blob:https://v.test/abc')).toBeNull();
  });

  it('turns byte-range pieces into the whole file and reads sizes', () => {
    expect(wholeFileUrl('https://fb.test/v/123.mp4?_nc=1&bytestart=0&byteend=9999')).toBe('https://fb.test/v/123.mp4?_nc=1');
    expect(sizeFromHeaders([{ name: 'Content-Range', value: 'bytes 0-99/52428800' }])).toBe(52428800);
    expect(sizeFromHeaders([{ name: 'content-length', value: '1234' }])).toBe(1234);
  });

  it('blocks YouTube', () => {
    expect(isBlockedHost('https://www.youtube.com/watch?v=x')).toBe(true);
    expect(isBlockedHost('https://rr3---sn.googlevideo.com/videoplayback')).toBe(true);
    expect(isBlockedHost('https://vimeo.com/1')).toBe(false);
  });

  it('finds videos the page names', () => {
    document.body.innerHTML = `
      <video poster="/p.jpg"><source src="/media/clip.mp4" type="video/mp4"><track src="/subs/en.vtt" srclang="en" label="English"></video>
      <a href="/files/talk.webm">Download the talk</a>
      <script type="application/ld+json">{"@type":"VideoObject","name":"Launch","contentUrl":"https://cdn.test/launch/master.m3u8"}</script>`;
    const found = scanPage(document, 'https://site.test/page');
    expect(found.map((f) => [f.kind, f.url])).toEqual([
      ['file', 'https://site.test/media/clip.mp4'],
      ['subtitles', 'https://site.test/subs/en.vtt'],
      ['hls', 'https://cdn.test/launch/master.m3u8'],
      ['file', 'https://site.test/files/talk.webm'],
    ]);
    expect(found[0].poster).toBe('https://site.test/p.jpg');
  });

  it('merges sightings of the same video', () => {
    const a = mergeFound([], { url: 'u', kind: 'file', via: 'page', title: 'T' });
    const b = mergeFound(a, { url: 'u', kind: 'file', via: 'network', bytes: 5 });
    expect(b).toEqual([{ url: 'u', kind: 'file', via: 'page', title: 'T', bytes: 5 }]);
  });
});

// Minimal MP4 boxes, enough to check the joining
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const bx = (type: string, ...body: number[][]) => {
  const content = body.flat();
  return [...u32(8 + content.length), ...[...type].map((c) => c.charCodeAt(0)), ...content];
};
const full = (v = 0) => [v, 0, 0, 0];
const tkhd = (id: number) => bx('tkhd', full(0), u32(0), u32(0), u32(id), new Array(68).fill(0));
const init = (id: number, handler: string) =>
  new Uint8Array([
    ...bx('ftyp', [...'iso6'].map((c) => c.charCodeAt(0)), u32(0)),
    ...bx('moov', bx('mvhd', full(0), new Array(92).fill(0), u32(id + 1)), bx('trak', tkhd(id), bx('mdia', bx('hdlr', full(0), u32(0), [...handler].map((c) => c.charCodeAt(0)), new Array(12).fill(0)))), bx('mvex', bx('trex', full(0), u32(id), u32(1), u32(0), u32(0), u32(0)))),
  ]);
const frag = (id: number) => new Uint8Array([...bx('moof', bx('mfhd', full(0), u32(1)), bx('traf', bx('tfhd', [0, 2, 0, 0], u32(id)))), ...bx('mdat', [1, 2, 3])]);

describe('joining picture and sound', () => {
  it('makes one header with both tracks numbered 1 and 2', () => {
    const merged = mergeInits(init(1, 'vide'), init(1, 'soun'));
    expect(boxes(merged).map((b) => b.type)).toEqual(['ftyp', 'moov']);
    expect(trackCount(merged)).toBe(2);
    const moov = boxes(merged)[1];
    const kids = boxes(merged, moov.start + 8, moov.start + moov.size);
    expect(kids.map((k) => k.type)).toEqual(['mvhd', 'trak', 'trak', 'mvex']);
    const ids = kids.filter((k) => k.type === 'trak').map((t) => {
      const th = boxes(merged, t.start + 8, t.start + t.size)[0];
      return new DataView(merged.buffer).getUint32(th.start + 8 + 4 + 8);
    });
    expect(ids).toEqual([1, 2]);
    const mvex = kids[3];
    const trexIds = boxes(merged, mvex.start + 8, mvex.start + mvex.size).map((t) => new DataView(merged.buffer).getUint32(t.start + 12));
    expect(trexIds).toEqual([1, 2]);
    // next_track_ID
    expect(new DataView(merged.buffer).getUint32(kids[0].start + kids[0].size - 4)).toBe(3);
  });

  it('renumbers fragments', () => {
    const f = setFragmentTrackId(frag(1), 2);
    const moof = boxes(f)[0];
    const traf = boxes(f, moof.start + 8, moof.start + moof.size)[1];
    const tfhd = boxes(f, traf.start + 8, traf.start + traf.size)[0];
    expect(new DataView(f.buffer).getUint32(tfhd.start + 12)).toBe(2);
  });
});

describe('YouTube addresses', () => {
  it('turns every kind of video address into a watch address', async () => {
    const { youtubeVideoUrl, isYouTube } = await import('@/lib/video/youtube');
    const w = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
    for (const u of ['https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PL1&t=4', 'https://youtu.be/jNQXAC9IVRw?si=x', 'https://www.youtube.com/shorts/jNQXAC9IVRw', 'https://m.youtube.com/watch?v=jNQXAC9IVRw', 'https://music.youtube.com/watch?v=jNQXAC9IVRw', 'https://www.youtube-nocookie.com/embed/jNQXAC9IVRw', 'https://www.youtube.com/live/jNQXAC9IVRw']) expect(youtubeVideoUrl(u)).toBe(w);
    for (const u of ['https://www.youtube.com/', 'https://www.youtube.com/@jawed', 'https://www.youtube.com/results?search_query=zoo', 'https://vimeo.com/1']) expect(youtubeVideoUrl(u)).toBeNull();
    expect(isYouTube('https://www.youtube.com/@jawed')).toBe(true);
    expect(isYouTube('https://notyoutube.com/x')).toBe(false);
  });

  it('finds YouTube players embedded in other pages', () => {
    document.body.innerHTML = '<iframe title="Launch film" src="https://www.youtube.com/embed/jNQXAC9IVRw?rel=0"></iframe>';
    const [f] = scanPage(document, 'https://news.test/story');
    expect(f).toMatchObject({ kind: 'youtube', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', title: 'Launch film' });
  });

  it('explains yt-dlp errors', async () => {
    const { explainYtError } = await import('@/lib/video/youtube');
    expect(explainYtError('This video is DRM protected')).toMatch(/DRM/);
    expect(explainYtError('Sign in to confirm you’re not a bot')).toMatch(/not a bot/);
    expect(explainYtError('Requested format is not available')).toMatch(/winget upgrade yt-dlp/);
  });
});

describe('YouTube helper version', () => {
  it('the bundled helper matches the version the panel expects', async () => {
    const fs = await import('node:fs');
    const { HELPER_VERSION } = await import('@/lib/video/youtube');
    const src = fs.readFileSync('public/helper/gleaner-host.mjs', 'utf8');
    expect(Number(/const HELPER_VERSION = (\d+);/.exec(src)?.[1])).toBe(HELPER_VERSION);
    expect(src.startsWith("// Gleaner's YouTube helper.")).toBe(true);
  });
});
