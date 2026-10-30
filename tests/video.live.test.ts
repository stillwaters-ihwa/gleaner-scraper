// Live check of the Video downloader against public streaming test streams (the ones player
// makers publish for testing). Saves a few seconds of each and asks ffprobe what's in the file.
// Runs only with GLEANER_LIVE=1 because it needs the internet.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMpd, resolveHls, type Rendition } from '@/lib/video/manifest';
import { saveRendition, saveTrack } from '@/lib/video/save';
// @ts-expect-error no types
import ffprobe from 'ffprobe-static';

import { Window } from 'happy-dom';

// The browser has DOMParser for DASH manifests; Node needs one
(globalThis as any).DOMParser ??= new Window().DOMParser;

const live = process.env.GLEANER_LIVE ? describe : describe.skip;
const get = (u: string) => fetch(u).then((r) => r.text());
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-video-'));

/** A few pieces only, to keep the test quick. */
function short(r: Rendition, n = 4): Rendition {
  const cut = <T extends { parts: unknown[]; duration?: number }>(t: T) => ({ ...t, parts: t.parts.slice(0, n) });
  return { ...r, video: cut(r.video), audio: r.audio.map(cut) };
}

function probe(blob: Uint8Array, name: string) {
  const file = path.join(out, name);
  fs.writeFileSync(file, blob);
  const json = JSON.parse(execFileSync(ffprobe.path, ['-v', 'error', '-count_packets', '-show_entries', 'stream=codec_type,codec_name,width,height,nb_read_packets:format=duration', '-of', 'json', file]).toString());
  return { file, streams: json.streams as { codec_type: string; codec_name: string; width?: number; nb_read_packets: string }[], duration: Number(json.format?.duration) };
}

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

live('real streams', () => {
  it('HLS with transport-stream pieces becomes an MP4 with picture and sound', async () => {
    const r = await resolveHls('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', get);
    const low = r.renditions[r.renditions.length - 1];
    expect(low.video.container).toBe('ts');
    const p = probe(await bytes(await saveRendition(short(low, 3))), 'mux-ts.mp4');
    console.log('mux ts', p);
    expect(p.streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);
    expect(p.streams.every((s) => Number(s.nb_read_packets) > 10)).toBe(true);
    expect(p.duration).toBeGreaterThan(15);
    expect(p.duration).toBeLessThan(60);
  }, 120000);

  it('HLS with MP4 pieces and a separate sound track is joined into one file', async () => {
    const r = await resolveHls('https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8', get);
    const pick = r.renditions[r.renditions.length - 1];
    expect(pick.audio.length).toBe(1);
    const p = probe(await bytes(await saveRendition(short(pick, 3))), 'apple-fmp4.mp4');
    console.log('apple fmp4', p);
    expect(p.streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);
    expect(p.streams.every((s) => Number(s.nb_read_packets) > 10)).toBe(true);
    expect(p.duration).toBeGreaterThan(10);
    expect(p.duration).toBeLessThan(60);
    // Audio only
    const a = probe(await bytes(await saveTrack({ ...r.audioOnly[0], parts: r.audioOnly[0].parts.slice(0, 3) })), 'apple-audio.m4a');
    expect(a.streams.map((s) => s.codec_type)).toEqual(['audio']);
  }, 180000);

  it('DASH with separate picture and sound is joined into one file', async () => {
    const url = 'https://storage.googleapis.com/shaka-demo-assets/angel-one/dash.mpd';
    const r = parseMpd(await get(url), url);
    const pick = r.renditions[r.renditions.length - 1];
    const p = probe(await bytes(await saveRendition(short(pick, 3))), 'shaka-dash.mp4');
    console.log('shaka dash', p, pick.label);
    expect(p.streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);
    expect(p.streams.every((s) => Number(s.nb_read_packets) > 10)).toBe(true);
  }, 180000);

  it('DASH with number templates (Akamai)', async () => {
    const url = 'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd';
    const r = parseMpd(await get(url), url);
    const pick = r.renditions[r.renditions.length - 1];
    const p = probe(await bytes(await saveRendition(short(pick, 3))), 'akamai-dash.mp4');
    console.log('akamai dash', p, pick.label);
    expect(p.streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);
  }, 180000);
});
