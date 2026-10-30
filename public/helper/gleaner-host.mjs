// Gleaner's YouTube helper. The browser starts it when the Video downloader asks (Chrome/Edge
// "native messaging"), and only Gleaner may talk to it. It runs yt-dlp (and ffmpeg, which yt-dlp
// uses to join picture and sound) and saves into your Downloads folder. It also runs Gleaner's
// Scrapling engine (scrapling_server.py: whole-site crawls and self-healing lists) in its own Python
// environment, %LOCALAPPDATA%\Gleaner\scrapling, and installs Scrapling there when asked.
// Messages are JSON with a 4-byte length in front, both ways.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Gleaner checks this and sends a newer helper when the extension has one. Keep in step with lib/video/youtube.ts. */
const HELPER_VERSION = 3;

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const config = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(here, 'config.json'), 'utf8'));
  } catch {
    return {};
  }
})();

// ---------- messages ----------
function send(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([head, body]));
}
let pending = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 4) {
    const len = pending.readUInt32LE(0);
    if (pending.length < 4 + len) break;
    const raw = pending.subarray(4, 4 + len).toString('utf8');
    pending = pending.subarray(4 + len);
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      continue;
    }
    handle(msg).catch((e) => send({ type: 'error', id: msg.id, message: String(e?.message ?? e) }));
  }
});
// The browser closes the pipe when the panel closes: stop any downloads with it
process.stdin.on('end', () => {
  for (const p of jobs.values()) p.kill();
  engine?.child.kill();
  process.exit(0);
});

// ---------- finding the tools ----------
function findTool(name) {
  if (config[name] && fs.existsSync(config[name])) return config[name];
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const dirs = [
    ...(process.env.PATH ?? '').split(path.delimiter),
    path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links'),
    path.join(os.homedir(), 'scoop', 'shims'),
    'C:\\ProgramData\\chocolatey\\bin',
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  for (const d of dirs) {
    const p = d && path.join(d, exe);
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}
const ytdlp = findTool('yt-dlp');
const ffmpeg = findTool('ffmpeg');
const downloads = config.downloads || path.join(os.homedir(), 'Downloads');

const version = (bin) => {
  if (!bin) return null;
  const r = spawnSync(bin, [bin.includes('ffmpeg') ? '-version' : '--version'], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  return (r.stdout || '').split(/\r?\n/)[0].replace(/^ffmpeg version (\S+).*/, '$1').trim() || null;
};

// ---------- Scrapling engine ----------
const gleanerDir = path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'Gleaner');
const venv = path.join(gleanerDir, 'scrapling');
const venvPython = process.platform === 'win32' ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python');
let engine = null; // { child, info }

/** A Python 3.10+ on this computer to make the environment with (not the Microsoft Store stub). */
function systemPython() {
  const tries = process.platform === 'win32' ? [['py', ['-3']], ['python', []], ['python3', []]] : [['python3', []], ['python', []]];
  for (const [cmd, pre] of tries) {
    const r = spawnSync(cmd, [...pre, '-c', 'import sys; print(sys.version_info >= (3, 10))'], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
    if (r.status === 0 && /True/.test(r.stdout)) return [cmd, pre];
  }
  return null;
}

function scraplingStatus() {
  if (!fs.existsSync(venvPython)) return { installed: false, python: !!systemPython() };
  const r = spawnSync(venvPython, ['-c', 'import scrapling, sys; from scrapling.spiders import Spider; print(scrapling.__version__, sys.version.split()[0])'], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  const [scrapling, python] = (r.stdout || '').trim().split(/\s+/);
  return r.status === 0 ? { installed: true, scrapling, python } : { installed: false, python: true, broken: (r.stderr || '').trim().split(/\r?\n/).pop() };
}

function step(cmd, args, onLine) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let err = '';
    const lines = (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => onLine?.(l.slice(0, 200)));
    p.stdout.on('data', lines);
    p.stderr.on('data', (d) => ((err += d), lines(d)));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split(/\r?\n/).pop() || `${cmd} stopped (code ${code})`))));
  });
}

