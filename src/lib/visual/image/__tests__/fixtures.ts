/**
 * Deterministic synthetic image fixtures. No files, no browser: every fixture is
 * a pure raster so analysis tests are reproducible byte for byte.
 */
import type { RgbaImage } from "../types";

interface Painter {
  (x: number, y: number): readonly [number, number, number, number] | null;
}

function raster(width: number, height: number, bg: readonly [number, number, number, number], paint: Painter): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = paint(x, y) ?? bg;
      const o = (y * width + x) * 4;
      data[o] = px[0];
      data[o + 1] = px[1];
      data[o + 2] = px[2];
      data[o + 3] = px[3];
    }
  }
  return { width, height, data };
}

const BLACK = [0, 0, 0, 255] as const;
const WHITE = [255, 255, 255, 255] as const;
const CLEAR = [0, 0, 0, 0] as const;

/** Seeded PRNG so "noisy" fixtures stay deterministic. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function inEllipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

/** Dark blob on a light background. */
export function simpleSilhouette(size = 200): RgbaImage {
  return raster(size, size, WHITE, (x, y) =>
    inEllipse(x, y, size / 2, size / 2, size * 0.3, size * 0.36) ? BLACK : null,
  );
}

/** Butterfly-like shape: two mirrored wing lobes plus a body. */
export function butterflyShape(size = 240): RgbaImage {
  const c = size / 2;
  return raster(size, size, WHITE, (x, y) => {
    const body = inEllipse(x, y, c, c, size * 0.035, size * 0.28);
    const upperL = inEllipse(x, y, c - size * 0.2, c - size * 0.12, size * 0.19, size * 0.15);
    const upperR = inEllipse(x, y, c + size * 0.2, c - size * 0.12, size * 0.19, size * 0.15);
    const lowerL = inEllipse(x, y, c - size * 0.15, c + size * 0.16, size * 0.13, size * 0.12);
    const lowerR = inEllipse(x, y, c + size * 0.15, c + size * 0.16, size * 0.13, size * 0.12);
    return body || upperL || upperR || lowerL || lowerR ? BLACK : null;
  });
}

/** Portrait-like head silhouette with two eye holes (background-coloured). */
export function portraitWithHoles(size = 220): RgbaImage {
  const c = size / 2;
  return raster(size, size, WHITE, (x, y) => {
    const head = inEllipse(x, y, c, c, size * 0.28, size * 0.36);
    if (!head) return null;
    const eyeL = inEllipse(x, y, c - size * 0.11, c - size * 0.08, size * 0.05, size * 0.045);
    const eyeR = inEllipse(x, y, c + size * 0.11, c - size * 0.08, size * 0.05, size * 0.045);
    return eyeL || eyeR ? WHITE : BLACK;
  });
}

/** Silhouette plus seeded salt-and-pepper noise and tiny stray specks. */
export function noisySilhouette(size = 200, seed = 12345): RgbaImage {
  const rnd = mulberry32(seed);
  const base = simpleSilhouette(size);
  const data = new Uint8ClampedArray(base.data);
  for (let i = 0; i < size * size; i++) {
    if (rnd() < 0.04) {
      const v = rnd() < 0.5 ? 0 : 255;
      const o = i * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

/** Opaque subject on a fully transparent background. */
export function transparentSubject(size = 200): RgbaImage {
  return raster(size, size, CLEAR, (x, y) =>
    inEllipse(x, y, size / 2, size / 2, size * 0.3, size * 0.3) ? [200, 60, 60, 255] : null,
  );
}

/** Light subject on a dark background (inverted polarity). */
export function lightOnDark(size = 200): RgbaImage {
  return raster(size, size, BLACK, (x, y) =>
    inEllipse(x, y, size / 2, size / 2, size * 0.28, size * 0.34) ? WHITE : null,
  );
}
