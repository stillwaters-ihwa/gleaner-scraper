import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { WarningCircle, Info } from '@phosphor-icons/react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({ variant = 'secondary', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-accent text-accent-ink hover:brightness-105 font-semibold',
    secondary: 'bg-surface-2 text-ink border border-line hover:border-muted/60',
    ghost: 'text-muted hover:text-ink hover:bg-surface-2',
    danger: 'text-danger border border-line hover:border-danger/60 bg-surface',
  };
  return (
    <button
      {...p}
      className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] whitespace-nowrap transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 cursor-pointer ${styles[variant]} ${className}`}
    />
  );
}

export function Field({ label, help, children }: { label: string; help?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12px] font-medium text-ink">
        {label}
      </label>
      {children(id)}
      {help && <p className="text-[12px] leading-snug text-muted">{help}</p>}
    </div>
  );
}

export const inputCls =
  'w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-[13px] text-ink placeholder:text-muted/80 focus:border-accent focus:outline-none';

export function NumberInput({ id, value, onChange, min = 0, max }: { id: string; value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <input
      id={id}
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(Math.max(min, Math.min(max ?? Infinity, Number(e.target.value) || 0)))}
      className={inputCls + ' font-mono tabular-nums'}
    />
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg border border-line bg-surface p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-8 cursor-pointer rounded-md px-2 text-[12.5px] transition ${value === o.value ? 'bg-surface-2 text-ink font-medium shadow-[inset_0_0_0_1px_var(--line)]' : 'text-muted hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-[13px] text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
      <span>{children}</span>
    </label>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error'; children: ReactNode }) {
  const Icon = tone === 'error' ? WarningCircle : Info;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex gap-2 rounded-lg border px-3 py-2.5 text-[12.5px] leading-snug ${tone === 'error' ? 'border-danger/40 text-danger' : 'border-line text-muted'}`}
    >
      <Icon size={16} weight="bold" className="mt-px shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-[15px] font-semibold tracking-tight">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
