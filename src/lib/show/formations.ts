/**
 * Formation Engine — deterministic point-cloud generators.
 *
 * Every generator returns exactly `count` points in the show frame (metres,
 * +Y up, origin at the centre of the show area floor). Generators are pure so
 * they can be moved to the Python computation service without behaviour drift.
 */
import type { Formation, FormationKind, ShowArea, Vec3 } from "./types";

const TAU = Math.PI * 2;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

function clampToArea(points: Vec3[], area: ShowArea): Vec3[] {
  const hx = area.width / 2;
  const hz = area.depth / 2;
  return points.map(([x, y, z]) => [
    Math.max(-hx, Math.min(hx, x)),
    Math.max(1, Math.min(area.height, y)),
    Math.max(-hz, Math.min(hz, z)),
  ]);
}

export function gridPoints(count: number, size: number, altitude: number): Vec3[] {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const out: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    out.push([
      ((c - (cols - 1) / 2) / Math.max(1, cols - 1)) * size,
      altitude,
      ((r - (rows - 1) / 2) / Math.max(1, rows - 1)) * size,
    ]);
  }
  return out;
}

export function circlePoints(count: number, radius: number, altitude: number): Vec3[] {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * TAU;
    return [Math.cos(a) * radius, altitude, Math.sin(a) * radius] as Vec3;
  });
}

/** Fibonacci sphere — near-uniform angular spacing, best separation margin. */
export function spherePoints(count: number, radius: number, altitude: number): Vec3[] {
  return Array.from({ length: count }, (_, i) => {
    const y = count === 1 ? 0 : 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN * i;
    return [Math.cos(theta) * r * radius, altitude + y * radius, Math.sin(theta) * r * radius] as Vec3;
  });
}

export function helixPoints(count: number, radius: number, height: number, turns: number): Vec3[] {
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1);
    const a = t * TAU * turns;
    return [Math.cos(a) * radius, 2 + t * height, Math.sin(a) * radius] as Vec3;
  });
}

export function cubePoints(count: number, size: number, altitude: number): Vec3[] {
  const n = Math.max(2, Math.ceil(Math.cbrt(count)));
  const out: Vec3[] = [];
  for (let i = 0; i < n && out.length < count; i++)
    for (let j = 0; j < n && out.length < count; j++)
      for (let k = 0; k < n && out.length < count; k++) {
        out.push([
          (i / (n - 1) - 0.5) * size,
          altitude + (j / (n - 1) - 0.5) * size,
          (k / (n - 1) - 0.5) * size,
        ]);
      }
  return out;
}

export function wavePoints(count: number, size: number, altitude: number, amplitude: number): Vec3[] {
  return gridPoints(count, size, altitude).map(([x, y, z]) => [
    x,
    y + Math.sin((x / size) * TAU) * amplitude + Math.cos((z / size) * TAU) * amplitude * 0.5,
    z,
  ]);
}

/**
 * Equal-arc-length resampling of a closed parametric curve. Uniform parameter
 * sampling clusters points at cusps (which reads as a separation violation), so
 * every curve formation goes through this.
 */
