/**
 * Rec.709 luminance + alpha-aware background handling + deterministic box
 * downscale. Pure functions on `RgbaImage`, so every fixture in tests can be a
 * synthetic raster with no browser involved.
 */
import type { ImageBackgroundMode, ResolvedPolarity, RgbaImage } from "./types";

/** Alpha below this is treated as background (transparent PNG support). */
export const ALPHA_BACKGROUND_CUTOFF = 24;

export interface LuminanceField {
  readonly width: number;
  readonly height: number;
  /** Rec.709 luminance in [0, 1], premultiplied against white for RGB use. */
  readonly lum: Float32Array;
  /** Alpha in [0, 255]. */
  readonly alpha: Uint8Array;
  /** True when the image carries meaningful transparency. */
  readonly hasAlpha: boolean;
}

/**
 * Deterministic box-filter downscale so the analysis long edge never exceeds
 * `maxEdge`. Integral accumulation in Float64 keeps the result independent of
 * traversal order.
 */
export function downscale(image: RgbaImage, maxEdge: number): RgbaImage {
  const longEdge = Math.max(image.width, image.height);
  if (longEdge <= maxEdge) return image;
  const scale = maxEdge / longEdge;
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor((y * image.height) / h);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * image.height) / h));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor((x * image.width) / w);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * image.width) / w));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * image.width + sx) * 4;
          const av = image.data[i + 3] ?? 0;
          r += (image.data[i] ?? 0) * av;
          g += (image.data[i + 1] ?? 0) * av;
          b += (image.data[i + 2] ?? 0) * av;
          a += av;
          n++;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round(a / Math.max(1, n));
    }
  }
  return { width: w, height: h, data: out };
}

export function toLuminance(image: RgbaImage): LuminanceField {
  const n = image.width * image.height;
  const lum = new Float32Array(n);
  const alpha = new Uint8Array(n);
  let transparentPixels = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = (image.data[o] ?? 0) / 255;
    const g = (image.data[o + 1] ?? 0) / 255;
    const b = (image.data[o + 2] ?? 0) / 255;
    const a = image.data[o + 3] ?? 255;
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    alpha[i] = a;
    if (a < ALPHA_BACKGROUND_CUTOFF) transparentPixels++;
  }
  return {
    width: image.width,
    height: image.height,
    lum,
    alpha,
    // Enough transparency to be intentional rather than a stray anti-aliased edge.
    hasAlpha: transparentPixels >= Math.max(16, Math.round(n * 0.02)),
  };
}

/** Mean luminance of the 1-pixel-thick border ring (opaque pixels only). */
export function borderRingLuminance(field: LuminanceField): number {
  const { width: w, height: h, lum, alpha } = field;
  let sum = 0;
  let n = 0;
  const push = (x: number, y: number) => {
    const i = y * w + x;
    if ((alpha[i] ?? 255) < ALPHA_BACKGROUND_CUTOFF) return;
    sum += lum[i] ?? 0;
    n++;
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    if (h > 1) push(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    push(0, y);
    if (w > 1) push(w - 1, y);
  }
  return n > 0 ? sum / n : 0.5;
}

/**
 * Resolves the requested background mode into the polarity actually used.
 * A meaningfully transparent image always wins: alpha is the most reliable
 * silhouette signal available and never depends on a threshold guess.
 */
export function resolvePolarity(
  field: LuminanceField,
  mode: ImageBackgroundMode,
  threshold: number,
): ResolvedPolarity {
  if (mode === "AUTO" && field.hasAlpha) return "ALPHA";
  if (mode === "LIGHT") return "LIGHT";
  if (mode === "DARK") return "DARK";
  return borderRingLuminance(field) >= threshold ? "LIGHT" : "DARK";
}
