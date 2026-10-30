// Room sizes stated in a listing ("Kitchen 4.20m x 3.10m", "Primary Bedroom: 14' 2\" x 12'",
// "Living room 18 x 14 ft"). Only sizes the listing states are read; nothing is estimated.

export interface Room {
  name: string;
  /** Both sides in metres, longest first. */
  length_m: number;
  width_m: number;
  area_m2: number;
  /** As written in the listing. */
  as_written: string;
}

const ROOM_WORDS =
  'bed(?:room)?s?|master(?: bed(?:room)?)?|primary(?: bed(?:room)?)?|guest(?: bed(?:room)?)?|kitchen(?:\\/dining)?|kitchen\\/diner|living(?: room| area)?|lounge|dining(?: room| area)?|family room|great room|sitting room|reception(?: room)?|study|office|den|bath(?:room)?|shower room|en-?suite|wc|cloakroom|utility(?: room)?|laundry(?: room)?|garage|hall(?:way)?|entrance(?: hall)?|landing|conservatory|sun ?room|playroom|nursery|loft|attic|basement|games room|media room|gym|walk-in closet|dressing room|pantry|porch|patio|deck|balcony|terrace|store(?: room)?|storage|boot room|snug|breakfast room|bonus room|workshop|거실|안방|침실|주방|욕실|화장실|발코니|드레스룸|서재';

// "4.20m", "4.2 m", "13'9\"", "13 ft 9 in", "14'", "13.75 ft", or a bare number
const LEN = String.raw`(\d{1,2}(?:[.,]\d{1,2})?)\s*(m(?:etres?|eters?)?\b|ft\b|feet\b|'|′)?\s*(?:(\d{1,2})\s*(?:"|″|in\b|inches\b))?`;
const ROOM_RE = new RegExp(String.raw`\b((?:(?:first|second|third|1st|2nd|3rd|4th|upstairs|downstairs|main|large|small|open[- ]plan)\s+)?(?:${ROOM_WORDS})(?:\s*(?:\d(?![\d.,])|one|two|three|four|five)\b)?)\s*[:\-–—(]?\s*${LEN}\s*(?:x|×|by|\*)\s*${LEN}`, 'gi');

const FT = 0.3048;

function toMetres(num: string, unit: string | undefined, inches: string | undefined, metricHint: boolean): number {
  let n = parseFloat(num.replace(',', '.'));
  const u = (unit ?? '').toLowerCase();
  if (u.startsWith('m')) return n;
  if (u === 'ft' || u === 'feet' || u === "'" || u === '′' || inches) return (n + (inches ? Number(inches) / 12 : 0)) * FT;
  // No unit: decimals under 15 are usually metres in metric listings, whole numbers usually feet
  return metricHint || (n < 15 && /[.,]\d/.test(num)) ? n : n * FT;
}

const title = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/^\w/, (c) => c.toUpperCase());

/** Every room size stated in a listing's text, without duplicates. */
export function parseRoomSizes(text: string): Room[] {
  const metricHint = /\b\d+(?:[.,]\d+)?\s*(?:m²|sq\.?\s?m|square met|m2\b)/i.test(text) && !/\bsq\.?\s?ft\b|square feet/i.test(text);
  const out = new Map<string, Room>();
  for (const m of text.matchAll(ROOM_RE)) {
    const a = toMetres(m[2], m[3], m[4], metricHint);
    const b = toMetres(m[5], m[6] ?? m[3], m[7], metricHint);
    // Real rooms are between about 1 m and 25 m on a side
    if (!(a >= 0.8 && b >= 0.8 && a <= 25 && b <= 25)) continue;
    const [length_m, width_m] = a >= b ? [a, b] : [b, a];
    const name = title(m[1]);
    const key = `${name.toLowerCase()}|${length_m.toFixed(1)}|${width_m.toFixed(1)}`;
    if (!out.has(key)) out.set(key, { name, length_m: Math.round(length_m * 100) / 100, width_m: Math.round(width_m * 100) / 100, area_m2: Math.round(length_m * width_m * 10) / 10, as_written: m[0].replace(/\s+/g, ' ').trim() });
  }
  return [...out.values()];
}

/** Square metres to square feet, for display. */
export const sqft = (m2: number) => Math.round(m2 * 10.7639);
