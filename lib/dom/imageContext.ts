// Tie each picture to the product it shows, so files can be named after the product or SKU.
// Product cards on listing pages give one product per card; on a product page, the gallery
// around the title (and og:image) belongs to that page's product.
import { findImages, imgSrc, type ImageInfo } from './doc';
import { safeQueryAll } from './selector';
import { cardProduct, findProductList } from './cards';
import { extractProduct, isAmazon, type Product } from '../product';
import { amazonGallery } from '../amazon';
import { extractVariants } from '../variants';

const OTHER_PRODUCTS = '[class*="related" i], [class*="recommend" i], [class*="upsell" i], [class*="cross-sell" i], [class*="similar" i], [class*="also-" i], [id*="related" i], [id*="recommend" i]';
const CHROME = 'header, footer, nav, [role="banner"], [role="contentinfo"], [role="navigation"]';

function tag(img: ImageInfo, p: Product) {
  img.product ||= p.title ?? '';
  img.sku ||= p.sku || p.asin || '';
  img.brand ||= p.brand ?? '';
  img.part ||= p.part_number ?? '';
}

const isBig = (el: HTMLImageElement, live: boolean) =>
  live ? Math.max(el.naturalWidth, el.naturalHeight) >= 200 : !(Number(el.getAttribute('width')) > 0 && Number(el.getAttribute('width')) < 200);

/** The block around the product title that holds its gallery, or null when the page isn't a product page. */
function galleryZone(doc: Document, live: boolean): Element | null {
  const h1 = doc.querySelector('h1');
  for (let el = h1?.parentElement; el && el !== doc.body; el = el.parentElement) {
    if ((el.textContent ?? '').length > 40000) return null;
    const imgs = safeQueryAll(el, 'img') as HTMLImageElement[];
    if (imgs.some((i) => !i.closest(OTHER_PRODUCTS) && !i.closest(CHROME) && isBig(i, live))) return el;
  }
  return null;
}

/** Attach the page's own product to its gallery pictures and og:image. Works on fetched pages too. */
export function withPageProduct(images: ImageInfo[], doc: Document, url: string, live = false): ImageInfo[] {
  const p = extractProduct(doc, url);
  // Each variant's picture (colour, size), from the variant data the page publishes
  const bySrcAll = new Map(images.map((i) => [i.src, i]));
  for (const v of extractVariants(doc, url).filter((x) => x.image)) {
    const name = v.name || Object.values(v.options).join(' / ');
    const hit = bySrcAll.get(v.image!);
    if (hit) ((hit.variant ||= name), (hit.sku ||= v.sku ?? ''));
    else {
      const img: ImageInfo = { src: v.image!, alt: name, width: 0, height: 0, page: url, sku: v.sku ?? '', variant: name };
      images.push(img);
      bySrcAll.set(img.src, img);
    }
  }
  if (!p.title || p.error || !(p.price || p.sku || p.gtin || p.part_number || p.asin)) return images;
  // Amazon: the shown variant's full gallery (hi-res) from the page's own data, as this product's pictures
  if (isAmazon(url)) {
    for (const src of amazonGallery(doc)) {
      const img = images.find((i) => i.src === src) ?? (images.push({ src, alt: p.title ?? '', width: 0, height: 0, page: url }), images[images.length - 1]);
      tag(img, p);
    }
    return images;
  }
  const bySrc = new Map(images.map((i) => [i.src, i]));
  const zone = galleryZone(doc, live);
  if (zone) {
    for (const el of safeQueryAll(zone, 'img') as HTMLImageElement[]) {
      if (el.closest(OTHER_PRODUCTS) || el.closest(CHROME)) continue;
      const img = bySrc.get(imgSrc(el, url, live));
      if (img) tag(img, p);
    }
  }
  for (const img of images) if (img.alt === 'og:image' || (p.image && img.src === p.image)) tag(img, p);
  for (const img of images) if (img.variant) tag(img, p);
  return images;
}

/** Live page: every picture, with product details from product cards and the product page itself. */
export function imagesWithProducts(): ImageInfo[] {
  const url = location.href;
  const images = findImages(document, url, true);
  const bySrc = new Map(images.map((i) => [i.src, i]));
  const list = findProductList();
  if (list) {
    for (const card of safeQueryAll(document, list.itemSelector)) {
      const imgs = safeQueryAll(card, 'img') as HTMLImageElement[];
      if (!imgs.length) continue;
      const p = cardProduct(card);
      if (!p.title && !p.sku) continue;
      for (const el of imgs) {
        const img = bySrc.get(imgSrc(el, url, true));
        if (img) tag(img, p);
      }
    }
  }
  return withPageProduct(images, document, url, true);
}
