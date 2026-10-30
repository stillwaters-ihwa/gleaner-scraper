import { Field, NumberInput, Segmented } from '../ui';
import type { LoadMode } from '@/lib/runner';

export interface LoadSettings {
  mode: LoadMode;
  concurrency: number;
  delay: number;
}

export const defaultLoad: LoadSettings = { mode: 'auto', concurrency: 3, delay: 300 };

export function LoadOptions({ value, onChange }: { value: LoadSettings; onChange: (v: LoadSettings) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Field
        label="How to load pages"
        help={
          value.mode === 'auto'
            ? 'Reads the page HTML first and opens a background tab only when a page is built by JavaScript or the site blocks the fast way.'
            : value.mode === 'fetch'
              ? 'Fastest. Reads the page HTML directly, so content drawn by JavaScript may be missing.'
              : 'Slowest. Opens every page in a background tab so it sees exactly what you see.'
        }
      >
        {() => (
          <Segmented
            label="How to load pages"
            value={value.mode}
            onChange={(mode) => onChange({ ...value, mode, concurrency: mode === 'tab' ? Math.min(value.concurrency, 2) : value.concurrency })}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'fetch', label: 'Fast' },
              { value: 'tab', label: 'Browser tab' },
            ]}
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Pages at once">{(id) => <NumberInput id={id} value={value.concurrency} onChange={(n) => onChange({ ...value, concurrency: n })} min={1} max={value.mode === 'tab' ? 4 : 10} />}</Field>
        <Field label="Wait between (ms)">{(id) => <NumberInput id={id} value={value.delay} onChange={(n) => onChange({ ...value, delay: n })} min={0} max={30000} />}</Field>
      </div>
    </div>
  );
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
