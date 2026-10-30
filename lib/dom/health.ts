// Is the listing page healthy, and can we jump straight to a page number?
// Runs inside the live page.
import { safeQueryAll, uniqueSelector } from './selector';

export interface PageHealth {
  ok: boolean;
  reason: '' | 'error page' | 'bot check' | 'no products';
  items: number;
  url: string;
  title: string;
}

const ERROR_TITLE = /\b(404|500|502|503|504|not found|error|exception|oops|bad gateway|service unavailable|too many requests|forbidden)\b/i;
const ERROR_TEXT = /(an unknown error occurred|page (was )?not found|page cannot be found|internal server error|server error|too many requests|runtime error|temporarily unavailable|something went wrong|error occurred while)/i;
const ERROR_PATH = /\/(exception|error|errors|404|500)(\/|$|\?|\.)/i;
const BOT = /(captcha|robot check|verify you are human|are you a human|access denied|just a moment|attention required|unusual traffic)/i;

export function pageHealth(itemSelector?: string): PageHealth {
  const title = document.title;
  const text = (document.body?.innerText ?? '').slice(0, 4000);
  const items = itemSelector ? safeQueryAll(document, itemSelector).length : -1;
  const bot = BOT.test(title) || BOT.test(text.slice(0, 800)) || !!document.querySelector('iframe[src*="captcha"], #challenge-form, form[action*="validateCaptcha"]');
  // Error wording only counts when the products are missing, so a product named "Error Free" is fine
  const error = items <= 0 && (ERROR_TITLE.test(title) || ERROR_PATH.test(location.pathname) || ERROR_TEXT.test(text) || text.trim().length < 200);
  const reason: PageHealth['reason'] = bot ? 'bot check' : error ? 'error page' : items === 0 ? 'no products' : '';
  return { ok: !reason, reason, items, url: location.href, title };
}

const PAGE_FIELD = /^(curr_?page|current_?page|cur_?page|page_?(no|num|number|index|idx)?|pg|pageindex|cpage|gotopage|pagenum)$/i;
const BLOCK_FIELD = /^(curr_?block|cur_?block|block_?(no|num|index)?|page_?block)$/i;
const BLOCK_SIZE_FIELD = /^(block_?pages|block_?size|page_?block_?size|pages_?per_?block|page_?count_?per_?block)$/i;

export interface FormPager {
  form: string;
  field: string;
  current: number;
  blockField: string | null;
  blockSize: number;
}

/** A pager that works by submitting a form with the page number (common on Korean wholesale sites). */
export function formPager(): FormPager | null {
  for (const form of Array.from(document.forms)) {
    const inputs = Array.from(form.elements).filter((e): e is HTMLInputElement => e instanceof HTMLInputElement);
    const page = inputs.find((e) => PAGE_FIELD.test(e.name) && /^\d+$/.test(e.value));
    if (!page) continue;
    const block = inputs.find((e) => BLOCK_FIELD.test(e.name) && /^\d+$/.test(e.value));
    const size = inputs.find((e) => BLOCK_SIZE_FIELD.test(e.name) && /^\d+$/.test(e.value));
    return { form: uniqueSelector(form), field: page.name, current: parseInt(page.value, 10), blockField: block?.name ?? null, blockSize: size ? parseInt(size.value, 10) : 10 };
  }
  return null;
}

/** Submit the pager form for page `n` directly. */
export function formGoto(n: number): boolean {
  const fp = formPager();
  if (!fp) return false;
  const form = document.querySelector(fp.form) as HTMLFormElement | null;
  if (!form) return false;
  (form.elements.namedItem(fp.field) as HTMLInputElement).value = String(n);
  if (fp.blockField) (form.elements.namedItem(fp.blockField) as HTMLInputElement).value = String(Math.ceil(n / Math.max(1, fp.blockSize)));
  HTMLFormElement.prototype.submit.call(form);
  return true;
}

/** The current page number shown in a numbered pager, if any. */
export function currentPageNumber(): number | null {
  const fp = formPager();
  if (fp) return fp.current;
  const el = safeQueryAll(document, '[aria-current="page"], .active > a, .active > span, li.active, .current, .selected').find((e) => /^\d+/.test((e as HTMLElement).innerText?.trim() ?? ''));
  const n = el ? parseInt((el as HTMLElement).innerText, 10) : NaN;
  return isNaN(n) ? null : n;
}