/** Starts the engine (or returns the running one): the server prints its port and token first. */
function startEngine(source) {
  const file = path.join(here, 'scrapling_server.py');
  if (source && (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== source)) fs.writeFileSync(file, source, 'utf8');
  if (engine && engine.child.exitCode === null) return Promise.resolve(engine.info);
  if (!fs.existsSync(venvPython)) return Promise.reject(new Error('Scrapling is not installed yet.'));
  return new Promise((resolve, reject) => {
    const child = spawn(venvPython, [file, '--data-dir', path.join(gleanerDir, 'scrapling-data')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => (child.kill(), reject(new Error('The Scrapling engine did not start in time.'))), 60000);
    child.stdout.on('data', (d) => {
      out += d;
      const line = out.split(/\r?\n/)[0];
      if (out.includes('\n') && !engine) {
        clearTimeout(timer);
        try {
          engine = { child, info: JSON.parse(line) };
          resolve(engine.info);
        } catch {
          reject(new Error('The Scrapling engine gave an unexpected answer.'));
        }
      }
    });
    child.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
    child.on('error', (e) => (clearTimeout(timer), reject(e)));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (!engine) reject(new Error(err.trim().split(/\r?\n/).pop() || `The Scrapling engine stopped (code ${code}).`));
      engine = null;
    });
  });
}

// ---------- commands ----------
const jobs = new Map();
const isHttp = (u) => /^https?:\/\//i.test(String(u ?? ''));
const common = () => ['--no-playlist', '--no-warnings', '--ignore-config', ...(ffmpeg ? ['--ffmpeg-location', ffmpeg] : [])];

function run(args, onLine) {
  return new Promise((resolve, reject) => {
    const p = spawn(ytdlp, args, { windowsHide: true });
    let out = '';
    let err = '';
    let buf = '';
    p.stdout.on('data', (d) => {
      const s = d.toString('utf8');
      out += s;
      if (onLine) {
        buf += s;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        lines.forEach(onLine);
      }
    });
    p.stderr.on('data', (d) => (err += d.toString('utf8')));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(cleanError(err) || `yt-dlp stopped (code ${code})`))));
    run.last = p;
  });
}

function cleanError(err) {
  const line = err.split(/\r?\n/).filter((l) => /ERROR/.test(l)).pop() ?? err.trim().split(/\r?\n/).pop() ?? '';
  return line.replace(/^ERROR:\s*(\[\w+\]\s*[\w-]+:\s*)?/, '').trim();
}

/** What the panel needs to offer choices; the full yt-dlp answer is far too big to send. */
function summarize(j) {
  const formats = (j.formats ?? []).filter((f) => f.protocol !== 'mhtml');
  // Listed size, or bitrate (kbit/s) × length when the site doesn't list one
  const sizeOf = (f) => f.filesize ?? f.filesize_approx ?? (f.tbr && j.duration ? Math.round(f.tbr * 125 * j.duration) : 0);
  // Plain files (with a size) are what yt-dlp picks first; streamed copies of the same quality come second
  const plain = (f) => (/^https?$/.test(f.protocol ?? '') ? 0 : 1);
  const audio = formats.filter((f) => f.vcodec === 'none' && f.acodec && f.acodec !== 'none');
  const bestAudio = audio.sort((a, b) => plain(a) - plain(b) || /mp4a/.test(b.acodec) - /mp4a/.test(a.acodec) || (b.abr ?? 0) - (a.abr ?? 0))[0];
  const audioBytes = bestAudio ? sizeOf(bestAudio) : 0;
  const byHeight = new Map();
  // Per height, the one the download will use: H.264 if there is one (plays everywhere), plain file first
  const rank = (x) => (/^avc1/.test(x.vcodec ?? '') ? 0 : 2) + plain(x);
  for (const f of formats) {
    if (!f.height || f.vcodec === 'none') continue;
    const cur = byHeight.get(f.height);
    if (!cur || rank(f) < rank(cur)) byHeight.set(f.height, f);
  }
  const qualities = [...byHeight.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([height, f]) => {
      const v = sizeOf(f);
      return { height, fps: f.fps ?? null, codec: (f.vcodec ?? '').split('.')[0], bytes: v ? v + (f.acodec === 'none' ? audioBytes : 0) : null };
    });
  // Sites without a picture size listed: one "best available" choice
  if (!qualities.length && formats.some((f) => f.vcodec !== 'none')) qualities.push({ height: 0, fps: null, codec: '', bytes: null });

  // Subtitles: the video's own language first, then English, then the rest
  const own = (j.language ?? '').split('-')[0];
  const order = (lang) => (own && lang.split('-')[0] === own ? 0 : lang.split('-')[0] === 'en' ? 1 : 2);
  const subs = Object.entries(j.subtitles ?? {})
    .filter(([k]) => k !== 'live_chat')
    .map(([lang, l]) => ({ lang, name: l?.[0]?.name ?? lang, auto: false }))
    .sort((a, b) => order(a.lang) - order(b.lang));
  // Automatic captions come in every language YouTube can translate to; offer the useful few
  const COMMON = ['en', 'ko', 'ja', 'zh-Hans', 'zh-Hant', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'hi', 'id', 'vi', 'th', 'tr', 'it', 'fil', 'tl'];
  const auto = Object.entries(j.automatic_captions ?? {})
    .filter(([lang]) => (own && lang.split('-')[0] === own) || /-orig$/.test(lang) || COMMON.includes(lang))
    .filter(([lang]) => !subs.some((s) => s.lang === lang))
    .map(([lang, l]) => ({ lang, name: `${(l?.[0]?.name ?? lang).replace(/\s*\(Original\)$/i, '')} (auto${/-orig$/.test(lang) || lang.split('-')[0] === own ? ', original language' : ''})`, auto: true }))
    .sort((a, b) => /-orig$/.test(b.lang) - /-orig$/.test(a.lang) || order(a.lang) - order(b.lang) || COMMON.indexOf(a.lang) - COMMON.indexOf(b.lang))
    .slice(0, 12);
  return {
    id: j.id,
    title: j.title,
    channel: j.channel ?? j.uploader ?? '',
    duration: j.duration ?? null,
    thumbnail: j.thumbnail ?? '',
    live: j.is_live === true,
    url: j.webpage_url ?? '',
    qualities,
    audioBytes: audioBytes || null,
    subtitles: [...subs, ...auto],
  };
}

