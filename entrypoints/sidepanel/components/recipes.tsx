import { useEffect, useRef, useState } from 'react';
import { BookmarkSimple, Check as CheckIcon, ListBullets, PencilSimple, Play, Pulse, Stack, Trash, X } from '@phosphor-icons/react';
import { deleteRecipe, listRecipes, onRecipesChanged, saveRecipe, type Recipe } from '@/lib/db';
import { Button, Field, Notice, Section, inputCls } from './ui';
import { useNav } from './nav';
import { MonitorSetup } from './monitors';
import { canMonitor } from '@/lib/monitor';

export function useRecipes() {
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  useEffect(() => {
    const load = () => listRecipes().then(setRecipes);
    load();
    return onRecipesChanged(load);
  }, []);
  return recipes;
}

/** "Save recipe" button that opens a small name (and URL pattern) form. */
export function SaveRecipe({ defaultName, pattern, onSave, disabled }: { defaultName: string; pattern?: string; onSave: (name: string, pattern: string) => Promise<void>; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [pat, setPat] = useState('');
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  function show() {
    setName(defaultName);
    setPat(pattern ?? '');
    setSaved('');
    setError('');
    setOpen(true);
  }

  async function save() {
    try {
      await onSave(name.trim() || defaultName, pat.trim());
      setSaved(name.trim() || defaultName);
      setOpen(false);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  if (!open)
    return (
      <div className="flex flex-col gap-2">
        <Button variant="ghost" onClick={show} disabled={disabled} className="self-start">
          <BookmarkSimple size={15} aria-hidden /> Save recipe
        </Button>
        {saved && (
          <p role="status" className="text-[12px] text-muted">
            Saved recipe <span className="font-medium text-ink">{saved}</span>. Run it again from Recipes on the home screen.
          </p>
        )}
      </div>
    );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3"
    >
      <Field label="Recipe name">{(id) => <input id={id} autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />}</Field>
      {pattern !== undefined && (
        <Field label="Offer it on pages like" help="Use * for any text. The List extractor suggests this recipe when the open page matches.">
          {(id) => <input id={id} value={pat} onChange={(e) => setPat(e.target.value)} className={inputCls + ' font-mono text-[12px]'} />}
        </Field>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          <BookmarkSimple size={15} aria-hidden /> Save recipe
        </Button>
      </div>
    </form>
  );
}

function summary(r: Recipe) {
  if (r.kind === 'list') {
    const paging = r.paging === 'none' ? 'this page only' : r.paging === 'next' ? `next button, up to ${r.maxPages} pages` : `infinite scroll, up to ${r.maxPages} scrolls`;
    return `${r.columns.length} ${r.columns.length === 1 ? 'column' : 'columns'}, ${paging}`;
  }
  const parts = [r.useMeta && 'metadata', r.useProduct && 'product details', r.fields.length && `${r.fields.length} ${r.fields.length === 1 ? 'field' : 'fields'}`].filter(Boolean);
  return `${parts.join(', ') || 'nothing selected'}, ${r.load.mode === 'tab' ? 'browser tab' : 'fast'} loading${r.urls.length ? `, ${r.urls.length} saved URLs` : ''}`;
}

function RecipeRow({ r }: { r: Recipe }) {
  const nav = useNav();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(r.name);
  const [confirm, setConfirm] = useState(false);
  const [monitoring, setMonitoring] = useState(false);
  const [monitored, setMonitored] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const Icon = r.kind === 'list' ? ListBullets : Stack;
  async function rename() {
    const n = name.trim();
    if (n && n !== r.name) await saveRecipe({ ...r, name: n });
    setRenaming(false);
  }
  function askDelete() {
    setConfirm(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setConfirm(false), 4000);
  }

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
          <Icon size={19} weight="duotone" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {renaming ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                rename();
              }}
              className="flex gap-1"
            >
              <input
                aria-label="Recipe name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && (setName(r.name), setRenaming(false))}
                className={inputCls + ' py-1.5'}
              />
              <Button type="submit" variant="ghost" aria-label="Save name" className="px-2">
                <CheckIcon size={15} aria-hidden />
              </Button>
              <Button type="button" variant="ghost" aria-label="Cancel rename" onClick={() => (setName(r.name), setRenaming(false))} className="px-2">
                <X size={15} aria-hidden />
              </Button>
            </form>
          ) : (
            <p className="flex items-baseline justify-between gap-2">
              <span className="truncate font-display text-[15px] font-semibold tracking-tight">{r.name}</span>
              <span className="shrink-0 font-mono text-[10.5px] text-muted">{r.kind === 'list' ? 'list' : 'pages'}</span>
            </p>
          )}
          {r.kind === 'list' && (
            <p className="truncate font-mono text-[11.5px] text-muted" title={r.urlPattern}>
              {r.urlPattern}
            </p>
          )}
          <p className="text-[12.5px] leading-snug text-muted">{summary(r)}</p>
        </div>
      </div>
      <div className="flex items-center justify-end gap-1">
        {confirm ? (
          <Button variant="danger" onClick={() => deleteRecipe(r.id)}>
            <Trash size={15} aria-hidden /> Delete {r.name}?
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setRenaming(true)} aria-label={`Rename ${r.name}`} title="Rename" className="px-2">
              <PencilSimple size={15} aria-hidden />
            </Button>
            <Button variant="ghost" onClick={askDelete} aria-label={`Delete ${r.name}`} title="Delete" className="px-2">
              <Trash size={15} aria-hidden />
            </Button>
            <Button
              variant="ghost"
              onClick={() => setMonitoring(true)}
              disabled={!canMonitor(r) || monitoring}
              aria-label={`Monitor ${r.name}`}
              title={canMonitor(r) ? 'Monitor on a schedule' : 'Save this recipe with page URLs to monitor it'}
              className="px-2"
            >
              <Pulse size={15} aria-hidden />
            </Button>
          </>
        )}
        <Button variant="primary" onClick={() => nav.handoff({ tool: r.kind, recipe: r, run: true } as any)} aria-label={`Run ${r.name}`}>
          <Play size={14} weight="fill" aria-hidden /> Run
        </Button>
      </div>
      {monitoring && (
        <MonitorSetup
          defaultName={r.name}
          getTarget={async () => ({ kind: 'recipe', recipe: r })}
          onClose={(saved) => (setMonitoring(false), setMonitored(saved))}
        />
      )}
      {monitored && !monitoring && (
        <p role="status" className="text-[12px] text-muted">
          Monitoring <span className="font-medium text-ink">{r.name}</span>. The first run is starting now.{' '}
          <button onClick={() => nav.go({ tab: 'monitors' })} className="cursor-pointer text-accent-text underline-offset-2 hover:underline">
            Open Monitors
          </button>
        </p>
      )}
    </li>
  );
}

export function RecipesView() {
  const nav = useNav();
  const recipes = useRecipes();
  if (!recipes) return null;
  return (
    <div className="flex flex-col gap-4">
      <Section title="Recipes">
        <p className="text-[12.5px] leading-relaxed text-muted">
          Saved List and Page extractor setups. Running a list recipe opens its page if the current tab doesn't match, then extracts with the saved columns and pagination.
        </p>
      </Section>
      {recipes.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-line p-4">
          <p className="text-[13px]">No recipes yet.</p>
          <p className="text-[12.5px] leading-relaxed text-muted">Set up the List or Page extractor the way you like it, then click Save recipe to reuse it with one click.</p>
          <Button onClick={() => nav.go({ tab: 'tools', tool: 'list' })}>
            <ListBullets size={15} aria-hidden /> Open List extractor
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {recipes.map((r) => (
            <RecipeRow key={r.id} r={r} />
          ))}
        </ul>
      )}
    </div>
  );
}
