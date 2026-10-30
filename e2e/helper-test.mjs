// Talks to the YouTube helper the way the browser does (length-prefixed JSON over stdin/stdout)
// and saves a short public YouTube video, its sound and its subtitles.
//   node e2e/helper-test.mjs [path to gleaner-host.mjs]
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const host = process.argv[2] ?? path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', 'public', 'helper', 'gleaner-host.mjs');
const URL_ = process.env.YT_URL ?? 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // default: "Me at the zoo", 19 s
const p = spawn(process.execPath, [host], { stdio: ['pipe', 'pipe', 'inherit'] });
const waiting = new Map();
const progress = {};
let buf = Buffer.alloc(0);
p.stdout.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32LE(0)) {
    const msg = JSON.parse(buf.subarray(4, 4 + buf.readUInt32LE(0)).toString('utf8'));
    buf = buf.subarray(4 + buf.readUInt32LE(0));
    if (msg.type === 'progress') (progress[msg.id] ??= []).push(msg.pct ?? msg.stage);
    else waiting.get(msg.id)?.(msg);
  }
});
let n = 0;
const ask = (msg) =>
  new Promise((resolve) => {
    const id = `q${++n}`;
    waiting.set(id, resolve);
    const body = Buffer.from(JSON.stringify({ ...msg, id }));
    const head = Buffer.alloc(4);
    head.writeUInt32LE(body.length);
    p.stdin.write(Buffer.concat([head, body]));
  });
const probe = (f) => {
  const ffprobe = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'ffprobe.exe');
  const j = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,height:format=duration', '-of', 'json', f]).toString());
  return { streams: j.streams.map((s) => `${s.codec_type}:${s.codec_name}${s.height ? `:${s.height}p` : ''}`), seconds: Math.round(Number(j.format.duration)) };
};

const R = {};
R.hello = await ask({ type: 'hello' });
const info = await ask({ type: 'info', url: URL_ });
R.info = info.info ? { title: info.info.title, channel: info.info.channel, duration: info.info.duration, qualities: info.info.qualities.map((q) => `${q.height}p ${q.codec} ${q.bytes ? Math.round(q.bytes / 1e6) + ' MB' : '?'}`), subtitles: info.info.subtitles.map((s) => s.name).slice(0, 6) } : info;
if (process.argv.includes('--info-only')) {
  console.log(JSON.stringify(R.info, null, 2));
  p.stdin.end();
  process.exit(0);
}
const saved = [];
for (const choice of [{ kind: 'video', height: Number(process.env.YT_HEIGHT ?? 360) }, { kind: 'audio', format: 'mp3' }, info.info?.subtitles?.[0] && { kind: 'subtitles', lang: info.info.subtitles[0].lang, auto: info.info.subtitles[0].auto }].filter(Boolean)) {
  const t0 = Date.now();
  const r = await ask({ type: 'download', url: URL_, choice });
  saved.push({ choice: choice.kind, ok: r.type === 'done', file: r.file && path.basename(r.file), seconds: Math.round((Date.now() - t0) / 1000), error: r.message, probe: r.type === 'done' && choice.kind !== 'subtitles' ? probe(r.file) : r.type === 'done' ? fs.readFileSync(r.file, 'utf8').slice(0, 60) : undefined, progressUpdates: (progress[`q${n}`] ?? []).length });
  if (r.file && !process.argv.includes('--keep')) fs.rmSync(r.file, { force: true });
}
R.saved = saved;
R.bad = await ask({ type: 'info', url: 'file:///C:/Windows/win.ini' });
console.log(JSON.stringify(R, null, 2));
p.stdin.end();
