// Readable names for list-extractor column keys like "div.card>a.product-title@href".

function words(s: string) {
  return s
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
}

const TAG_NAMES: Record<string, string> = { a: 'link', img: 'image', p: 'text', span: 'text', div: 'text', li: 'item', td: 'cell', th: 'header', time: 'date', strong: 'text', b: 'text', em: 'text', button: 'button', video: 'video', source: 'media', label: 'label', small: 'note' };
const GENERIC = new Set(['text', 'link', 'item', 'cell', 'note']);

/** Name for the element at the end of a path: its class, or a heading/semantic ancestor. */
function baseName(path: string): string {
  const segs = path.split('>');
  for (let i = segs.length - 1; i >= 0; i--) {
    const [tag, ...classes] = segs[i].split('.');
    if (classes.length) return words(classes[classes.length - 1].replace(/\\/g, ''));
    if (/^h[1-6]$/.test(tag)) return 'title';
    if (tag === 'time') return 'date';
    if (tag === 'img') return 'image';
    if (i === segs.length - 1 && TAG_NAMES[tag] && !GENERIC.has(TAG_NAMES[tag])) return TAG_NAMES[tag];
  }
  const last = segs[segs.length - 1].split('.')[0];
  return TAG_NAMES[last] ?? last;
}

export function labelForKey(key: string): string {
  const m = key.match(/^(.*)@(text|href|src|alt|title)(#\d+)?$/);
  if (!m) return key;
  const [, path, attr, dup] = m;
  let base = baseName(path);
  const has = (w: string) => base.split(' ').includes(w);
  if (attr === 'href' && !has('link') && !has('url')) base = `${base} link`;
  if (attr === 'src' && !has('image') && !has('img') && !has('thumbnail') && !has('photo')) base = `${base} image`;
  if (attr === 'alt') base = `${base} alt`;
  if (attr === 'title') base = base === 'title' ? 'full title' : `${base} title`;
  return dup ? `${base} ${dup.slice(1)}` : base;
}

/** Make labels unique by appending a counter. */
export function uniqueLabels<T extends { label: string }>(cols: T[]): T[] {
  const seen = new Map<string, number>();
  return cols.map((c) => {
    const n = (seen.get(c.label) ?? 0) + 1;
    seen.set(c.label, n);
    return n > 1 ? { ...c, label: `${c.label} ${n}` } : c;
  });
}

export const looksLikeImage = (v: string) => /^https?:\/\/\S+\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(v) || /^https?:\/\/\S+\/(image|img|media)s?\//i.test(v);
export const looksLikeUrl = (v: string) => /^https?:\/\//i.test(v);
