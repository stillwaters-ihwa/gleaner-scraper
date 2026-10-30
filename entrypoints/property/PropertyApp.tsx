// Property viewer: one scraped listing at a time, with its photos sorted by room, the real floor
// plan and 3D tour when the listing has them, stated room sizes drawn to scale, feature tags,
// key facts and a map pin. Nothing here is invented: every shape and label comes from the listing.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Spider } from '@/entrypoints/sidepanel/components/Emblem';
import {
  ArrowSquareOut, CaretLeft, CaretRight, CheckCircle, Cube, House, MapPin, Ruler, Sparkle, SquaresFour, Tag, X,
} from '@phosphor-icons/react';
import { getDataset, onDatasetsChanged, saveDataset, type Dataset } from '@/lib/db';
import { featureTags, groupPhotos, mapLinks, packRooms, toProperty, type PhotoRooms, type Property } from '@/lib/property';
import { loadLabeler, MODEL_MB, ROOM_NAMES } from '@/lib/roomVision';
import { requestHostAccess } from '@/lib/tab';
import { sqft } from '@/lib/verticals/rooms';

const ROOM_ORDER = Object.keys(ROOM_NAMES);
const params = new URLSearchParams(location.search);

const btn =
  'inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3 text-[13px] whitespace-nowrap text-ink transition hover:border-muted/60 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45';
const primary =
  'inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-semibold whitespace-nowrap text-accent-ink transition hover:brightness-105 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45';

