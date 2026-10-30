// Word-list sentiment and keywords for headlines, articles and reviews. Runs offline.
// It is a simple, explainable score (like AFINN): good for sorting and spotting trends across
// many items, not a judgment on any single sentence.

// Weighted English words, -3 (very negative) to +3 (very positive)
const WORDS: Record<string, number> = {};
const add = (score: number, list: string) => list.split(' ').forEach((w) => (WORDS[w] = score));
add(3, 'excellent outstanding amazing fantastic superb perfect love loved loving wonderful brilliant exceptional incredible flawless best breakthrough triumph');
add(2, 'great good happy pleased glad impressive recommend recommended beautiful lovely enjoy enjoyed nice awesome favorite favourite gain gains surge surged soar soared record win wins won success successful strong growth boost boosted rally rallied profit profits upgrade upgraded thrive thriving praise praised helpful effective reliable smooth comfortable gentle soft fresh fast quick worth');
add(1, 'ok okay fine decent fair improve improved improving rise rose up positive hope hopeful support stable recover recovered recovery calm clean easy satisfied safe agree approved approve benefit benefits');
add(-1, 'slow slower small concern concerns concerned risk risks doubt doubts delay delayed mixed cut cuts down drop dropped decline declined lower weak weaker uncertain uncertainty issue issues problem problems pricey expensive sticky greasy oily dry');
add(-2, 'bad poor worse disappoint disappointed disappointing broken fail failed failure loss losses lose lost fall fell plunge plunged slump crisis warning warns warned sued lawsuit fraud scam fake angry hate hated refund return returned complaint complaints damaged defective leak leaked rash irritation itchy burning breakout breakouts allergic harmful useless waste wasted cheap');
add(-3, 'terrible horrible awful worst disaster disastrous catastrophic crash crashed collapse collapsed scandal dead deaths killed toxic dangerous unsafe nightmare garbage');

const NEGATE = new Set(['not', 'no', 'never', "don't", 'dont', "doesn't", 'doesnt', "didn't", 'didnt', "isn't", 'isnt', "wasn't", 'wasnt', "won't", 'wont', 'without', 'hardly', 'barely', 'neither', 'nor']);
const BOOST = new Set(['very', 'really', 'extremely', 'super', 'so', 'highly', 'totally', 'absolutely', 'incredibly']);

const STOP = new Set(
  'a an the and or but if then than of in on at to for from by with about as into over after before under between is are was were be been being it its this that these those i me my we our you your he she they them their his her him not no so very can will just also more most some any all each such only own same too s t do does did have has had would could should may might must there here what which who whom when where why how up out off again further once one two new get got make made use used like really much many even still'.split(' '),
);

export const tokens = (text: string) => text.toLowerCase().replace(/[^a-z0-9가-힣'\s-]/g, ' ').split(/\s+/).filter(Boolean);

/** Sentiment for one text: a score per 100 words (comparable across lengths) and a label. */
export function sentiment(text: string): { score: number; label: 'positive' | 'neutral' | 'negative'; hits: number } {
  const ws = tokens(text);
  if (!ws.length) return { score: 0, label: 'neutral', hits: 0 };
  let total = 0;
  let hits = 0;
  for (let i = 0; i < ws.length; i++) {
    const v = WORDS[ws[i]];
    if (!v) continue;
    let s = v;
    const prev = ws.slice(Math.max(0, i - 3), i);
    if (prev.some((p) => NEGATE.has(p))) s = -s * 0.8;
    if (BOOST.has(ws[i - 1])) s *= 1.5;
    total += s;
    hits++;
  }
  // Normalize so a long article and a one-line review are on one scale
  const score = Math.round((total / Math.sqrt(ws.length)) * 10) / 10;
  const label = score >= 0.5 ? 'positive' : score <= -0.5 ? 'negative' : 'neutral';
  return { score, label, hits };
}

/** The most common meaningful words and two-word phrases in some texts. */
export function keywords(texts: string[], n = 12): string[] {
  const counts = new Map<string, number>();
  for (const t of texts) {
    const seen = new Set<string>();
    // Two-word phrases never cross punctuation ("strong smell, sticky texture" has no "smell sticky")
    for (const clause of t.split(/[.,;:!?()\n—–]+/)) {
      const ws = tokens(clause).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
      for (let i = 0; i < ws.length; i++) {
        for (const k of [ws[i], i + 1 < ws.length ? `${ws[i]} ${ws[i + 1]}` : '']) {
          if (!k || seen.has(k)) continue; // count each term once per text, so one long text can't dominate
          seen.add(k);
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
      }
    }
  }
  const ranked = [...counts.entries()].filter(([k, c]) => c >= (texts.length > 3 ? 2 : 1) && (k.includes(' ') ? c >= 2 : true)).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  const out: string[] = [];
  for (const [k] of ranked) {
    // Prefer a phrase over the single words inside it
    if (out.some((o) => o.includes(' ') && o.split(' ').includes(k))) continue;
    out.push(k);
    if (out.length >= n) break;
  }
  return out;
}
