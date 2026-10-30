// Image downloader helpers: full-size URLs, measuring (real pixels, file size, duplicates),
// size classes, file names from product details, and format conversion.
import type { ImageInfo } from './dom/doc';

export type SizeClass = 'S' | 'M' | 'L' | 'XL';
export const SIZE_CLASSES: SizeClass[] = ['S', 'M', 'L', 'XL'];
export const SIZE_LABEL: Record<SizeClass, string> = { S: 'Small', M: 'Medium', L: 'Large', XL: 'Extra large' };
/** Shown in the UI so the classes are never a mystery. */
export const SIZE_RULE: Record<SizeClass, string> = { S: 'under 500 px', M: '500 to 999 px', L: '1000 to 1999 px', XL: '2000 px and up' };

/**
 * Size class from the longest side in pixels. When the pixels are unknown (a picture that
 * couldn't be decoded), the file size decides: under 60 KB, 250 KB, 1 MB, then larger.
 */
export function sizeClass(width: number, height: number, bytes: number): SizeClass | '' {
  const side = Math.max(width, height);
  if (side > 0) return side < 500 ? 'S' : side < 1000 ? 'M' : side < 2000 ? 'L' : 'XL';
  if (bytes > 0) return bytes < 60_000 ? 'S' : bytes < 250_000 ? 'M' : bytes < 1_000_000 ? 'L' : 'XL';
  return '';
}

export function formatBytes(n: number) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The original-size version of a resized picture, for image hosts with a known pattern.
 * Returns '' when there is nothing to upgrade.
 */
