// Edits on a captured picture, kept as shapes so they can be changed later and listed in the
// edit history, and drawn onto the full-size picture when saving. Coordinates are image pixels.

export type EditKind = 'blur' | 'pixelate' | 'blackout' | 'box' | 'arrow' | 'text' | 'highlight';

export interface Edit {
  id: string;
  kind: EditKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Arrow end point (the arrow points from x,y to x2,y2). */
  x2?: number;
  y2?: number;
  color?: string;
  /** Blur and pixelate strength 1-3; line width for boxes and arrows. */
  strength?: number;
  text?: string;
  size?: number;
}

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Stamp {
  /** Lines written in a band under the picture (address, capture time). */
  lines: string[];
}

const BLUR = [0, 6, 14, 28];
const PIXEL = [0, 8, 16, 32];

/** Normalised box (positive width and height). */
export function norm(e: { x: number; y: number; w: number; h: number }) {
  const x = e.w < 0 ? e.x + e.w : e.x;
  const y = e.h < 0 ? e.y + e.h : e.y;
  return { x, y, w: Math.abs(e.w), h: Math.abs(e.h) };
}

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function drawArrow(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, width: number) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.max(14, width * 4.5);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2 - Math.cos(angle) * head * 0.8, y2 - Math.sin(angle) * head * 0.8);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

/** Draws the edits onto a context that already holds the picture (for saving at full size). */
export function applyEdits(ctx: Ctx, source: CanvasImageSource, edits: Edit[], scale = 1) {
  for (const e of edits) {
    const b = norm(e);
    if (e.kind === 'blur' || e.kind === 'pixelate') {
      if (b.w < 2 || b.h < 2) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(b.x, b.y, b.w, b.h);
      ctx.clip();
      if (e.kind === 'blur') {
        ctx.filter = `blur(${BLUR[e.strength ?? 2] * scale}px)`;
        // Draw a little beyond the box so the edges blur too
        const pad = BLUR[3] * 2;
        ctx.drawImage(source, b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2, b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
        ctx.filter = 'none';
      } else {
        // Pixelate: shrink and grow back without smoothing (cannot be undone from the picture)
        const cell = PIXEL[e.strength ?? 2] * scale;
        const small = new OffscreenCanvas(Math.max(1, Math.ceil(b.w / cell)), Math.max(1, Math.ceil(b.h / cell)));
        const sctx = small.getContext('2d')!;
        sctx.drawImage(source, b.x, b.y, b.w, b.h, 0, 0, small.width, small.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(small, 0, 0, small.width, small.height, b.x, b.y, small.width * cell, small.height * cell);
        ctx.imageSmoothingEnabled = true;
      }
      ctx.restore();
    } else if (e.kind === 'blackout') {
      ctx.fillStyle = '#000';
      ctx.fillRect(b.x, b.y, b.w, b.h);
    } else if (e.kind === 'highlight') {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = e.color ?? '#ffe14d';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.restore();
    } else if (e.kind === 'box') {
      ctx.strokeStyle = e.color ?? '#e5484d';
      ctx.lineWidth = (e.strength ?? 2) * 2 * scale;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
    } else if (e.kind === 'arrow') {
      ctx.strokeStyle = ctx.fillStyle = e.color ?? '#e5484d';
      ctx.lineWidth = (e.strength ?? 2) * 2 * scale;
      ctx.lineCap = 'round';
      drawArrow(ctx, e.x, e.y, e.x2 ?? e.x + 80, e.y2 ?? e.y + 80, ctx.lineWidth);
    } else if (e.kind === 'text' && e.text) {
      const size = (e.size ?? 24) * scale;
      ctx.font = `600 ${size}px "Geist Variable", system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      const lines = e.text.split('\n');
      const width = Math.max(...lines.map((l) => ctx.measureText(l).width));
      // A light backing so the text reads on any picture
      ctx.fillStyle = 'rgba(255,255,255,0.86)';
      ctx.fillRect(e.x - size * 0.25, e.y - size * 0.15, width + size * 0.5, lines.length * size * 1.25 + size * 0.2);
      ctx.fillStyle = e.color ?? '#e5484d';
      lines.forEach((l, i) => ctx.fillText(l, e.x, e.y + i * size * 1.25));
    }
  }
}

/** The finished picture: crop, edits, and an optional band with the address and time. */
export async function renderEdited(source: ImageBitmap, edits: Edit[], crop: Crop | null, stamp: Stamp | null, scale = 1): Promise<Blob> {
  const full = new OffscreenCanvas(source.width, source.height);
  const fctx = full.getContext('2d')!;
  fctx.drawImage(source, 0, 0);
  applyEdits(fctx, source, edits, scale);
  const c = crop ? norm(crop) : { x: 0, y: 0, w: source.width, h: source.height };
  const band = stamp?.lines.length ? Math.round(18 * scale + stamp.lines.length * 20 * scale) : 0;
  const out = new OffscreenCanvas(Math.max(1, Math.round(c.w)), Math.max(1, Math.round(c.h + band)));
  const ctx = out.getContext('2d')!;
  ctx.drawImage(full, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
  if (band && stamp) {
    ctx.fillStyle = '#f4f5f7';
    ctx.fillRect(0, c.h, out.width, band);
    ctx.fillStyle = '#1d2530';
    ctx.font = `500 ${13 * scale}px "Geist Mono Variable", ui-monospace, monospace`;
    ctx.textBaseline = 'top';
    stamp.lines.forEach((l, i) => ctx.fillText(l, 10 * scale, c.h + 9 * scale + i * 20 * scale, out.width - 20 * scale));
  }
  return out.convertToBlob({ type: 'image/png' });
}
