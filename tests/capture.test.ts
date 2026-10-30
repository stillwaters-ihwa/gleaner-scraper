// @vitest-environment happy-dom
// Page capture: structure and calls to action, design tokens, quotes, packing and records.
import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { pageStructure, selectedQuote } from '@/lib/capture/page';
import { designCss, designJson, designMarkdown, designTailwind, quoteMarkdown, sha256, sha256Sums, slug, structureMarkdown, zip } from '@/lib/capture/formats';
import { recordFiles, stampLines, timestampRequest } from '@/lib/capture/record';
import type { DesignSpec } from '@/lib/capture/page';
import type { CaptureReport } from '@/lib/capture/shot';

const LANDING = `
  <header><nav><a href="/">Home</a><a href="/pricing">Pricing</a><a class="btn" href="/signup" style="background:#c9ff68;padding:10px 16px">Start free</a></nav></header>
  <main>
    <section class="hero"><h1>Grab good pages</h1><p>Turn a page into files.</p><a class="btn" href="/signup" style="background:#c9ff68;padding:10px 16px">Start free</a></section>
    <section id="features"><h2>Features</h2><p>Markdown, JSON and more.</p></section>
    <section class="pricing"><h2>Pricing</h2><button style="background:#0c1511;color:#fff;padding:12px 20px">Choose plan</button></section>
    <section><h3>Skipped level</h3><p>Questions.</p></section>
  </main>
  <footer><a href="https://x.com/pagegrab">X</a></footer>`;

describe('page structure', () => {
  it('orders sections, finds calls to action and notes problems', () => {
    document.body.innerHTML = LANDING;
    // happy-dom has no layout: give every element a size so it counts as visible
    for (const el of Array.from(document.querySelectorAll('*')) as HTMLElement[]) el.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, width: 300, height: 120, right: 300, bottom: 120, toJSON: () => ({}) }) as DOMRect;
    const s = pageStructure();
    const kinds = s.sections.map((x) => x.kind);
    expect(kinds).toEqual(expect.arrayContaining(['header', 'hero', 'features', 'pricing', 'footer']));
    const start = s.ctas.find((c) => c.label === 'Start free');
    expect(start).toMatchObject({ kind: 'primary', count: 2 });
    expect(s.ctas.some((c) => c.label === 'Home')).toBe(false); // navigation text links are wayfinding
    expect(s.notes.join(' ')).toMatch(/skip from h2 to h3|meta description/);
    const md = structureMarkdown(s);
    expect(md).toMatch(/## Section order/);
    expect(md).toMatch(/\| Start free \| primary \|/);
  });
});

