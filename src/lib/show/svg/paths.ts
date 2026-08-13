/**
 * SVG path data parser — `d` attribute to absolute segments.
 *
 * Supports every standard command: M/m L/l H/h V/v C/c S/s Q/q T/t A/a Z/z.
 * Elliptical arcs are converted to cubic Béziers so the rest of the pipeline
 * only ever deals with lines and cubics (affine-transform safe).
 */
import type { Point2 } from "./types";

export interface LineSeg {
  t: "L";
  x: number;
  y: number;
}
export interface CubicSeg {
  t: "C";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x: number;
  y: number;
}
export type Segment = LineSeg | CubicSeg;

export interface SubPath {
  start: Point2;
  segments: Segment[];
  closed: boolean;
}

const COMMANDS = "MmLlHhVvCcSsQqTtAaZz";

interface Token {
  cmd: string;
  args: number[];
}

/** Tokenises path data. Tolerant of commas, exponents and implicit repeats. */
export function tokenizePathData(d: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = d.length;
  const readNumber = (): number | null => {
    while (i < n && (d[i] === " " || d[i] === "," || d[i] === "\n" || d[i] === "\r" || d[i] === "\t")) i++;
    const start = i;
    if (i < n && (d[i] === "+" || d[i] === "-")) i++;
    let digits = 0;
    while (i < n && d[i]! >= "0" && d[i]! <= "9") {
      i++;
      digits++;
    }
    if (i < n && d[i] === ".") {
      i++;
      while (i < n && d[i]! >= "0" && d[i]! <= "9") {
        i++;
        digits++;
      }
    }
    if (digits === 0) {
      i = start;
      return null;
    }
    if (i < n && (d[i] === "e" || d[i] === "E")) {
      const save = i;
      i++;
      if (i < n && (d[i] === "+" || d[i] === "-")) i++;
      let expDigits = 0;
      while (i < n && d[i]! >= "0" && d[i]! <= "9") {
        i++;
        expDigits++;
      }
      if (expDigits === 0) i = save;
    }
    const value = Number(d.slice(start, i));
    return Number.isFinite(value) ? value : null;
  };

  while (i < n) {
    const ch = d[i]!;
    if (!COMMANDS.includes(ch)) {
      i++;
      continue;
    }
    i++;
    const args: number[] = [];
    for (;;) {
      const before = i;
      const v = readNumber();
      if (v === null) {
        i = before;
        break;
      }
      args.push(v);
    }
    tokens.push({ cmd: ch, args });
  }
  return tokens;
}

const ARG_COUNT: Record<string, number> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

function quadToCubic(
  px: number,
  py: number,
  qx: number,
  qy: number,
  x: number,
  y: number,
): CubicSeg {
  return {
    t: "C",
    x1: px + (2 / 3) * (qx - px),
    y1: py + (2 / 3) * (qy - py),
    x2: x + (2 / 3) * (qx - x),
    y2: y + (2 / 3) * (qy - y),
    x,
    y,
  };
}

/** Endpoint-parameterisation elliptical arc -> cubic Béziers (SVG spec F.6). */
export function arcToCubics(
  x0: number,
  y0: number,
  rxIn: number,
  ryIn: number,
  rotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x1: number,
  y1: number,
): CubicSeg[] {
  if (x0 === x1 && y0 === y1) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [{ t: "C", x1: x0, y1: y0, x2: x1, y2: y1, x: x1, y: y1 }];

  const phi = (rotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx2 = (x0 - x1) / 2;
  const dy2 = (y0 - y1) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / (den || 1)));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x0 + x1) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y0 + y1) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / (len || 1))));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angle(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  );
  if (!sweep && dTheta > 0) dTheta -= Math.PI * 2;
  if (sweep && dTheta < 0) dTheta += Math.PI * 2;

  const count = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const delta = dTheta / count;
  const alpha = (4 / 3) * Math.tan(delta / 4);
  const out: CubicSeg[] = [];
  let th = theta1;
  let px = x0;
  let py = y0;
  for (let k = 0; k < count; k++) {
    const th2 = th + delta;
    const e1x = -rx * Math.sin(th);
    const e1y = ry * Math.cos(th);
    const e2x = -rx * Math.sin(th2);
    const e2y = ry * Math.cos(th2);
    const p2x = cx + cosPhi * (rx * Math.cos(th2)) - sinPhi * (ry * Math.sin(th2));
    const p2y = cy + sinPhi * (rx * Math.cos(th2)) + cosPhi * (ry * Math.sin(th2));
    const c1x = px + alpha * (cosPhi * e1x - sinPhi * e1y);
    const c1y = py + alpha * (sinPhi * e1x + cosPhi * e1y);
    const c2x = p2x - alpha * (cosPhi * e2x - sinPhi * e2y);
    const c2y = p2y - alpha * (sinPhi * e2x + cosPhi * e2y);
    out.push({ t: "C", x1: c1x, y1: c1y, x2: c2x, y2: c2y, x: p2x, y: p2y });
    th = th2;
    px = p2x;
    py = p2y;
  }
  return out;
}

