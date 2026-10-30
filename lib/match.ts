// Match the same product across stores. Identifiers win when they exist (barcode, then SKU,
// then part number / MPN), and titles decide otherwise. Used by competitor price tracking and
// MAP monitoring, so one product you track is lined up with its page on each store.
import type { Product } from './product';

export type MatchBy = 'gtin' | 'sku' | 'mpn' | 'title';
export const MATCH_LABEL: Record<MatchBy, string> = { gtin: 'barcode', sku: 'SKU', mpn: 'part number', title: 'title' };

/** The fields that identify a product, however a row happens to name its columns. */
export interface ProductKey {
  gtin: string;
  sku: string;
  mpn: string;
  brand: string;
  title: string;
  titleTokens: string[];
  /** Size or pack from the title in a common unit ("150ml", "1000g", "3pack"), or ''. */
  size: string;
}

const UNIT: Record<string, [string, number]> = {
  ml: ['ml', 1], l: ['ml', 1000], ltr: ['ml', 1000], litre: ['ml', 1000], liter: ['ml', 1000],
  g: ['g', 1], gr: ['g', 1], kg: ['g', 1000], mg: ['g', 0.001], oz: ['oz', 1], floz: ['oz', 1], lb: ['g', 453.6],
  pcs: ['pc', 1], pc: ['pc', 1], ea: ['pc', 1], ct: ['pc', 1], count: ['pc', 1], pack: ['pack', 1], packs: ['pack', 1], sheets: ['sheet', 1], sheet: ['sheet', 1],
};

/**
 * The product's size from its title, so variants (150ml vs 300ml, 1-pack vs 3-pack) are told
 * apart. Several sizes ("2 x 150ml") combine into one string.
 */
export function sizeOf(title: string): string {
  const out: string[] = [];
  const re = /(\d+(?:[.,]\d+)?)\s?(ml|l|ltr|litre|liter|kg|mg|g|gr|fl\.?\s?oz|oz|lb|pcs|pc|ea|ct|count|packs?|sheets?)\b/gi;
  for (const m of String(title ?? '').matchAll(re)) {
    const unit = m[2].toLowerCase().replace(/[.\s]/g, '');
    const [base, factor] = UNIT[unit] ?? [unit, 1];
    const n = Math.round(parseFloat(m[1].replace(',', '.')) * factor * 100) / 100;
    out.push(`${n}${base}`);
  }
  // "2 x 150ml" / "set of 3": a multiplier changes the pack
  const multi = String(title ?? '').match(/\b(\d+)\s?[x×]\s?\d|\b(?:set|pack) of (\d+)/i);
  if (multi) out.push(`x${multi[1] ?? multi[2]}`);
  return [...new Set(out)].sort().join('+');
}

const ID = (s: string) => String(s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const digits = (s: string) => String(s ?? '').replace(/\D/g, '');

/** A barcode is 8 to 14 digits; a leading zero on a 13-digit code is dropped so EAN and UPC line up. */
export function normalizeGtin(v: string): string {
  const d = digits(v);
  if (d.length < 8 || d.length > 14) return '';
  return d.replace(/^0+(?=\d{12,13}$)/, '');
}

// Words that describe size or packaging, not the product, so two listings of the same item match.
const NOISE = /\b(\d+(?:\.\d+)?\s?(?:ml|l|g|kg|mg|oz|lb|fl|floz|ct|pcs?|pack|packs|count|ea|each|sheets?|tablets?|capsules?|servings?|cm|mm|in|inch|pairs?)|new|sale|official|genuine|authentic|set|value|bundle|free|shipping|wholesale|bulk|case|box|carton|x\d+|\d+x)\b/gi;
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'with', 'of', 'in', 'to', 'by']);

/** Title reduced to the words that identify the product: lowercased, size and filler words removed. */
export function titleTokens(title: string): string[] {
  return String(title ?? '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ') // "[Brand]" prefixes
    .replace(/[‘’“”]/g, '')
    .replace(NOISE, ' ')
    .replace(/[^a-z0-9가-힣]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

const col = (p: Product, keys: string[]) => {
  for (const k of keys) if (p[k]) return p[k];
  // Case-insensitive fallback for datasets with oddly named columns
  for (const [k, v] of Object.entries(p)) if (v && keys.some((want) => k.toLowerCase().replace(/[^a-z]/g, '') === want.replace(/[^a-z]/g, ''))) return v;
  return '';
};

export function productKey(p: Product): ProductKey {
  const title = col(p, ['title', 'name', 'product', 'product_name']);
  return {
    gtin: normalizeGtin(col(p, ['gtin', 'barcode', 'ean', 'upc', 'jan'])),
    sku: ID(col(p, ['sku', 'variant_sku', 'product_code', 'prodcd', 'item_number'])),
    mpn: ID(col(p, ['mpn', 'part_number', 'partnum', 'model', 'asin'])),
    brand: col(p, ['brand', 'vendor', 'manufacturer']).toLowerCase().trim(),
    title,
    titleTokens: titleTokens(title),
    size: sizeOf(title),
  };
}

/** How alike two token sets are, 0 to 1 (shared tokens over the smaller set). */
function tokenScore(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  const shared = a.filter((t) => setB.has(t)).length;
  return shared / Math.min(a.length, b.length);
}

export interface MatchResult {
  by: MatchBy;
  score: number;
}

/**
 * Whether two products are the same item, and how the match was made. Identifiers are decisive;
 * titles match only when they overlap strongly and the brands don't conflict.
 */
export function matchKeys(a: ProductKey, b: ProductKey, titleThreshold = 0.6): MatchResult | null {
  if (a.gtin && a.gtin === b.gtin) return { by: 'gtin', score: 1 };
  if (a.sku && a.sku === b.sku && a.sku.length >= 4) return { by: 'sku', score: 1 };
  if (a.mpn && a.mpn === b.mpn && a.mpn.length >= 4) return { by: 'mpn', score: 1 };
  const brandClash = a.brand && b.brand && a.brand !== b.brand && !a.brand.includes(b.brand) && !b.brand.includes(a.brand);
  // Same product line in another size is a different product for pricing
  const sizeClash = a.size && b.size && a.size !== b.size;
  if (!brandClash && !sizeClash) {
    const score = tokenScore(a.titleTokens, b.titleTokens);
    if (score >= titleThreshold) return { by: 'title', score };
  }
  return null;
}

/** The best match for `target` among `candidates`, or null when nothing is close enough. */
export function bestMatch(target: ProductKey, candidates: Product[], titleThreshold = 0.6): { product: Product; key: ProductKey; match: MatchResult } | null {
  let best: { product: Product; key: ProductKey; match: MatchResult } | null = null;
  for (const c of candidates) {
    const key = productKey(c);
    const match = matchKeys(target, key, titleThreshold);
    if (!match) continue;
    // Identifier matches beat title matches; among title matches the higher overlap wins
    const rank = (m: MatchResult) => (m.by === 'title' ? m.score : 1 + m.score);
    if (!best || rank(match) > rank(best.match)) best = { product: c, key, match };
  }
  return best;
}

/** A short, stable id for a product, for grouping the same item across runs. */
export function groupId(k: ProductKey): string {
  if (k.gtin) return `g:${k.gtin}`;
  if (k.sku && k.sku.length >= 4) return `s:${k.sku}`;
  if (k.mpn && k.mpn.length >= 4) return `m:${k.mpn}`;
  return `t:${(k.brand ? k.brand + ' ' : '') + k.titleTokens.slice(0, 6).join(' ')}`;
}
