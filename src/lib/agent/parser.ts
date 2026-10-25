/**
 * AI AGENT — deterministic local command parser (Romanian + English).
 *
 * Works with NO API key and no network: it maps a natural-language request to
 * the typed operations in ./operations.ts. When the model backend is
 * available it may produce the same typed operations instead; this parser is
 * the transparent offline fallback and the test oracle for both paths.
 *
 * Deliberately conservative: anything it cannot map exactly returns
 * { ok: false } — the agent says what it did not understand instead of
 * guessing an edit.
 */
import type { RGB } from "../show/types";
import type { AgentOp } from "./operations";

export type ParseResult =
  | { ok: true; ops: AgentOp[]; understood: string }
  | { ok: false; reason: "EMPTY" | "NOT_UNDERSTOOD" };

const NAMED_COLORS: Record<string, RGB> = {
  // Romanian
  auriu: [255, 200, 40],
  aurii: [255, 200, 40],
  roșu: [255, 40, 40],
  rosu: [255, 40, 40],
  roșie: [255, 40, 40],
  rosie: [255, 40, 40],
  albastru: [60, 120, 255],
  albastră: [60, 120, 255],
  albastra: [60, 120, 255],
  verde: [60, 220, 100],
  alb: [255, 255, 255],
  albă: [255, 255, 255],
  alba: [255, 255, 255],
  roz: [255, 120, 180],
  violet: [170, 90, 255],
  violetă: [170, 90, 255],
  violeta: [170, 90, 255],
  portocaliu: [255, 150, 40],
  galben: [255, 230, 60],
  galbenă: [255, 230, 60],
  galbena: [255, 230, 60],
  turcoaz: [40, 220, 220],
  cyan: [40, 220, 220],
  // English
  gold: [255, 200, 40],
  golden: [255, 200, 40],
  red: [255, 40, 40],
  blue: [60, 120, 255],
  green: [60, 220, 100],
  white: [255, 255, 255],
  pink: [255, 120, 180],
  purple: [170, 90, 255],
  orange: [255, 150, 40],
  yellow: [255, 230, 60],
  turquoise: [40, 220, 220],
};

const HEX_RE = /#([0-9a-f]{6})\b/i;
const NUMBER_RE = /(-?\d+(?:[.,]\d+)?)/;

function parseColor(text: string): RGB | null {
  const hex = HEX_RE.exec(text);
  if (hex) {
    const h = hex[1]!;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const words = text.toLowerCase().split(/[^a-zăâîșţț]+/i);
  for (const w of words) {
    if (w && NAMED_COLORS[w]) return NAMED_COLORS[w]!;
  }
  return null;
}

interface RotationMention {
  axis: "X" | "Y" | "Z";
  degrees: number;
}

function parseRotations(text: string): RotationMention[] {
  const t = text.toLowerCase();
  const out: RotationMention[] = [];
  const num = NUMBER_RE.exec(t);
  if (!num) return out;
  const value = Number(num[1]!.replace(",", "."));
  if (!Number.isFinite(value)) return out;

  const has = (...needles: string[]) => needles.some((n) => t.includes(n));

  // Tilt (roll, about Z): "înclină", "tilt", "lasă pe o parte".
  if (has("înclin", "inclin", "tilt", "pleac", "pleoac")) {
    let deg = value;
    if (has("stânga", "stanga", "left")) deg = -Math.abs(deg);
    else if (has("dreapta", "right")) deg = Math.abs(deg);
    out.push({ axis: "Z", degrees: deg });
  }
  // Turn (yaw, about Y): "rotește", "întoarce", "turn", "rotate".
  if (has("roteș", "rotes", "rotire", "întoarce", "intoarce", "turn", "rotate", "rotac")) {
    let deg = value;
    if (has("stânga", "stanga", "left")) deg = Math.abs(deg);
    else if (has("dreapta", "right")) deg = -Math.abs(deg);
    out.push({ axis: "Y", degrees: deg });
  }
  // Lean forward/back (pitch, about X).
  if (has("înainte", "inainte", "forward", "față", "fata")) {
    out.push({ axis: "X", degrees: Math.abs(value) });
  } else if (has("înapoi", "inapoi", "backward", "spate")) {
    out.push({ axis: "X", degrees: -Math.abs(value) });
  }
  return out;
}

const SECONDS_RE = /(-?\d+(?:[.,]\d+)?)\s*(?:secunde|secunda|sec|seconds|second|s)\b/i;

/**
 * Duration mentions: "ține scena 12 secunde" (absolute), "prelungește cu 5
 * secunde" / "scurtează cu 5 secunde" (relative). Returns null when the
 * request is not about duration at all.
 */
function parseDuration(text: string): AgentOp | null {
  const t = text.toLowerCase();
  const m = SECONDS_RE.exec(t);
  if (!m) return null;
  const value = Number(m[1]!.replace(",", "."));
  if (!Number.isFinite(value)) return null;
  const aboutDuration = /ține|tine|dureaz|durat|stă |sta |hold|last|duration|lung/i.test(t);
  if (!aboutDuration) return null;
  if (/prelung|extind|mai mult|lengthen|extend|longer|add|adaug/i.test(t)) {
    return { kind: "SET_DURATION", deltaSeconds: Math.abs(value) };
  }
  if (/scurteaz|scurt|reduce|shorten|shorter|mai puțin|mai putin/i.test(t)) {
    return { kind: "SET_DURATION", deltaSeconds: -Math.abs(value) };
  }
  return { kind: "SET_DURATION", holdSeconds: Math.abs(value) };
}

/** Scene selection: "selectează scena 5", "select the heart", "alege inima". */
function parseSelection(text: string): AgentOp | null {
  const t = text.toLowerCase();
  if (!/selecteaz|select|alege|choose|deschide|open/i.test(t)) return null;
  const byIndex = /scena\s+(\d+)|scene\s+(\d+)|clip(?:ul)?\s+(\d+)/i.exec(t);
  if (byIndex) {
    const n = Number(byIndex[1] ?? byIndex[2] ?? byIndex[3]);
    if (Number.isInteger(n) && n >= 1) return { kind: "SELECT_SCENE", sceneIndex: n };
  }
  const byName = /(?:selecteaz[ăa]|select|alege|choose|deschide|open)\s+(?:scena|scene|the|clipul|clip)?\s*([a-zăâîșţț0-9 _-]{2,40})/i.exec(t);
  if (byName) {
    const name = byName[1]!.trim();
    if (name && !/^\d+$/.test(name)) return { kind: "SELECT_SCENE", sceneName: name };
  }
  return null;
}

/**
 * Parses one user request into typed operations. Supports combining a
 * rotation and a recolor in one sentence, e.g.
 * "înclină scena 20 de grade spre stânga și schimbă culoarea în auriu".
 */
export function parseAgentCommand(input: string): ParseResult {
  const text = input.trim();
  if (!text) return { ok: false, reason: "EMPTY" };
  const ops: AgentOp[] = [];

  const selection = parseSelection(text);
  if (selection) ops.push(selection);

  for (const r of parseRotations(text)) {
    ops.push({ kind: "ROTATE_SCENE", axis: r.axis, degrees: r.degrees });
  }

  const wantsColor = /culoar|color|recolor|vopse|coloreaz|colorează/i.test(text);
  if (wantsColor) {
    const color = parseColor(text);
    if (color) ops.push({ kind: "RECOLOR_SCENE", color });
  }

  const duration = parseDuration(text);
  if (duration) ops.push(duration);

  if (ops.length === 0) return { ok: false, reason: "NOT_UNDERSTOOD" };
  return { ok: true, ops, understood: text };
}
