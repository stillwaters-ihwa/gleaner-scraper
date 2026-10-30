// Files made from a page: Markdown for AI tools, a structure report, design tokens as CSS /
// JSON / Tailwind, a component as standalone HTML, a quote with its source, and ZIP packing with
// SHA-256 fingerprints. Pure functions (no browser APIs beyond TextEncoder and crypto.subtle).
import { strToU8, zipSync } from 'fflate';
import type { ComponentGrab, DesignSpec, PageStructure, Quote } from './page';

export type FileMap = Record<string, Uint8Array | string>;

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const local = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : `${d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'long' })} (${d.toISOString()})`;
};

/** A short, file-safe name from a page title or address. */
export function slug(s: string, max = 60): string {
  return (
    s
      .normalize('NFKC')
      .replace(/https?:\/\//, '')
      .replace(/[\\/:*?"<>|#%&{}$!'@+`=\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, max) || 'page'
  );
}

/** "2026-10-20_1432" in local time, for folder and file names. */
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// ---------- Structure ----------

export function structureMarkdown(s: PageStructure): string {
  const L: string[] = [];
  L.push(`# Page structure: ${s.title || s.url}`, '');
  L.push(`- Address: ${s.url}`, `- Read: ${local(s.capturedAt)}`, `- Window: ${s.viewport.width}×${s.viewport.height}, page height ${s.pageHeight}px`);
  if (s.description) L.push(`- Description: ${s.description}`);
  if (s.lang) L.push(`- Language: ${s.lang}`);
  L.push('', '## Section order', '');
  L.push(s.sections.map((x) => x.kind).filter((k, i, a) => k !== a[i - 1]).join(' → ') || '(no sections found)', '');
  L.push('| # | Kind | Heading | Calls to action | Images | Height |', '|---|---|---|---|---|---|');
  for (const x of s.sections) L.push(`| ${x.index} | ${x.kind} | ${esc(x.heading || x.preview.slice(0, 60))} | ${esc(x.ctas.slice(0, 4).join(', '))} | ${x.images} | ${x.height}px |`);
  L.push('', '## Calls to action', '');
  if (!s.ctas.length) L.push('None found.');
  else {
    L.push('| Label | Kind | Where | Times shown | Goes to | Look |', '|---|---|---|---|---|---|');
    for (const c of s.ctas.slice(0, 40)) L.push(`| ${esc(c.label)} | ${c.kind} | ${c.place} | ${c.count} | ${esc(c.href.slice(0, 80))} | ${c.background !== 'none' ? `${c.background} on ` : ''}${c.color}, ${c.fontSize} ${c.fontWeight}, radius ${c.radius} |`);
  }
  L.push('', '## Headings', '');
  for (const h of s.outline.slice(0, 80)) L.push(`${'  '.repeat(Math.max(0, h.level - 1))}- h${h.level}: ${h.text}`);
  L.push('', '## Links and forms', '', `- ${s.links.internal} links within the site, ${s.links.external} to other sites, ${s.links.anchors} to places on this page`, `- ${s.images} images, ${s.videos} videos`);
  for (const f of s.forms) L.push(`- Form: ${f.fields.join(', ') || '(no labelled fields)'}; button "${f.submit}"`);
  if (s.notes.length) L.push('', '## Worth a look', '', ...s.notes.map((n) => `- ${n}`));
  return L.join('\n') + '\n';
}

// ---------- Design tokens ----------

const name = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function designCss(d: DesignSpec): string {
  const L = [`/* Design tokens read from ${d.url} on ${d.capturedAt}. Values as the browser computed them. */`, ':root {'];
  for (const [k, v] of Object.entries(d.roles)) if (v) L.push(`  --color-${k}: ${v};`);
  d.colors.slice(0, 16).forEach((c, i) => L.push(`  --color-${i + 1}: ${c.hex}; /* ${c.roles.join(', ')} */`));
  d.fonts.forEach((f, i) => L.push(`  --font-${i === 0 ? 'body' : i === 1 ? 'display' : i + 1}: "${f.family}", system-ui, sans-serif;`));
  for (const t of d.type) L.push(`  --text-${name(t.name)}: ${t.fontSize}px;`, `  --leading-${name(t.name)}: ${t.lineHeight};`, `  --weight-${name(t.name)}: ${t.fontWeight};`);
  d.spacing.scale.forEach((v, i) => L.push(`  --space-${i + 1}: ${v}px;`));
  d.radii.forEach((r, i) => L.push(`  --radius-${i + 1}: ${r.value};`));
  d.shadows.forEach((s, i) => L.push(`  --shadow-${i + 1}: ${s.value};`));
  d.containerWidths.forEach((w, i) => L.push(`  --container-${i + 1}: ${w}px;`));
  L.push('}');
  if (Object.keys(d.variables).length) {
    L.push('', '/* The page\'s own custom properties */', ':root {');
    for (const [k, v] of Object.entries(d.variables)) L.push(`  ${k}: ${v};`);
    L.push('}');
  }
  L.push('', '/* Type styles */');
  for (const t of d.type) L.push(`.${name(t.name)} { font-family: ${t.fontFamily}; font-size: ${t.fontSize}px; font-weight: ${t.fontWeight}; line-height: ${t.lineHeight};${t.letterSpacing !== 'normal' ? ` letter-spacing: ${t.letterSpacing};` : ''}${t.textTransform !== 'none' ? ` text-transform: ${t.textTransform};` : ''} }`);
  return L.join('\n') + '\n';
}

/** Design tokens in the W3C Design Tokens format ($value / $type). */
export function designJson(d: DesignSpec): string {
  const color: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d.roles)) if (v) color[k] = { $value: v, $type: 'color' };
  d.colors.forEach((c, i) => (color[`palette-${i + 1}`] = { $value: c.hex, $type: 'color', $description: `${c.roles.join(', ')}; ${c.uses} uses` }));
  const tokens = {
    $description: `Read from ${d.url} on ${d.capturedAt}`,
    color,
    font: Object.fromEntries(d.fonts.map((f, i) => [i === 0 ? 'body' : i === 1 ? 'display' : `font-${i + 1}`, { $value: [f.family, 'system-ui', 'sans-serif'], $type: 'fontFamily', $description: `weights ${f.weights.join(', ')}` }])),
    typography: Object.fromEntries(d.type.map((t) => [name(t.name), { $type: 'typography', $value: { fontFamily: t.fontFamily, fontSize: `${t.fontSize}px`, fontWeight: t.fontWeight, lineHeight: t.lineHeight, letterSpacing: t.letterSpacing } }])),
    spacing: Object.fromEntries(d.spacing.scale.map((v, i) => [String(i + 1), { $value: `${v}px`, $type: 'dimension' }])),
    radius: Object.fromEntries(d.radii.map((r, i) => [String(i + 1), { $value: r.value, $type: 'dimension' }])),
    shadow: Object.fromEntries(d.shadows.map((s, i) => [String(i + 1), { $value: s.value, $type: 'shadow' }])),
    breakpoint: Object.fromEntries(d.breakpoints.map((b) => [`${b}`, { $value: `${b}px`, $type: 'dimension' }])),
  };
  return JSON.stringify({ tokens, source: d }, null, 2);
}

export function designTailwind(d: DesignSpec): string {
  const colors: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.roles)) if (v) colors[k] = v;
  const fontFamily: Record<string, string[]> = {};
  d.fonts.slice(0, 3).forEach((f, i) => (fontFamily[i === 0 ? 'sans' : i === 1 ? 'display' : 'extra'] = [f.family, 'system-ui', 'sans-serif']));
  const fontSize: Record<string, [string, { lineHeight: string; fontWeight: string }]> = {};
  for (const t of d.type) fontSize[name(t.name)] = [`${t.fontSize}px`, { lineHeight: t.lineHeight === 'normal' ? '1.4' : t.lineHeight, fontWeight: String(t.fontWeight) }];
  const spacing = Object.fromEntries(d.spacing.scale.map((v) => [String(v / 4).replace('.', '_'), `${v}px`]));
  const borderRadius = Object.fromEntries(d.radii.slice(0, 5).map((r, i) => [['sm', 'DEFAULT', 'md', 'lg', 'xl'][i], r.value]));
  const boxShadow = Object.fromEntries(d.shadows.slice(0, 4).map((s, i) => [['sm', 'DEFAULT', 'md', 'lg'][i], s.value]));
  const screens = Object.fromEntries(d.breakpoints.slice(0, 6).map((b, i) => [['sm', 'md', 'lg', 'xl', '2xl', '3xl'][i], `${b}px`]));
  const maxWidth = Object.fromEntries(d.containerWidths.map((w, i) => [`container-${i + 1}`, `${w}px`]));
  const theme = { extend: { colors, fontFamily, fontSize, spacing, borderRadius, boxShadow, maxWidth }, ...(Object.keys(screens).length ? { screens } : {}) };
  return `// Tailwind theme read from ${d.url} on ${d.capturedAt}\n/** @type {import('tailwindcss').Config} */\nexport default ${JSON.stringify({ theme }, null, 2)};\n`;
}

