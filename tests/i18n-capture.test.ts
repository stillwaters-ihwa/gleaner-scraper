import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { JA } from '@/lib/capture/i18n-ja';
import { translate } from '@/lib/capture/i18n';

// Every English text the panel and Studio pass to tr() needs a Japanese entry
function keys(file: string) {
  const s = fs.readFileSync(file, 'utf8');
  const out = new Set<string>();
  for (const m of s.matchAll(/\btr\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) out.add(m[2].replace(/\\(['"])/g, '$1'));
  for (const m of s.matchAll(/\b(?:label|title|blurb|saves):\s*'((?:\\.|[^'])*)'/g)) out.add(m[1].replace(/\\'/g, "'"));
  return out;
}

describe('capture Japanese', () => {
  it('covers every translated string', () => {
    const all = new Set([...keys('entrypoints/studio/StudioApp.tsx'), ...keys('entrypoints/sidepanel/components/tools/PageCapture.tsx')]);
    const missing = [...all].filter((k) => k.trim() && !(k in JA));
    expect(missing).toEqual([]);
  });
  it('fills placeholders in both languages', () => {
    expect(translate('en', 'Page {i} of {n}', { i: 2, n: 5 })).toBe('Page 2 of 5');
    expect(translate('ja', 'Page {i} of {n}', { i: 2, n: 5 })).toBe('5ページ中2ページ目');
    expect(translate('ja', 'not in the table')).toBe('not in the table');
  });
  it('keeps placeholders intact in every translation', () => {
    for (const [en, ja] of Object.entries(JA)) {
      const a = (en.match(/\{\w+\}/g) ?? []).sort().join();
      const b = (ja.match(/\{\w+\}/g) ?? []).sort().join();
      expect(b, en).toBe(a);
    }
  });
  it('has no em dashes', () => {
    for (const v of Object.values(JA)) expect(v).not.toContain('—');
  });
});