describe('quotes', () => {
  it('keeps the words, the context and a link that finds the text again', () => {
    document.body.innerHTML = '<h2>Results</h2><p>Before this. The quick brown fox jumps over the lazy dog near the river bank today. After that.</p>';
    const p = document.querySelector('p')!.firstChild!;
    const text = p.textContent!;
    const start = text.indexOf('The quick');
    const end = text.indexOf('today.') + 'today.'.length;
    const range = document.createRange();
    range.setStart(p, start);
    range.setEnd(p, end);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    const q = selectedQuote()!;
    expect(q.text).toBe('The quick brown fox jumps over the lazy dog near the river bank today.');
    expect(q.before).toMatch(/Before this/);
    expect(q.after).toMatch(/After that/);
    expect(q.heading).toBe('Results');
    expect(q.linkToText).toMatch(/#:~:text=The%20quick%20brown%20fox,the%20river%20bank%20today./);
    expect(quoteMarkdown(q)).toMatch(/^> The quick brown fox/);
  });
});

const SPEC: DesignSpec = {
  url: 'https://pagegrab.example/',
  title: 'Example',
  capturedAt: '2026-10-20T05:00:00.000Z',
  colors: [{ hex: '#0c1511', uses: 40, roles: ['text', 'background'] }, { hex: '#c9ff68', uses: 12, roles: ['background'] }],
  roles: { background: '#f4f1ea', text: '#0c1511', muted: '#5a6372', primary: '#c9ff68', accent: '#0c1511', border: '#d6dce4' },
  fonts: [{ family: 'Inter', uses: 80, weights: [400, 700] }],
  type: [{ name: 'Heading 1', tag: 'h1', fontFamily: 'Inter, sans-serif', fontSize: 48, fontWeight: 700, lineHeight: '52px', letterSpacing: '-0.5px', textTransform: 'none' }],
  spacing: { base: 8, scale: [8, 16, 24, 32] },
  radii: [{ value: '12px', uses: 9 }],
  shadows: [{ value: 'rgba(0, 0, 0, 0.1) 0px 4px 12px 0px', uses: 3 }],
  gradients: [],
  containerWidths: [1120],
  breakpoints: [640, 1024],
  variables: { '--brand': '#c9ff68' },
  layout: { grids: 3, flex: 10, columns: [3], gaps: [24] },
  transitions: [],
};

describe('design tokens', () => {
  it('writes CSS variables, W3C tokens and a Tailwind theme', () => {
    const css = designCss(SPEC);
    expect(css).toMatch(/--color-primary: #c9ff68;/);
    expect(css).toMatch(/--text-heading-1: 48px;/);
    expect(css).toMatch(/--brand: #c9ff68;/);
    const json = JSON.parse(designJson(SPEC));
    expect(json.tokens.color.primary).toEqual({ $value: '#c9ff68', $type: 'color' });
    expect(json.tokens.spacing['2']).toEqual({ $value: '16px', $type: 'dimension' });
    const tw = designTailwind(SPEC);
    expect(tw).toMatch(/"primary": "#c9ff68"/);
    expect(tw).toMatch(/"md": "1024px"/);
    expect(designMarkdown(SPEC)).toMatch(/Spacing is built on 8px/);
  });
});

describe('packing and records', () => {
  it('names files safely', () => {
    expect(slug('PageGrab — スクショを, あとで: 使える/記録 ?')).toBe('PageGrab-—-スクショを,-あとで-使える-記録');
    expect(slug('')).toBe('page');
  });

  it('zips files and fingerprints them in sha256sum format', async () => {
    const files = { 'a.txt': 'hello', 'b/c.txt': 'world' };
    const back = unzipSync(zip(files));
    expect(strFromU8(back['b/c.txt'])).toBe('world');
    expect(await sha256('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(await sha256Sums(files)).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824  a.txt\n486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7  b/c.txt\n');
  });

  const report: CaptureReport = { url: 'https://shop.example/p/1', title: 'Product', mode: 'full page', capturedAt: '2026-10-20T05:00:00.000Z', viewport: { width: 1280, height: 800 }, devicePixelRatio: 1, pageSize: { width: 1280, height: 5000 }, scrolled: 'page', reachedBottom: true, stoppedEarly: false, scrollSteps: 7, loadSeconds: 4.2, parts: [{ width: 1280, height: 5000, overlapPx: 0 }], userAgent: 'test' };

  it('keeps the original apart, lists every file with its fingerprint, and can leave the original out', async () => {
    const original = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const edited = new Blob([new Uint8Array([4, 5, 6])], { type: 'image/png' });
    const full = await recordFiles({ report, originals: [original], edited: [edited], mhtml: 'MIME-Version: 1.0', edits: [{ id: 'a', kind: 'blackout', x: 1, y: 2, w: 3, h: 4 }], crop: null, history: [{ at: report.capturedAt, action: 'captured' }] });
    expect(Object.keys(full).sort()).toEqual(['README-FIRST.md', 'SHA256SUMS.txt', 'edited/page-edited.png', 'history.json', 'original/page.png', 'page.mhtml', 'report.json', 'report.md']);
    expect(String(full['report.md'])).toMatch(/1 × blacked out \(solid\)/);
    expect(String(full['README-FIRST.md'])).toMatch(/contains the unedited original/);
    const sums = String(full['SHA256SUMS.txt']);
    expect(sums).toContain(`${await sha256(new Uint8Array([1, 2, 3]))}  original/page.png`);
    const shared = await recordFiles({ report, originals: [original], edited: [edited], edits: [], crop: null, history: [], withoutOriginal: true, evidence: { number: '甲第1号証', title: 'Product page', createdOn: '2026-10-20', author: 'Shop', purpose: 'Price shown', notes: '' } });
    expect(Object.keys(shared).some((k) => k.startsWith('original/'))).toBe(false);
    expect(String(shared['evidence-list.csv'])).toMatch(/甲第1号証/);
    expect(String(shared['timestamp-hash.txt'])).toMatch(/[0-9a-f]{64}/);
  });

  it('stamps the address and time', () => {
    const [url, when] = stampLines(report);
    expect(url).toBe('https://shop.example/p/1');
    expect(when).toMatch(/Captured .*2026-10-20T05:00:00.000Z.*whole page/);
  });

  it('builds a valid RFC 3161 timestamp request', () => {
    const sha = 'ab'.repeat(32);
    const req = timestampRequest(sha, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    // SEQUENCE { INTEGER 1, SEQUENCE { SEQUENCE { OID sha256, NULL }, OCTET STRING(32) }, INTEGER nonce, BOOLEAN true }
    expect([...req.slice(0, 5)]).toEqual([0x30, req.length - 2, 0x02, 0x01, 0x01]);
    const hex = [...req].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex).toContain('0609608648016503040201'); // sha256 OID
    expect(hex).toContain('0420' + sha);
    expect(hex.endsWith('0101ff')).toBe(true);
  });
});