/** Parses path data into absolute subpaths of lines and cubics. */
export function parsePathData(d: string): SubPath[] {
  const tokens = tokenizePathData(d);
  const subPaths: SubPath[] = [];
  let current: SubPath | null = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let prevCmd = "";
  let lastC: Point2 | null = null; // last cubic control point
  let lastQ: Point2 | null = null; // last quadratic control point

  const push = (seg: Segment) => {
    if (!current) {
      current = { start: [x, y], segments: [], closed: false };
      subPaths.push(current);
    }
    current.segments.push(seg);
  };

  for (const token of tokens) {
    const upper = token.cmd.toUpperCase();
    const relative = token.cmd !== upper;
    const arity = ARG_COUNT[upper] ?? 0;
    if (upper === "Z") {
      if (current) {
        current.closed = true;
        current = null;
      }
      x = startX;
      y = startY;
      prevCmd = "Z";
      lastC = null;
      lastQ = null;
      continue;
    }
    if (arity === 0) continue;
    const groups = Math.max(1, Math.floor(token.args.length / arity));
    for (let g = 0; g < groups; g++) {
      const a = token.args.slice(g * arity, g * arity + arity);
      if (a.length < arity) break;
      switch (upper) {
        case "M": {
          const nx = relative ? x + a[0]! : a[0]!;
          const ny = relative ? y + a[1]! : a[1]!;
          if (g === 0) {
            x = nx;
            y = ny;
            startX = x;
            startY = y;
            current = { start: [x, y], segments: [], closed: false };
            subPaths.push(current);
          } else {
            x = nx;
            y = ny;
            push({ t: "L", x, y });
          }
          lastC = null;
          lastQ = null;
          break;
        }
        case "L": {
          x = relative ? x + a[0]! : a[0]!;
          y = relative ? y + a[1]! : a[1]!;
          push({ t: "L", x, y });
          lastC = null;
          lastQ = null;
          break;
        }
        case "H": {
          x = relative ? x + a[0]! : a[0]!;
          push({ t: "L", x, y });
          lastC = null;
          lastQ = null;
          break;
        }
        case "V": {
          y = relative ? y + a[0]! : a[0]!;
          push({ t: "L", x, y });
          lastC = null;
          lastQ = null;
          break;
        }
        case "C": {
          const x1 = relative ? x + a[0]! : a[0]!;
          const y1 = relative ? y + a[1]! : a[1]!;
          const x2 = relative ? x + a[2]! : a[2]!;
          const y2 = relative ? y + a[3]! : a[3]!;
          x = relative ? x + a[4]! : a[4]!;
          y = relative ? y + a[5]! : a[5]!;
          push({ t: "C", x1, y1, x2, y2, x, y });
          lastC = [x2, y2];
          lastQ = null;
          break;
        }
        case "S": {
          const smooth = prevCmd === "C" || prevCmd === "S";
          const x1 = smooth && lastC ? 2 * x - lastC[0] : x;
          const y1 = smooth && lastC ? 2 * y - lastC[1] : y;
          const x2 = relative ? x + a[0]! : a[0]!;
          const y2 = relative ? y + a[1]! : a[1]!;
          x = relative ? x + a[2]! : a[2]!;
          y = relative ? y + a[3]! : a[3]!;
          push({ t: "C", x1, y1, x2, y2, x, y });
          lastC = [x2, y2];
          lastQ = null;
          break;
        }
        case "Q": {
          const qx = relative ? x + a[0]! : a[0]!;
          const qy = relative ? y + a[1]! : a[1]!;
          const px = x;
          const py = y;
          x = relative ? x + a[2]! : a[2]!;
          y = relative ? y + a[3]! : a[3]!;
          push(quadToCubic(px, py, qx, qy, x, y));
          lastQ = [qx, qy];
          lastC = null;
          break;
        }
        case "T": {
          const smooth = prevCmd === "Q" || prevCmd === "T";
          const qx: number = smooth && lastQ ? 2 * x - lastQ[0] : x;
          const qy: number = smooth && lastQ ? 2 * y - lastQ[1] : y;
          const px = x;
          const py = y;
          x = relative ? x + a[0]! : a[0]!;
          y = relative ? y + a[1]! : a[1]!;
          push(quadToCubic(px, py, qx, qy, x, y));
          lastQ = [qx, qy];
          lastC = null;
          break;
        }
        case "A": {
          const x0 = x;
          const y0 = y;
          x = relative ? x + a[5]! : a[5]!;
          y = relative ? y + a[6]! : a[6]!;
          const cubics = arcToCubics(x0, y0, a[0]!, a[1]!, a[2]!, a[3]! !== 0, a[4]! !== 0, x, y);
          if (cubics.length === 0) push({ t: "L", x, y });
          else for (const c of cubics) push(c);
          lastC = null;
          lastQ = null;
          break;
        }
        default:
          break;
      }
      prevCmd = upper;
    }
  }
  return subPaths.filter((sp) => sp.segments.length > 0);
}