function Section({ id, icon, title, aside, children }: { id: string; icon: React.ReactNode; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t border-line pt-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="flex items-center gap-2 font-display text-[17px] font-semibold">
          <span className="text-accent-text" aria-hidden>
            {icon}
          </span>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line px-3 py-3 text-[13px] text-muted">{children}</p>;
}

/** Big photo with a strip of thumbnails; arrow keys move through them. */
function Gallery({ photos, title }: { photos: string[]; title: string }) {
  const [i, setI] = useState(0);
  if (!photos.length) {
    return (
      <div className="flex aspect-[3/2] items-center justify-center rounded-xl border border-dashed border-line text-[13px] text-muted">
        This listing had no photos
      </div>
    );
  }
  const go = (d: number) => setI((n) => (n + d + photos.length) % photos.length);
  return (
    <div
      className="flex flex-col gap-2"
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') go(1);
        if (e.key === 'ArrowLeft') go(-1);
      }}
    >
      <div className="relative overflow-hidden rounded-xl bg-surface-2">
        <img src={photos[i]} alt={`${title}, photo ${i + 1} of ${photos.length}`} referrerPolicy="no-referrer" className="aspect-[3/2] w-full object-cover" />
        {photos.length > 1 && (
          <>
            <button aria-label="Previous photo" onClick={() => go(-1)} className="absolute top-1/2 left-2 flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75">
              <CaretLeft size={18} />
            </button>
            <button aria-label="Next photo" onClick={() => go(1)} className="absolute top-1/2 right-2 flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75">
              <CaretRight size={18} />
            </button>
            <span className="absolute right-2 bottom-2 rounded-md bg-black/60 px-2 py-0.5 font-mono text-[11px] text-white tabular-nums">
              {i + 1} / {photos.length}
            </span>
          </>
        )}
      </div>
      {photos.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {photos.map((p, n) => (
            <button key={p} aria-label={`Show photo ${n + 1}`} aria-current={n === i} onClick={() => setI(n)} className={`shrink-0 cursor-pointer overflow-hidden rounded-md border-2 ${n === i ? 'border-accent' : 'border-transparent opacity-70 hover:opacity-100'}`}>
              <img src={p} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-14 w-20 object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Stated room sizes drawn at one scale on a 1 m grid. Rooms sit side by side, not where they are in the home. */
function RoomChart({ rooms }: { rooms: Property['rooms'] }) {
  const [feet, setFeet] = useState(() => rooms.some((r) => /ft|'|′|"/.test(r.as_written)));
  const widthM = Math.max(16, ...rooms.map((r) => r.length_m + 0.5));
  const { placed, width, height } = packRooms(rooms, widthM);
  const pad = 0.4;
  const vbW = Math.max(width, 5) + pad * 2;
  const vbH = height + pad * 2 + 1.4; // room for the scale bar
  const unit = feet ? 'ft' : 'm';
  const len = (m: number) => (feet ? `${(m / 0.3048).toFixed(1)}` : m.toFixed(2).replace(/0$/, ''));
  const area = (m2: number) => (feet ? `${sqft(m2).toLocaleString()} sq ft` : `${m2} m²`);
  const total = rooms.reduce((s, r) => s + r.area_m2, 0);
  const barM = feet ? 3.048 : 5; // 10 ft or 5 m
  return (
    <figure className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <figcaption className="text-[13px] text-muted">
          <span className="font-medium text-ink">Sizes to scale, layout not shown.</span> Each box is a room's stated size; boxes sit side by side so you can compare them, not where the rooms are in the home.
        </figcaption>
        <div role="group" aria-label="Units" className="flex rounded-lg border border-line p-0.5">
          {(['m', 'ft'] as const).map((u) => (
            <button key={u} aria-pressed={unit === u} onClick={() => setFeet(u === 'ft')} className={`cursor-pointer rounded-md px-2.5 py-1 text-[12px] ${unit === u ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink'}`}>
              {u === 'm' ? 'Metres' : 'Feet'}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-bg p-2">
        <svg viewBox={`${-pad} ${-pad} ${vbW} ${vbH}`} role="img" aria-label={`Room sizes to scale: ${rooms.map((r) => `${r.name} ${len(r.length_m)} by ${len(r.width_m)} ${unit}`).join('; ')}`} className="w-full" style={{ minWidth: 520, maxHeight: 560 }}>
          <defs>
            <pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse">
              <path d="M 1 0 L 0 0 0 1" fill="none" stroke="var(--line)" strokeWidth="0.02" />
            </pattern>
          </defs>
          <rect x={-pad} y={-pad} width={vbW} height={height + pad * 2} fill="url(#grid)" />
          {placed.map((r, n) => {
            const small = Math.min(r.length_m, r.width_m) < 2.2;
            const fs = Math.min(0.42, Math.max(0.2, r.width_m / 6));
            return (
              <g key={n}>
                <rect x={r.x} y={r.y} width={r.length_m} height={r.width_m} rx="0.06" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="0.05" />
                <title>{`${r.name}: ${len(r.length_m)} × ${len(r.width_m)} ${unit}, ${area(r.area_m2)}. As written: ${r.as_written}`}</title>
                <text x={r.x + 0.15} y={r.y + fs + 0.12} fontSize={fs} fontWeight="600" fill="var(--text)" style={{ fontFamily: 'var(--font-display)' }}>
                  {r.name.length > r.length_m * 3.2 ? `${r.name.slice(0, Math.max(3, Math.floor(r.length_m * 3)))}…` : r.name}
                </text>
                {!small && (
                  <text x={r.x + 0.15} y={r.y + fs * 2 + 0.25} fontSize={fs * 0.8} fill="var(--muted)" style={{ fontFamily: 'var(--font-mono)' }}>
                    {len(r.length_m)} × {len(r.width_m)} {unit}
                  </text>
                )}
              </g>
            );
          })}
          <g transform={`translate(0 ${height + 0.7})`}>
            <line x1="0" x2={barM} y1="0" y2="0" stroke="var(--text)" strokeWidth="0.06" />
            <line x1="0" x2="0" y1="-0.18" y2="0.18" stroke="var(--text)" strokeWidth="0.05" />
            <line x1={barM} x2={barM} y1="-0.18" y2="0.18" stroke="var(--text)" strokeWidth="0.05" />
            <text x={barM + 0.25} y="0.14" fontSize="0.34" fill="var(--muted)" style={{ fontFamily: 'var(--font-mono)' }}>
              {feet ? '10 ft' : '5 m'} · grid squares are 1 m
            </text>
          </g>
        </svg>
      </div>
      <table className="w-full text-[13px]">
        <caption className="sr-only">Room sizes as stated in the listing</caption>
        <thead>
          <tr className="text-left text-[12px] text-muted">
            <th className="py-1 font-medium">Room</th>
            <th className="py-1 font-medium">Size ({unit})</th>
            <th className="py-1 text-right font-medium">Area</th>
            <th className="hidden py-1 pl-4 font-medium sm:table-cell">As written</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {[...rooms].sort((a, b) => b.area_m2 - a.area_m2).map((r, n) => (
            <tr key={n}>
              <td className="py-1.5">{r.name}</td>
              <td className="py-1.5 font-mono text-[12px] tabular-nums">
                {len(r.length_m)} × {len(r.width_m)}
              </td>
              <td className="py-1.5 text-right font-mono text-[12px] tabular-nums">{area(r.area_m2)}</td>
              <td className="hidden max-w-[260px] truncate py-1.5 pl-4 text-muted sm:table-cell" title={r.as_written}>
                {r.as_written}
              </td>
            </tr>
          ))}
          <tr>
            <td className="py-1.5 font-medium">Stated rooms total</td>
            <td />
            <td className="py-1.5 text-right font-mono text-[12px] font-medium tabular-nums">{area(Math.round(total * 10) / 10)}</td>
            <td className="hidden sm:table-cell" />
          </tr>
        </tbody>
      </table>
    </figure>
  );
}

/** A floor plan image from the listing; if the site won't serve it here, offer the link instead. */
function FloorPlan({ url, n }: { url: string; n: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className={`${btn} justify-start`}>
        <ArrowSquareOut size={15} aria-hidden /> Floor plan {n} didn't load here. Open it on the site
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-line bg-white">
      <img src={url} alt={`Floor plan ${n} from the listing`} referrerPolicy="no-referrer" onError={() => setFailed(true)} className="w-full object-contain" />
    </a>
  );
}

type LabelState = { phase: 'idle' } | { phase: 'loading'; pct: number } | { phase: 'labeling'; done: number; total: number } | { phase: 'error'; message: string };

function PhotosByRoom({ p, onChange }: { p: Property; onChange: (next: PhotoRooms) => void }) {
  const [state, setState] = useState<LabelState>({ phase: 'idle' });
  const stop = useRef(false);
  const labels = p.photoRooms;
  const labeled = p.photos.filter((u) => labels[u]).length;
  const groups = useMemo(() => groupPhotos(p.photos, labels, ROOM_ORDER), [p.photos, labels]);

  const run = async () => {
    if (!(await requestHostAccess())) {
      setState({ phase: 'error', message: 'Gleaner needs access to sites to read the photos. Click "Label photos" again and choose Allow.' });
      return;
    }
    stop.current = false;
    setState({ phase: 'loading', pct: 0 });
    try {
      const label = await loadLabeler((pct) => setState({ phase: 'loading', pct }));
      const next: PhotoRooms = { ...labels };
      const todo = p.photos.filter((u) => next[u]?.by !== 'you');
      let failed = 0;
      for (let n = 0; n < todo.length && !stop.current; n++) {
        setState({ phase: 'labeling', done: n, total: todo.length });
        try {
          const r = await label(todo[n]);
          next[todo[n]] = { room: r.room, by: 'model', confidence: Math.round(r.confidence * 100) / 100 };
        } catch {
          failed++;
        }
        if (n % 4 === 3) onChange({ ...next });
      }
      onChange(next);
      setState(failed ? { phase: 'error', message: `${failed} photo${failed === 1 ? '' : 's'} could not be read (the site may block downloads). The rest are labeled.` } : { phase: 'idle' });
    } catch (e) {
      setState({ phase: 'error', message: `The photo model could not load: ${(e as Error).message}. Check your connection and try again.` });
    }
  };

  const busy = state.phase === 'loading' || state.phase === 'labeling';
  const setRoom = (u: string, room: string) => {
    const next = { ...labels };
    if (room === 'unlabeled') delete next[u];
    else next[u] = { room, by: 'you' };
    onChange(next);
  };

  return (
    <Section
      id="by-room"
      icon={<SquaresFour size={18} />}
      title="Photos by room"
      aside={
        p.photos.length > 0 &&
        (busy ? (
          <button className={btn} onClick={() => (stop.current = true)}>
            <X size={14} aria-hidden /> Stop
          </button>
        ) : (
          <button className={primary} onClick={run}>
            <Sparkle size={15} aria-hidden /> {labeled ? 'Label the rest again' : 'Label photos'}
          </button>
        ))
      }
    >
      {!p.photos.length ? (
        <Empty>No photos to sort.</Empty>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-muted" aria-live="polite">
            {state.phase === 'loading'
              ? `Getting the photo model ready… ${state.pct}% (about ${MODEL_MB} MB, downloaded once and kept by your browser)`
              : state.phase === 'labeling'
                ? `Looking at photo ${state.done + 1} of ${state.total}…`
                : state.phase === 'error'
                  ? <span className="text-danger">{state.message}</span>
                  : labeled
                    ? `${labeled} of ${p.photos.length} photos labeled on this computer. Wrong room? Pick the right one under the photo; your choice is kept.`
                    : `Sorts the photos into rooms using a model that runs on this computer; photos are not uploaded anywhere. The first time downloads about ${MODEL_MB} MB.`}
          </p>
          {state.phase === 'loading' && (
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={state.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Model download">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${state.pct}%` }} />
            </div>
          )}
          {groups.map((g) => (
            <div key={g.room}>
              <h3 className="mb-2 flex items-baseline gap-2 text-[13px] font-semibold">
                {g.room === 'unlabeled' ? 'Not labeled yet' : ROOM_NAMES[g.room] ?? g.room}
                <span className="font-mono text-[11px] font-normal text-muted tabular-nums">{g.photos.length}</span>
              </h3>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
                {g.photos.map((u) => {
                  const l = labels[u];
                  const unsure = l?.by === 'model' && (l.confidence ?? 1) < 0.15;
                  return (
                    <li key={u} className="flex flex-col gap-1">
                      <a href={u} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg bg-surface-2">
                        <img src={u} alt={l ? ROOM_NAMES[l.room] : 'Listing photo'} loading="lazy" referrerPolicy="no-referrer" className="aspect-[4/3] w-full object-cover transition hover:scale-[1.03]" />
                      </a>
                      <div className="flex items-center gap-1">
                        <select
                          aria-label="Room in this photo"
                          value={l?.room ?? 'unlabeled'}
                          onChange={(e) => setRoom(u, e.target.value)}
                          className="min-w-0 flex-1 cursor-pointer rounded-md border border-line bg-surface px-1.5 py-1 text-[12px] text-ink focus:border-accent focus:outline-none"
                        >
                          <option value="unlabeled">Not labeled</option>
                          {ROOM_ORDER.map((k) => (
                            <option key={k} value={k}>
                              {ROOM_NAMES[k]}
                            </option>
                          ))}
                        </select>
                        {l?.by === 'you' ? (
                          <CheckCircle size={16} weight="fill" className="shrink-0 text-ok" aria-label="Set by you" />
                        ) : unsure ? (
                          <span className="shrink-0 rounded bg-surface-2 px-1 text-[11px] text-muted" title="The model wasn't sure about this one">
                            unsure
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function Detail({ p, onPhotoRooms }: { p: Property; onPhotoRooms: (next: PhotoRooms) => void }) {
  const [tourHere, setTourHere] = useState(false);
  useEffect(() => setTourHere(false), [p.index]);
  const map = mapLinks(p);
  const tags = featureTags(p.description, p.photoRooms);
  const price = p.facts.find((f) => f.label === 'Price');
  const facts = p.facts.filter((f) => f !== price);
  return (
    <article className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]">
        <Gallery photos={p.photos} title={p.title} />
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="font-display text-[22px] leading-tight font-semibold text-balance">{p.address || p.title}</h1>
            {price && <p className="mt-1 font-display text-[28px] font-bold text-accent-text tabular-nums">{price.value}</p>}
          </div>
          {facts.length > 0 && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              {facts.map((f) => (
                <div key={f.label} className="min-w-0 border-t border-line pt-1.5">
                  <dt className="text-[11px] text-muted">{f.label}</dt>
                  <dd className="truncate font-medium" title={f.value}>
                    {f.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <div className="flex flex-wrap gap-2">
            {p.url && (
              <a className={btn} href={p.url} target="_blank" rel="noreferrer">
                <ArrowSquareOut size={15} aria-hidden /> Open listing
              </a>
            )}
            {map && (
              <a className={btn} href={map.open} target="_blank" rel="noreferrer">
                <MapPin size={15} aria-hidden /> {map.embed ? 'Open map' : 'Find on map'}
              </a>
            )}
          </div>
          {map?.embed && (
            <iframe title="Map of the property" src={map.embed} loading="lazy" className="aspect-[4/3] w-full rounded-xl border border-line bg-surface-2" />
          )}
        </div>
      </div>

      <Section id="features" icon={<Tag size={18} />} title="Features">
        {tags.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <li key={t.name} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[12px]" title={t.from === 'text' ? 'Named in the listing' : t.from === 'photos' ? 'Seen in the photos' : 'Named in the listing and seen in the photos'}>
                {t.name}
                <span className="text-[11px] text-muted">{t.from === 'text' ? 'listing' : t.from === 'photos' ? 'photo' : 'both'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>The listing text names no features. Label the photos to find some from the pictures.</Empty>
        )}
      </Section>

      <Section id="floor-plan" icon={<House size={18} />} title="Floor plan">
        {p.floorPlans.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {p.floorPlans.map((u, n) => (
              <FloorPlan key={u} url={u} n={n + 1} />
            ))}
          </div>
        ) : (
          <Empty>This listing didn't publish a floor plan. The room sizes below are what it states.</Empty>
        )}
      </Section>

      <Section
        id="tour"
        icon={<Cube size={18} />}
        title="3D tour"
        aside={
          p.tour && (
            <div className="flex gap-2">
              <button className={btn} onClick={() => setTourHere((v) => !v)}>
                {tourHere ? 'Hide' : 'Show here'}
              </button>
              <a className={primary} href={p.tour} target="_blank" rel="noreferrer">
                <ArrowSquareOut size={15} aria-hidden /> Open tour
              </a>
            </div>
          )
        }
      >
        {!p.tour ? (
          <Empty>This listing has no 3D or virtual tour.</Empty>
        ) : tourHere ? (
          <div className="flex flex-col gap-1.5">
            <iframe title="3D tour" src={p.tour} allow="fullscreen; xr-spatial-tracking; gyroscope; accelerometer" allowFullScreen className="aspect-video w-full rounded-xl border border-line bg-surface-2" />
            <p className="text-[12px] text-muted">Blank? Some tour sites only open on their own page. Use "Open tour".</p>
          </div>
        ) : (
          <p className="truncate text-[13px] text-muted" title={p.tour}>
            {new URL(p.tour).hostname.replace(/^www\./, '')}
          </p>
        )}
      </Section>

      <PhotosByRoom p={p} onChange={onPhotoRooms} />

      <Section id="room-sizes" icon={<Ruler size={18} />} title="Room sizes">
        {p.rooms.length ? <RoomChart rooms={p.rooms} /> : <Empty>The listing doesn't state room sizes, so there is nothing to draw. Gleaner never guesses them.</Empty>}
      </Section>

      {p.description && (
        <Section id="about" icon={<House size={18} />} title="From the listing">
          <p className="max-w-[75ch] text-[14px] leading-relaxed whitespace-pre-line text-muted">{p.description}</p>
        </Section>
      )}
    </article>
  );
}

export function PropertyApp() {
  const id = params.get('id') ?? '';
  const [ds, setDs] = useState<Dataset | null | undefined>(undefined);
  const [row, setRow] = useState(() => Math.max(0, Number(params.get('row')) || 0));
  useEffect(() => {
    const load = () => getDataset(id).then((d) => setDs(d ?? null));
    load();
    return onDatasetsChanged(load);
  }, [id]);
  const props = useMemo(() => (ds ? ds.rows.map(toProperty) : []), [ds]);
  const p = props[Math.min(row, props.length - 1)];
  useEffect(() => {
    if (p) document.title = `${p.address || p.title} · Gleaner`;
    const u = new URL(location.href);
    u.searchParams.set('row', String(row));
    history.replaceState(null, '', u);
  }, [p, row]);

  const savePhotoRooms = async (next: PhotoRooms) => {
    if (!ds || !p) return;
    const rows = ds.rows.slice();
    rows[p.index] = { ...rows[p.index], photo_rooms: JSON.stringify(next) };
    const columns = ds.columns.some((c) => c.key === 'photo_rooms') ? ds.columns : [...ds.columns, { key: 'photo_rooms', label: 'photo rooms' }];
    const saved = { ...ds, rows, columns };
    setDs(saved);
    await saveDataset(saved);
  };

  if (ds === undefined) return <div className="mx-auto mt-10 h-64 max-w-6xl animate-pulse rounded-xl bg-surface" />;
  if (!ds || !p) {
    return (
      <main className="mx-auto flex max-w-xl flex-col gap-2 px-4 py-16">
        <h1 className="font-display text-[20px] font-semibold">No property to show</h1>
        <p className="text-muted">Run the Real estate listings tool on a listing page, then choose "Open property viewer" on its data.</p>
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <span className="flex items-center gap-1.5 font-display text-[14px]"><Spider size={20} className="text-accent-text" />Gleaner</span>
          <span className="truncate text-[13px] text-muted">{ds.name}</span>
          {props.length > 1 && (
            <div className="ml-auto flex items-center gap-1.5">
              <button aria-label="Previous property" className={btn} disabled={row <= 0} onClick={() => setRow((r) => r - 1)}>
                <CaretLeft size={15} />
              </button>
              <select
                aria-label="Property"
                value={Math.min(row, props.length - 1)}
                onChange={(e) => setRow(Number(e.target.value))}
                className="max-w-[min(360px,45vw)] cursor-pointer truncate rounded-lg border border-line bg-surface px-2 py-1.5 text-[13px] text-ink focus:border-accent focus:outline-none"
              >
                {props.map((x) => (
                  <option key={x.index} value={x.index}>
                    {x.index + 1}. {x.title.slice(0, 70)}
                  </option>
                ))}
              </select>
              <button aria-label="Next property" className={btn} disabled={row >= props.length - 1} onClick={() => setRow((r) => r + 1)}>
                <CaretRight size={15} />
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Detail key={p.index} p={p} onPhotoRooms={savePhotoRooms} />
      </main>
    </div>
  );
}
