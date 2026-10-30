// "Report a problem": a short form (what you expected, what happened) that saves a report ZIP
// with the run's steps, a picture of the page and what Gleaner found on it.
import { useId, useState } from 'react';
import { Bug, X } from '@phosphor-icons/react';
import { saveReport, type ReportInput } from '@/lib/report';
import { Button, Notice, inputCls } from './ui';

export function ReportProblem({ tool, run, compact }: { tool: string; run?: ReportInput['run']; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ ok: boolean; text: string } | null>(null);
  const id = useId();

  const save = async () => {
    setBusy(true);
    setDone(null);
    try {
      const name = await saveReport({ tool, run, description: text.trim() });
      setDone({ ok: true, text: `Saved ${name} to Downloads/Gleaner. Open it to check what's inside, then send it.` });
      setText('');
    } catch (e) {
      setDone({ ok: false, text: `The report couldn't be saved: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return compact ? (
      <button onClick={() => setOpen(true)} aria-label="Report a problem" title="Report a problem" className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink">
        <Bug size={17} aria-hidden />
      </button>
    ) : (
      <Button variant="ghost" onClick={() => setOpen(true)} className="self-start px-2 text-[12px]">
        <Bug size={14} aria-hidden /> Report a problem
      </Button>
    );

  return (
    <div role="dialog" aria-labelledby={`${id}-t`} className="fixed inset-x-3 top-16 z-30 flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-[0_18px_50px_rgb(0_0_0/0.45)]">
      <div className="flex items-center justify-between gap-2">
        <h2 id={`${id}-t`} className="flex items-center gap-2 font-display text-[15px]">
          <Bug size={18} className="text-accent-text" aria-hidden /> Report a problem
        </h2>
        <button onClick={() => setOpen(false)} aria-label="Close" className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink">
          <X size={16} aria-hidden />
        </button>
      </div>
      <p className="text-[12.5px] leading-snug text-muted">
        Keep the page that went wrong open in the tab. The report holds every step the run took, how it ended, a picture of the page and what Gleaner found on it. It is saved on this computer; nothing is sent.
      </p>
      <label htmlFor={`${id}-d`} className="text-[12px] font-medium">
        What did you expect, and what happened? (optional)
      </label>
      <textarea id={`${id}-d`} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. The shop has 13 pages but it stopped on page 4" className={inputCls} />
      {done && <Notice tone={done.ok ? 'info' : 'error'}>{done.text}</Notice>}
      <Button variant="primary" onClick={save} disabled={busy}>
        <Bug size={15} aria-hidden /> {busy ? 'Saving the report…' : 'Save report (ZIP)'}
      </Button>
    </div>
  );
}
