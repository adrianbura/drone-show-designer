/**
 * Moore-neighbour contour tracing with Jacob's stopping criterion.
 *
 * Traces the closed outer boundary of a labeled region in analysis pixel space
 * (X right, Y DOWN). Deterministic: the start pixel is the first pixel of the
 * region in row-major order, and the neighbour walk direction is fixed.
 */
import type { BinaryMask } from "./mask";
import type { PixelRing } from "./types";

/** Clockwise 8-neighbour offsets starting at west. */
const OFFSETS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
];

export interface TraceTarget {
  readonly width: number;
  readonly height: number;
  /** Returns true when the pixel belongs to the region being traced. */
  readonly inside: (x: number, y: number) => boolean;
}

export function targetFromLabels(
  width: number,
  height: number,
  labels: Int32Array,
  label: number,
): TraceTarget {
  return {
    width,
    height,
    inside: (x, y) =>
      x >= 0 && y >= 0 && x < width && y < height && labels[y * width + x] === label,
  };
}

export function targetFromMask(mask: BinaryMask, value: 0 | 1): TraceTarget {
  return {
    width: mask.width,
    height: mask.height,
    inside: (x, y) =>
      x >= 0 &&
      y >= 0 &&
      x < mask.width &&
      y < mask.height &&
      mask.data[y * mask.width + x] === value,
  };
}

/** First region pixel in row-major order, or null when the region is empty. */
export function firstPixel(target: TraceTarget): [number, number] | null {
  for (let y = 0; y < target.height; y++) {
    for (let x = 0; x < target.width; x++) {
      if (target.inside(x, y)) return [x, y];
    }
  }
  return null;
}

/**
 * Traces the outer boundary ring of the region containing `start`.
 * Returns pixel centres; the ring is implicitly closed (last != first).
 */
export function traceContour(target: TraceTarget, start: [number, number]): PixelRing {
  const ring: [number, number][] = [];
  const maxSteps = target.width * target.height * 8 + 64;
  let current = start;
  // Enter from the west of the start pixel — guaranteed background for a
  // row-major first pixel.
  let backtrack: [number, number] = [start[0] - 1, start[1]];
  let steps = 0;
  const firstMove: string[] = [];
  while (steps++ < maxSteps) {
    ring.push([current[0], current[1]]);
    const dx = backtrack[0] - current[0];
    const dy = backtrack[1] - current[1];
    let idx = OFFSETS.findIndex((o) => o[0] === dx && o[1] === dy);
    if (idx < 0) idx = 0;
    let next: [number, number] | null = null;
    let nextBacktrack: [number, number] = backtrack;
    for (let k = 1; k <= 8; k++) {
      const o = OFFSETS[(idx + k) % 8] as readonly [number, number];
      const cx = current[0] + o[0];
      const cy = current[1] + o[1];
      if (target.inside(cx, cy)) {
        next = [cx, cy];
        const prev = OFFSETS[(idx + k - 1 + 8) % 8] as readonly [number, number];
        nextBacktrack = [current[0] + prev[0], current[1] + prev[1]];
        break;
      }
    }
    if (!next) break; // isolated pixel
    const key = `${next[0]},${next[1]},${nextBacktrack[0]},${nextBacktrack[1]}`;
    if (firstMove.length === 0) {
      firstMove.push(key);
    } else if (firstMove[0] === key) {
      break; // Jacob's stopping criterion
    }
    current = next;
    backtrack = nextBacktrack;
  }
  return ring;
}

export function ringArea(ring: PixelRing): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as readonly [number, number];
    const q = ring[(i + 1) % ring.length] as readonly [number, number];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}
