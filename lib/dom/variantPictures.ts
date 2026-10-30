// Each variant's picture on a product page. From the variant data the page publishes when there
// is some; otherwise by choosing each colour or size option, as a person would, and noting the
// main picture (and price) it shows. Runs in the page.
import { isVisible } from './list';
import { imgSrc } from './doc';
import { extractVariants } from '../variants';

export interface VariantPicture {
  variant: string;
  image: string;
  price?: string;
  sku?: string;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const BUY = /add to (cart|bag|basket)|buy (it )?now|장바구니|구매|カートに入れる|in den warenkorb|ajouter au panier/i;
const PRICE = /([$€£¥₩₱]|USD|EUR|KRW)\s?\d[\d,.]*|\d[\d,.]*\s?(원|円|USD|EUR)/;

// Site settings, never product options: changing them reloads the page in another language or order
const SITE_SETTING = /lang|locale|language|currency|country|region|sort|order|per.?page|limit|view|display|정렬|언어|통화/i;
const LANGUAGE_NAMES = /^(english|한국어|中文|简体中文|繁體中文|日本語|español|français|deutsch|русский|tiếng việt|ไทย|bahasa|eng|kor|chn|jpn|en|ko|zh|ja)$/i;

/** The block around the product: the form with the buy button and the title. Null when the page has neither. */
function productArea(): Element | null {
  const buy = (Array.from(document.querySelectorAll('button, input[type="submit"], a')) as HTMLElement[]).find((b) => BUY.test(clean(b.innerText || (b as HTMLInputElement).value)) && isVisible(b));
  const h1 = document.querySelector('h1');
  for (let el = (buy ?? h1)?.parentElement ?? null; el && el !== document.body; el = el.parentElement) {
    if (h1 && el.contains(h1) && (!buy || el.contains(buy)) && el.querySelector('img')) return el;
    if (!h1 && buy && el.querySelector('img') && el.querySelector('select, input[type="radio"], [class*="swatch" i]')) return el;
  }
  // No product block to work in: choosing options page-wide would change the site's own settings
  return document.querySelector('form[action*="cart" i], .product, #product, [itemtype*="Product"]');
}

/** The biggest visible picture in the product area (the main gallery picture). */
function mainPicture(area: Element): HTMLImageElement | null {
  let best: HTMLImageElement | null = null;
  let size = 0;
  for (const img of Array.from(area.querySelectorAll('img')) as HTMLImageElement[]) {
    if (!isVisible(img) || !img.naturalWidth) continue;
    const r = img.getBoundingClientRect();
    if (r.width * r.height > size) ((size = r.width * r.height), (best = img));
  }
  return best;
}

const priceText = (area: Element) => clean((Array.from(area.querySelectorAll('[class*="price" i], [itemprop="price"], [data-price]')) as HTMLElement[]).find((e) => isVisible(e) && PRICE.test(e.innerText))?.innerText.match(PRICE)?.[0]);

type Choice = { label: string; pick: () => void };

/** The variant choices on the page: drop-down lists, radio swatches and swatch buttons. */
function choices(area: Element): Choice[][] {
  const groups: Choice[][] = [];
  for (const sel of Array.from(area.querySelectorAll('select')) as HTMLSelectElement[]) {
    if (!isVisible(sel) && !sel.closest('[class*="swatch" i], [class*="variant" i], [class*="option" i]')) continue;
    if (/qty|quantity|수량|数量/i.test(sel.name + sel.id)) continue;
    if (SITE_SETTING.test(`${sel.name} ${sel.id} ${sel.className} ${sel.getAttribute('aria-label') ?? ''}`) || sel.closest('header, nav, footer, [class*="header" i], [class*="gnb" i], [class*="language" i], [class*="sort" i], [class*="toolbar" i]')) continue;
    if (Array.from(sel.options).filter((o) => LANGUAGE_NAMES.test(clean(o.text))).length >= 2) continue;
    const opts = Array.from(sel.options).filter((o) => o.value && !o.disabled && !/^(choose|select|pick)\b|^-+$/i.test(clean(o.text)));
    if (opts.length < 2) continue;
    groups.push(opts.map((o) => ({ label: clean(o.text), pick: () => ((sel.value = o.value), sel.dispatchEvent(new Event('input', { bubbles: true })), sel.dispatchEvent(new Event('change', { bubbles: true }))) })));
  }
  const radios = new Map<string, HTMLInputElement[]>();
  for (const r of Array.from(area.querySelectorAll('input[type="radio"]')) as HTMLInputElement[]) if (r.name && !/qty|quantity|subscri|delivery|shipping/i.test(r.name)) radios.set(r.name, [...(radios.get(r.name) ?? []), r]);
  for (const list of radios.values()) {
    if (list.length < 2) continue;
    groups.push(
      list.map((r) => {
        const label = r.labels?.[0] ?? r.closest('label');
        return { label: clean(label?.innerText || r.value || r.getAttribute('aria-label')), pick: () => (label as HTMLElement | null)?.click() ?? r.click() };
      }),
    );
  }
  if (!groups.length) {
    // Swatch buttons: several siblings that each carry a value
    const swatches = (Array.from(area.querySelectorAll('[data-value], [data-option-value], [class*="swatch" i] button, [class*="swatch" i] li, [class*="swatch" i] a')) as HTMLElement[]).filter((e) => isVisible(e) && !e.closest('nav, header, footer'));
    const byParent = new Map<Element, HTMLElement[]>();
    for (const s of swatches) if (s.parentElement) byParent.set(s.parentElement, [...(byParent.get(s.parentElement) ?? []), s]);
    for (const list of byParent.values()) if (list.length >= 2) groups.push(list.map((s) => ({ label: clean(s.getAttribute('data-value') ?? s.getAttribute('data-option-value') ?? s.getAttribute('title') ?? s.getAttribute('aria-label') ?? s.innerText), pick: () => s.click() })));
  }
  return groups.map((g) => g.filter((c) => c.label)).filter((g) => g.length >= 2);
}

/** Each variant's picture, from the page's data or by choosing each option. */
export async function variantPictures(maxPerGroup = 20, budgetMs = 45000): Promise<VariantPicture[]> {
  const fromData = extractVariants(document, location.href).filter((v) => v.image);
  if (fromData.length) return fromData.map((v) => ({ variant: v.name || Object.values(v.options).join(' / '), image: v.image!, price: v.price, sku: v.sku }));

  const start = Date.now();
  // A listing (several buy buttons) has filters, not variants: choosing them would change the search
  const buys = (Array.from(document.querySelectorAll('button, input[type="submit"], a')) as HTMLElement[]).filter((b) => BUY.test(clean(b.innerText || (b as HTMLInputElement).value)) && isVisible(b));
  if (buys.length > 2) return [];
  const area = productArea();
  if (!area) return [];
  // The choices as they are now, to put back at the end
  const selects = (Array.from(area.querySelectorAll('select')) as HTMLSelectElement[]).map((s) => [s, s.value] as const);
  const checked = (Array.from(area.querySelectorAll('input[type="radio"]:checked')) as HTMLInputElement[]);
  const out: VariantPicture[] = [];
  const at = { x: scrollX, y: scrollY };
  // Stay on the page: option links that would navigate are stopped after the page's own code runs
  const stay = (e: Event) => (e.target as Element | null)?.closest?.('a[href]') && e.preventDefault();
  addEventListener('click', stay);
  try {
    for (const group of choices(area).slice(0, 3)) {
      for (const c of group.slice(0, maxPerGroup)) {
        if (Date.now() - start > budgetMs) break;
        const before = mainPicture(area);
        const beforeSrc = before ? imgSrc(before, location.href, true) : '';
        c.pick();
        // Wait for the picture to change and load
        let now = beforeSrc;
        for (let t = 0; t < 15; t++) {
          await wait(100);
          const img = mainPicture(area);
          now = img && img.complete ? imgSrc(img, location.href, true) : now;
          if (now && now !== beforeSrc) break;
        }
        if (now) out.push({ variant: c.label, image: now, price: priceText(area) });
      }
    }
  } finally {
    for (const [s, v] of selects) if (s.value !== v) ((s.value = v), s.dispatchEvent(new Event('change', { bubbles: true })));
    for (const r of checked) if (!r.checked) ((r.labels?.[0] as HTMLElement | undefined) ?? r).click();
    removeEventListener('click', stay);
    scrollTo(at.x, at.y);
  }
  // Only options that changed the picture are worth keeping as variant pictures
  const seen = new Map<string, VariantPicture>();
  for (const v of out) if (!seen.has(v.image)) seen.set(v.image, v);
  return seen.size > 1 ? [...seen.values()] : [];
}
