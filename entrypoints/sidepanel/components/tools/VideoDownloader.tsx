// Video downloader: finds the videos a page shows or streams and saves them as files. Streams
// (HLS and DASH) are saved at the quality you pick, with picture and sound joined into one MP4;
// live HLS broadcasts can be recorded. YouTube, DRM-protected and encrypted videos are refused.
import { logEvent } from '@/lib/report';
import { ReportProblem } from '../ReportProblem';
import { useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { ArrowClockwise, FilmStrip, MusicNotes, Record, Subtitles, VideoCamera, X, YoutubeLogo } from '@phosphor-icons/react';
import { activeTab, call, isRestricted, requestHostAccess } from '@/lib/tab';
import { classify, mergeFound, type FoundMedia } from '@/lib/video/detect';
import { estimateBytes, isBlockedHost, isMasterPlaylist, parseHlsMaster, parseMpd, Refusal, resolveHls, type Resolved, type Track } from '@/lib/video/manifest';
import { saveRendition, saveSubtitles, saveTrack, type SaveProgress } from '@/lib/video/save';
import { isYouTube, youtubeVideoUrl } from '@/lib/video/youtube';
import { Button, Notice, Section, Segmented, inputCls } from '../ui';
import { YouTubeSave } from './YouTubeSave';
import { errorText } from './common';

const mb = (n?: number) => (!n ? '' : n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB`);
const time = (s?: number) => (!s ? '' : s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const KIND_LABEL: Record<FoundMedia['kind'], string> = { hls: 'Stream (HLS)', dash: 'Stream (DASH)', file: 'Video file', audio: 'Audio file', subtitles: 'Subtitles', youtube: 'YouTube video' };
const KIND_ICON = { hls: FilmStrip, dash: FilmStrip, file: VideoCamera, audio: MusicNotes, subtitles: Subtitles, youtube: YoutubeLogo };

function safeName(s: string) {
  return (s || 'video').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'video';
}

function fileName(url: string) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
  } catch {
    return '';
  }
}

async function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  try {
    await browser.downloads.download({ url, filename: name, conflictAction: 'uniquify' });
  } finally {
    // The download keeps reading the file for a moment after it starts
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }
}

const getText = (u: string) =>
  fetch(u, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`The site answered HTTP ${r.status}. Reload the page, play the video, and try again.`);
    return r.text();
  });

type Job = { id: string; label: string; progress?: SaveProgress; live?: boolean; stop: () => void; cancel: () => void };

function Progress({ job }: { job: Job }) {
  const p = job.progress;
  const pct = p && p.total && !job.live ? Math.min(100, Math.round((p.done / p.total) * 100)) : null;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-2.5" aria-live="polite">
      <div className="flex items-center justify-between gap-2 text-[12.5px]">
        <span className="min-w-0 truncate">
          {job.live ? 'Recording' : 'Saving'} {job.label}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-muted tabular-nums">
          {mb(p?.bytes) || '…'}
          {pct !== null && ` · ${pct}%`}
          {job.live && p?.recorded ? ` · ${time(p.recorded)}` : ''}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={`Saving ${job.label}`} aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full bg-accent transition-[width] ${pct === null ? 'w-1/3 animate-pulse' : ''}`} style={pct !== null ? { width: `${pct}%` } : undefined} />
      </div>
      <div className="flex gap-1.5">
        {job.live && (
          <Button variant="primary" onClick={job.stop}>
            Stop and save
          </Button>
        )}
        <Button variant="ghost" onClick={job.cancel}>
          <X size={14} aria-hidden /> Cancel
        </Button>
      </div>
    </div>
  );
}

