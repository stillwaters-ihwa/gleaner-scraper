// Reading a page for reuse: its structure and calls to action, its design system (colours, type,
// spacing, corners, shadows, layout), a single component with the styles that make it look the
// way it does, and selected text with where it came from. Runs inside the page.
import { isVisible } from '../dom/list';
import { uniqueSelector } from '../dom/selector';

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const docTop = (el: Element) => el.getBoundingClientRect().top + scrollY;

function rgbToHex(c: string): string {
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
  if (!m) return c.startsWith('#') ? c.toLowerCase() : '';
  if (m[4] !== undefined && Number(m[4]) < 0.05) return '';
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
}
const px = (v: string) => (v.endsWith('px') ? Math.round(parseFloat(v) * 10) / 10 : NaN);

function actionLabel(el: Element): string {
  const e = el as HTMLElement;
  return clean(e.innerText || e.getAttribute('aria-label') || (e as HTMLInputElement).value || e.getAttribute('title')).slice(0, 120);
}

// ---------- Structure and calls to action ----------

// Whole words only: "invoices" is not a testimonial, "planner" is not a price list
const SECTION_SIGNALS: [string, RegExp][] = [
  ['hero', /\b(hero|banner|jumbotron|masthead|main-?visual|key-?visual|first-?view|mv|splash|intro)\b/i],
  ['logos', /\b(logos?|clients|partners|brands|trusted by|used by|as seen)\b/i],
  ['features', /\b(features?|benefits?|services?|advantages?|why us|how it works|capabilities)\b/i],
  ['testimonials', /\b(testimonials?|reviews?|what (our )?(customers|clients|people) say|customer stories|case stud(y|ies)|voices)\b/i],
  ['pricing', /\b(pricing|prices?|plans and pricing|plans|tiers|subscriptions?)\b|料金|価格/i],
  ['faq', /\b(faqs?|questions|q-?and-?a)\b|よくある質問|자주/i],
  ['stats', /\b(stats|statistics|numbers|metrics|results|impact)\b/i],
  ['team', /\b(team|about us|founders?|our people)\b/i],
  ['blog', /\b(blog|news|articles|insights|resources)\b/i],
  ['contact', /\b(contact( us)?|get in touch|reach us|support)\b/i],
  ['cta', /\b(cta|call-?to-?action|sign-?up|register|get started|subscribe|apply now|book a)\b/i],
];

export interface PageSection {
  index: number;
  kind: string;
  tag: string;
  selector: string;
  heading: string;
  preview: string;
  ctas: string[];
  images: number;
  height: number;
  top: number;
  background: string;
}
export interface PageCta {
  label: string;
  href: string;
  kind: 'primary' | 'secondary' | 'text link';
  place: string;
  count: number;
  top: number;
  color: string;
  background: string;
  radius: string;
  fontSize: string;
  fontWeight: string;
}
export interface PageStructure {
  url: string;
  title: string;
  description: string;
  lang: string;
  capturedAt: string;
  viewport: { width: number; height: number };
  pageHeight: number;
  sections: PageSection[];
  outline: { level: number; text: string }[];
  ctas: PageCta[];
  links: { internal: number; external: number; anchors: number };
  forms: { fields: string[]; submit: string }[];
  images: number;
  videos: number;
  social: Record<string, string>;
  notes: string[];
}

function classifySection(el: Element, heading: string): string {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role') ?? '';
  if (tag === 'nav' || role === 'navigation') return 'navigation';
  if (tag === 'header' || role === 'banner') return 'header';
  if (tag === 'footer' || role === 'contentinfo') return 'footer';
  // The page's own names for the block first (id, class), then its heading
  const named = `${el.id} ${String((el as HTMLElement).className ?? '').replace(/[-_]/g, ' ')} ${el.getAttribute('aria-label') ?? ''}`;
  for (const [kind, re] of SECTION_SIGNALS) if (re.test(named)) return kind;
  for (const [kind, re] of SECTION_SIGNALS) if (kind !== 'hero' && re.test(heading)) return kind;
  // The first big block with a heading and a button is the hero
  if (docTop(el) < innerHeight * 0.9 && el.querySelector('h1, h2') && el.querySelector('a[href], button')) return 'hero';
  const body = clean(el.textContent);
  if (el.querySelector('form')) return 'form';
  if (el.querySelector('a[href], button') && body.length < 400) return 'cta';
  return 'content';
}

