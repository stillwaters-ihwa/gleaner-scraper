// Labels listing photos by room (kitchen, bathroom, bedroom, exterior, pool, floor plan...) with
// CLIP running on this computer. The room descriptions were computed once (scripts/room-labels.mjs),
// so only CLIP's image model is needed here; it downloads from Hugging Face the first time and is
// then cached by the browser. Photos are never uploaded.
import { browser } from 'wxt/browser';
import roomLabels from './verticals/roomLabels.json';

export const ROOM_NAMES: Record<string, string> = {
  kitchen: 'Kitchen',
  bathroom: 'Bathroom',
  bedroom: 'Bedroom',
  living_room: 'Living room',
  dining_room: 'Dining room',
  office: 'Office',
  laundry: 'Laundry',
  garage: 'Garage',
  hallway: 'Hallway',
  stairs: 'Stairs',
  closet: 'Closet',
  exterior: 'Exterior',
  garden: 'Garden and patio',
  pool: 'Pool',
  balcony: 'Balcony',
  view: 'View',
  floor_plan: 'Floor plan',
  aerial: 'Aerial and map',
  amenity: 'Building amenities',
};

/** Features worth a tag when at least one photo shows them. */
export const FEATURE_ROOMS = ['pool', 'balcony', 'garden', 'garage', 'view', 'office', 'laundry', 'closet', 'amenity'];

export interface PhotoLabel {
  room: string;
  /** How far ahead of the runner-up the chosen label is (0 to 1); low means "not sure". */
  confidence: number;
}

type Labeler = (imageUrl: string) => Promise<PhotoLabel>;
let labelerP: Promise<Labeler> | null = null;

/** About how much the image model downloads the first time. */
export const MODEL_MB = 88;

export function loadLabeler(onProgress?: (pct: number) => void): Promise<Labeler> {
  labelerP ??= (async () => {
    const { env, AutoProcessor, CLIPVisionModelWithProjection, RawImage } = await import('@huggingface/transformers');
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    const wasm = env.backends.onnx.wasm!;
    wasm.wasmPaths = browser.runtime.getURL('/vendor/ort/' as any);
    wasm.numThreads = 1; // extension pages can't share memory between threads
    wasm.proxy = false;
    const loaded = new Map<string, number>();
    const progress_callback = (p: any) => {
      if (p.status === 'progress' && p.total) {
        loaded.set(p.file, p.loaded / p.total);
        onProgress?.(Math.round(([...loaded.values()].reduce((a, b) => a + b, 0) / Math.max(1, loaded.size)) * 100));
      }
    };
    const model = roomLabels.model;
    const processor = await AutoProcessor.from_pretrained(model, { progress_callback });
    const vision = await CLIPVisionModelWithProjection.from_pretrained(model, { dtype: 'q8', device: 'wasm', progress_callback });
    const labels = Object.entries(roomLabels.labels as Record<string, number[]>);
    return async (imageUrl: string) => {
      const image = await RawImage.fromURL(imageUrl);
      const { image_embeds } = await vision(await processor(image));
      const v = image_embeds.data as Float32Array;
      const n = Math.hypot(...v);
      const scores = labels.map(([k, t]) => [k, t.reduce((s, x, i) => s + (x * v[i]) / n, 0)] as const).sort((a, b) => b[1] - a[1]);
      // CLIP similarities sit close together; turn the gap to the runner-up into a 0-1 confidence
      const gap = scores[0][1] - scores[1][1];
      return { room: scores[0][0], confidence: Math.max(0, Math.min(1, gap * 25)) };
    };
  })();
  labelerP.catch(() => (labelerP = null));
  return labelerP;
}
