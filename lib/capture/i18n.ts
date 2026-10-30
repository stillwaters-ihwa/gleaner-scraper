// English / 日本語 for Page capture and Capture Studio. The English text is the key; Japanese
// comes from the table in i18n-ja.ts. The choice is remembered and shared between the side panel
// and the Studio.
import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { JA } from './i18n-ja';

export type Lang = 'en' | 'ja';
const KEY = 'captureLang';

/** Fills {name} placeholders. */
function fill(s: string, vars?: Record<string, string | number>) {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

export function translate(lang: Lang, en: string, vars?: Record<string, string | number>): string {
  return fill(lang === 'ja' ? (JA[en] ?? en) : en, vars);
}

/** The interface language, a setter, and `tr` for text in it. */
export function useLang() {
  const [lang, setLangState] = useState<Lang>(() => (navigator.language.startsWith('ja') ? 'ja' : 'en'));
  useEffect(() => {
    browser.storage.local
      .get(KEY)
      .then((r) => r[KEY] === 'ja' || r[KEY] === 'en' ? setLangState(r[KEY] as Lang) : undefined)
      .catch(() => {});
    const onChange = (c: Record<string, { newValue?: unknown }>, area: string) => {
      const v = c[KEY]?.newValue;
      if (area === 'local' && (v === 'ja' || v === 'en')) setLangState(v);
    };
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    void browser.storage.local.set({ [KEY]: l }).catch(() => {});
  }, []);
  const tr = useCallback((en: string, vars?: Record<string, string | number>) => translate(lang, en, vars), [lang]);
  return { lang, setLang, tr };
}