/** The page's top-level blocks: from the main element's children, or the body's. */
function sectionElements(): Element[] {
  const main = document.querySelector('main, [role="main"]');
  const pool = new Set<Element>();
  for (const el of Array.from(document.querySelectorAll('body > header, body > nav, header[role="banner"], nav, footer, [role="contentinfo"]'))) if (!el.closest('main')) pool.add(el);
  const containers = [main, document.body].filter(Boolean) as Element[];
  for (const c of containers) {
    let kids = Array.from(c.children).filter((k) => isVisible(k) && !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|LINK)$/.test(k.tagName));
    // A single wrapper div around everything: look inside it
    for (let depth = 0; depth < 4 && kids.length === 1 && kids[0].children.length > 1; depth++) kids = Array.from(kids[0].children).filter((k) => isVisible(k));
    for (const k of kids) if (k.getBoundingClientRect().height >= 60) pool.add(k);
  }
  for (const s of Array.from(document.querySelectorAll('section, [role="region"]'))) if (isVisible(s) && s.getBoundingClientRect().height >= 80) pool.add(s);
  // Keep the innermost blocks: wrappers (main, a page div) give way to the sections inside them,
  // and anything inside the page header or footer is part of it
  const all = [...pool].filter((el) => el.tagName !== 'MAIN' && el !== document.body);
  const frame = (el: Element) => /^(HEADER|FOOTER)$/.test(el.tagName) || /^(banner|contentinfo)$/.test(el.getAttribute('role') ?? '');
  const list = all.filter((el) => !all.some((o) => o !== el && frame(o) && o.contains(el)) && (frame(el) || !all.some((o) => o !== el && el.contains(o))));
  return list.sort((a, b) => docTop(a) - docTop(b)).slice(0, 60);
}

function ctaKind(el: Element, style: CSSStyleDeclaration): PageCta['kind'] {
  const bg = rgbToHex(style.backgroundColor);
  const filled = !!bg && bg !== rgbToHex(getComputedStyle(document.body).backgroundColor);
  const bordered = parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== 'none';
  if (filled && (el.tagName === 'BUTTON' || /btn|button|cta/i.test(String((el as HTMLElement).className)) || parseFloat(style.paddingLeft) >= 10)) return 'primary';
  if (bordered || el.tagName === 'BUTTON' || /btn|button/i.test(String((el as HTMLElement).className))) return 'secondary';
  return 'text link';
}

