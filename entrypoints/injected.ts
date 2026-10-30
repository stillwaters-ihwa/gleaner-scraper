// Injected into the target tab on demand. Exposes a small command API on globalThis.__gleaner
// that the side panel calls through chrome.scripting.executeScript.
import { pageMetadata, productData, customFields, findEmails, findPhones, findSocials, contactLinks, readableText, type CustomField } from '@/lib/dom/doc';
import { extractItems, findLists, isVisible, itemsSignature, listFromElement, type ListCandidate } from '@/lib/dom/list';
import { cancelPick, clearHighlight, highlight, pick, pickElement } from '@/lib/dom/overlay';
import { designSpec, grabComponent, pageForAi, pageStructure, selectedQuote } from '@/lib/capture/page';
import { safeQueryAll, uniqueSelector } from '@/lib/dom/selector';
import { extractCards, findNextControl, findPageNumber, findProductList } from '@/lib/dom/cards';
import { currentPageNumber, formGoto, formPager, pageHealth } from '@/lib/dom/health';
import { extractProduct } from '@/lib/product';
import { imagesWithProducts } from '@/lib/dom/imageContext';
import { openThumbnails } from '@/lib/dom/bigImages';
import { variantPictures } from '@/lib/dom/variantPictures';
import { VERTICALS, rowsSignature, type VerticalKind } from '@/lib/verticals';
import { articleLinks, feedLinks } from '@/lib/verticals/news';
import { nextReviewsUrl } from '@/lib/verticals/reviews';
import { TECH_GLOBALS } from '@/lib/web/tech';
import { htmlTables, pageLinks } from '@/lib/dom/pageData';
import { expandTruncated, limitedView, loadMore, newestFirst, scrollPoint } from '@/lib/dom/more';
import { hasStreamedVideo, scanPage } from '@/lib/video/detect';

