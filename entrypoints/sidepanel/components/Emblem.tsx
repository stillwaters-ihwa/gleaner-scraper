// Gleaner's marks. The spider is an original emblem in the spirit of Hunter x Hunter's Phantom
// Troupe: eight angular legs and an abdomen shaped as the Nen hexagon. The Nen mark is the
// six-sided Nen chart with one type lit, used to tell the tool groups apart.

const LEGS = [
  'M27 20 18 12 12 4',
  'M26 25 14 22 6 16',
  'M24 34 12 36 4 44',
  'M25 42 16 50 12 60',
];

/** The spider emblem, in the current text colour. */
export function Spider({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden fill="currentColor">
      <g fill="none" stroke="currentColor" strokeWidth={3.6} strokeLinejoin="miter" strokeLinecap="square">
        {LEGS.map((d) => (
          <path key={d} d={d} />
        ))}
        <g transform="translate(64 0) scale(-1 1)">
          {LEGS.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </g>
      <circle cx="32" cy="22" r="6.5" />
      <path d="M32 27.5 42 33.25V44.75L32 50.5 22 44.75V33.25Z" />
    </svg>
  );
}

export type NenType = 'enhancer' | 'transmuter' | 'emitter' | 'conjurer' | 'manipulator' | 'specialist';

/** Clockwise from the top, as on the Nen chart. */
export const NEN: { id: NenType; name: string; kanji: string }[] = [
  { id: 'enhancer', name: 'Enhancer', kanji: '強化系' },
  { id: 'transmuter', name: 'Transmuter', kanji: '変化系' },
  { id: 'conjurer', name: 'Conjurer', kanji: '具現化系' },
  { id: 'specialist', name: 'Specialist', kanji: '特質系' },
  { id: 'manipulator', name: 'Manipulator', kanji: '操作系' },
  { id: 'emitter', name: 'Emitter', kanji: '放出系' },
];

/** A small Nen chart: the hexagon outline with this type's corner lit in its colour. */
export function NenMark({ type, size = 18 }: { type: NenType; size?: number }) {
  const i = NEN.findIndex((n) => n.id === type);
  const pt = (k: number) => {
    const a = (Math.PI / 3) * k - Math.PI / 2;
    return [12 + 9 * Math.cos(a), 12 + 9 * Math.sin(a)];
  };
  const corners = Array.from({ length: 6 }, (_, k) => pt(k));
  const [x, y] = corners[i];
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <polygon points={corners.map((c) => c.join(',')).join(' ')} fill="none" stroke="var(--line)" strokeWidth={1.6} />
      <line x1="12" y1="12" x2={x} y2={y} stroke={`var(--nen-${type})`} strokeWidth={1.6} />
      <circle cx={x} cy={y} r={3.2} fill={`var(--nen-${type})`} />
    </svg>
  );
}
