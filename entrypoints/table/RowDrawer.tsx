// Everything about one row: pictures large, every field, copy buttons.
import { useEffect, useRef, useState } from 'react';
import { ArrowSquareOut, CaretLeft, CaretRight, Check, Copy, X } from '@phosphor-icons/react';
import type { Column } from '@/lib/db';
import { looksLikeImage, looksLikeUrl } from '@/lib/columns';

interface Props {
  title: string;
  position: number;
  total: number;
  row: Record<string, string>;
  columns: Column[];
  onClose: () => void;
  onStep: (delta: number) => void;
}

export function RowDrawer({ title, position, total, row, columns, onClose, onStep }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState('');
  const images = [...new Set(columns.flatMap((c) => (row[c.key] ?? '').split(' | ')).filter(looksLikeImage))];
  const [active, setActive] = useState(0);
  const link = columns.map((c) => row[c.key] ?? '').find((v) => looksLikeUrl(v) && !looksLikeImage(v));

  useEffect(() => {
    setActive(0);
  }, [row]);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown' || e.key === 'j') onStep(1);
      if (e.key === 'ArrowUp' || e.key === 'k') onStep(-1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose, onStep]);

  const copy = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(''), 1200);
  };

  return (
    <aside role="dialog" aria-modal="false" aria-label={`Row ${position}: ${title}`} className="flex h-full w-[min(440px,100vw)] shrink-0 flex-col border-l border-line bg-surface">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <p className="font-mono text-[12px] text-muted tabular-nums">
          {position} / {total}
        </p>
        <div className="ml-auto flex gap-1">
          <button aria-label="Previous row" onClick={() => onStep(-1)} disabled={position <= 1} className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40">
            <CaretLeft size={16} aria-hidden />
          </button>
          <button aria-label="Next row" onClick={() => onStep(1)} disabled={position >= total} className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40">
            <CaretRight size={16} aria-hidden />
          </button>
          <button ref={closeRef} aria-label="Close" onClick={onClose} className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink">
            <X size={16} aria-hidden />
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">
        {images.length > 0 && (
          <div className="border-b border-line bg-surface-2 p-4">
            <img src={images[active]} alt="" className="mx-auto aspect-square w-full max-w-[320px] rounded-xl bg-surface object-contain" />
            {images.length > 1 && (
              <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
                {images.slice(0, 24).map((src, i) => (
                  <button key={src} aria-label={`Picture ${i + 1}`} aria-pressed={i === active} onClick={() => setActive(i)} className={`shrink-0 cursor-pointer rounded-md border ${i === active ? 'border-accent' : 'border-line opacity-70 hover:opacity-100'}`}>
                    <img src={src} alt="" loading="lazy" className="size-12 rounded-md object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="px-4 pt-4">
          <h2 className="font-display text-[17px] leading-snug font-semibold tracking-tight">{title}</h2>
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12.5px] text-accent-text hover:underline">
              Open page <ArrowSquareOut size={13} aria-hidden />
            </a>
          )}
        </div>
        <dl className="flex flex-col gap-3 p-4">
          {columns.map((c) => {
            const v = row[c.key] ?? '';
            return (
              <div key={c.key} className="group">
                <dt className="flex items-center justify-between gap-2 text-[11.5px] font-medium text-muted">
                  {c.label}
                  {v && (
                    <button aria-label={`Copy ${c.label}`} onClick={() => copy(c.key, v)} className="cursor-pointer rounded p-0.5 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-ink">
                      {copied === c.key ? <Check size={13} className="text-ok" aria-hidden /> : <Copy size={13} aria-hidden />}
                    </button>
                  )}
                </dt>
                <dd className="mt-0.5 text-[13px] leading-relaxed [overflow-wrap:anywhere]">
                  {!v ? <span className="text-muted/50">-</span> : looksLikeUrl(v) ? <a href={v} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">{v}</a> : v.length > 1200 ? v.slice(0, 1200) + '...' : v}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </aside>
  );
}
