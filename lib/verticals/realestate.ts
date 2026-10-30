// Property listings for sale or rent: from listing pages and search results on property portals
// (schema.org residences and offers, the listings array in the page's own data, or the cards).
import { parseRoomSizes, type Room } from './rooms';
import { absUrl, addressText, firstImage, compact, dedupeRows, embeddedJson, isoDate, isType, keyScore, ldNodes, numStr, pick, recordArrays, str, toNum, type Row } from './structured';

export const PROPERTY_COLUMNS = [
  ['address', 'address'],
  ['city', 'city'],
  ['region', 'state / region'],
  ['postal_code', 'postal code'],
  ['price', 'price'],
  ['currency', 'currency'],
  ['status', 'status'],
  ['home_type', 'home type'],
  ['beds', 'beds'],
  ['baths', 'baths'],
  ['area', 'area'],
  ['area_unit', 'area unit'],
  ['price_per_area', 'price per area'],
  ['lot_size', 'lot size'],
  ['year_built', 'year built'],
  ['days_on_market', 'days on market'],
  ['listed', 'listed'],
  ['broker', 'broker / agency'],
  ['listing_id', 'listing id'],
  ['latitude', 'latitude'],
  ['longitude', 'longitude'],
  ['image', 'image'],
  ['photo_count', 'photos'],
  ['images', 'all photos'],
  ['floor_plan', 'floor plan'],
  ['virtual_tour', '3D tour'],
  ['rooms', 'room sizes'],
  ['description', 'description'],
  ['url', 'url'],
  ['source', 'found via'],
] as const;

const RESIDENCE = ['singlefamilyresidence', 'residence', 'house', 'apartment', 'apartmentcomplex', 'accommodation', 'realestatelisting', 'condominium', 'townhouse', 'gatedresidencecommunity', 'place'];
const CURRENCY: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP', '₩': 'KRW', '¥': 'JPY', '₹': 'INR' };

function statusOf(...texts: string[]): string {
  const t = texts.join(' ').toLowerCase();
  if (/\bsold\b/.test(t)) return 'sold';
  if (/\bpending|under contract|contingent\b/.test(t)) return 'pending';
  if (/\bfor rent|for_rent|rental|\/mo\b|per month|lease\b/.test(t)) return 'for rent';
  if (/\bfor sale|for_sale|forsale|active\b/.test(t)) return 'for sale';
  return '';
}

function pricePart(v: unknown): { price: string; currency: string } {
  if (typeof v === 'number') return { price: String(v), currency: '' };
  const s = str(v);
  const sym = s.match(/US\$|[$€£₩¥₹]|\b(USD|EUR|GBP|KRW|CAD|AUD)\b/);
  return { price: numStr(s), currency: sym ? CURRENCY[sym[0]] ?? sym[0] : '' };
}

/** Beds, baths and area from text like "3 bds | 2 ba | 1,540 sqft" or "2 beds · 1 bath · 85 m²". */
export function roomsFromText(text: string): { beds: string; baths: string; area: string; area_unit: string } {
  const t = text.replace(/ /g, ' ');
  const beds = t.match(/(\d+(?:\.\d+)?)\s*(?:bds?|beds?|bedrooms?|br\b|bd\b)/i)?.[1] ?? (/\bstudio\b/i.test(t) ? '0' : '');
  const baths = t.match(/(\d+(?:\.\d+)?)\s*(?:ba\b|baths?|bathrooms?)/i)?.[1] ?? '';
  const a = t.match(/(\d[\d,.]*)\s*(sq\.?\s?ft|sqft|square feet|sf\b|m²|m2|sqm|sq\.?\s?m|평)/i);
  return { beds, baths, area: a ? numStr(a[1]) : '', area_unit: a ? (/m|평/i.test(a[2]) && !/ft/i.test(a[2]) ? (a[2] === '평' ? 'pyeong' : 'm²') : 'sqft') : '' };
}