export function designMarkdown(d: DesignSpec): string {
  const L = [`# Design specification: ${d.title || d.url}`, '', `- Address: ${d.url}`, `- Read: ${local(d.capturedAt)}`, ''];
  L.push('## Colour roles', '', ...Object.entries(d.roles).filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`), '');
  L.push('## Palette (most used first)', '', ...d.colors.slice(0, 16).map((c) => `- ${c.hex}: ${c.roles.join(', ')} (${c.uses})`), '');
  L.push('## Type', '', '| Style | Font | Size | Weight | Line height | Spacing |', '|---|---|---|---|---|---|');
  for (const t of d.type) L.push(`| ${t.name} (${t.tag}) | ${esc(t.fontFamily.split(',')[0])} | ${t.fontSize}px | ${t.fontWeight} | ${t.lineHeight} | ${t.letterSpacing} |`);
  L.push('', `Fonts: ${d.fonts.map((f) => `${f.family} (${f.weights.join('/')})`).join(', ')}`, '');
  L.push('## Spacing, corners, depth', '', `- Spacing is built on ${d.spacing.base}px: ${d.spacing.scale.map((v) => `${v}px`).join(', ')}`, `- Corner radii: ${d.radii.map((r) => r.value).join(', ') || 'square'}`, `- Shadows: ${d.shadows.length ? d.shadows.map((s) => `\`${s.value}\``).join('; ') : 'none'}`);
  if (d.gradients.length) L.push(`- Gradients: ${d.gradients.map((g) => `\`${g}\``).join('; ')}`);
  L.push('', '## Layout', '', `- Content widths: ${d.containerWidths.map((w) => `${w}px`).join(', ') || 'not fixed'}`, `- Breakpoints: ${d.breakpoints.map((b) => `${b}px`).join(', ') || 'not readable (styles from another site)'}`, `- ${d.layout.grids} grid and ${d.layout.flex} flex containers; grid columns used: ${d.layout.columns.join(', ') || 'none'}; gaps: ${d.layout.gaps.map((g) => `${g}px`).join(', ') || 'none'}`);
  if (d.transitions.length) L.push(`- Motion: ${d.transitions.slice(0, 4).map((t) => `\`${t}\``).join('; ')}`);
  L.push('', 'Files: tokens.css (CSS variables), tokens.json (W3C design tokens), tailwind.config.js (Tailwind theme).');
  return L.join('\n') + '\n';
}

// ---------- Component ----------

export function componentHtml(c: ComponentGrab): string {
  const fonts = c.fonts.filter((f) => !/^(system-ui|-apple-system|sans-serif|serif|monospace|arial|helvetica|times)/i.test(f));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Component from ${c.title.replace(/</g, '&lt;')}</title>
<!-- From ${c.url} (${c.selector}) on ${c.capturedAt}.${fonts.length ? ` Fonts used: ${fonts.join(', ')} (load them for an exact match).` : ''} -->
<style>body{margin:0;padding:32px;background:#f4f5f7;font-family:system-ui,sans-serif}.stage{display:inline-block;max-width:100%}</style>
<style>
/* The component's styles (also in component.css) */
${c.css}
</style>
</head>
<body>
<div class="stage" style="width:${c.width}px">
${c.html}
</div>
</body>
</html>
`;
}

export function componentJson(c: ComponentGrab): string {
  const { html, css, ...rest } = c;
  return JSON.stringify({ ...rest, htmlBytes: html.length, cssRules: css.split('\n}\n').length }, null, 2);
}

// ---------- Quote ----------

export function quoteMarkdown(q: Quote): string {
  const by = [q.author, q.site].filter(Boolean).join(', ');
  return [
    `> ${q.text.split('\n').join('\n> ')}`,
    '',
    `Source: [${q.title || q.url}](${q.linkToText})${by ? ` (${by})` : ''}${q.published ? `, published ${q.published.slice(0, 10)}` : ''}`,
    `Captured: ${local(q.capturedAt)}`,
    q.heading ? `Section: ${q.heading}` : '',
    '',
    '<details><summary>Context</summary>',
    '',
    `…${q.before} **${q.text}** ${q.after}…`,
    '',
    '</details>',
    '',
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n');
}

// ---------- Packing ----------

export async function sha256(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? strToU8(data) : data;
  const h = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** "sha256  path" lines, the format `sha256sum -c` reads. */
export async function sha256Sums(files: FileMap): Promise<string> {
  const lines: string[] = [];
  for (const [path, data] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) lines.push(`${await sha256(data)}  ${path}`);
  return lines.join('\n') + '\n';
}

export function zip(files: FileMap): Uint8Array {
  const input: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(files)) input[path] = typeof data === 'string' ? strToU8(data) : data;
  // Pictures are already compressed; text compresses well
  return zipSync(input, { level: 6, mtime: new Date() });
}