function formatFor(choice) {
  if (choice.kind === 'audio') return ['-f', 'ba/b', '-x', '--audio-format', choice.format === 'mp3' ? 'mp3' : 'm4a', ...(choice.format === 'mp3' ? ['--audio-quality', '0'] : [])];
  if (choice.kind === 'subtitles') return ['--skip-download', '--write-subs', ...(choice.auto ? ['--write-auto-subs'] : []), '--sub-langs', String(choice.lang).replace(/[^\w-]/g, ''), '--convert-subs', 'srt'];
  // No height: a site that doesn't list picture sizes, so take the best there is
  if (!Number(choice.height)) return ffmpeg ? ['-f', 'bv*+ba/b', '-S', 'vcodec:h264,acodec:aac', '--merge-output-format', 'mp4'] : ['-f', 'b'];
  const h = Math.max(144, Math.min(4320, Number(choice.height)));
  // Up to that height, preferring H.264 + AAC (plays everywhere) over VP9/AV1 + Opus. Without
  // ffmpeg, only files that already hold picture and sound can be saved (YouTube: 360p at most).
  return ffmpeg
    ? ['-f', 'bv*+ba/b', '-S', `res:${h},vcodec:h264,acodec:aac`, '--merge-output-format', 'mp4']
    : ['-f', 'b', '-S', `res:${h},vcodec:h264`];
}