function withPerArea(r: Row): Row {
  const p = toNum(r.price);
  const a = toNum(r.area);
  if (p && a && !r.price_per_area) r.price_per_area = String(Math.round(p / a));
  return r;
}

export function propertyFromLd(n: any, url: string): Row {
  const offer = [].concat(n.offers ?? [])[0] as any;
  const addr = addressText(n.address ?? offer?.itemOffered?.address ?? n.location?.address);
  const geo = n.geo ?? n.location?.geo;
  const area = n.floorSize ?? offer?.itemOffered?.floorSize;
  const p = pricePart(offer?.price ?? offer?.priceSpecification?.price ?? n.price);
  return withPerArea(
    compact({
      address: addr.full || str(n.name),
      city: addr.city,
      region: addr.region,
      postal_code: addr.postal,
      price: p.price,
      currency: str(offer?.priceCurrency) || p.currency,
      status: statusOf(str(offer?.availability), str(offer?.businessFunction), str(n.name), url),
      home_type: (Array.isArray(n['@type']) ? n['@type'] : [n['@type']]).map((t: string) => String(t)).filter((t: string) => !/^(Product|Offer|Place|RealEstateListing)$/i.test(t)).join(', '),
      beds: numStr(n.numberOfBedrooms ?? n.numberOfRooms),
      baths: numStr(n.numberOfBathroomsTotal ?? n.numberOfFullBathrooms),
      area: numStr(area?.value ?? area),
      area_unit: /mtk|m2|sqm/i.test(str(area?.unitCode ?? area?.unitText)) ? 'm²' : area ? 'sqft' : '',
      year_built: numStr(n.yearBuilt),
      listed: isoDate(n.datePosted ?? offer?.validFrom),
      broker: str(offer?.offeredBy?.name ?? n.provider?.name ?? offer?.seller?.name),
      latitude: numStr(geo?.latitude),
      longitude: numStr(geo?.longitude),
      image: firstImage(n.image ?? n.photo, url),
      url: absUrl(n.url, url) || url,
      source: 'listing data',
    }),
  );
}

// Keys a property record in a portal's own data usually has
const PROPERTY_KEYS = [
  ['price', 'listPrice', 'unformattedPrice', 'priceRaw', 'list_price', 'askingPrice', 'rentPrice', 'formattedPrice', 'priceLabel'],
  ['address', 'streetAddress', 'addressStreet', 'location', 'fullAddress', 'displayAddress', 'formattedAddress', 'line'],
  ['beds', 'bedrooms', 'bedroom', 'numBedrooms', 'beds_max', 'bedsMin', 'bed', 'numberOfBedrooms'],
  ['baths', 'bathrooms', 'bathroom', 'numBathrooms', 'baths_full', 'bath', 'sqft', 'area', 'livingArea', 'floorArea', 'zpid', 'mlsId', 'propertyId', 'listingId', 'property_id'],
];