function StreamOptions({ media, title, onSave }: { media: FoundMedia; title: string; onSave: (label: string, live: boolean, run: (o: { signal: AbortSignal; shouldStop: () => boolean; onProgress: (p: SaveProgress) => void }) => Promise<{ blob: Blob; name: string }>) => void }) {
  const [res, setRes] = useState<Resolved | null>(null);
  const [error, setError] = useState('');
  const [pick, setPick] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => (media.kind === 'hls' ? resolveHls(media.url, getText) : parseMpd(await getText(media.url), media.url)))().then(
      (r) => alive && (r.renditions.length || r.audioOnly.length ? setRes(r) : setError('This stream lists no video to save.')),
      (e) => alive && setError(e instanceof Refusal ? e.message : `Couldn't read this stream: ${errorText(e)}`),
    );
    return () => {
      alive = false;
    };
  }, [media.url, media.kind]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!res) return <div className="h-16 animate-pulse rounded-lg bg-surface-2" aria-label="Reading the stream" />;
  const r = res.renditions[pick];
  const name = safeName(title);
  const saveTrackAs = (t: Track, what: string, ext: string) =>
    onSave(`${what} ${t.label}`, !!t.live, async (o) => ({ blob: t.kind === 'text' ? await saveSubtitles(t, o) : await saveTrack(t, o), name: `${name} (${what.toLowerCase()} ${safeName(t.label)}).${ext}` }));
  return (
    <div className="flex flex-col gap-2.5">
      {res.live && <Notice>This is a live broadcast. Recording starts from now and keeps going until you press "Stop and save".</Notice>}
      {res.renditions.length > 0 && (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-[12px] font-medium">Quality</legend>
          {res.renditions.map((x, i) => (
            <label key={i} className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-[12.5px] ${i === pick ? 'border-accent bg-accent-soft' : 'border-line hover:border-muted/60'}`}>
              <span className="flex items-center gap-2">
                <input type="radio" name={`q-${media.url}`} checked={i === pick} onChange={() => setPick(i)} className="accent-[var(--accent)]" />
                {x.label}
                {x.video.width && x.video.height ? <span className="text-muted">{x.video.width}×{x.video.height}</span> : null}
              </span>
              <span className="font-mono text-[11px] text-muted tabular-nums">{res.live ? 'live' : estimateBytes(x, res.duration) ? `≈ ${mb(estimateBytes(x, res.duration))}` : ''}</span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex flex-wrap gap-1.5">
        {r && (
          <Button variant="primary" onClick={() => onSave(r.label, res.live, async (o) => ({ blob: await saveRendition(r, o), name: `${name} (${safeName(r.label)}).mp4` }))}>
            {res.live ? <Record size={15} aria-hidden /> : <VideoCamera size={15} aria-hidden />} {res.live ? `Record ${r.label}` : `Save ${r.label} video`}
          </Button>
        )}
        {res.audioOnly.slice(0, 3).map((a, i) => (
          <Button key={`a${i}`} onClick={() => saveTrackAs(a, 'Audio', 'm4a')}>
            <MusicNotes size={15} aria-hidden /> Audio only{res.audioOnly.length > 1 ? ` (${a.label})` : ''}
          </Button>
        ))}
        {res.subtitles.slice(0, 4).map((s, i) => (
          <Button key={`s${i}`} onClick={() => saveTrackAs(s, 'Subtitles', 'vtt')}>
            <Subtitles size={15} aria-hidden /> {s.label}
          </Button>
        ))}
      </div>
      {res.duration ? <p className="text-[12px] text-muted">Length {time(res.duration)}. Picture and sound are saved together as one MP4.</p> : null}
    </div>
  );
}

export function VideoDownloader() {
  const [tab, setTab] = useState<{ id: number; url: string } | null>(null);
  const [found, setFound] = useState<FoundMedia[] | null>(null);
  const [streamed, setStreamed] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  useEffect(() => void (error && logEvent('video', error)), [error]);
  const [open, setOpen] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [mode, setMode] = useState<'page' | 'link'>('page');
  const [linkText, setLinkText] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // On YouTube itself the page isn't scanned: yt-dlp saves the video (see YouTubeSave)
  const blocked = tab ? isYouTube(tab.url) : false;
  // For each HLS playlist seen: the playlists it lists (when it's a main playlist), read once
  const hlsChildren = useRef(new Map<string, Promise<string[] | null>>());
  const childrenOf = (url: string) => {
    if (!hlsChildren.current.has(url)) {
      hlsChildren.current.set(
        url,
        getText(url)
          .then((t) => {
            if (!isMasterPlaylist(t)) return null;
            const m = parseHlsMaster(t, url);
            return [...m.variants.map((v) => v.url), ...m.media.map((x) => x.url ?? '')].filter(Boolean);
          })
          .catch(() => null),
      );
    }
    return hlsChildren.current.get(url)!;
  };

  async function scan(t = tab) {
    if (!t) return;
    const [page, net] = await Promise.all([
      call<{ found: FoundMedia[]; streamed: boolean; title: string }>(t.id, 'videos').catch(() => ({ found: [], streamed: false, title: '' })),
      browser.runtime.sendMessage({ type: 'videos:list', tabId: t.id }).then((r: any) => (r?.list ?? []) as FoundMedia[]).catch(() => []),
    ]);
    let list: FoundMedia[] = [];
    // googlevideo.com pieces are YouTube's stream; embedded YouTube players are listed as 'youtube' instead
    for (const m of [...page.found, ...net]) if ((m.kind === 'youtube' || !isBlockedHost(m.url)) && !m.url.startsWith('blob:')) list = mergeFound(list, m);
    // A player also fetches each quality's own playlist: list the video once, by its main playlist
    const hls = list.filter((m) => m.kind === 'hls');
    const kids = await Promise.all(hls.map((m) => childrenOf(m.url)));
    const masters = new Set(hls.filter((_, i) => kids[i]).map((m) => m.url));
    const covered = new Set(kids.flat().filter(Boolean) as string[]);
    list = list.filter((m) => !(m.kind === 'hls' && covered.has(m.url) && !masters.has(m.url)));
    // Streams first (main playlists before single ones), then files; newest first within each
    const rank = (m: FoundMedia) => (m.kind === 'hls' ? (masters.has(m.url) ? 0 : 1) : m.kind === 'dash' || m.kind === 'youtube' ? 0 : m.kind === 'file' ? 2 : m.kind === 'audio' ? 3 : 4);
    list.sort((a, b) => rank(a) - rank(b) || (b.at ?? 0) - (a.at ?? 0));
    setFound(list);
    setStreamed(page.streamed);
    setTitle(page.title);
  }

  /** `quiet`: following a tab switch, so a browser page (new tab, settings) just keeps the list. */
  async function start(quiet = false) {
    if (!quiet) setError('');
    if (!(await requestHostAccess())) return setError('Gleaner needs access to sites to see their videos. Click again and choose Allow.');
    const t = await activeTab();
    if (isRestricted(t.url)) return quiet ? undefined : setError('Open a page with a video first.');
    setError('');
    const cur = { id: t.id!, url: t.url ?? '' };
    setTab(cur);
    if (isYouTube(cur.url)) return;
    await scan(cur);
  }

  // Streams appear as the page plays; keep the list fresh while the tool is open
  useEffect(() => {
    if (!tab || blocked) return;
    timer.current = setInterval(() => void scan(), 2500);
    return () => clearInterval(timer.current);
  }, [tab, blocked]);

  // Follow the browser when another tab is chosen, or when the page changes address without
  // reloading (YouTube does this when you click another video)
  useEffect(() => {
    const onActivated = () => tab && void start(true);
    const onUpdated = (id: number, info: { url?: string }) => tab && id === tab.id && info.url && info.url !== tab.url && void start(true);
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [tab]);

  const runSave = (label: string, live: boolean, run: Parameters<React.ComponentProps<typeof StreamOptions>['onSave']>[2]) => {
    const id = `${Date.now()}-${Math.random()}`;
    const ac = new AbortController();
    let stopping = false;
    const update = (patch: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));
    setJobs((js) => [...js, { id, label, live, stop: () => (stopping = true), cancel: () => ac.abort() }]);
    run({ signal: ac.signal, shouldStop: () => stopping, onProgress: (progress) => update({ progress }) })
      .then(async ({ blob, name }) => {
        await saveBlob(blob, name);
        setSaved((s) => [`${name} (${mb(blob.size)})`, ...s].slice(0, 8));
      })
      .catch((e) => {
        if ((e as any)?.name !== 'AbortError') setError(e instanceof Refusal ? e.message : `${label}: ${errorText(e)}`);
      })
      .finally(() => setJobs((js) => js.filter((j) => j.id !== id)));
  };

  const saveDirect = async (m: FoundMedia) => {
    const ext = fileName(m.url).match(/\.(\w{2,5})$/)?.[1] ?? (m.kind === 'audio' ? 'mp3' : m.kind === 'subtitles' ? 'vtt' : 'mp4');
    const name = `${safeName(m.kind === 'subtitles' ? `${title} ${m.title ?? ''}` : title || fileName(m.url))}.${ext}`;
    try {
      const id = await browser.downloads.download({ url: m.url, filename: name, conflictAction: 'uniquify' });
      // Only "Saved" once the file is complete, and not when the site sent a web page instead
      // (an expired or blocked link answers with an HTML error page)
      const item = await new Promise<Browser.downloads.DownloadItem | undefined>((resolve) => {
        const check = async () => {
          const [d] = await browser.downloads.search({ id });
          if (!d || d.state !== 'in_progress') {
            browser.downloads.onChanged.removeListener(onChange);
            resolve(d);
          }
        };
        const onChange = (delta: Browser.downloads.DownloadDelta) => delta.id === id && delta.state && void check();
        browser.downloads.onChanged.addListener(onChange);
        void check();
      });
      if (!item || item.state === 'interrupted') throw new Error(item?.error ? `the download stopped (${item.error})` : 'the download stopped');
      if (/^text\/(html|plain)/i.test(item.mime ?? '') || (item.fileSize >= 0 && item.fileSize < 2048 && m.kind !== 'subtitles')) throw new Error('the site sent an error page instead of the file (the link may have expired). Play the video again and save it while it plays');
      setSaved((s) => [name, ...s].slice(0, 8));
    } catch (e) {
      setError(`Couldn't save ${name}: ${errorText(e)}`);
    }
  };

  /** A pasted link: YouTube and other video sites go to yt-dlp, stream and file addresses are read here. */
  const openLink = async (raw = linkText) => {
    setError('');
    let u = raw.trim();
    if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
    try {
      new URL(u);
    } catch {
      return setError('Paste a full web address, like https://vimeo.com/76979871');
    }
    if (!(await requestHostAccess())) return setError('Gleaner needs access to sites to read the video. Click again and choose Allow.');
    setLink(youtubeVideoUrl(u) ?? u);
  };
  const linkKind = link ? (youtubeVideoUrl(link) ? 'youtube' : classify(link)) : null;
  const linkHost = link ? new URL(link).hostname.replace(/^www\./, '') : '';
  const linkPane = (
    <div className="flex flex-col gap-3">
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void openLink();
        }}
      >
        <input aria-label="Video link" value={linkText} onChange={(e) => setLinkText(e.target.value)} placeholder="https://… (YouTube, Vimeo, X, TikTok, .mp4, .m3u8…)" className={`${inputCls} min-w-0 flex-1`} />
        <Button variant="primary" type="submit" disabled={!linkText.trim()}>
          Get video
        </Button>
      </form>
      {!link ? (
        <p className="text-[12px] leading-relaxed text-muted">
          A YouTube link, a page on one of 1,000+ video sites yt-dlp knows (Vimeo, X, TikTok, Instagram, Facebook, Reddit, Twitch clips, Dailymotion, Bilibili…), or a direct video, .m3u8 or .mpd address. Pages from other sites: open them and use "This page".
        </p>
      ) : linkKind === 'hls' || linkKind === 'dash' ? (
        <StreamOptions key={link} media={{ url: link, kind: linkKind, via: 'page' }} title={linkHost} onSave={runSave} />
      ) : linkKind === 'file' || linkKind === 'audio' || linkKind === 'subtitles' ? (
        <Button onClick={() => void saveDirect({ url: link, kind: linkKind, via: 'page' })} className="self-start">
          Save {linkKind === 'audio' ? 'audio' : linkKind === 'subtitles' ? 'subtitles' : 'video'} ({fileName(link) || linkHost})
        </Button>
      ) : (
        <YouTubeSave key={link} url={link} />
      )}
    </div>
  );

  const streams = useMemo(() => (found ?? []).filter((m) => m.kind === 'hls' || m.kind === 'dash').length, [found]);

  return (
    <div className="flex flex-1 flex-col gap-5">
      <Segmented
        label="Where the video is"
        value={mode}
        onChange={(m) => {
          setMode(m);
          setError('');
        }}
        options={[
          { value: 'page', label: 'This page' },
          { value: 'link', label: 'Paste a link' },
        ]}
      />
      <Section
        title={mode === 'link' ? 'Video from a link' : 'Videos on this page'}
        action={
          mode === 'page' && tab && !blocked ? (
            <Button variant="ghost" onClick={() => void start()} aria-label="Look again">
              <ArrowClockwise size={15} aria-hidden /> Look again
            </Button>
          ) : null
        }
      >
        {mode === 'link' ? (
          linkPane
        ) : !tab ? (
          <>
            <p className="text-[12.5px] leading-relaxed text-muted">
              Saves the videos a page plays: plain video files, and streamed videos (HLS and DASH) at the quality you choose, with picture and sound in one MP4. Also audio only, subtitles, and live broadcasts.
            </p>
            <p className="text-[12px] leading-relaxed text-muted">YouTube is saved through yt-dlp on this computer (a one-time setup). Not saved: videos with DRM or encryption (Netflix, Disney+, paid courses and the like). Save only videos you have the right to keep.</p>
            <Button variant="primary" onClick={() => void start()} className="self-start">
              <VideoCamera size={15} aria-hidden /> Find videos on this page
            </Button>
          </>
        ) : blocked ? (
          youtubeVideoUrl(tab.url) ? (
            <YouTubeSave key={youtubeVideoUrl(tab.url)!} url={youtubeVideoUrl(tab.url)!} />
          ) : (
            <Notice>Open a YouTube video or Short, and its download options appear here.</Notice>
          )
        ) : found === null ? (
          <div className="h-20 animate-pulse rounded-lg bg-surface-2" />
        ) : (
          <>
            {!found.length && (
              <Notice>{streamed ? 'This page streams its video. Play it for a few seconds and it will show up here.' : 'No videos yet. Play the video on the page (or reload the page and play it), and it will show up here.'}</Notice>
            )}
            {found.length > 0 && streams === 0 && streamed && <Notice>The page is also streaming a video. Play it for a moment to list it here.</Notice>}
            <ul className="flex flex-col gap-2">
              {found.map((m) => {
                const Icon = KIND_ICON[m.kind];
                const isStream = m.kind === 'hls' || m.kind === 'dash';
                const name = fileName(m.url);
                return (
                  <li key={m.url} className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-3">
                    <div className="flex items-start gap-2.5">
                      {m.poster ? (
                        <img src={m.poster} alt="" className="h-12 w-20 shrink-0 rounded-md object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-text" aria-hidden>
                          <Icon size={20} />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium" title={m.title || title}>
                          {m.kind === 'subtitles' ? m.title : m.title || title || name}
                        </p>
                        <p className="truncate font-mono text-[11px] text-muted" title={m.url}>
                          {new URL(m.url).hostname.replace(/^www\./, '')}/{name.slice(0, 48)}
                        </p>
                        <p className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted">
                          <span className="rounded bg-surface-2 px-1.5 py-0.5">{KIND_LABEL[m.kind]}</span>
                          {m.bytes ? <span className="rounded bg-surface-2 px-1.5 py-0.5 tabular-nums">{mb(m.bytes)}</span> : null}
                          {m.height ? <span className="rounded bg-surface-2 px-1.5 py-0.5">{m.height}p</span> : null}
                          {m.duration ? <span className="rounded bg-surface-2 px-1.5 py-0.5 tabular-nums">{time(m.duration)}</span> : null}
                        </p>
                      </div>
                    </div>
                    {m.kind === 'youtube' ? (
                      open === m.url ? (
                        <YouTubeSave url={m.url} />
                      ) : (
                        <Button onClick={() => setOpen(m.url)} className="self-start">
                          Choose quality
                        </Button>
                      )
                    ) : isStream ? (
                      open === m.url ? (
                        <StreamOptions media={m} title={m.title || title} onSave={runSave} />
                      ) : (
                        <Button onClick={() => setOpen(m.url)} className="self-start">
                          Choose quality
                        </Button>
                      )
                    ) : (
                      <Button onClick={() => void saveDirect(m)} className="self-start">
                        Save {m.kind === 'subtitles' ? 'subtitles' : m.kind === 'audio' ? 'audio' : 'video'}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
            {/* Players that hide their video from the page are often still on yt-dlp's list */}
            <Button
              variant="ghost"
              className="self-start"
              onClick={() => {
                setMode('link');
                setLinkText(tab.url);
                setLink(tab.url);
              }}
            >
              Not listed, or no sound? Try this page with yt-dlp
            </Button>
          </>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        {error && <ReportProblem tool="video" run={{ error }} />}
      </Section>
      {(jobs.length > 0 || saved.length > 0) && (
        <Section title="Downloads">
          {jobs.map((j) => (
            <Progress key={j.id} job={j} />
          ))}
          {jobs.length > 0 && <p className="text-[12px] text-muted">Keep this panel open until the file is saved.</p>}
          {saved.length > 0 && (
            <ul className="flex flex-col gap-1 text-[12.5px]" aria-label="Saved files">
              {saved.map((s, i) => (
                <li key={i} className="truncate text-ok">
                  Saved {s}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </div>
  );
}
