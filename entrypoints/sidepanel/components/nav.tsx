import { createContext, useContext, useEffect, useRef } from 'react';
import type { Recipe } from '@/lib/db';

export type ToolId =
  | 'list' | 'page' | 'images' | 'emails' | 'shopify' | 'social' | 'text' | 'sitemap'
  | 'marketplace' | 'reviews' | 'jobs' | 'realestate' | 'travel' | 'articles' | 'posts'
  | 'company' | 'business' | 'emailcheck' | 'tech' | 'domain' | 'links' | 'convert' | 'documents' | 'video' | 'capture' | 'sitecrawl' | 'seller';

export type View = { tab: 'tools'; tool?: ToolId } | { tab: 'data'; datasetId?: string } | { tab: 'recipes' } | { tab: 'monitors' } | { tab: 'prices'; trackerId?: string };

/** Something one screen hands to a tool: a recipe to apply, or URLs to fill in. */
export type Handoff = { tool: 'list'; recipe: Recipe; run: boolean } | { tool: 'page'; recipe?: Recipe; urls?: string[]; run: boolean };

export interface Nav {
  view: View;
  go: (v: View) => void;
  openDataset: (id: string) => void;
  /** Open a tool and pass it work. */
  handoff: (h: Handoff) => void;
  pending: (Handoff & { seq: number }) | null;
  consume: (seq: number) => void;
}

export const NavContext = createContext<Nav | null>(null);

export function useNav(): Nav {
  const n = useContext(NavContext);
  if (!n) throw new Error('useNav outside NavContext');
  return n;
}

// Handoffs already delivered. Effects can run twice (StrictMode), and a recipe run must not start twice.
const delivered = new Set<number>();

/** Run `fn` once for each handoff addressed to `tool`. */
export function useHandoff<T extends Handoff['tool']>(tool: T, fn: (h: Extract<Handoff, { tool: T }>) => void) {
  const nav = useNav();
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    const p = nav.pending;
    if (!p || p.tool !== tool || delivered.has(p.seq)) return;
    delivered.add(p.seq);
    nav.consume(p.seq);
    latest.current(p as any);
  }, [nav.pending, tool]);
}