function propertyFromRecord(o: any, base: string): Row {
  const addrObj = pick(o, ['address', 'location', 'addressInfo'], 1);
  const addr = typeof addrObj === 'object' ? addressText(pick(addrObj, ['address'], 0) ?? addrObj) : addressText(addrObj);
  const street = addr.full || str(pick(o, ['addressStreet', 'streetAddress', 'displayAddress', 'fullAddress', 'formattedAddress', 'streetLine', 'line'], 1));
  const rawPrice = pick(o, ['unformattedPrice', 'listPrice', 'list_price', 'priceRaw', 'price', 'askingPrice', 'rentPrice', 'formattedPrice', 'priceLabel'], 2);
  const p = pricePart(typeof rawPrice === 'object' ? pick(rawPrice, ['value', 'amount', 'price'], 1) : rawPrice);
  const area = pick(o, ['livingArea', 'area', 'sqft', 'floorArea', 'squareFeet', 'size', 'lotAreaValue'], 2);
  const geo = pick(o, ['latLong', 'coordinate', 'coordinates', 'geo', 'latlng'], 1) ?? o;
  const link = pick(o, ['detailUrl', 'url', 'href', 'permalink', 'listingUrl', 'propertyUrl', 'link'], 1);
  const statusText = str(pick(o, ['statusText', 'statusType', 'status', 'listingStatus', 'homeStatus', 'marketingStatus'], 2));
  return withPerArea(
    compact({
      address: street,
      city: addr.city || str(pick(o, ['addressCity', 'city'], 1)),
      region: addr.region || str(pick(o, ['addressState', 'state', 'state_code'], 1)),
      postal_code: addr.postal || str(pick(o, ['addressZipcode', 'zipcode', 'postal_code', 'zip'], 1)),
      price: p.price,
      currency: str(pick(o, ['currency', 'currencyCode'], 1)) || p.currency,
      status: statusOf(statusText, str(pick(o, ['listingType', 'type'], 0))) || statusText.toLowerCase(),
      home_type: str(pick(o, ['homeType', 'propertyType', 'home_type', 'type_name', 'buildingType'], 2)).toLowerCase().replace(/_/g, ' '),
      beds: numStr(pick(o, ['beds', 'bedrooms', 'numBedrooms', 'bed', 'beds_max', 'numberOfBedrooms'], 2)),
      baths: numStr(pick(o, ['baths', 'bathrooms', 'numBathrooms', 'bath', 'baths_consolidated', 'baths_full', 'numberOfBathrooms'], 2)),
      area: numStr(typeof area === 'object' ? pick(area, ['value', 'amount'], 0) : area),
      area_unit: area ? (/m²|sqm|m2/i.test(str(pick(o, ['areaUnit', 'livingAreaUnits', 'unit'], 1))) ? 'm²' : 'sqft') : '',
      lot_size: numStr(pick(o, ['lotAreaValue', 'lotSize', 'lot_sqft'], 2)),
      year_built: numStr(pick(o, ['yearBuilt', 'year_built'], 2)),
      days_on_market: numStr(pick(o, ['daysOnZillow', 'daysOnMarket', 'dom', 'days_on_market', 'timeOnZillow'], 2)),
      listed: isoDate(pick(o, ['listDate', 'list_date', 'listingDate', 'datePosted'], 2)),
      broker: str(pick(o, ['brokerName', 'broker', 'brokerage', 'agencyName', 'officeName', 'office'], 2)),
      listing_id: str(pick(o, ['zpid', 'mlsId', 'listingId', 'propertyId', 'property_id', 'listing_id', 'id'], 0)),
      latitude: numStr(pick(geo, ['latitude', 'lat'], 0)),
      longitude: numStr(pick(geo, ['longitude', 'lng', 'lon'], 0)),
      image: absUrl(pick(o, ['imgSrc', 'image', 'photo', 'primaryPhoto', 'thumbnail', 'primary_photo'], 1), base),
      url: absUrl(link, base),
      source: 'page data',
    }),
  );
}

function propertiesFromCards(base: string): Row[] {
  if (typeof (globalThis as any).__gleanerFindLists !== 'function') return [];
  const lists: { items: Element[] }[] = (globalThis as any).__gleanerFindLists(6);
  for (const l of lists) {
    const rows = l.items.map((item) => {
      const text = (item as HTMLElement).innerText ?? item.textContent ?? '';
      const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
      const priceLine = lines.find((s) => /^(?:US\$|[$€£₩¥])\s?[\d,.]+|^[\d,.]+\s?(?:€|만원|억)/.test(s)) ?? '';
      const addrLine = str(item.querySelector('address, [class*="address" i], [data-testid*="address" i]')?.textContent) || (lines.find((s) => /^\d+\s+\w+.*\b(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|way|ct|court|pl|place|ter|pkwy|hwy)\b/i.test(s)) ?? '');
      const link = (item.querySelector('a[href*="home"], a[href*="propert"], a[href*="listing"], a[href*="detail"], a[href]') as HTMLAnchorElement | null)?.href ?? '';
      const img = (item.querySelector('img') as HTMLImageElement | null)?.currentSrc ?? '';
      return withPerArea(compact({ address: addrLine, ...pricePart(priceLine), ...roomsFromText(text), status: statusOf(text), image: img, url: link, source: 'listing cards' }));
    });
    const good = rows.filter((r) => r.price && (r.address || r.beds || r.area));
    if (good.length >= Math.max(3, rows.length * 0.5)) return good;
  }
  return [];
}