export function fullSizeUrl(src: string): string {
  let u: URL;
  try {
    u = new URL(src);
  } catch {
    return '';
  }
  const before = u.href;
  const host = u.hostname;
  // Shopify: name_300x300.jpg, name_large.jpg, ?width=300
  if (/cdn\.shopify\.com$/.test(host) || u.pathname.includes('/cdn/shop/')) {
    u.pathname = u.pathname.replace(/_(\d+x\d*|\d*x\d+|pico|icon|thumb|small|compact|medium|large|grande|master)(@\dx)?(_crop_[a-z]+)?(?=\.[a-z0-9]+$)/i, '');
    for (const k of ['width', 'height', 'crop']) u.searchParams.delete(k);
  }
  // WordPress: photo-300x300.jpg
  else if (u.pathname.includes('/wp-content/uploads/')) {
    u.pathname = u.pathname.replace(/-\d{2,4}x\d{2,4}(?=\.(jpe?g|png|gif|webp)$)/i, '');
  }
  // Amazon: 71abc._AC_SX300_.jpg
  else if (/(media-amazon|images-amazon|ssl-images-amazon)\.com$/.test(host)) {
    u.pathname = u.pathname.replace(/\._[^/]*_\.(jpe?g|png|webp)$/i, '.$1');
  }
  // Wix: media/abc.jpg/v1/fill/w_300,h_300/abc.jpg
  else if (/wixstatic\.com$/.test(host)) {
    u.pathname = u.pathname.replace(/(\/media\/[^/]+\.(jpe?g|png|webp|gif))\/v1\/.*$/i, '$1');
  }
  // Squarespace: ?format=300w
  else if (/squarespace-cdn\.com$/.test(host) && u.searchParams.has('format')) {
    u.searchParams.set('format', '2500w');
  }
  // Cafe24 (many Korean stores): /product/small/ -> /product/big/
  else if (/\/web\/product\/(tiny|small|medium|extra\/small)\//.test(u.pathname)) {
    u.pathname = u.pathname.replace(/\/web\/product\/(tiny|small|medium|extra\/small)\//, '/web/product/big/');
  }
  // Wikimedia: /thumb/a/ab/Name.jpg/300px-Name.jpg -> /a/ab/Name.jpg
  else if (/(upload|thumb)\.wikimedia\.org$/.test(host) && u.pathname.includes('/thumb/')) {
    u.hostname = 'upload.wikimedia.org';
    u.pathname = u.pathname.replace(/\/thumb(\/.+?\/[^/]+\.\w+)\/[^/]+$/, '$1');
  }
  // Cloudinary: /image/upload/w_300,h_300,c_fill/v123/name.jpg -> /image/upload/v123/name.jpg
  else if (/res\.cloudinary\.com$/.test(host)) {
    u.pathname = u.pathname.replace(/\/(image\/upload)\/(?:[a-z]{1,3}_[^/]+\/)+/i, '/$1/');
  }
  // imgix and other resizing services: ?w=300&h=300&fit=crop
  else if (/imgix\.net$/.test(host) || ['w', 'h', 'width', 'height', 'resize', 'fit', 'crop', 'dpr', 'q'].filter((k) => u.searchParams.has(k)).length >= 1 && /\.(jpe?g|png|webp|gif)$/i.test(u.pathname)) {
    for (const k of ['w', 'h', 'width', 'height', 'resize', 'fit', 'crop', 'dpr', 'q', 'auto']) u.searchParams.delete(k);
  }
  return u.href === before ? '' : u.href;
}

export interface Measured extends ImageInfo {
  /** URL that will be downloaded (the full-size one when it worked). */
  src: string;
  /** URL as found on the page, when a full-size version replaced it. */
  foundAs?: string;
  bytes: number;
  type: string;
  ext: string;
  size: SizeClass | '';
  hash: string;
  failed?: boolean;
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico' };

export function extFromUrl(src: string) {
  const m = src.split(/[?#]/)[0].match(/\.(jpe?g|png|gif|webp|avif|svg|bmp|ico)$/i);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : '';
}

async function dimensions(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const bmp = await createImageBitmap(blob);
    const d = { width: bmp.width, height: bmp.height };
    bmp.close();
    return d;
  } catch {
    // SVG only decodes through an <img>
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { width: img.naturalWidth, height: img.naturalHeight };
    } catch {
      return { width: 0, height: 0 };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function hashOf(buf: ArrayBuffer) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', buf));
  return Array.from(d.slice(0, 10), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Loads a picture as the page would. Some shops (many Korean ones) only serve their pictures to
 * their own pages, so when a direct download is refused, `viaPage` asks the open tab to load it.
 */
export type ViaPage = (url: string) => Promise<Blob>;

export async function fetchImage(url: string, signal?: AbortSignal, viaPage?: ViaPage): Promise<Blob> {
  try {
    const res = await fetch(url, { signal, credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const type = (blob.type || res.headers.get('content-type') || '').split(';')[0];
    if (type && !type.startsWith('image/') && type !== 'application/octet-stream') throw new Error(`not an image (${type})`);
    return blob;
  } catch (e) {
    if (!viaPage || signal?.aborted) throw e;
    const blob = await viaPage(url);
    if (!blob.size || (blob.type && !blob.type.startsWith('image/'))) throw e;
    return blob;
  }
}

/** A ViaPage that loads pictures through a tab's own page. */
export function viaTab(call: (tabId: number, command: string, ...args: any[]) => Promise<any>, tabId: number): ViaPage {
  return async (url) => {
    const dataUrl: string = await call(tabId, 'fetchAsDataUrl', url);
    return (await fetch(dataUrl)).blob();
  };
}

async function measureOne(img: ImageInfo, fullSize: boolean, signal: AbortSignal, viaPage?: ViaPage): Promise<Measured> {
  // The big version found for a small picture first, then a known full-size address, then the picture itself
  // Known full-size addresses first (the original file), then the bigger version the page showed, then the picture itself
  const tries = fullSize ? [...new Set([fullSizeUrl(img.big ?? ''), fullSizeUrl(img.src), img.big ?? '', img.src].filter(Boolean))] : [img.src];
  for (const url of tries) {
    try {
      // Through the page too, for shops that only serve pictures to their own pages
      const blob = await fetchImage(url, signal, viaPage);
      const buf = await blob.arrayBuffer();
      const { width, height } = await dimensions(blob);
      // A "full-size" URL that decodes smaller than what the page showed isn't an upgrade
      if (url !== img.src && Math.max(width, height) < Math.max(img.width, img.height)) continue;
      const type = blob.type.split(';')[0];
      return {
        ...img,
        src: url,
        foundAs: url !== img.src ? img.src : undefined,
        width: width || img.width,
        height: height || img.height,
        bytes: buf.byteLength,
        type,
        ext: EXT[type] ?? (extFromUrl(url) || 'jpg'),
        size: sizeClass(width || img.width, height || img.height, buf.byteLength),
        hash: await hashOf(buf),
      };
    } catch (e) {
      if (signal.aborted) throw e;
    }
  }
  return { ...img, bytes: 0, type: '', ext: extFromUrl(img.src) || 'jpg', size: sizeClass(img.width, img.height, 0), hash: '', failed: true };
}

/**
 * Download every picture once to learn its real pixels, file size and content. Identical
 * pictures (same bytes under different URLs) are merged, keeping the first one's product.
 */
export async function measureImages(
  images: ImageInfo[],
  opts: { fullSize: boolean; signal: AbortSignal; concurrency?: number; viaPage?: ViaPage; onProgress: (done: number, total: number, failed: number) => void },
): Promise<{ images: Measured[]; duplicates: number; upgraded: number }> {
  const out: Measured[] = new Array(images.length);
  let next = 0;
  let done = 0;
  let failed = 0;
  const worker = async () => {
    while (next < images.length && !opts.signal.aborted) {
      const i = next++;
      out[i] = await measureOne(images[i], opts.fullSize, opts.signal, opts.viaPage).catch(() => ({ ...images[i], bytes: 0, type: '', ext: 'jpg', size: '' as const, hash: '', failed: true }));
      if (out[i].failed) failed++;
      opts.onProgress(++done, images.length, failed);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 6, images.length) }, worker));
  const seen = new Map<string, Measured>();
  const kept: Measured[] = [];
  let duplicates = 0;
  for (const m of out.filter(Boolean)) {
    const key = m.hash || m.src;
    const first = seen.get(key);
    // The same file for two different products (a shared placeholder or photo) stays with each
    if (first && first.sku && m.sku && first.sku !== m.sku) {
      kept.push(m);
      continue;
    }
    if (first) {
      duplicates++;
      // Fill in product details the first copy didn't have
      first.product ||= m.product;
      first.sku ||= m.sku;
      first.brand ||= m.brand;
      first.part ||= m.part;
      first.variant ||= m.variant;
      continue;
    }
    seen.set(key, m);
    kept.push(m);
  }
  return { images: kept, duplicates, upgraded: kept.filter((m) => m.foundAs).length };
}

// ---------- File names ----------

export type NamingPreset = 'name' | 'sku' | 'sku_name' | 'brand_name' | 'name_variant' | 'alt' | 'original' | 'number' | 'custom';
export const NAMING_PRESETS: { value: NamingPreset; label: string; pattern: string }[] = [
  { value: 'name', label: 'Product name', pattern: '{name}' },
  { value: 'sku', label: 'SKU', pattern: '{sku}' },
  { value: 'sku_name', label: 'SKU + product name', pattern: '{sku}_{name}' },
  { value: 'brand_name', label: 'Brand + product name', pattern: '{brand}_{name}' },
  { value: 'name_variant', label: 'Product name + variant', pattern: '{name}_{variant}' },
  { value: 'alt', label: 'Alt text', pattern: '{alt}' },
  { value: 'original', label: 'Original file name', pattern: '{original}' },
  { value: 'number', label: '001, 002, 003', pattern: '{n}' },
  { value: 'custom', label: 'Custom pattern', pattern: '' },
];
export const NAME_TOKENS = ['{name}', '{sku}', '{brand}', '{part}', '{variant}', '{size}', '{w}', '{h}', '{alt}', '{original}', '{n}'];

export function originalName(src: string) {
  const last = src.split(/[?#]/)[0].split('/').pop() || 'image';
  try {
    return decodeURIComponent(last).replace(/\.[a-z0-9]+$/i, '');
  } catch {
    return last.replace(/\.[a-z0-9]+$/i, '');
  }
}

const tidy = (s: string) => {
  const t = s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_').replace(/[_-]{2,}/g, '_').replace(/^[_.\- ]+|[_.\- ]+$/g, '');
  return t.slice(0, 100).replace(/[_.\- ]+$/, '');
};
/** Tokens that say which picture it is; size and pixels alone don't. */
const IDENTITY = new Set(['name', 'sku', 'brand', 'part', 'variant', 'alt', 'original', 'n']);

/**
 * File names (without extension) for a list of pictures. Missing details fall back to the
 * product name, then alt text, then the original name. A product with several pictures
 * gets -1, -2, -3.
 */
export function fileNames(list: Measured[], pattern: string): string[] {
  const pad = Math.max(3, String(list.length).length);
  const bases = list.map((m, i) => {
    const n = String(i + 1).padStart(pad, '0');
    const vals: Record<string, string> = {
      name: m.product ?? '',
      sku: m.sku ?? '',
      brand: m.brand ?? '',
      part: m.part ?? '',
      // "Lip Balm Clear", not "Lip Balm Lip Balm Clear" when the variant repeats the product name
      variant: (m.variant ?? '').replace(new RegExp(`^${(m.product ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[-–:/]?\\s*`, 'i'), '') || (m.variant ?? ''),
      size: m.size ? SIZE_LABEL[m.size] : '',
      w: m.width ? String(m.width) : '',
      h: m.height ? String(m.height) : '',
      alt: m.alt === 'og:image' ? '' : m.alt,
      original: originalName(m.foundAs ?? m.src),
      n,
    };
    const filled = pattern.replace(/\{(\w+)\}/g, (_, k) => vals[k] ?? '');
    // Every detail the pattern asked for was missing
    const tokens = [...pattern.matchAll(/\{(\w+)\}/g)].map(([, k]) => k);
    const usedSomething = tokens.length ? tokens.some((k) => IDENTITY.has(k) && vals[k]) : !!pattern.trim();
    return tidy(usedSomething ? filled : '') || tidy(vals.name) || tidy(vals.alt) || tidy(vals.original) || n;
  });
  const count = new Map<string, number>();
  for (const b of bases) count.set(b.toLowerCase(), (count.get(b.toLowerCase()) ?? 0) + 1);
  const seen = new Map<string, number>();
  return bases.map((b) => {
    const k = b.toLowerCase();
    if ((count.get(k) ?? 0) < 2) return b;
    const i = (seen.get(k) ?? 0) + 1;
    seen.set(k, i);
    return `${b}-${i}`;
  });
}

// ---------- Format ----------

export type OutFormat = 'original' | 'jpg' | 'png' | 'webp';
const MIME: Record<Exclude<OutFormat, 'original'>, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** Re-encode a picture. SVG and GIF stay as they are when the target is "original". */
export async function convert(blob: Blob, format: OutFormat): Promise<{ blob: Blob; ext: string } | null> {
  if (format === 'original') return null;
  let src: ImageBitmap | HTMLImageElement;
  try {
    src = await createImageBitmap(blob);
  } catch {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    await img.decode();
    URL.revokeObjectURL(url);
    src = img;
  }
  const w = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const h = 'naturalHeight' in src ? src.naturalHeight : src.height;
  const canvas = new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  const ctx = canvas.getContext('2d')!;
  if (format === 'jpg') {
    ctx.fillStyle = '#ffffff'; // JPEG has no transparency
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(src, 0, 0, w, h);
  return { blob: await canvas.convertToBlob({ type: MIME[format], quality: 0.92 }), ext: format };
}
