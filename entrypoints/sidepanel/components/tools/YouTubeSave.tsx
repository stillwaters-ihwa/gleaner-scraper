// YouTube in the Video downloader: pick a quality, sound only or subtitles, and yt-dlp on this
// computer saves it into Downloads. First use walks through a one-time helper setup.
import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { ArrowClockwise, CheckCircle, Copy, FolderOpen, MusicNotes, Subtitles, VideoCamera, X } from '@phosphor-icons/react';
import { downloadVideo, explainYtError, helperHello, HelperError, revealFile, videoInfo, type YtChoice, type YtHello, type YtInfo, type YtProgress } from '@/lib/video/youtube';
import { Button, Notice } from '../ui';

const qualityName = (h: number) => (!h ? 'Best available' : h >= 2160 ? '4K' : h >= 1440 ? '1440p (2K)' : `${h}p`);
const mb = (n?: number | null) => (!n ? '' : n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB`);
const time = (s?: number | null) => (!s ? '' : s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

function CopyLine({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-line bg-bg py-1 pr-1 pl-2">
      <code className="min-w-0 flex-1 truncate font-mono text-[11.5px]" title={text}>
        {text}
      </code>
      <button
        type="button"
        aria-label={`Copy ${text}`}
        onClick={() => navigator.clipboard.writeText(text).then(() => (setDone(true), setTimeout(() => setDone(false), 1500)))}
        className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-ink"
      >
        {done ? <CheckCircle size={15} className="text-ok" /> : <Copy size={15} />}
      </button>
    </div>
  );
}

/** One-time setup: yt-dlp + ffmpeg, then the helper that lets Gleaner use them. */
function Setup({ reason, onRetry, checking }: { reason: HelperError['reason'] | 'no-ytdlp'; onRetry: () => void; checking: boolean }) {
  const id = browser.runtime.id;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3">
      <div>
        <h4 className="font-display text-[14px] font-semibold">Set up YouTube saving (once)</h4>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
          YouTube (and links from 1,000+ other video sites) are saved by <span className="text-ink">yt-dlp</span>, a free tool that runs on your computer and keeps up with the sites' changes. Gleaner talks to it through a small helper.
        </p>
      </div>
      {reason === 'forbidden' && (
        <Notice tone="error">The helper is installed, but not for this copy of Gleaner (it was probably loaded from another folder). Run step 2 again, or run install.cmd with the code below.</Notice>
      )}
      {reason === 'outdated' && <Notice tone="error">This copy of Gleaner has a newer helper. Run step 2 once more to install it; after that it updates itself.</Notice>}
      {reason === 'stopped' && <Notice tone="error">The helper started but stopped. Run step 2 again; if it keeps happening, check that Node.js is installed.</Notice>}
      <ol className="flex flex-col gap-3 text-[12.5px]">
        <li className="flex flex-col gap-1.5">
          <span>
            <span className="font-semibold">1.</span> In PowerShell, install yt-dlp and ffmpeg{reason === 'no-ytdlp' ? ' (yt-dlp is missing)' : ''}:
          </span>
          <CopyLine text="winget install yt-dlp.yt-dlp" />
          <CopyLine text="winget install Gyan.FFmpeg" />
          <span className="text-[12px] text-muted">ffmpeg joins YouTube's separate picture and sound, needed above 360p. Node.js is needed too (winget install OpenJS.NodeJS.LTS).</span>
        </li>
        <li className="flex flex-col gap-1.5">
          <span>
            <span className="font-semibold">2.</span> Open the folder you loaded Gleaner from, then its <code className="font-mono">helper</code> folder, and double-click <code className="font-mono">install.cmd</code>.
          </span>
          <span className="text-[12px] text-muted">It works out Gleaner's code by itself. If it ever asks, or this step doesn't take, run it in that folder with this code:</span>
          <CopyLine text={`install.cmd ${id}`} />
        </li>
        <li className="flex flex-col gap-1.5">
          <span>
            <span className="font-semibold">3.</span> Come back here:
          </span>
          <Button variant="primary" onClick={onRetry} disabled={checking} className="self-start">
            <ArrowClockwise size={15} aria-hidden /> {checking ? 'Checking…' : 'Check again'}
          </Button>
        </li>
      </ol>
    </div>
  );
}

type Job = { key: string; label: string; progress: YtProgress; cancel: () => void };

export function YouTubeSave({ url }: { url: string }) {
  const [hello, setHello] = useState<YtHello | null>(null);
  const [setup, setSetup] = useState<HelperError['reason'] | 'no-ytdlp' | null>(null);
  const [checking, setChecking] = useState(true);
  const [info, setInfo] = useState<YtInfo | null>(null);
  const [error, setError] = useState('');
  const [height, setHeight] = useState<number | null>(null);
  const [sub, setSub] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [saved, setSaved] = useState<{ file: string; bytes: number | null }[]>([]);

  const connect = useCallback(async () => {
    setChecking(true);
    setError('');
    try {
      const h = await helperHello();
      setHello(h);
      if (!h.ytdlp) {
        setSetup('no-ytdlp');
        return;
      }
      setSetup(null);
      setInfo(null);
      const i = await videoInfo(url);
      setInfo(i);
      // Default: 1080p or the best below it (bigger files take a while and few screens need more)
      setHeight((i.qualities.find((q) => q.height <= 1080) ?? i.qualities[0])?.height ?? null);
      setSub(i.subtitles[0] ? `${i.subtitles[0].lang}|${i.subtitles[0].auto ? 1 : 0}` : '');
    } catch (e) {
      if (e instanceof HelperError && e.reason !== 'stopped') setSetup(e.reason);
      else if (e instanceof HelperError) setSetup('stopped');
      else setError(explainYtError((e as Error).message));
    } finally {
      setChecking(false);
    }
  }, [url]);

  useEffect(() => {
    void connect();
  }, [connect]);

  const start = (label: string, choice: YtChoice) => {
    const key = `${Date.now()}-${Math.random()}`;
    let cancelled = false;
    const job = downloadVideo(url, choice, (progress) => setJobs((js) => js.map((j) => (j.key === key ? { ...j, progress: { ...j.progress, ...progress, pct: progress.pct ?? j.progress.pct } } : j))));
    setJobs((js) => [...js, { key, label, progress: { pct: 0 }, cancel: () => ((cancelled = true), job.cancel()) }]);
    job.done
      .then((r) => setSaved((s) => [r, ...s].slice(0, 8)))
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof HelperError) setSetup(e.reason);
        else setError(explainYtError(e.message));
      })
      .finally(() => setJobs((js) => js.filter((j) => j.key !== key)));
  };

  if (checking && !info && !setup) return <div className="h-24 animate-pulse rounded-xl bg-surface-2" aria-label="Connecting to yt-dlp" />;
  if (setup) return <Setup reason={setup} onRetry={() => void connect()} checking={checking} />;

  const q = info?.qualities.find((x) => x.height === height);
  const noFfmpeg = hello && !hello.ffmpeg;
  return (
    <div className="flex flex-col gap-3">
      {error && <Notice tone="error">{error}</Notice>}
      {info && (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3">
          <div className="flex items-start gap-2.5">
            {info.thumbnail && <img src={info.thumbnail} alt="" className="h-14 w-24 shrink-0 rounded-md object-cover" referrerPolicy="no-referrer" />}
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-[13px] leading-snug font-medium">{info.title}</p>
              <p className="mt-0.5 truncate text-[12px] text-muted">
                {info.channel}
                {info.duration ? ` · ${time(info.duration)}` : ''}
              </p>
            </div>
          </div>
          {info.live ? (
            <Notice>This is a live broadcast. It can be saved once the broadcast has ended.</Notice>
          ) : (
            <>
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-[12px] font-medium">Quality</legend>
                {info.qualities.map((x) => (
                  <label key={x.height} className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-[12.5px] ${x.height === height ? 'border-accent bg-accent-soft' : 'border-line hover:border-muted/60'}`}>
                    <span className="flex items-center gap-2">
                      <input type="radio" name="yt-quality" checked={x.height === height} onChange={() => setHeight(x.height)} className="accent-[var(--accent)]" />
                      {qualityName(x.height)}
                      {x.fps && x.fps > 30 ? <span className="text-muted">{x.fps} fps</span> : null}
                      {x.codec !== 'avc1' ? <span className="text-muted" title="Plays in browsers, VLC and modern players; some older apps can't play it">{x.codec === 'av01' ? 'AV1' : x.codec.toUpperCase()}</span> : null}
                    </span>
                    <span className="font-mono text-[11px] text-muted tabular-nums">{x.bytes ? `≈ ${mb(x.bytes)}` : ''}</span>
                  </label>
                ))}
              </fieldset>
              {noFfmpeg && <Notice>ffmpeg isn't installed, so only versions with picture and sound already together can be saved (usually 360p). Install it with: winget install Gyan.FFmpeg</Notice>}
              <div className="flex flex-wrap gap-1.5">
                <Button variant="primary" disabled={height === null} onClick={() => height !== null && start(height ? `${height}p video` : 'video', { kind: 'video', height })}>
                  <VideoCamera size={15} aria-hidden /> Save {height ? `${height}p ` : ''}video
                </Button>
                <Button onClick={() => start('MP3 audio', { kind: 'audio', format: 'mp3' })} disabled={!!noFfmpeg}>
                  <MusicNotes size={15} aria-hidden /> MP3
                </Button>
                <Button onClick={() => start('M4A audio', { kind: 'audio', format: 'm4a' })} disabled={!!noFfmpeg}>
                  <MusicNotes size={15} aria-hidden /> M4A
                </Button>
              </div>
              {info.subtitles.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <select aria-label="Subtitle language" value={sub} onChange={(e) => setSub(e.target.value)} className="min-w-0 flex-1 cursor-pointer rounded-lg border border-line bg-surface px-2 py-1.5 text-[12.5px] text-ink focus:border-accent focus:outline-none">
                    {info.subtitles.map((s) => (
                      <option key={`${s.lang}|${s.auto}`} value={`${s.lang}|${s.auto ? 1 : 0}`}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <Button onClick={() => { const [lang, a] = sub.split('|'); start('subtitles', { kind: 'subtitles', lang, auto: a === '1' }); }} disabled={!sub}>
                    <Subtitles size={15} aria-hidden /> Subtitles (.srt)
                  </Button>
                </div>
              )}
              <p className="text-[12px] text-muted">
                {q?.bytes ? `About ${mb(q.bytes)}. ` : ''}Saved into {hello?.downloads ?? 'Downloads'} by yt-dlp {hello?.ytdlp}.
              </p>
            </>
          )}
        </div>
      )}
      {jobs.map((j) => {
        const p = j.progress;
        return (
          <div key={j.key} className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-2.5" aria-live="polite">
            <div className="flex items-center justify-between gap-2 text-[12.5px]">
              <span className="min-w-0 truncate">Saving {j.label}{p.stage ? `: ${p.stage}` : (p.part ?? 0) > 0 && j.label.includes('video') ? ': sound' : ''}</span>
              <span className="shrink-0 font-mono text-[11px] text-muted tabular-nums">
                {p.pct !== null && p.pct !== undefined ? `${p.pct}%` : ''}
                {p.speed ? ` · ${mb(p.speed)}/s` : ''}
                {p.eta ? ` · ${time(p.eta)} left` : ''}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={`Saving ${j.label}`} aria-valuenow={p.pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-accent transition-[width]" style={{ width: `${p.stage ? 100 : p.pct ?? 0}%` }} />
            </div>
            <Button variant="ghost" onClick={j.cancel} className="self-start">
              <X size={14} aria-hidden /> Cancel
            </Button>
          </div>
        );
      })}
      {jobs.length > 0 && <p className="text-[12px] text-muted">Keep this panel open until it's saved.</p>}
      {saved.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="Saved YouTube files">
          {saved.map((s, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-[12.5px]">
              <span className="min-w-0 truncate text-ok" title={s.file}>
                Saved {s.file.split(/[\\/]/).pop()} {s.bytes ? `(${mb(s.bytes)})` : ''}
              </span>
              <button type="button" onClick={() => void revealFile(s.file).catch((e) => setError(`Couldn't open the folder: ${(e as Error).message}. The file is in ${hello?.downloads ?? 'Downloads'}.`))} className="flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-[12px] text-muted hover:bg-surface-2 hover:text-ink">
                <FolderOpen size={14} aria-hidden /> Show
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