async function handle(msg) {
  if (msg.type === 'hello') {
    return send({ type: 'hello', id: msg.id, version: HELPER_VERSION, ytdlp: version(ytdlp), ffmpeg: version(ffmpeg), downloads, node: process.version });
  }
  // A newer helper from the extension (only Gleaner can talk to this program): replace this file,
  // then exit so the browser starts the new one next time
  if (msg.type === 'update') {
    const src = String(msg.source ?? '');
    const v = Number(/const HELPER_VERSION = (\d+);/.exec(src)?.[1]);
    if (!src.startsWith("// Gleaner's YouTube helper.") || !(v > HELPER_VERSION)) throw new Error('Not a newer Gleaner helper');
    const self = path.join(here, 'gleaner-host.mjs');
    fs.writeFileSync(`${self}.new`, src, 'utf8');
    fs.renameSync(`${self}.new`, self);
    send({ type: 'updated', id: msg.id, version: v });
    setTimeout(() => process.exit(0), 200);
    return;
  }
  // Scrapling engine
  if (msg.type === 'scrapling-status') return send({ type: 'scrapling-status', id: msg.id, ...scraplingStatus() });
  if (msg.type === 'scrapling-start') return send({ type: 'scrapling-started', id: msg.id, ...(await startEngine(String(msg.source ?? ''))) });
  if (msg.type === 'scrapling-install') {
    const py = systemPython();
    if (!py) throw new Error('Python 3.10 or newer is needed first. In PowerShell run: winget install Python.Python.3.12  then try again.');
    const progress = (stage) => (line) => send({ type: 'progress', id: msg.id, stage, line });
    if (!fs.existsSync(venvPython)) await step(py[0], [...py[1], '-m', 'venv', venv], progress('Making a Python environment for Scrapling'));
    await step(venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '--upgrade', 'pip'], progress('Updating pip'));
    await step(venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '--upgrade', 'scrapling[fetchers]'], progress('Installing Scrapling'));
    return send({ type: 'scrapling-installed', id: msg.id, ...scraplingStatus() });
  }
  if (!ytdlp) throw new Error('yt-dlp is not installed. In PowerShell run: winget install yt-dlp.yt-dlp');
  if (msg.type === 'info') {
    if (!isHttp(msg.url)) throw new Error('Not a web address');
    const out = await run(['-J', ...common(), msg.url]);
    return send({ type: 'info', id: msg.id, info: summarize(JSON.parse(out)) });
  }
  if (msg.type === 'download') {
    if (!isHttp(msg.url)) throw new Error('Not a web address');
    const args = [
      ...common(),
      '--newline',
      '--progress',
      '--progress-template',
      'download:GLP|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s',
      '--print',
      'after_move:GLPFILE|%(filepath)s',
      '--no-simulate',
      '-P',
      downloads,
      '-o',
      '%(title).150B [%(id)s].%(ext)s',
      ...formatFor(msg.choice ?? {}),
      msg.url,
    ];
    let part = 0;
    let lastPct = -1;
    let file = '';
    const p = run(args, (line) => {
      if (line.startsWith('GLPFILE|')) file = line.slice(8).trim();
      else if (line.startsWith('GLP|')) {
        const [, status, done, total, estimate, speed, eta] = line.split('|');
        const t = Number(total) || Number(estimate) || 0;
        const pct = t ? Math.min(100, Math.round((Number(done) / t) * 100)) : null;
        if (status === 'finished') part++;
        if (pct !== lastPct || status === 'finished') {
          lastPct = pct;
          send({ type: 'progress', id: msg.id, part, pct, bytes: Number(done) || 0, total: t || null, speed: Number(speed) || null, eta: Number(eta) || null });
        }
      } else if (/^\[(Merger|ExtractAudio|FFmpeg\w*|SubtitlesConvertor)\]/.test(line)) send({ type: 'progress', id: msg.id, stage: line.startsWith('[Merger]') ? 'joining picture and sound' : 'converting' });
    });
    jobs.set(msg.id, run.last);
    try {
      await p;
      // Subtitles don't pass through "after_move"; find the file yt-dlp wrote
      if (!file && msg.choice?.kind === 'subtitles') {
        const recent = fs.readdirSync(downloads).filter((n) => /\.(srt|vtt)$/i.test(n)).map((n) => ({ n, t: fs.statSync(path.join(downloads, n)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
        if (recent && Date.now() - recent.t < 120000) file = path.join(downloads, recent.n);
      }
      if (!file) throw new Error('yt-dlp finished without saving a file (YouTube may have offered no matching format).');
      send({ type: 'done', id: msg.id, file, bytes: fs.existsSync(file) ? fs.statSync(file).size : null });
    } finally {
      jobs.delete(msg.id);
    }
    return;
  }
  if (msg.type === 'cancel') {
    jobs.get(msg.jobId)?.kill();
    return send({ type: 'cancelled', id: msg.id, jobId: msg.jobId });
  }
  if (msg.type === 'reveal') {
    const f = String(msg.file ?? '');
    if (!f.startsWith(downloads) || !fs.existsSync(f)) throw new Error('File not found');
    // Explorer wants the quotes around the path only, not around the whole "/select,..." argument
    if (process.platform === 'win32') spawn('explorer.exe', [`/select,"${f}"`], { detached: true, windowsVerbatimArguments: true }).unref();
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [path.dirname(f)], { detached: true });
    return send({ type: 'revealed', id: msg.id });
  }
  throw new Error(`Unknown request: ${msg.type}`);
}