export function resampleClosedCurve(
  curve: (t: number) => Vec3,
  count: number,
  density = 2000,
): Vec3[] {
  const dense = Array.from({ length: density }, (_, i) => curve((i / density) * TAU));
  const cum = [0];
  for (let i = 1; i <= density; i++) {
    const a = dense[i - 1]!;
    const b = dense[i % density]!;
    cum.push(cum[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const total = cum[density]!;
  const out: Vec3[] = [];
  let cursor = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    while (cursor < density - 1 && cum[cursor + 1]! < target) cursor++;
    out.push(dense[cursor]!);
  }
  return out;
}

export function heartPoints(count: number, scale: number, altitude: number): Vec3[] {
  return resampleClosedCurve((t) => {
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    return [(x / 16) * scale, altitude + (y / 16) * scale, 0];
  }, count);
}

/**
 * NATIVE LINE GEOMETRY — deterministic evenly spaced row(s) of points.
 *
 * Geometry only: it feeds the same static-source path as any library asset, so
 * assignment, trajectory and safety stay untouched. `rows` > 1 builds a thicker
 * bar (underline) by stacking rows on the local Y axis.
 */
export function linePoints(
  count: number,
  length: number,
  altitude: number,
  rotationDeg = 0,
  rows = 1,
  rowSpacing = 1.5,
): Vec3[] {
  const n = Math.max(1, Math.round(count));
  const r = Math.max(1, Math.round(rows));
  const perRow = Math.ceil(n / r);
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const x = perRow === 1 ? 0 : (col / (perRow - 1) - 0.5) * length;
    const y = (row - (r - 1) / 2) * rowSpacing;
    out.push([x * cos - y * sin, altitude + (x * sin + y * cos), 0]);
  }
  return out;
}


/**
 * Text formation via glyph-mask sampling. Runs in the browser only (needs
 * canvas); callers must invoke it from an effect/handler, never during SSR.
 */
export function textPoints(
  text: string,
  count: number,
  size: number,
  altitude: number,
): Vec3[] {
  if (typeof document === "undefined" || !text.trim()) {
    return circlePoints(count, size / 3, altitude);
  }
  const W = 320;
  const H = 96;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return circlePoints(count, size / 3, altitude);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let font = 72;
  do {
    ctx.font = `bold ${font}px sans-serif`;
    font -= 2;
  } while (ctx.measureText(text).width > W * 0.92 && font > 8);
  ctx.fillText(text, W / 2, H / 2);

  const data = ctx.getImageData(0, 0, W, H).data;
  const candidates: Vec3[] = [];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if ((data[(y * W + x) * 4] ?? 0) > 128) {
        candidates.push([(x / W - 0.5) * size, altitude + (0.5 - y / H) * (size * (H / W)), 0]);
      }
    }
  }
  if (candidates.length === 0) return circlePoints(count, size / 3, altitude);
  // Even stride sampling keeps glyph coverage balanced across the string.
  return Array.from({ length: count }, (_, i) => {
    const idx = Math.floor((i * candidates.length) / count);
    return candidates[Math.min(candidates.length - 1, idx)]!;
  });
}

export function generatePoints(
  kind: FormationKind,
  count: number,
  area: ShowArea,
  params: Record<string, number | string> = {},
): Vec3[] {
  const num = (k: string, d: number) => (typeof params[k] === "number" ? (params[k] as number) : d);
  const alt = num("altitude", Math.min(area.height * 0.5, 40));
  const size = num("size", Math.min(area.width, area.depth) * 0.6);
  let pts: Vec3[];
  switch (kind) {
    case "grid":
      pts = gridPoints(count, size, alt);
      break;
    case "circle":
      pts = circlePoints(count, size / 2, alt);
      break;
    case "sphere":
      pts = spherePoints(count, size / 2, alt);
      break;
    case "helix":
      pts = helixPoints(count, size / 3, num("height", area.height * 0.7), num("turns", 3));
      break;
    case "cube":
      pts = cubePoints(count, size * 0.7, alt);
      break;
    case "wave":
      pts = wavePoints(count, size, alt, num("amplitude", 8));
      break;
    case "heart":
      pts = heartPoints(count, size * 0.8, alt);
      break;
    case "text":
      pts = textPoints(String(params["text"] ?? "SHOW"), count, size, alt);
      break;
    case "line":
      pts = linePoints(
        count,
        num("length", size),
        alt,
        num("rotationDeg", 0),
        num("rows", 1),
        num("rowSpacing", 1.5),
      );
      break;
    default:
      pts = gridPoints(count, size, alt);
  }
  return clampToArea(pts, area);
}

export function makeFormation(
  id: string,
  name: string,
  kind: FormationKind,
  count: number,
  area: ShowArea,
  params: Record<string, number | string> = {},
): Formation {
  return { id, name, kind, params, points: generatePoints(kind, count, area, params) };
}
