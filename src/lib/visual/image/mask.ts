/**
 * Binary mask construction: Otsu threshold, small deterministic morphology,
 * connected components and component filtering. All pure, all integer-stable.
 */
import { ALPHA_BACKGROUND_CUTOFF, resolvePolarity, type LuminanceField } from "./luminance";
import type { ImageBackgroundMode, ResolvedPolarity } from "./types";

const HISTOGRAM_BINS = 256;

/** Classic Otsu threshold in [0, 1] over the supplied luminance samples. */
export function otsuThreshold(field: LuminanceField): number {
  const hist = new Float64Array(HISTOGRAM_BINS);
  let total = 0;
  for (let i = 0; i < field.lum.length; i++) {
    if ((field.alpha[i] ?? 255) < ALPHA_BACKGROUND_CUTOFF) continue;
    const bin = Math.min(255, Math.max(0, Math.round((field.lum[i] ?? 0) * 255)));
    hist[bin] = (hist[bin] ?? 0) + 1;
    total++;
  }
  if (total === 0) return 0.5;
  let sumAll = 0;
  for (let b = 0; b < HISTOGRAM_BINS; b++) sumAll += b * (hist[b] ?? 0);
  let wB = 0;
  let sumB = 0;
  // A perfectly bimodal image produces a PLATEAU of equally good thresholds
  // (every empty bin between the two modes). Returning the first index would
  // collapse the mask, so the plateau midpoint is used instead.
  let bestLow = 0;
  let bestHigh = 0;
  let bestVar = -1;
  for (let b = 0; b < HISTOGRAM_BINS; b++) {
    wB += hist[b] ?? 0;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += b * (hist[b] ?? 0);
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar * (1 + 1e-12) && between > bestVar) {
      bestVar = between;
      bestLow = b;
      bestHigh = b;
    } else if (bestVar > 0 && Math.abs(between - bestVar) <= bestVar * 1e-12) {
      bestHigh = b;
    }
  }
  return (bestLow + bestHigh) / 2 / 255;
}

export interface BinaryMask {
  readonly width: number;
  readonly height: number;
  /** 1 = foreground (subject), 0 = background. */
  readonly data: Uint8Array;
}

export interface MaskResult {
  readonly mask: BinaryMask;
  readonly polarity: ResolvedPolarity;
  readonly threshold: number;
  readonly foregroundRatio: number;
}

export function buildMask(
  field: LuminanceField,
  background: ImageBackgroundMode,
): MaskResult {
  const threshold = otsuThreshold(field);
  const polarity = resolvePolarity(field, background, threshold);
  const n = field.width * field.height;
  const data = new Uint8Array(n);
  let fg = 0;
  for (let i = 0; i < n; i++) {
    const a = field.alpha[i] ?? 255;
    let on: boolean;
    if (polarity === "ALPHA") {
      on = a >= ALPHA_BACKGROUND_CUTOFF;
    } else if (a < ALPHA_BACKGROUND_CUTOFF) {
      on = false;
    } else if (polarity === "LIGHT") {
      // Light background -> the subject is the darker material.
      on = (field.lum[i] ?? 0) < threshold;
    } else {
      on = (field.lum[i] ?? 0) >= threshold;
    }
    data[i] = on ? 1 : 0;
    if (on) fg++;
  }
  return {
    mask: { width: field.width, height: field.height, data },
    polarity,
    threshold,
    foregroundRatio: n > 0 ? fg / n : 0,
  };
}

function dilate(mask: BinaryMask, radius: number, value: 1 | 0): BinaryMask {
  const { width: w, height: h, data } = mask;
  const out = new Uint8Array(data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (data[i] === value) continue;
      let hit = false;
      for (let dy = -radius; dy <= radius && !hit; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          if (data[yy * w + xx] === value) {
            hit = true;
            break;
          }
        }
      }
      if (hit) out[i] = value;
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * STIPPLE CONSOLIDATION.
 *
 * A drone-render reference (bright dots on a dark sky) is a STIPPLED silhouette:
 * hundreds of tiny components with gaps between them. A radius-1 opening erases
 * every dot, which previously made analysis fall back to the whole frame and
 * produce a rectangle. Closing with an adaptive radius bridges the dot lattice
 * into the silhouette it depicts BEFORE any noise removal happens.
 *
 * Deterministic: the radius search is a bounded ascending scan.
 */
export function isStippledMask(mask: BinaryMask): boolean {
  const fg = labelComponents(mask, 1);
  if (fg.count < 12) return false;
  const total = fg.areas.reduce((a, b) => a + b, 0);
  if (total === 0) return false;
  const largest = Math.max(...fg.areas);
  return largest / total < 0.2;
}

export function consolidateStipple(mask: BinaryMask, maxRadius = 6): BinaryMask {
  if (!isStippledMask(mask)) return mask;
  let best = mask;
  for (let r = 1; r <= maxRadius; r++) {
    const closed = dilate(dilate(mask, r, 1), r, 0);
    best = closed;
    if (!isStippledMask(closed)) break;
  }
  return best;
}

/**
 * Morphological opening then closing with a square structuring element.
 * Opening removes salt noise, closing seals pepper holes. Deliberately small:
 * bad extraction must stay visible in the STRUCTURE preview rather than being
 * hidden behind aggressive post-processing.
 */
export function cleanMask(mask: BinaryMask, radius: number): BinaryMask {
  if (radius <= 0) return mask;
  const eroded = dilate(mask, radius, 0); // erode foreground
  const opened = dilate(eroded, radius, 1);
  const closedFill = dilate(opened, radius, 1);
  return dilate(closedFill, radius, 0);
}

export interface LabeledComponents {
  /** 0 = background, 1..count = component label. */
  readonly labels: Int32Array;
  readonly count: number;
  /** areas[label - 1] */
  readonly areas: readonly number[];
  readonly bboxes: readonly (readonly [number, number, number, number])[];
}

/**
 * 8-connected labeling of pixels equal to `value`, scanning row major so labels
 * are deterministic (top-left component first).
 */
export function labelComponents(mask: BinaryMask, value: 0 | 1): LabeledComponents {
  const { width: w, height: h, data } = mask;
  const labels = new Int32Array(w * h);
  const areas: number[] = [];
  const bboxes: [number, number, number, number][] = [];
  const stack: number[] = [];
  let count = 0;
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] !== 0 || data[start] !== value) continue;
    count++;
    const label = count;
    let area = 0;
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    labels[start] = label;
    stack.push(start);
    while (stack.length > 0) {
      const p = stack.pop() as number;
      const x = p % w;
      const y = (p - x) / w;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (labels[q] !== 0 || data[q] !== value) continue;
          labels[q] = label;
          stack.push(q);
        }
      }
    }
    areas.push(area);
    bboxes.push([minX, minY, maxX, maxY]);
  }
  return { labels, count, areas, bboxes };
}

/** Background components that do NOT touch the image border are holes. */
export function findHoleLabels(mask: BinaryMask, background: LabeledComponents): Set<number> {
  const { width: w, height: h } = mask;
  const border = new Set<number>();
  for (let x = 0; x < w; x++) {
    border.add(background.labels[x] ?? 0);
    border.add(background.labels[(h - 1) * w + x] ?? 0);
  }
  for (let y = 0; y < h; y++) {
    border.add(background.labels[y * w] ?? 0);
    border.add(background.labels[y * w + (w - 1)] ?? 0);
  }
  const holes = new Set<number>();
  for (let label = 1; label <= background.count; label++) {
    if (!border.has(label)) holes.add(label);
  }
  return holes;
}
