// What the Property viewer shows for one scraped listing: key facts, feature tags, a map, the
// photos, floor plans and 3D tour, and the stated room sizes drawn to scale. Pure functions only,
// so they can be tested without a browser.
import type { Room } from './verticals/rooms';

export type PhotoRooms = Record<string, { room: string; by: 'model' | 'you'; confidence?: number }>;

export interface Property {
  index: number;
  title: string;
  facts: { label: string; value: string }[];
  photos: string[];
  floorPlans: string[];
  tour: string;
  description: string;
  rooms: Room[];
  lat: number | null;
  lon: number | null;
  address: string;
  url: string;
  photoRooms: PhotoRooms;
}

const split = (s = '') => s.split(/\s*\|\s*/).map((x) => x.trim()).filter((x) => /^https?:/.test(x));

function money(price: string, currency: string): string {
  const n = Number(price);
  if (!price || !Number.isFinite(n)) return price;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString()}`.trim();
  }
}

export function parseJson<T>(s: string | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** A dataset row from the Real estate tool, ready to show. */
export function toProperty(r: Record<string, string>, index: number): Property {
  const address = [r.address, r.city, r.region, r.postal_code].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
  const facts = [
    ['Price', money(r.price, r.currency) + (r.status === 'for rent' && r.price ? ' / mo' : '')],
    ['Status', r.status],
    ['Type', r.home_type],
    ['Beds', r.beds],
    ['Baths', r.baths],
    ['Area', r.area ? `${Number(r.area).toLocaleString()} ${r.area_unit || ''}`.trim() : ''],
    ['Price per area', r.price_per_area ? `${money(r.price_per_area, r.currency)} / ${r.area_unit || 'unit'}` : ''],
    ['Lot', r.lot_size],
    ['Built', r.year_built],
    ['On market', r.days_on_market ? `${r.days_on_market} days` : ''],
    ['Listed', r.listed],
    ['Agency', r.broker],
    ['Listing ID', r.listing_id],
  ]
    .filter(([, v]) => v && v.trim())
    .map(([label, value]) => ({ label, value }));
  const photos = split(r.images);
  if (!photos.length && /^https?:/.test(r.image ?? '')) photos.push(r.image);
  const lat = Number(r.latitude);
  const lon = Number(r.longitude);
  return {
    index,
    title: r.address || r.url || `Property ${index + 1}`,
    facts,
    photos,
    floorPlans: split(r.floor_plan),
    tour: /^https?:/.test(r.virtual_tour ?? '') ? r.virtual_tour : '',
    description: r.description ?? '',
    rooms: parseJson<Room[]>(r.rooms, []).filter((x) => x && x.length_m > 0 && x.width_m > 0),
    lat: r.latitude && Number.isFinite(lat) && Math.abs(lat) <= 90 ? lat : null,
    lon: r.longitude && Number.isFinite(lon) && Math.abs(lon) <= 180 ? lon : null,
    address,
    url: r.url ?? '',
    photoRooms: parseJson<PhotoRooms>(r.photo_rooms, {}),
  };
}

// Features named in the listing's own words
const FEATURES: [string, RegExp][] = [
  ['Pool', /\b(swimming )?pool\b(?!\s*table)/i],
  ['Garage', /\bgarage\b/i],
  ['Parking', /\bparking|car ?port|driveway\b/i],
  ['Balcony', /\bbalcon(y|ies)\b/i],
  ['Terrace', /\b(roof )?terrace\b/i],
  ['Garden', /\bgarden|back ?yard|front ?yard\b/i],
  ['Patio or deck', /\bpatio|deck\b/i],
  ['View', /\b(ocean|sea|city|mountain|lake|river|water|panoramic|skyline) views?\b/i],
  ['Fireplace', /\bfireplace\b/i],
  ['Air conditioning', /\bair[- ]?con(ditioning)?|central air|\ba\/c\b/i],
  ['Elevator', /\belevator|\blift\b/i],
  ['Gym', /\bgym|fitness (center|centre|room)\b/i],
  ['Doorman or concierge', /\bdoorman|concierge\b/i],
  ['Laundry', /\blaundry|washer\b/i],
  ['Walk-in closet', /\bwalk-?in (closet|wardrobe)\b/i],
  ['Home office', /\bhome office|\bstudy\b|\boffice (room|space)\b/i],
  ['Basement', /\bbasement|cellar\b/i],
  ['Furnished', /\bfurnished\b/i],
  ['Pets allowed', /\bpets? (allowed|friendly|ok)\b/i],
  ['Renovated', /\b(newly |recently |fully )?(renovated|remodeled|refurbished)\b/i],
  ['Solar', /\bsolar\b/i],
  ['Hardwood floors', /\bhardwood\b/i],
];

// Photo labels that are features in their own right
const PHOTO_FEATURES: Record<string, string> = { pool: 'Pool', balcony: 'Balcony', garden: 'Garden', garage: 'Garage', view: 'View', office: 'Home office', laundry: 'Laundry', closet: 'Walk-in closet', amenity: 'Building amenities' };

/** Feature tags, each saying whether the listing text or a photo shows it. */
export function featureTags(description: string, photoRooms: PhotoRooms = {}): { name: string; from: 'text' | 'photos' | 'both' }[] {
  const out = new Map<string, 'text' | 'photos' | 'both'>();
  for (const [name, re] of FEATURES) if (re.test(description) && !(name === 'Furnished' && /\bunfurnished\b/i.test(description))) out.set(name, 'text');
  for (const { room } of Object.values(photoRooms)) {
    const name = PHOTO_FEATURES[room];
    if (!name) continue;
    const had = out.get(name);
    out.set(name, had === 'text' || had === 'both' ? 'both' : 'photos');
  }
  return [...out].map(([name, from]) => ({ name, from }));
}

/** Photos grouped by room, in a sensible walk-through order; unlabeled photos come last. */
export function groupPhotos(photos: string[], photoRooms: PhotoRooms, order: string[]): { room: string; photos: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const p of photos) {
    const room = photoRooms[p]?.room ?? 'unlabeled';
    groups.set(room, [...(groups.get(room) ?? []), p]);
  }
  const rank = (k: string) => (k === 'unlabeled' ? 1e9 : order.indexOf(k) === -1 ? 1e8 : order.indexOf(k));
  return [...groups].sort((a, b) => rank(a[0]) - rank(b[0])).map(([room, ps]) => ({ room, photos: ps }));
}

export interface PlacedRoom extends Room {
  x: number;
  y: number;
}

/**
 * Lays rooms side by side in rows (largest first) so their sizes can be compared at one scale.
 * Positions are only for the chart: they say nothing about where rooms are in the home.
 */
export function packRooms(rooms: Room[], widthM: number, gapM = 0.6): { placed: PlacedRoom[]; width: number; height: number } {
  const sorted = [...rooms].sort((a, b) => b.area_m2 - a.area_m2);
  const placed: PlacedRoom[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  let maxX = 0;
  for (const r of sorted) {
    if (x > 0 && x + r.length_m > widthM) {
      x = 0;
      y += rowH + gapM;
      rowH = 0;
    }
    placed.push({ ...r, x, y });
    x += r.length_m + gapM;
    maxX = Math.max(maxX, x - gapM);
    rowH = Math.max(rowH, r.width_m);
  }
  return { placed, width: maxX, height: placed.length ? y + rowH : 0 };
}

/** A map link: the exact pin when the listing gave coordinates, otherwise an address search. */
export function mapLinks(p: Pick<Property, 'lat' | 'lon' | 'address'>): { embed: string; open: string } | null {
  if (p.lat !== null && p.lon !== null) {
    const d = 0.006;
    return {
      embed: `https://www.openstreetmap.org/export/embed.html?bbox=${p.lon - d},${p.lat - d / 1.6},${p.lon + d},${p.lat + d / 1.6}&layer=mapnik&marker=${p.lat},${p.lon}`,
      open: `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=17/${p.lat}/${p.lon}`,
    };
  }
  if (p.address) return { embed: '', open: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.address)}` };
  return null;
}
