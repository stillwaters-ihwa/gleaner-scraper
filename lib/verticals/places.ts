// Places: travel (hotels, restaurants, attractions, tours) and business listings (directories
// like Yellow Pages or Manta, and companies' own pages). Both describe a named place with an
// address, rating and contact details, so they share one reader with different column sets.
import { absUrl, addressText, firstImage, compact, dedupeRows, embeddedJson, isType, keyScore, ldNodes, numStr, pick, recordArrays, str, typesOf, type Row } from './structured';

export const TRAVEL_COLUMNS = [
  ['name', 'name'],
  ['type', 'type'],
  ['rating', 'rating'],
  ['review_count', 'reviews'],
  ['stars', 'hotel stars'],
  ['price', 'price'],
  ['price_range', 'price range'],
  ['currency', 'currency'],
  ['address', 'address'],
  ['city', 'city'],
  ['country', 'country'],
  ['cuisine', 'cuisine'],
  ['amenities', 'amenities'],
  ['hours', 'opening hours'],
  ['phone', 'phone'],
  ['website', 'website'],
  ['latitude', 'latitude'],
  ['longitude', 'longitude'],
  ['image', 'image'],
  ['url', 'url'],
  ['source', 'found via'],
] as const;

export const BUSINESS_COLUMNS = [
  ['name', 'business name'],
  ['category', 'category'],
  ['phone', 'phone'],
  ['email', 'email'],
  ['website', 'website'],
  ['address', 'address'],
  ['city', 'city'],
  ['region', 'state / region'],
  ['postal_code', 'postal code'],
  ['country', 'country'],
  ['rating', 'rating'],
  ['review_count', 'reviews'],
  ['hours', 'opening hours'],
  ['years_in_business', 'years in business'],
  ['description', 'description'],
  ['latitude', 'latitude'],
  ['longitude', 'longitude'],
  ['url', 'listing url'],
  ['source', 'found via'],
] as const;

const TRAVEL_TYPES = ['hotel', 'lodgingbusiness', 'resort', 'motel', 'hostel', 'bedandbreakfast', 'vacationrental', 'campground', 'restaurant', 'foodestablishment', 'cafeorcoffeeshop', 'barorpub', 'bakery', 'touristattraction', 'touristtrip', 'touristdestination', 'landmarksorhistoricalbuildings', 'museum', 'park', 'event', 'trip', 'apartment'];
const BUSINESS_HINT = ['localbusiness', 'organization', 'corporation', 'store', 'professionalservice', 'homeandconstructionbusiness', 'legalservice', 'medicalbusiness', 'dentist', 'physician', 'automotivebusiness', 'financialservice', 'realestateagent', 'healthandbeautybusiness', 'sportsactivitylocation', 'entertainmentbusiness', 'emergencyservice', 'governmentoffice', 'educationalorganization', 'plumber', 'electrician', 'locksmith', 'hvacbusiness', 'roofingcontractor', 'generalcontractor', 'insuranceagency', 'accountingservice', 'attorney', ...TRAVEL_TYPES];

