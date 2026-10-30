// YouTube, through yt-dlp on this computer. YouTube changes how its video addresses are scrambled
// every few weeks; yt-dlp keeps up with that, so Gleaner hands YouTube videos to it through a
// small local helper (public/helper) instead of reimplementing it. The browser starts the helper
// when asked ("native messaging"), and only Gleaner may talk to it.
import { browser } from 'wxt/browser';

export const HELPER = 'com.gleaner.ytdlp';
/** The helper this build ships (public/helper/gleaner-host.mjs); older installed ones are replaced. */
export const HELPER_VERSION = 3;

/** The single video a YouTube address points at, as a plain watch address; null for home, channel or search pages. */
export function youtubeVideoUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = '';
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v') ?? '';
    else id = /^\/(?:shorts|embed|live|v)\/([\w-]{11})/.exec(u.pathname)?.[1] ?? '';
  }
  return /^[\w-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}

export function isYouTube(raw: string): boolean {
  try {
    return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(new URL(raw).hostname);
  } catch {
    return false;
  }
}

export interface YtQuality {
  height: number;
  fps: number | null;
  codec: string;
  bytes: number | null;
}
export interface YtInfo {
  id: string;
  title: string;
  channel: string;
  duration: number | null;
  thumbnail: string;
  live: boolean;
  url: string;
  qualities: YtQuality[];
  audioBytes: number | null;
  subtitles: { lang: string; name: string; auto: boolean }[];
}
export interface YtHello {
  version?: number;
  ytdlp: string | null;
  ffmpeg: string | null;
  downloads: string;
  node: string;
}
export type YtChoice = { kind: 'video'; height: number } | { kind: 'audio'; format: 'mp3' | 'm4a' } | { kind: 'subtitles'; lang: string; auto: boolean };
export interface YtProgress {
  pct: number | null;
  bytes?: number;
  total?: number | null;
  speed?: number | null;
  eta?: number | null;
  part?: number;
  stage?: string;
}

/** Why the helper can't be reached, so the panel can show the right next step. */
export class HelperError extends Error {
  constructor(
    public reason: 'missing' | 'forbidden' | 'stopped' | 'outdated',
    message: string,
  ) {
    super(message);
  }
}

let port: Browser.runtime.Port | null = null;
const waiting = new Map<string, { resolve: (m: any) => void; reject: (e: Error) => void; onProgress?: (p: YtProgress) => void }>();
let seq = 0;

function connect(): Browser.runtime.Port {
  if (port) return port;
  const p = browser.runtime.connectNative(HELPER);
  p.onMessage.addListener((m: any) => {
    const w = waiting.get(m.id);
    if (!w) return;
    if (m.type === 'progress') return w.onProgress?.(m);
    waiting.delete(m.id);
    if (m.type === 'error') w.reject(new Error(m.message));
    else w.resolve(m);
  });
  p.onDisconnect.addListener(() => {
    const msg = browser.runtime.lastError?.message ?? 'The YouTube helper stopped.';
    const reason = /not found/i.test(msg) ? 'missing' : /forbidden/i.test(msg) ? 'forbidden' : 'stopped';
    for (const w of waiting.values()) w.reject(new HelperError(reason, msg));
    waiting.clear();
    port = null;
  });
  port = p;
  return p;
}

function ask<T>(msg: Record<string, unknown>, onProgress?: (p: YtProgress) => void): { id: string; done: Promise<T> } {
  const id = `y${++seq}`;
  const done = new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve, reject, onProgress });
    try {
      connect().postMessage({ ...msg, id });
    } catch (e) {
      waiting.delete(id);
      reject(new HelperError('missing', String((e as Error)?.message ?? e)));
    }
  });
  return { id, done };
}

/** Any request to the helper (also used for the Scrapling engine's status and install). */
export const askHelper = ask;

/** Connects, and replaces an older installed helper with the one in this build (no reinstall needed). */
export async function helperHello(): Promise<YtHello> {
  const h = await ask<YtHello>({ type: 'hello' }).done;
  if ((h.version ?? 1) >= HELPER_VERSION) return h;
  const source = await fetch(browser.runtime.getURL('/helper/gleaner-host.mjs' as any)).then((r) => r.text());
  // A helper from before updates existed answers "Unknown request"; it needs install.cmd once
  await ask({ type: 'update', source }).done.catch((e) => {
    throw new HelperError('outdated', String((e as Error)?.message ?? e));
  });
  // It exits after updating; the next message starts the new one
  await new Promise((r) => setTimeout(r, 600));
  return ask<YtHello>({ type: 'hello' }).done;
}
export const videoInfo = (url: string) => ask<{ info: YtInfo }>({ type: 'info', url }).done.then((r) => r.info);
export const revealFile = (file: string) => ask({ type: 'reveal', file }).done;

/** Starts a download; `cancel` stops it and yt-dlp leaves no finished file. */
export function downloadVideo(url: string, choice: YtChoice, onProgress: (p: YtProgress) => void) {
  const job = ask<{ file: string; bytes: number | null }>({ type: 'download', url, choice }, onProgress);
  return { done: job.done, cancel: () => void ask({ type: 'cancel', jobId: job.id }).done.catch(() => {}) };
}

/** yt-dlp's errors, in words that say what to do. */
export function explainYtError(message: string): string {
  if (/DRM/i.test(message)) return 'This video is protected with DRM (copy protection), so it can only be played on YouTube.';
  if (/Private video|members-only|Join this channel/i.test(message)) return 'This video is private or for channel members only.';
  if (/confirm your age|age-restricted|Sign in to confirm your age/i.test(message)) return 'YouTube requires signing in to watch this video (age-restricted), which the helper does not do.';
  if (/not a bot|Sign in to confirm/i.test(message)) return 'YouTube is asking to confirm you are not a bot. Wait a while and try again, or update yt-dlp (winget upgrade yt-dlp.yt-dlp).';
  if (/logged-in|--cookies|login required|log in to/i.test(message)) return 'This site only shows the video to signed-in visitors, and the helper does not sign in. Open the page in a tab while signed in, play it, and use "This page" instead.';
  if (/Unsupported URL/i.test(message)) return "yt-dlp doesn't know this site. Open the page in a tab, play the video, and use \"This page\" instead.";
  if (/Video unavailable|removed|terminated/i.test(message)) return 'The site says this video is unavailable.';
  if (/Requested format is not available|HTTP Error 403|Unable to extract|nsig|signature/i.test(message)) return `YouTube changed something yt-dlp doesn't know yet. Update it in PowerShell with: winget upgrade yt-dlp.yt-dlp  (${message})`;
  return message;
}
