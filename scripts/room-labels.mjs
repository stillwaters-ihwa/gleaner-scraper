// Builds lib/verticals/roomLabels.json: one text embedding per room type, from MobileCLIP-S0's
// text model. Only the small image model is then needed in the browser to label listing photos.
// Run: node scripts/room-labels.mjs        (add --test to measure accuracy on Commons photos)
import fs from 'node:fs';
import path from 'node:path';
import { AutoTokenizer, CLIPTextModelWithProjection, AutoProcessor, CLIPVisionModelWithProjection, RawImage } from '@huggingface/transformers';

const MODEL = process.env.ROOM_MODEL ?? 'Xenova/mobileclip_s0';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');

// Several phrasings per room; their average describes the room better than any one sentence
export const ROOMS = {
  kitchen: ['a photo of a kitchen', 'a kitchen with cabinets and a stove', 'a modern kitchen interior', 'a kitchen with a countertop and sink'],
  bathroom: ['a photo of a bathroom', 'a bathroom with a toilet and sink', 'a bathroom with a shower or bathtub', 'a tiled bathroom interior'],
  bedroom: ['a photo of a bedroom', 'a bedroom with a bed', 'a bedroom interior with a made bed', 'a master bedroom'],
  living_room: ['a photo of a living room', 'a living room with a sofa', 'a lounge with couches and a coffee table', 'a family room interior'],
  dining_room: ['a photo of a dining room', 'a dining table with chairs', 'a dining area in a house'],
  office: ['a photo of a home office', 'a study room with a desk and chair', 'a home office with a computer desk'],
  laundry: ['a photo of a laundry room', 'a washing machine and dryer in a laundry room'],
  garage: ['a photo of a garage interior', 'an empty garage with a garage door'],
  hallway: ['a photo of a hallway', 'an entrance hall or foyer of a house', 'a corridor inside a house'],
  stairs: ['a photo of a staircase inside a house', 'stairs in a home'],
  closet: ['a walk-in closet', 'a wardrobe closet with clothes rails'],
  exterior: ['a photo of the front of a house', 'the exterior of a house from the street', 'an apartment building exterior', 'a house facade'],
  garden: ['a photo of a backyard garden', 'a garden lawn behind a house', 'an outdoor patio area'],
  pool: ['a photo of a swimming pool', 'a backyard swimming pool'],
  balcony: ['a photo of a balcony', 'a terrace or balcony with a view'],
  view: ['a view from a window', 'a city skyline view', 'a scenic view of the ocean or mountains'],
  floor_plan: ['a floor plan diagram', 'an architectural floor plan drawing of a house', 'a 2d floorplan with rooms and walls'],
  aerial: ['an aerial photo of a neighborhood', 'a map of a location'],
  amenity: ['a building gym with exercise machines', 'a lobby of an apartment building', 'a shared amenity room'],
};

async function textEmbeddings() {
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL);
  const model = await CLIPTextModelWithProjection.from_pretrained(MODEL, { dtype: 'fp32' });
  const out = {};
  for (const [label, prompts] of Object.entries(ROOMS)) {
    const inputs = tokenizer(prompts, { padding: 'max_length', truncation: true });
    const { text_embeds } = await model(inputs);
    const dim = text_embeds.dims[1];
    const avg = new Float32Array(dim);
    for (let p = 0; p < prompts.length; p++) {
      const v = text_embeds.data.slice(p * dim, (p + 1) * dim);
      const n = Math.hypot(...v);
      for (let i = 0; i < dim; i++) avg[i] += v[i] / n;
    }
    const n = Math.hypot(...avg);
    out[label] = Array.from(avg, (x) => Math.round((x / n) * 1e5) / 1e5);
  }
  return out;
}

const labels = await textEmbeddings();
fs.writeFileSync(path.join(root, 'lib/verticals/roomLabels.json'), JSON.stringify({ model: MODEL, labels }));
console.log('wrote', Object.keys(labels).length, 'room types,', labels.kitchen.length, 'dims');

if (process.argv.includes('--test')) {
  const processor = await AutoProcessor.from_pretrained(MODEL);
  const vision = await CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: process.env.ROOM_DTYPE ?? 'q8' });
  const queries = { kitchen: 'modern kitchen', bathroom: 'modern bathroom', bedroom: 'modern bedroom design', living_room: 'modern living room', dining_room: 'dining room table chairs home', exterior: 'house front yard street', pool: 'swimming pool backyard', floor_plan: 'apartment floor plan diagram', garage: 'garage interior car parked', office: 'home office desk computer' };
  let right = 0;
  let total = 0;
  for (const [want, q] of Object.entries(queries)) {
    const api = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrnamespace=6&gsrlimit=12&prop=imageinfo&iiprop=url&iiurlwidth=448&format=json`;
    // Wikimedia limits how fast its search can be called
    let data = {};
    for (let attempt = 0; attempt < 4; attempt++) {
      await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
      const text = await (await fetch(api, { headers: { 'user-agent': 'GleanerDev/1.0 (accuracy test)' } })).text();
      try {
        data = JSON.parse(text);
        break;
      } catch {
        /* rate limited: wait longer */
      }
    }
    const urls = Object.values(data.query?.pages ?? {}).map((p) => p.imageinfo?.[0]?.thumburl).filter((u) => u && /\.(jpe?g|png)$/i.test(u.split('?')[0]) && (want === 'floor_plan' || !/page\d|\((1[5-8]\d\d)|drawing|engraving|painting|\.tif|architecture_\(/i.test(decodeURIComponent(u)))).slice(0, 4);
    for (const u of urls) {
      try {
        await new Promise((r) => setTimeout(r, 800));
        const image = await RawImage.fromURL(u);
        const { image_embeds } = await vision(await processor(image));
        const v = image_embeds.data;
        const n = Math.hypot(...v);
        const scores = Object.entries(labels).map(([k, t]) => [k, t.reduce((s, x, i) => s + (x * v[i]) / n, 0)]).sort((a, b) => b[1] - a[1]);
        const ok = scores[0][0] === want;
        right += ok;
        total++;
        console.log(ok ? 'ok  ' : 'MISS', want.padEnd(12), '->', scores[0][0].padEnd(12), scores[0][1].toFixed(3), decodeURIComponent(u.split('/').pop()).slice(0, 50));
      } catch (e) {
        console.log('skip', u.slice(-50), e.message);
      }
    }
  }
  console.log(`accuracy ${right}/${total} = ${Math.round((right / total) * 100)}%`);
}