export function pageStructure(): PageStructure {
  const notes: string[] = [];
  const sectionEls = sectionElements();
  const sections = sectionEls.map((el, i) => {
    const heading = clean(el.querySelector('h1, h2, h3, [role="heading"]')?.textContent).slice(0, 140);
    const r = el.getBoundingClientRect();
    const ctas = [...new Set(Array.from(el.querySelectorAll('a[href], button, [role="button"], input[type="submit"]')).filter(isVisible).map(actionLabel).filter((l) => l && l.length <= 60))].slice(0, 8);
    return {
      index: i + 1,
      kind: classifySection(el, heading),
      tag: el.tagName.toLowerCase(),
      selector: uniqueSelector(el),
      heading,
      preview: clean((el as HTMLElement).innerText).slice(0, 220),
      ctas,
      images: el.querySelectorAll('img, picture, svg[role="img"], video').length,
      height: Math.round(r.height),
      top: Math.round(docTop(el)),
      background: rgbToHex(getComputedStyle(el).backgroundColor) || 'transparent',
    };
  });
  const outline = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    .filter(isVisible)
    .map((h) => ({ level: Number(h.tagName[1]), text: clean(h.textContent).slice(0, 160) }))
    .filter((h) => h.text)
    .slice(0, 200);
  if (outline.filter((h) => h.level === 1).length !== 1) notes.push(`The page has ${outline.filter((h) => h.level === 1).length} main headings (h1); one is usual.`);
  for (let i = 1; i < outline.length; i++) if (outline[i].level > outline[i - 1].level + 1) {
    notes.push(`Heading levels skip from h${outline[i - 1].level} to h${outline[i].level} at "${outline[i].text.slice(0, 50)}".`);
    break;
  }

  const sectionOf = (el: Element) => sections[sectionEls.findIndex((s) => s.contains(el))]?.kind ?? 'page';
  const grouped = new Map<string, PageCta>();
  for (const el of Array.from(document.querySelectorAll('a[href], button, input[type="submit"], input[type="button"], [role="button"]'))) {
    if (!isVisible(el) || el.closest('[aria-hidden="true"]')) continue;
    const label = actionLabel(el);
    if (!label || label.length > 80) continue;
    const href = el instanceof HTMLAnchorElement ? el.href : (el as HTMLButtonElement).form?.action ?? '';
    const style = getComputedStyle(el);
    const kind = ctaKind(el, style);
    const place = el.closest('nav, header') ? 'navigation' : el.closest('footer') ? 'footer' : sectionOf(el);
    // Navigation and footer text links are wayfinding, not calls to action
    if (kind === 'text link' && (place === 'navigation' || place === 'footer' || place === 'header')) continue;
    const key = `${label.toLowerCase()}|${href}`;
    const had = grouped.get(key);
    if (had) {
      had.count++;
      continue;
    }
    grouped.set(key, { label, href, kind, place, count: 1, top: Math.round(docTop(el)), color: rgbToHex(style.color), background: rgbToHex(style.backgroundColor) || 'none', radius: style.borderTopLeftRadius, fontSize: style.fontSize, fontWeight: style.fontWeight });
  }
  const ctas = [...grouped.values()].sort((a, b) => (a.kind === b.kind ? a.top - b.top : ['primary', 'secondary', 'text link'].indexOf(a.kind) - ['primary', 'secondary', 'text link'].indexOf(b.kind))).slice(0, 80);
  const primary = ctas.filter((c) => c.kind === 'primary');
  if (!primary.length) notes.push('No filled call-to-action button was found.');
  else if (primary[0].top > innerHeight) notes.push(`The first main call to action ("${primary[0].label}") is below the first screen.`);
  const labels = new Set(primary.map((c) => c.label.toLowerCase()));
  if (labels.size > 3) notes.push(`${labels.size} different main call-to-action labels; pages usually repeat one or two.`);

  let internal = 0;
  let external = 0;
  let anchors = 0;
  for (const a of Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[]) {
    if (a.getAttribute('href')!.startsWith('#')) anchors++;
    else if (a.hostname === location.hostname) internal++;
    else if (/^https?:/.test(a.protocol)) external++;
  }
  const forms = Array.from(document.querySelectorAll('form')).filter(isVisible).map((f) => ({
    fields: Array.from(f.querySelectorAll('input:not([type=hidden]):not([type=submit]), select, textarea')).map((i) => clean((i as HTMLInputElement).labels?.[0]?.textContent || i.getAttribute('placeholder') || i.getAttribute('aria-label') || i.getAttribute('name') || i.tagName.toLowerCase())).slice(0, 20),
    submit: actionLabel(f.querySelector('[type=submit], button') ?? f),
  }));
  const social: Record<string, string> = {};
  for (const m of Array.from(document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"]'))) social[m.getAttribute('property') ?? m.getAttribute('name') ?? ''] = m.getAttribute('content') ?? '';
  if (!document.querySelector('meta[name="description"]')) notes.push('The page has no meta description.');
  const missingAlt = (Array.from(document.querySelectorAll("img")) as HTMLImageElement[]).filter((i) => isVisible(i) && i.width > 60 && !i.hasAttribute('alt')).length;
  if (missingAlt) notes.push(`${missingAlt} visible images have no alt text.`);
  return {
    url: location.href,
    title: document.title.trim(),
    description: document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? '',
    lang: document.documentElement.lang || '',
    capturedAt: new Date().toISOString(),
    viewport: { width: innerWidth, height: innerHeight },
    pageHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
    sections,
    outline,
    ctas,
    links: { internal, external, anchors },
    forms,
    images: (Array.from(document.querySelectorAll("img")) as HTMLImageElement[]).filter(isVisible).length,
    videos: document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"]').length,
    social,
    notes,
  };
}

// ---------- Design specification ----------

export interface DesignSpec {
  url: string;
  title: string;
  capturedAt: string;
  colors: { hex: string; uses: number; roles: string[] }[];
  roles: { background: string; text: string; muted: string; primary: string; accent: string; border: string };
  fonts: { family: string; uses: number; weights: number[] }[];
  type: { name: string; tag: string; fontFamily: string; fontSize: number; fontWeight: number; lineHeight: string; letterSpacing: string; textTransform: string }[];
  spacing: { base: number; scale: number[] };
  radii: { value: string; uses: number }[];
  shadows: { value: string; uses: number }[];
  gradients: string[];
  containerWidths: number[];
  breakpoints: number[];
  variables: Record<string, string>;
  layout: { grids: number; flex: number; columns: number[]; gaps: number[] };
  transitions: string[];
}

const top = <T,>(m: Map<T, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const bump = <T,>(m: Map<T, number>, k: T, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

export function designSpec(): DesignSpec {
  const els = (Array.from(document.querySelectorAll('body, body *')) as HTMLElement[]).filter((el) => !/^(SCRIPT|STYLE|NOSCRIPT|META|LINK|TEMPLATE|BR|SOURCE|TRACK)$/.test(el.tagName)).slice(0, 6000);
  const colorUse = new Map<string, number>();
  const colorRoles = new Map<string, Set<string>>();
  const role = (hex: string, r: string, w = 1) => {
    if (!hex) return;
    bump(colorUse, hex, w);
    if (!colorRoles.has(hex)) colorRoles.set(hex, new Set());
    colorRoles.get(hex)!.add(r);
  };
  const fontUse = new Map<string, number>();
  const fontWeights = new Map<string, Set<number>>();
  const spacing = new Map<number, number>();
  const radii = new Map<string, number>();
  const shadows = new Map<string, number>();
  const gradients = new Set<string>();
  const widths = new Map<number, number>();
  const transitions = new Set<string>();
  const columns = new Map<number, number>();
  const gaps = new Map<number, number>();
  let grids = 0;
  let flex = 0;
  const textBg = new Map<string, number>();
  const textColor = new Map<string, number>();
  const ctaBg = new Map<string, number>();

  for (const el of els) {
    if (!isVisible(el)) continue;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const area = Math.max(1, Math.min(r.width * r.height, 2e6));
    const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && clean(n.textContent).length > 1);
    const bg = rgbToHex(s.backgroundColor);
    if (bg) {
      role(bg, 'background', Math.ceil(area / 20000));
      bump(textBg, bg, Math.ceil(area / 20000));
    }
    if (hasText) {
      const c = rgbToHex(s.color);
      role(c, 'text', 2);
      bump(textColor, c, clean(el.textContent).length > 40 ? 3 : 1);
      const fam = s.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      bump(fontUse, fam);
      if (!fontWeights.has(fam)) fontWeights.set(fam, new Set());
      fontWeights.get(fam)!.add(Number(s.fontWeight));
    }
    if (parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none') role(rgbToHex(s.borderTopColor), 'border');
    if (/^(A|BUTTON)$/.test(el.tagName) && bg && parseFloat(s.paddingLeft) >= 8) bump(ctaBg, bg, 3);
    if (s.backgroundImage.includes('gradient')) gradients.add(s.backgroundImage.slice(0, 300));
    for (const p of [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft, s.marginTop, s.marginBottom, s.rowGap, s.columnGap]) {
      const v = px(p);
      if (v > 0 && v <= 200) bump(spacing, Math.round(v));
    }
    if (s.borderTopLeftRadius !== '0px') bump(radii, s.borderTopLeftRadius);
    if (s.boxShadow && s.boxShadow !== 'none') bump(shadows, s.boxShadow.slice(0, 200));
    if (s.maxWidth.endsWith('px') && px(s.maxWidth) >= 600) bump(widths, px(s.maxWidth));
    if (s.transitionDuration && s.transitionDuration !== '0s') transitions.add(`${s.transitionProperty} ${s.transitionDuration} ${s.transitionTimingFunction}`.slice(0, 120));
    if (s.display.includes('grid')) {
      grids++;
      const cols = s.gridTemplateColumns.split(' ').filter((x) => x && x !== 'none').length;
      if (cols > 1) bump(columns, cols);
      if (px(s.columnGap) > 0) bump(gaps, px(s.columnGap));
    } else if (s.display.includes('flex')) {
      flex++;
      if (px(s.columnGap) > 0) bump(gaps, px(s.columnGap));
    }
  }

  // Type scale: one row per element kind
  const typeOf = (name: string, sel: string) => {
    const el = (Array.from(document.querySelectorAll(sel)) as HTMLElement[]).find((e) => isVisible(e) && clean(e.textContent));
    if (!el) return null;
    const s = getComputedStyle(el);
    return { name, tag: sel.split(',')[0], fontFamily: s.fontFamily, fontSize: px(s.fontSize), fontWeight: Number(s.fontWeight), lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, textTransform: s.textTransform };
  };
  const type = [
    typeOf('Heading 1', 'h1'),
    typeOf('Heading 2', 'h2'),
    typeOf('Heading 3', 'h3'),
    typeOf('Heading 4', 'h4'),
    typeOf('Body', 'main p, article p, p'),
    typeOf('Small', 'small, figcaption, .caption'),
    typeOf('Link', 'main a, a'),
    typeOf('Button', 'button, a[class*="btn" i], a[class*="button" i]'),
    typeOf('Navigation', 'nav a'),
    typeOf('Label', 'label'),
  ].filter(Boolean) as DesignSpec['type'];

  // Spacing: the common values and the unit they're built on (4 or 8 usually)
  const scale = top(spacing, 14).map(([v]) => v).sort((a, b) => a - b);
  const base = [8, 4, 6, 5, 10].find((b) => scale.filter((v) => v % b === 0).length >= scale.length * 0.7) ?? (scale[0] || 4);

  // Breakpoints and custom properties from the page's own stylesheets (when readable)
  const bps = new Set<number>();
  const variables: Record<string, string> = {};
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // another site's stylesheet: not readable
    }
    const walk = (list: CSSRuleList) => {
      for (const rule of Array.from(list)) {
        if (rule instanceof CSSMediaRule) {
          for (const m of rule.conditionText.matchAll(/(min|max)-width:\s*([\d.]+)(px|em|rem)/g)) bps.add(Math.round(Number(m[2]) * (m[3] === 'px' ? 1 : 16)));
          walk(rule.cssRules);
        } else if (rule instanceof CSSStyleRule && /^(:root|html|body)$/.test(rule.selectorText.trim())) {
          for (const p of Array.from(rule.style)) if (p.startsWith('--') && Object.keys(variables).length < 300) variables[p] = rule.style.getPropertyValue(p).trim();
        }
      }
    };
    walk(rules);
  }
  const rootStyle = getComputedStyle(document.documentElement);
  for (const k of Object.keys(variables)) variables[k] = rootStyle.getPropertyValue(k).trim() || variables[k];

  const pageBg = rgbToHex(getComputedStyle(document.body).backgroundColor) || rgbToHex(getComputedStyle(document.documentElement).backgroundColor) || '#ffffff';
  const textMain = top(textColor, 3);
  const primary = top(ctaBg, 2)[0]?.[0] ?? '';
  const accent = top(ctaBg, 3).map(([c]) => c).find((c) => c !== primary) ?? '';
  const colors = top(colorUse, 24).map(([hex, uses]) => ({ hex, uses, roles: [...(colorRoles.get(hex) ?? [])] }));
  return {
    url: location.href,
    title: document.title.trim(),
    capturedAt: new Date().toISOString(),
    colors,
    roles: {
      background: top(textBg, 1)[0]?.[0] ?? pageBg,
      text: textMain[0]?.[0] ?? '',
      muted: textMain[1]?.[0] ?? '',
      primary,
      accent,
      border: colors.find((c) => c.roles.includes('border'))?.hex ?? '',
    },
    fonts: top(fontUse, 6).map(([family, uses]) => ({ family, uses, weights: [...(fontWeights.get(family) ?? [])].sort((a, b) => a - b) })),
    type,
    spacing: { base, scale },
    radii: top(radii, 8).map(([value, uses]) => ({ value, uses })),
    shadows: top(shadows, 6).map(([value, uses]) => ({ value, uses })),
    gradients: [...gradients].slice(0, 8),
    containerWidths: top(widths, 4).map(([w]) => w).sort((a, b) => a - b),
    breakpoints: [...bps].filter((b) => b >= 320 && b <= 2560).sort((a, b) => a - b),
    variables,
    layout: { grids, flex, columns: top(columns, 4).map(([c]) => c), gaps: top(gaps, 5).map(([g]) => g) },
    transitions: [...transitions].slice(0, 8),
  };
}

// ---------- One component ----------

export interface ComponentGrab {
  url: string;
  title: string;
  capturedAt: string;
  selector: string;
  tag: string;
  text: string;
  html: string;
  css: string;
  width: number;
  height: number;
  /** Where it is on the page, for the preview picture (CSS pixels from the top left of the page). */
  rect: { x: number; y: number; width: number; height: number };
  /** Where it is in the visible area (CSS pixels), for cropping a screenshot of the window. */
  view: { x: number; y: number; width: number; height: number };
  devicePixelRatio: number;
  fonts: string[];
  colors: string[];
  images: string[];
}

// Properties that decide how a component looks. Values equal to a plain element's are dropped.
const KEEP = ['display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'box-sizing', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'flex-grow', 'flex-shrink', 'flex-basis', 'gap', 'row-gap', 'column-gap', 'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'order', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'text-decoration-line', 'white-space', 'color', 'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius', 'box-shadow', 'opacity', 'overflow-x', 'overflow-y', 'object-fit', 'transform', 'transition', 'cursor', 'list-style-type', 'vertical-align', 'fill', 'stroke'];

let defaults: Map<string, CSSStyleDeclaration> | null = null;
function defaultStyle(tag: string): CSSStyleDeclaration {
  defaults ??= new Map();
  if (!defaults.has(tag)) {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
    document.documentElement.appendChild(frame);
    const d = frame.contentDocument!;
    const el = d.createElement(tag);
    // A link only looks like a link (blue, underlined) when it has an address
    if (tag === 'a') el.setAttribute('href', '#');
    d.body.appendChild(el);
    const s = frame.contentWindow!.getComputedStyle(el);
    const copy = {} as Record<string, string>;
    for (const p of KEEP) copy[p] = s.getPropertyValue(p);
    frame.remove();
    defaults.set(tag, { getPropertyValue: (p: string) => copy[p] ?? '' } as CSSStyleDeclaration);
  }
  return defaults.get(tag)!;
}

export function grabComponent(root: Element): ComponentGrab {
  const all = [root, ...Array.from(root.querySelectorAll('*'))].slice(0, 800);
  const clone = root.cloneNode(true) as Element;
  const cloneAll = [clone, ...Array.from(clone.querySelectorAll('*'))].slice(0, 800);
  const rules: string[] = [];
  const fonts = new Set<string>();
  const colors = new Set<string>();
  const images = new Set<string>();
  all.forEach((el, i) => {
    const c = cloneAll[i];
    if (!c) return;
    const cls = `g-${i}`;
    // Keep the page's own classes out: the exported CSS is all that styles it
    c.removeAttribute('class');
    c.removeAttribute('style');
    for (const a of Array.from(c.attributes)) if (/^on|^data-(?!src)|^js|^ng-|^v-|^_ngcontent/i.test(a.name)) c.removeAttribute(a.name);
    c.setAttribute('class', cls);
    if (c.tagName === 'A' && c.getAttribute('href')) c.setAttribute('href', (el as HTMLAnchorElement).href);
    if (c.tagName === 'IMG') {
      const src = (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src;
      c.setAttribute('src', src);
      c.removeAttribute('srcset');
      c.removeAttribute('loading');
      images.add(src);
    }
    if (/^(SCRIPT|NOSCRIPT|IFRAME)$/.test(c.tagName)) {
      c.remove();
      return;
    }
    const s = getComputedStyle(el);
    const d = defaultStyle(el.tagName.toLowerCase());
    const decl: string[] = [];
    for (const p of KEEP) {
      let v = s.getPropertyValue(p);
      if (!v || v === d.getPropertyValue(p)) continue;
      // Sizes of the root come from the page layout; keep them, but let inner text flow
      if ((p === 'width' || p === 'height') && i > 0 && !/^(IMG|SVG|VIDEO|CANVAS|svg)$/.test(el.tagName) && s.display !== 'inline-block') continue;
      if ((p === 'top' || p === 'left' || p === 'right' || p === 'bottom') && i === 0) continue;
      if (p === 'position' && i === 0 && /fixed|sticky/.test(v)) v = 'relative';
      if (p === 'background-image' && v.includes('url(')) for (const m of v.matchAll(/url\("?(.*?)"?\)/g)) images.add(m[1]);
      decl.push(`  ${p}: ${v};`);
    }
    if (i === 0) for (const p of ['margin-top', 'margin-right', 'margin-bottom', 'margin-left']) {
      const at = decl.findIndex((x) => x.startsWith(`  ${p}:`));
      if (at >= 0) decl.splice(at, 1);
    }
    fonts.add(s.fontFamily.split(',')[0].replace(/["']/g, '').trim());
    for (const v of [s.color, s.backgroundColor, s.borderTopColor]) {
      const h = rgbToHex(v);
      if (h) colors.add(h);
    }
    if (decl.length) rules.push(`.${cls} {\n${decl.join('\n')}\n}`);
    // Hover look, when the page's stylesheet says so (readable stylesheets only)
  });
  const r = root.getBoundingClientRect();
  return {
    url: location.href,
    title: document.title.trim(),
    capturedAt: new Date().toISOString(),
    selector: uniqueSelector(root),
    tag: root.tagName.toLowerCase(),
    text: clean((root as HTMLElement).innerText).slice(0, 2000),
    html: clone.outerHTML,
    css: rules.join('\n\n'),
    width: Math.round(r.width),
    height: Math.round(r.height),
    rect: { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height },
    view: { x: r.left, y: r.top, width: r.width, height: r.height },
    devicePixelRatio: devicePixelRatio,
    fonts: [...fonts].filter(Boolean),
    colors: [...colors].slice(0, 20),
    images: [...images].filter((u) => /^https?:/.test(u)).slice(0, 50),
  };
}

// ---------- Selected text with its source ----------

export interface Quote {
  text: string;
  before: string;
  after: string;
  heading: string;
  url: string;
  linkToText: string;
  title: string;
  author: string;
  published: string;
  site: string;
  capturedAt: string;
}

/** The selected text, the sentences around it, and a link that jumps straight to it. */
export function selectedQuote(): Quote | null {
  const sel = getSelection();
  const text = clean(sel?.toString());
  if (!sel || !text || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const block = (range.commonAncestorContainer.nodeType === 1 ? (range.commonAncestorContainer as Element) : range.commonAncestorContainer.parentElement)?.closest('p, li, blockquote, td, article, section, div') ?? document.body;
  const whole = clean((block as HTMLElement).innerText);
  const at = whole.indexOf(text);
  // Up to 300 characters each side, trimmed to whole words only where the excerpt was cut
  const from = Math.max(0, at - 300);
  const to = at + text.length + 300;
  const before = at > 0 ? (from > 0 ? whole.slice(from, at).replace(/^\S*\s/, '') : whole.slice(0, at)).trim() : '';
  const after = at >= 0 ? (to < whole.length ? whole.slice(at + text.length, to).replace(/\s\S*$/, '') : whole.slice(at + text.length)).trim() : '';
  // Nearest heading above the selection
  let heading = '';
  const hs = Array.from(document.querySelectorAll('h1, h2, h3, h4')).filter((h) => h.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING || h.contains(block));
  if (hs.length) heading = clean(hs[hs.length - 1].textContent).slice(0, 160);
  // Text fragment link (#:~:text=start,end) so the quote can be found again
  const words = text.split(' ');
  const enc = (s: string) => encodeURIComponent(s).replace(/-/g, '%2D');
  const fragment = words.length > 8 ? `${enc(words.slice(0, 4).join(' '))},${enc(words.slice(-4).join(' '))}` : enc(text);
  const base = location.href.split('#')[0];
  const meta = (n: string) => document.querySelector(`meta[name="${n}"], meta[property="${n}"]`)?.getAttribute('content')?.trim() ?? '';
  return {
    text: sel.toString().trim(),
    before,
    after,
    heading,
    url: location.href,
    linkToText: `${base}#:~:text=${fragment}`,
    title: document.title.trim(),
    author: meta('author') || meta('article:author'),
    published: meta('article:published_time') || document.querySelector('time[datetime]')?.getAttribute('datetime') || '',
    site: meta('og:site_name') || location.hostname,
    capturedAt: new Date().toISOString(),
  };
}

// ---------- Page text for AI ----------

export interface PageForAi {
  url: string;
  title: string;
  html: string;
  kind: 'post' | 'article' | 'page';
  /** For X (Twitter) posts: the post itself, read from the page. */
  post?: { author: string; handle: string; time: string; text: string; images: string[]; replies: { author: string; text: string }[] };
  images: { src: string; alt: string }[];
  capturedAt: string;
}

export function pageForAi(): PageForAi {
  const images = ((Array.from(document.querySelectorAll("img")) as HTMLImageElement[]) as HTMLImageElement[])
    .filter((i) => isVisible(i) && i.naturalWidth >= 120 && i.naturalHeight >= 80 && !/logo|icon|avatar|sprite|emoji/i.test(`${i.currentSrc} ${i.className} ${i.alt}`))
    .map((i) => ({ src: i.currentSrc || i.src, alt: clean(i.alt) }))
    .filter((i, n, a) => /^https?:/.test(i.src) && a.findIndex((x) => x.src === i.src) === n)
    .slice(0, 80);
  let post: PageForAi['post'];
  if (/(^|\.)(x|twitter)\.com$/.test(location.hostname) && /\/status\//.test(location.pathname)) {
    const tweets = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    const read = (t: Element) => ({
      author: clean(t.querySelector('[data-testid="User-Name"] span')?.textContent),
      handle: clean(Array.from(t.querySelectorAll('[data-testid="User-Name"] span')).map((s) => s.textContent).find((x) => x?.startsWith('@'))),
      time: t.querySelector('time')?.getAttribute('datetime') ?? '',
      text: (t.querySelector('[data-testid="tweetText"]') as HTMLElement | null)?.innerText.trim() ?? '',
      images: Array.from(t.querySelectorAll('[data-testid="tweetPhoto"] img')).map((i) => (i as HTMLImageElement).src.replace(/name=\w+/, 'name=orig')),
    });
    if (tweets[0]) {
      const main = read(tweets[0]);
      post = { ...main, replies: tweets.slice(1, 30).map(read).map((r) => ({ author: `${r.author} ${r.handle}`.trim(), text: r.text })).filter((r) => r.text) };
    }
  }
  return {
    url: location.href,
    title: document.title.trim(),
    html: document.documentElement.outerHTML,
    kind: post ? 'post' : document.querySelector('article, [itemtype*="Article"], meta[property="og:type"][content="article"]') ? 'article' : 'page',
    post,
    images,
    capturedAt: new Date().toISOString(),
  };
}
