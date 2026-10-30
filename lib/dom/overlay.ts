// Highlight boxes and the element picker drawn over the live page, isolated in a shadow root.

const ACCENT = '#E3B04B';
let host: HTMLElement | null = null;
let layer: HTMLElement | null = null;
let tracked: { el: Element; label?: string; strong?: boolean }[] = [];
let raf = 0;

function ensureLayer(): HTMLElement {
  if (layer && host?.isConnected) return layer;
  host = document.createElement('gleaner-overlay');
  host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    .box{position:fixed;border:2px solid ${ACCENT};background:rgba(227,176,75,.10);border-radius:4px;box-sizing:border-box;transition:transform .08s}
    .box.soft{border-style:dashed;background:rgba(227,176,75,.05)}
    .tag{position:absolute;top:-22px;left:-2px;background:${ACCENT};color:#1A1405;font:600 11px/18px system-ui,sans-serif;padding:0 6px;border-radius:4px 4px 4px 0;white-space:nowrap}
    .hint{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);background:#161C25;color:#E7EBF1;font:500 13px/1.4 system-ui,sans-serif;padding:8px 14px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35);border:1px solid #283241}
  </style><div id="layer"></div>`;
  document.documentElement.appendChild(host);
  layer = root.getElementById('layer') as HTMLElement;
  addEventListener('scroll', schedule, true);
  addEventListener('resize', schedule);
  return layer;
}

function schedule() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(render);
}

function render() {
  const l = ensureLayer();
  l.querySelectorAll('.box').forEach((b) => b.remove());
  for (const t of tracked) {
    if (!t.el.isConnected) continue;
    const r = t.el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) continue;
    const b = document.createElement('div');
    b.className = 'box' + (t.strong ? '' : ' soft');
    b.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    if (t.label) {
      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.textContent = t.label;
      b.appendChild(tag);
    }
    l.appendChild(b);
  }
}

export function highlight(els: Element[], label?: string, scroll = true) {
  tracked = els.map((el, i) => ({ el, label: i === 0 ? label : undefined, strong: true }));
  if (scroll && els[0]) els[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
  schedule();
}

export function clearHighlight() {
  tracked = [];
  schedule();
}

function hint(text: string | null) {
  const l = ensureLayer();
  l.querySelector('.hint')?.remove();
  if (!text) return;
  const h = document.createElement('div');
  h.className = 'hint';
  h.textContent = text;
  l.appendChild(h);
}

let cancelActive: (() => void) | null = null;

/**
 * Let the user click an element on the page. `preview` turns the hovered element into the
 * elements to highlight (for example the whole list it belongs to).
 */
export function pick(message: string, preview: (el: Element) => Element[] = (el) => [el]): Promise<Element | null> {
  cancelActive?.();
  ensureLayer();
  hint(message + '  ·  Esc to cancel');
  return new Promise((resolve) => {
    let last: Element | null = null;
    const move = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === last || el === host) return;
      last = el;
      const els = preview(el);
      tracked = els.map((x, i) => ({ el: x, strong: i === 0 || els.length > 1 }));
      schedule();
    };
    const block = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    const click = (e: MouseEvent) => {
      block(e);
      const el = document.elementFromPoint(e.clientX, e.clientY);
      done(el);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        block(e);
        done(null);
      }
    };
    const done = (el: Element | null) => {
      removeEventListener('mousemove', move, true);
      removeEventListener('click', click, true);
      removeEventListener('mousedown', block, true);
      removeEventListener('mouseup', block, true);
      removeEventListener('keydown', key, true);
      hint(null);
      cancelActive = null;
      if (!el) clearHighlight();
      resolve(el);
    };
    cancelActive = () => done(null);
    addEventListener('mousemove', move, true);
    addEventListener('click', click, true);
    addEventListener('mousedown', block, true);
    addEventListener('mouseup', block, true);
    addEventListener('keydown', key, true);
  });
}

/**
 * Pick one element, with the keyboard to adjust: ↑ selects the box around it, ↓ goes back in,
 * Enter takes it. The label shows the tag and size so a button and its wrapper can be told apart.
 */
export function pickElement(message: string): Promise<Element | null> {
  cancelActive?.();
  ensureLayer();
  hint(message + '  ·  ↑ bigger  ↓ smaller  ·  Enter or click to take  ·  Esc to cancel');
  return new Promise((resolve) => {
    let current: Element | null = null;
    const trail: Element[] = [];
    const show = () => {
      if (!current) return;
      const r = current.getBoundingClientRect();
      const cls = String((current as HTMLElement).className ?? '').trim().split(/\s+/)[0];
      tracked = [{ el: current, label: `${current.tagName.toLowerCase()}${cls ? '.' + cls.slice(0, 24) : ''}  ${Math.round(r.width)}×${Math.round(r.height)}`, strong: true }];
      schedule();
    };
    const move = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === host || trail[0] === el) return;
      trail.length = 0;
      trail.push(el);
      current = el;
      show();
    };
    const block = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    const click = (e: MouseEvent) => {
      block(e);
      done(current ?? document.elementFromPoint(e.clientX, e.clientY));
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return block(e), done(null);
      if (e.key === 'Enter' && current) return block(e), done(current);
      if (e.key === 'ArrowUp' && current?.parentElement && current.parentElement !== document.body) {
        block(e);
        trail.push(current.parentElement);
        current = current.parentElement;
        show();
      }
      if (e.key === 'ArrowDown' && trail.length > 1) {
        block(e);
        trail.pop();
        current = trail[trail.length - 1];
        show();
      }
    };
    const done = (el: Element | null) => {
      removeEventListener('mousemove', move, true);
      removeEventListener('click', click, true);
      removeEventListener('mousedown', block, true);
      removeEventListener('mouseup', block, true);
      removeEventListener('keydown', key, true);
      hint(null);
      cancelActive = null;
      clearHighlight();
      resolve(el);
    };
    cancelActive = () => done(null);
    addEventListener('mousemove', move, true);
    addEventListener('click', click, true);
    addEventListener('mousedown', block, true);
    addEventListener('mouseup', block, true);
    addEventListener('keydown', key, true);
  });
}

export function cancelPick() {
  cancelActive?.();
}
