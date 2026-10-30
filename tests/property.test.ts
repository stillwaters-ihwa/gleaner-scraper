// @vitest-environment happy-dom
// Property viewer: what a single listing page yields (photos, floor plan, 3D tour, room sizes)
// and how the viewer turns that row into facts, tags, a room chart and a map pin.
import { describe, expect, it } from 'vitest';
import { extractProperties } from '@/lib/verticals/realestate';
import { featureTags, groupPhotos, mapLinks, packRooms, toProperty } from '@/lib/property';

const LISTING = `<!doctype html><html><head>
<meta name="description" content="Bright 3 bed home with a swimming pool, garage and ocean views.">
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'SingleFamilyResidence',
  name: '12 Harbour Road',
  address: { '@type': 'PostalAddress', streetAddress: '12 Harbour Road', addressLocality: 'Seaview', addressRegion: 'CA', postalCode: '90210' },
  geo: { latitude: 34.05, longitude: -118.24 },
  numberOfBedrooms: 3,
  numberOfBathroomsTotal: 2,
  floorSize: { value: 1650, unitCode: 'FTK' },
  image: ['https://img.example.com/photos/front-1200.jpg', { '@type': 'ImageObject', contentUrl: 'https://img.example.com/photos/kitchen-1200.jpg', caption: 'Kitchen' }],
  offers: { '@type': 'Offer', price: 895000, priceCurrency: 'USD' },
})}</script>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { listing: { photos: [{ url: 'https://img.example.com/photos/bath-1200.jpg' }], floorPlans: [{ url: 'https://img.example.com/plans/plan-a.png' }], virtualTourUrl: 'https://my.matterport.com/show/?m=abc123' } } })}</script>
</head><body>
<h1>12 Harbour Road</h1>
<p>Kitchen 4.20m x 3.10m. Living room 5.5m x 3.9m. Bedroom 1 3.6 x 3.2 m. Total 140 m²</p>
<a href="https://my.matterport.com/show/?m=abc123">3D tour</a>
</body></html>`;

describe('single listing media', () => {
  const doc = new DOMParser().parseFromString(LISTING, 'text/html');
  const [row] = extractProperties(doc, 'https://homes.example.com/listing/12-harbour-road');

  it('collects photos, the floor plan and the 3D tour', () => {
    const photos = row.images.split(' | ');
    expect(photos).toEqual(expect.arrayContaining(['https://img.example.com/photos/front-1200.jpg', 'https://img.example.com/photos/kitchen-1200.jpg', 'https://img.example.com/photos/bath-1200.jpg']));
    expect(row.floor_plan).toBe('https://img.example.com/plans/plan-a.png');
    expect(photos).not.toContain(row.floor_plan);
    expect(row.virtual_tour).toBe('https://my.matterport.com/show/?m=abc123');
    expect(row.photo_count).toBe(String(photos.length));
  });

  it('keeps only the room sizes the listing states', () => {
    const rooms = JSON.parse(row.rooms);
    expect(rooms.map((r: any) => r.name)).toEqual(['Kitchen', 'Living room', 'Bedroom 1']);
    expect(rooms[0]).toMatchObject({ length_m: 4.2, width_m: 3.1, area_m2: 13 });
  });

  it('becomes a property with facts, a map pin and tags', () => {
    const p = toProperty(row, 0);
    expect(p.facts.find((f) => f.label === 'Price')?.value).toMatch(/895,000/);
    expect(p.facts.find((f) => f.label === 'Beds')?.value).toBe('3');
    expect(p.lat).toBe(34.05);
    expect(mapLinks(p)?.embed).toContain('marker=34.05,-118.24');
    expect(featureTags(p.description).map((t) => t.name)).toEqual(expect.arrayContaining(['Pool', 'Garage', 'View']));
  });
});

describe('property viewer helpers', () => {
  it('tags features from text and photos, without "unfurnished" counting as furnished', () => {
    const tags = featureTags('Unfurnished flat with a balcony', { 'a.jpg': { room: 'pool', by: 'model' }, 'b.jpg': { room: 'balcony', by: 'you' } });
    expect(tags).toEqual(expect.arrayContaining([{ name: 'Balcony', from: 'both' }, { name: 'Pool', from: 'photos' }]));
    expect(tags.find((t) => t.name === 'Furnished')).toBeUndefined();
  });

  it('groups photos in walk-through order with unlabeled last', () => {
    const g = groupPhotos(['1', '2', '3', '4'], { '1': { room: 'bathroom', by: 'model' }, '3': { room: 'kitchen', by: 'you' } }, ['kitchen', 'bathroom']);
    expect(g).toEqual([
      { room: 'kitchen', photos: ['3'] },
      { room: 'bathroom', photos: ['1'] },
      { room: 'unlabeled', photos: ['2', '4'] },
    ]);
  });

  it('packs rooms into rows without overlap, at true size', () => {
    const room = (name: string, l: number, w: number) => ({ name, length_m: l, width_m: w, area_m2: l * w, as_written: '' });
    const { placed, width } = packRooms([room('a', 5, 4), room('b', 4, 3), room('c', 3, 3), room('d', 2, 2)], 10);
    expect(width).toBeLessThanOrEqual(10);
    for (const a of placed) for (const b of placed) {
      if (a === b) continue;
      const apart = a.x + a.length_m <= b.x || b.x + b.length_m <= a.x || a.y + a.width_m <= b.y || b.y + b.width_m <= a.y;
      expect(apart).toBe(true);
    }
    expect(placed[0]).toMatchObject({ name: 'a', x: 0, y: 0, length_m: 5 });
  });

  it('falls back to an address search when there are no coordinates', () => {
    expect(mapLinks({ lat: null, lon: null, address: '1 Main St, Springfield' })).toEqual({ embed: '', open: 'https://www.google.com/maps/search/?api=1&query=1%20Main%20St%2C%20Springfield' });
    expect(mapLinks({ lat: null, lon: null, address: '' })).toBeNull();
  });
});