const hours = (v: any) => str([].concat(v ?? []).map((h: any) => (typeof h === 'string' ? h : [str(h.dayOfWeek).replace(/https?:\/\/schema\.org\//g, ''), h.opens && `${h.opens}-${h.closes}`].filter(Boolean).join(' '))));

/** One schema.org place (LocalBusiness, Hotel, Restaurant, Attraction...) as a row. */
export function placeFromLd(n: any, url: string): Row {
  const addr = addressText(n.address);
  const rating = n.aggregateRating ?? {};
  const offer = [].concat(n.offers ?? [])[0] as any;
  const geo = n.geo ?? {};
  // A place's own website is a link to another site; its url on this site is its listing page
  const website = [n.sameAs, n.url].flat().map((u: unknown) => absUrl(u, url)).find((u: string) => u && new URL(u).host !== new URL(url).host) ?? '';
  return compact({
    name: str(n.name),
    type: typesOf(n).filter((t) => t !== 'thing').join(', '),
    category: str(n.category ?? n.additionalType ?? n.knowsAbout) || typesOf(n).filter((t) => !['localbusiness', 'organization', 'thing'].includes(t)).join(', '),
    rating: numStr(rating.ratingValue),
    review_count: numStr(rating.reviewCount ?? rating.ratingCount),
    stars: numStr(n.starRating?.ratingValue),
    price: numStr(offer?.price ?? offer?.lowPrice),
    price_range: str(n.priceRange),
    currency: str(offer?.priceCurrency ?? n.currenciesAccepted),
    address: addr.full,
    city: addr.city,
    region: addr.region,
    postal_code: addr.postal,
    country: addr.country,
    cuisine: str(n.servesCuisine),
    amenities: str([].concat(n.amenityFeature ?? []).map((a: any) => (a?.value === false ? '' : a?.name ?? a))),
    hours: hours(n.openingHoursSpecification ?? n.openingHours),
    phone: str(n.telephone),
    email: str(n.email).replace(/^mailto:/i, ''),
    website,
    years_in_business: n.foundingDate ? String(new Date().getFullYear() - new Date(str(n.foundingDate)).getFullYear()) : '',
    description: str(n.description).slice(0, 600),
    latitude: numStr(geo.latitude),
    longitude: numStr(geo.longitude),
    image: firstImage(n.image ?? n.photo, url),
    url: absUrl(n.url ?? (String(n['@id'] ?? '').startsWith('http') ? n['@id'] : ''), url) || url,
    source: 'listing data',
  });
}

const PLACE_KEYS = [
  ['name', 'title', 'businessName', 'displayName', 'locationName', 'hotelName'],
  ['rating', 'ratingValue', 'averageRating', 'avgRating', 'reviewScore', 'bubbleRating', 'starRating', 'score'],
  ['reviewCount', 'numberOfReviews', 'reviewsCount', 'numReviews', 'userReviewCount', 'ratingCount', 'reviews'],
  ['address', 'location', 'locationString', 'city', 'neighborhood', 'price', 'priceForDisplay', 'priceLevel', 'phone', 'telephone'],
];

function placeFromRecord(o: any, base: string): Row {
  const addrObj = pick(o, ['address', 'location'], 1);
  const addr = typeof addrObj === 'object' ? addressText(addrObj) : addressText(addrObj);
  const price = pick(o, ['priceForDisplay', 'price', 'displayPrice', 'lowestPrice', 'minPrice', 'pricePerNight', 'strikePrice'], 2);
  const geo = pick(o, ['geo', 'coordinates', 'latLong', 'location'], 1) ?? o;
  return compact({
    name: str(pick(o, ['name', 'title', 'businessName', 'displayName', 'hotelName', 'locationName'], 0)),
    type: str(pick(o, ['type', 'category', 'placeType', 'accommodationType', 'entityType'], 1)).toLowerCase(),
    category: str(pick(o, ['categories', 'category', 'primaryCategory', 'businessCategory'], 1)),
    rating: numStr(pick(o, ['rating', 'ratingValue', 'averageRating', 'avgRating', 'reviewScore', 'bubbleRating', 'score'], 2)),
    review_count: numStr(pick(o, ['reviewCount', 'numberOfReviews', 'reviewsCount', 'numReviews', 'userReviewCount', 'ratingCount'], 2)),
    stars: numStr(pick(o, ['starRating', 'hotelClass', 'stars'], 1)),
    price: numStr(typeof price === 'object' ? pick(price, ['amount', 'value', 'price', 'formatted'], 1) : price),
    price_range: str(pick(o, ['priceRange', 'priceLevel', 'price_level'], 1)),
    currency: str(pick(o, ['currency', 'currencyCode'], 2)),
    address: addr.full || str(pick(o, ['locationString', 'formattedAddress', 'displayAddress'], 1)),
    city: addr.city || str(pick(o, ['city', 'cityName'], 1)),
    country: addr.country,
    phone: str(pick(o, ['phone', 'telephone', 'phoneNumber', 'displayPhone'], 1)),
    website: absUrl(pick(o, ['website', 'websiteUrl', 'businessUrl'], 1), base),
    latitude: numStr(pick(geo, ['latitude', 'lat'], 0)),
    longitude: numStr(pick(geo, ['longitude', 'lng', 'lon'], 0)),
    image: absUrl(pick(o, ['image', 'photo', 'thumbnail', 'imageUrl', 'photoUrl', 'heroImage'], 2), base),
    url: absUrl(pick(o, ['url', 'detailUrl', 'href', 'link', 'detailPageUrl', 'canonicalUrl', 'webUrl'], 1), base),
    source: 'page data',
  });
}

const PHONE = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/;

/** Directory and travel cards read from the visible page (live pages only). */
function placesFromCards(kind: 'travel' | 'business'): Row[] {
  if (typeof (globalThis as any).__gleanerFindLists !== 'function') return [];
  const lists: { items: Element[] }[] = (globalThis as any).__gleanerFindLists(6);
  for (const l of lists) {
    const rows = l.items.map((item) => {
      const text = (item as HTMLElement).innerText ?? item.textContent ?? '';
      const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
      const nameEl = item.querySelector('h2, h3, h4, [class*="business-name" i], [class*="title" i] a, [class*="name" i] a, a[class*="name" i]');
      const name = str(nameEl?.textContent) || lines[0] || '';
      const link = ((nameEl?.closest('a') ?? nameEl?.querySelector('a') ?? item.querySelector('a[href]')) as HTMLAnchorElement | null)?.href ?? '';
      const ext = Array.from(item.querySelectorAll('a[href^="http"]')).map((a) => (a as HTMLAnchorElement).href).find((h) => new URL(h).host !== location.host && !/google|facebook|twitter|yelp|tripadvisor|maps/i.test(h));
      const rating = text.match(/(\d(?:[.,]\d)?)\s*(?:of 5|out of 5|\/\s*5|stars?|bubbles)/i)?.[1] ?? item.querySelector('[class*="rating" i], [aria-label*="rating" i], [aria-label*="of 5" i]')?.getAttribute('aria-label')?.match(/(\d(?:\.\d)?)/)?.[1] ?? '';
      const reviews = text.match(/([\d,]+)\s*(?:reviews?|ratings?|opinions)/i)?.[1] ?? '';
      const phone = (item.querySelector('a[href^="tel:"]')?.getAttribute('href')?.slice(4) ?? text.match(PHONE)?.[0] ?? '').trim();
      const address = str(item.querySelector('address, [class*="address" i], [class*="street" i], [class*="locality" i]')?.textContent) || (lines.find((s) => /^\d+\s+\w+.*\b(st|street|ave|avenue|rd|road|dr|drive|blvd|way|ln|lane|ct|suite|ste|hwy)\b/i.test(s)) ?? '');
      const price = lines.find((s) => /^(?:from\s+)?(?:US\$|[$€£₩¥])\s?\d/i.test(s)) ?? '';
      const category = str(item.querySelector('[class*="categor" i]')?.textContent);
      return compact({
        name,
        category,
        rating: rating.replace(',', '.'),
        review_count: reviews.replace(/,/g, ''),
        phone: kind === 'business' || phone.replace(/\D/g, '').length >= 9 ? phone : '',
        address,
        price: numStr(price),
        website: ext ?? '',
        url: link,
        source: 'listing cards',
      });
    });
    const good = rows.filter((r) => r.name && (kind === 'business' ? r.phone || r.address : r.rating || r.price || r.review_count));
    if (good.length >= Math.max(3, rows.length * 0.5)) return good;
  }
  return [];
}

function extractPlaces(doc: Document, url: string, kind: 'travel' | 'business'): Row[] {
  const types = kind === 'travel' ? TRAVEL_TYPES : BUSINESS_HINT;
  const fromLd = ldNodes(doc)
    .filter((n) => isType(n, types) || (kind === 'business' && (n.address || n.telephone) && isType(n, ['place'])))
    // The site describing itself is not a listing on a directory page
    .filter((n) => !(kind === 'business' && isType(n, ['organization', 'corporation']) && !n.address && !n.telephone))
    .map((n) => placeFromLd(n, url))
    .filter((r) => r.name);
  const arrays = recordArrays(embeddedJson(doc), (o) => (pick(o, PLACE_KEYS[0], 0) !== undefined ? keyScore(o, PLACE_KEYS, 1) : 0), 3);
  const fromData = arrays.flatMap((a) => a.map((o) => placeFromRecord(o, url))).filter((r) => r.name && (r.rating || r.address || r.price || r.phone));
  let rows = fromData.length > fromLd.length ? fromData : fromLd;
  if (rows.length < 2) {
    const cards = placesFromCards(kind);
    if (cards.length > rows.length) rows = cards;
  }
  return dedupeRows(rows, (r) => r.url && r.url !== url ? r.url : `${r.name}|${r.address}|${r.phone}`);
}

export const extractTravel = (doc: Document, url: string) => extractPlaces(doc, url, 'travel');
export const extractBusinesses = (doc: Document, url: string) => extractPlaces(doc, url, 'business');