// ---------- Photos, floor plans, tours and room sizes (listing pages) ----------

const IMG_URL = /\.(jpe?g|png|webp|avif)(\?|#|$)|\/(photos?|images?|media|pictures?)\//i;
const FLOOR = /floor[\s_-]?plans?|floorplan|grundriss|plan d['’]étage|평면도|間取り|planta/i;
const TOUR = /matterport\.com|my\.matterport|kuula\.co|youriguide\.com|iguide|cloudpano|zillow\.com\/view-imx|3d-?tour|virtual-?tour|virtualtour|ricohtours|theasys|panoee|tourbuilder|realvision|eyespy360/i;

/** The biggest version of a photo when a site lists several sizes ("mixedSources", "sizes"). */
function bestPhotoUrl(o: any): string {
  if (!o) return '';
  if (typeof o === 'string') return o;
  const mixed = o.mixedSources?.jpeg ?? o.mixedSources?.webp;
  if (Array.isArray(mixed) && mixed.length) return mixed.reduce((a: any, b: any) => ((b.width ?? 0) > (a.width ?? 0) ? b : a)).url;
  return str(pick(o, ['highResLink', 'fullUrl', 'largeUrl', 'contentUrl', 'url', 'href', 'src', 'uri', 'link', 'imageUrl', 'photoUrl'], 1));
}

export interface ListingMedia {
  images: string[];
  floor_plans: string[];
  tour: string;
  description: string;
  rooms: Room[];
}

/** Everything visual a listing page offers: photos, floor plans, a 3D tour, and stated room sizes. */
export function listingMedia(doc: Document, url: string, parseRooms: (t: string) => Room[]): ListingMedia {
  const photos = new Map<string, string>(); // url -> caption
  const add = (u: unknown, caption = '') => {
    const a = absUrl(u, url);
    if (a && IMG_URL.test(a) && !/logo|icon|avatar|sprite|placeholder|1x1|pixel/i.test(a) && !photos.has(a)) photos.set(a, caption);
  };
  // Structured data
  for (const n of ldNodes(doc)) for (const im of [].concat(n.image ?? [], n.photo ?? [])) add(bestPhotoUrl(im), str((im as any)?.caption ?? (im as any)?.name));
  // The page's own data: arrays under photo/image/media/gallery keys
  const tours = new Set<string>();
  const floorFromData: string[] = [];
  const walk = (o: any, key: string, depth: number) => {
    if (!o || depth > 12) return;
    if (typeof o === 'string') {
      if (TOUR.test(o) && /^https?:/.test(o)) tours.add(o);
      return;
    }
    if (typeof o !== 'object') return;
    if (Array.isArray(o)) {
      if (/photo|image|media|gallery|picture|floor/i.test(key)) for (const it of o.slice(0, 120)) {
        const u = bestPhotoUrl(it);
        if (u) (FLOOR.test(key) ? floorFromData.push(absUrl(u, url)) : add(u, str(it?.caption ?? it?.description ?? it?.title ?? it?.label)));
      }
      for (const it of o.slice(0, 500)) walk(it, key, depth + 1);
      return;
    }
    for (const [k, v] of Object.entries(o)) {
      if (/virtual.?tour|tour.?url|matterport|3d.?(home|tour)|threeD/i.test(k) && typeof v === 'string' && /^https?:/.test(v)) tours.add(v);
      walk(v, k, depth + 1);
    }
  };
  for (const j of embeddedJson(doc)) walk(j, '', 0);
  // The page itself: big pictures, tour links and embedded tours
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const el = img as HTMLImageElement;
    const w = Number(el.getAttribute('width')) || el.naturalWidth || 0;
    const inGallery = !!el.closest('[class*="gallery" i], [class*="carousel" i], [class*="photo" i], [class*="media" i], [class*="slider" i], [id*="photo" i]');
    if (w >= 400 || inGallery || FLOOR.test(`${el.alt} ${el.src}`)) add(el.currentSrc || el.getAttribute('src') || el.getAttribute('data-src'), el.alt);
  }
  for (const a of Array.from(doc.querySelectorAll('a[href], iframe[src]'))) {
    const u = absUrl(a.getAttribute('href') ?? a.getAttribute('src'), url);
    if (TOUR.test(u) || (/\b(3d|virtual) tour\b/i.test(a.textContent ?? '') && /^https?:/.test(u))) tours.add(u);
    if (FLOOR.test(a.textContent ?? '') && IMG_URL.test(u)) floorFromData.push(u);
  }
  add(doc.querySelector('meta[property="og:image"]')?.getAttribute('content'));

  const floor = [...new Set([...floorFromData, ...[...photos].filter(([u, cap]) => FLOOR.test(`${u} ${cap}`)).map(([u]) => u)])].filter(Boolean);
  const images = [...photos.keys()].filter((u) => !floor.includes(u)).slice(0, 80);
  const ld = ldNodes(doc).find((n) => n.description);
  const description = (str(ld?.description) || str(doc.querySelector('meta[name="description"], meta[property="og:description"]')?.getAttribute('content'))).slice(0, 2000);
  const pageText = (doc.body as HTMLElement | null)?.innerText ?? doc.body?.textContent ?? '';
  return { images, floor_plans: floor.slice(0, 6), tour: [...tours][0] ?? '', description, rooms: parseRooms(`${description}\n${pageText.slice(0, 60000)}`) };
}

/** Every property on a page: one listing page or a page of search results. */
export function extractProperties(doc: Document, url: string): Row[] {
  const nodes = ldNodes(doc).filter((n) => isType(n, RESIDENCE) || ((isType(n, ['product', 'offer']) || n.offers) && (n.address || n.offers?.itemOffered?.address)));
  const fromLd = nodes.map((n) => propertyFromLd(n, url)).filter((r) => r.price || r.address);
  const arrays = recordArrays(embeddedJson(doc), (o) => (pick(o, PROPERTY_KEYS[0], 2) !== undefined ? keyScore(o, PROPERTY_KEYS, 2) : 0), 2);
  const fromData = arrays.flatMap((a) => a.map((o) => propertyFromRecord(o, url))).filter((r) => r.price && (r.address || r.url));
  // Search pages: the app data holds every result; listing pages: JSON-LD describes the one home
  let rows = fromData.length >= 2 ? fromData : fromLd.length ? fromLd : fromData;
  if (!rows.length) rows = propertiesFromCards(url);
  if (rows.length === 1 && !rows[0].url) rows[0].url = url;
  // A single listing: add its photos, floor plans, 3D tour and stated room sizes
  if (rows.length === 1) {
    const media = listingMedia(doc, url, parseRoomSizes);
    Object.assign(
      rows[0],
      compact({
        images: media.images.join(' | '),
        floor_plan: media.floor_plans.join(' | '),
        virtual_tour: media.tour,
        description: media.description,
        rooms: media.rooms.length ? JSON.stringify(media.rooms) : '',
        photo_count: media.images.length ? String(media.images.length) : '',
      }),
    );
    if (!rows[0].image && media.images[0]) rows[0].image = media.images[0];
  }
  return dedupeRows(rows, (r) => r.listing_id || r.url || `${r.address}|${r.price}`);
}
