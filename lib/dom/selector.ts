// CSS selector helpers. Runs in any document (live page or DOMParser).

const STATE_CLASS = /^(active|selected|current|hover|focus|open|is-|has-|js-|ng-|css-[a-z0-9]{5,}|sc-)/i;

/** Classes that are stable enough to use in a selector (no state or generated hashes). */
export function stableClasses(el: Element): string[] {
  return Array.from(el.classList).filter(
    (c) => !STATE_CLASS.test(c) && !/\d{3,}/.test(c) && !/[:[\]/]/.test(c) && c.length < 40,
  );
}

function esc(s: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/([^\w-])/g, '\\$1');
}

function stableId(el: Element): string | null {
  const id = el.id;
  if (!id || /\d{4,}/.test(id) || /^[0-9]/.test(id) || id.length > 40) return null;
  return id;
}

/** One selector step for el: tag plus up to two stable classes. */
export function step(el: Element, withClasses = 2): string {
  const tag = el.tagName.toLowerCase();
  const cls = stableClasses(el).slice(0, withClasses).map((c) => '.' + esc(c)).join('');
  return tag + cls;
}

/** A selector that matches exactly `el` in its document. */
export function uniqueSelector(el: Element): string {
  const doc = el.ownerDocument;
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== doc.documentElement) {
    const id = stableId(cur);
    if (id && doc.querySelectorAll('#' + esc(id)).length === 1) {
      parts.unshift('#' + esc(id));
      break;
    }
    let part = step(cur);
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.matches(part));
      if (same.length > 1) {
        const tag = cur.tagName;
        const idx = Array.from(parent.children).filter((c) => c.tagName === tag).indexOf(cur) + 1;
        part += `:nth-of-type(${idx})`;
      }
    }
    parts.unshift(part);
    const sel = parts.join(' > ');
    try {
      if (doc.querySelectorAll(sel).length === 1) return sel;
    } catch {
      /* keep climbing */
    }
    cur = parent;
  }
  return parts.join(' > ');
}

/** Path from `root` down to `el`, used as a stable column key inside list items. */
export function relativePath(root: Element, el: Element): string {
  if (root === el) return step(el, 1);
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== root) {
    parts.unshift(step(cur, 1));
    cur = cur.parentElement;
  }
  return parts.join('>');
}

export function safeQueryAll(doc: Document | Element, sel: string): Element[] {
  try {
    return Array.from(doc.querySelectorAll(sel));
  } catch {
    return [];
  }
}