export default defineUnlistedScript(() => {
  const g = globalThis as any;
  if (g.__gleaner) return;
  // The industry readers fall back to reading cards on the page through the list finder
  g.__gleanerFindLists = findLists;

  let candidates: ListCandidate[] = [];
  const summary = (c: ListCandidate, index: number) => ({
    index,
    total: candidates.length,
    itemSelector: c.itemSelector,
    count: c.items.length,
  });

  const NEXT_TEXT = /^(next|next page|more results|older posts|weiter|suivant|siguiente|›|»|>|→|›››)$/i;
  const LOAD_MORE = /(load|show|view|see) more|more products|mehr laden|ver más|charger plus/i;

  function isEnabled(el: Element) {
    return !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true' && !/\bdisabled\b/.test(el.className);
  }

  function labelOf(el: Element) {
    return ((el as HTMLElement).innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
  }

  g.__gleaner = {
    ping: () => true,

    findList: (index = 0) => {
      if (!candidates.length || index === 0) candidates = findLists();
      const c = candidates[index % Math.max(1, candidates.length)];
      if (!c) return null;
      highlight(c.items, `${c.items.length} items`);
      return summary(c, index % candidates.length);
    },

    pickList: async () => {
      const el = await pick('Click any item in the list you want', (el) => listFromElement(el)?.items ?? [el]);
      if (!el) return null;
      const c = listFromElement(el);
      if (!c) return null;
      candidates = [c];
      highlight(c.items, `${c.items.length} items`, false);
      return summary(c, 0);
    },

    showList: (itemSelector: string) => {
      const items = safeQueryAll(document, itemSelector).filter(isVisible);
      highlight(items, `${items.length} items`, false);
      return items.length;
    },

    extractItems: (itemSelector: string) => extractItems(itemSelector),
    signature: (itemSelector: string) => itemsSignature(itemSelector),

    // Next button, numbered pager or "load more"
    findNext: () => findNextControl(),
    findNextControl: () => findNextControl(),
    findPageNumber: (n: number) => findPageNumber(n),

    // Product grids and product pages
    findProductList: () => findProductList(),
    extractCards: (itemSelector: string) => extractCards(itemSelector),
    fullProduct: () => extractProduct(document, location.href),

    pickElement: async (message: string) => {
      const el = await pick(message);
      if (!el) return null;
      highlight([el], undefined, false);
      return { selector: uniqueSelector(el), label: labelOf(el).slice(0, 80), tag: el.tagName.toLowerCase() };
    },

    location: () => location.href,

    // Industry readers (jobs, properties, articles, places, businesses, reviews)
    vertical: (kind: VerticalKind) => VERTICALS[kind].extract(document, location.href),
    verticalSignature: (kind: VerticalKind) => rowsSignature(VERTICALS[kind].extract(document, location.href), VERTICALS[kind].key) + '|' + location.href,
    articleLinks: (max?: number) => articleLinks(document, location.href, max),
    feedLinks: () => feedLinks(document, location.href),
    nextReviewsUrl: () => nextReviewsUrl(document, location.href),
    links: () => pageLinks(document, location.href),
    // Lists without a next page: "Show more" buttons and infinite scroll (also inside panels)
    expandTruncated: () => expandTruncated(),
    loadMore: () => loadMore(),
    scrollPoint: () => scrollPoint(),
    limitedView: () => limitedView(),
    newestFirst: () => newestFirst(),
    tables: () => htmlTables(document),
    // Page capture: structure, design system, one component, quotes, text for AI
    pageStructure: () => pageStructure(),
    designSpec: () => designSpec(),
    pageForAi: () => pageForAi(),
    selectedQuote: () => selectedQuote(),
    pickComponent: async () => {
      const el = await pickElement('Point at the part you want');
      if (!el) return null;
      // Bring it fully into view so its preview picture can be taken
      el.scrollIntoView({ block: 'center', inline: 'center' });
      await new Promise((r) => setTimeout(r, 350));
      return grabComponent(el);
    },
    // Video downloader: videos the page names, and whether it streams one we can't see yet
    videos: () => ({ found: scanPage(document, location.href), streamed: hasStreamedVideo(document), title: (document.querySelector('meta[property="og:title"]')?.getAttribute('content') || document.title || '').trim() }),
    pageSource: () => ({ html: document.documentElement.outerHTML, url: location.href, globals: TECH_GLOBALS.filter((n) => n in window) }),
    // Load a file the way this page does (with its cookies and address), for sites that only
    // serve their pictures to their own pages
    fetchAsDataUrl: async (url: string) => {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
    },
    // Guardrail: page health checks and direct page-number jumps
    pageHealth: (itemSelector?: string) => pageHealth(itemSelector),
    formPager: () => formPager(),
    formGoto: (n: number) => formGoto(n),
    currentPage: () => currentPageNumber(),
    goBack: () => {
      history.back();
      return true;
    },
    gotoUrl: (url: string) => {
      // Same-site only: listing pages move by page number in the address
      if (new URL(url, location.href).origin !== location.origin) return false;
      location.assign(url);
      return true;
    },

    clickNext: (selector: string) => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el || !isVisible(el) || !isEnabled(el)) return false;
      el.scrollIntoView({ block: 'center' });
      // Links like href="javascript:void(0)" rely on the site's own click handlers. Let those
      // run, then cancel the javascript: navigation, which the extension's CSP would block.
      const link = el.closest('a[href]');
      if (link && /^\s*javascript:/i.test(link.getAttribute('href') ?? '')) {
        const cancel = (e: Event) => {
          if (e.target instanceof Node && link.contains(e.target)) e.preventDefault();
        };
        window.addEventListener('click', cancel, { once: true });
        setTimeout(() => window.removeEventListener('click', cancel), 0);
      }
      el.click();
      return true;
    },

    scrollToEnd: (itemSelector: string) => {
      const items = safeQueryAll(document, itemSelector);
      items[items.length - 1]?.scrollIntoView({ block: 'end' });
      window.scrollBy(0, Math.round(innerHeight * 0.8));
      return items.length;
    },

    clear: () => {
      cancelPick();
      clearHighlight();
    },

    // Document-level extractors, run against the live page
    metadata: () => pageMetadata(document, location.href),
    product: () => productData(document),
    custom: (fields: CustomField[]) => customFields(document, fields, location.href),
    emails: () => findEmails(document),
    phones: () => findPhones(document),
    socials: () => findSocials(document, location.href),
    contactLinks: () => contactLinks(document, location.href),
    text: () => readableText(document, location.href),
    images: () => imagesWithProducts(),
    openThumbnails: (max?: number) => openThumbnails(max),
    variantPictures: () => variantPictures(),
  };
});
