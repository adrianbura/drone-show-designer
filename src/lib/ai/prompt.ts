/**
 * Bilingual (EN/RO) prompt understanding for the deterministic mock provider.
 *
 * Pure text -> structured intent. It never produces geometry, never decides
 * safety and never invents units: an unrecognised request degrades to explicit
 * assumptions instead of guessing silently.
 */
import type { ChoreographyConcept, PromptLanguage } from "./types";

export interface PromptIntent {
  readonly language: PromptLanguage;
  readonly concept: ChoreographyConcept | null;
  /** Fleet size mentioned in the prompt, if any. */
  readonly fleetCount?: number;
  readonly cycles?: number;
  /** Multiplier applied to the default cycle duration (slower / faster). */
  readonly speedScale?: number;
  /** Multiplier applied to the default formation size. */
  readonly sizeScale?: number;
  readonly amplitudeDeg?: number;
  readonly rotationDeg?: number;
  /** Metres of forward travel (+Z, away from the audience). */
  readonly forward?: number;
  /** Metres of lateral travel (+X, to the right). */
  readonly right?: number;
  /** Metres of climb (+Y). */
  readonly climb?: number;
  readonly bodyDeforms?: boolean;
  readonly color?: readonly [number, number, number];
  readonly colorName?: string;
}

const RO_HINTS = [
  "drone",
  "porumbel",
  "pasare",
  "pasăre",
  "fluture",
  "inima",
  "inimă",
  "cerc",
  "stea",
  "spirala",
  "spirală",
  "aripi",
  "arip",
  "bate",
  "batai",
  "bătăi",
  "ori",
  "metri",
  "grade",
  "zboara",
  "zboară",
  "roteste",
  "rotește",
  "urca",
  "urcă",
  "inainte",
  "înainte",
  "corpul",
  "mai",
  "lent",
  "repede",
];

const EN_HINTS = [
  "drone",
  "bird",
  "pigeon",
  "dove",
  "butterfly",
  "heart",
  "circle",
  "ring",
  "star",
  "spiral",
  "wave",
  "wings",
  "flap",
  "times",
  "meters",
  "metres",
  "degrees",
  "fly",
  "rotate",
  "climb",
  "forward",
  "body",
  "slower",
  "faster",
];

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  un: 1,
  una: 1,
  doi: 2,
  doua: 2,
  trei: 3,
  patru: 4,
  cinci: 5,
  sase: 6,
  sapte: 7,
  opt: 8,
  noua: 9,
  zece: 10,
};

const CONCEPT_KEYWORDS: readonly (readonly [ChoreographyConcept, readonly string[]])[] = [
  ["BIRD", ["bird", "pigeon", "dove", "eagle", "porumbel", "pasare", "vultur"]],
  ["BUTTERFLY", ["butterfly", "fluture"]],
  ["HEART", ["heart", "inima"]],
  ["RING", ["ring", "inel", "halo"]],
  ["CIRCLE", ["circle", "cerc", "disc"]],
  ["STAR", ["star", "stea"]],
  ["SPIRAL", ["spiral", "spirala", "vortex", "helix"]],
  ["WAVE", ["wave", "val", "valuri"]],
];

const COLOR_KEYWORDS: readonly (readonly [string, readonly [number, number, number]])[] = [
  ["white", [255, 255, 255]],
  ["alb", [255, 255, 255]],
  ["red", [255, 60, 60]],
  ["rosu", [255, 60, 60]],
  ["blue", [70, 150, 255]],
  ["albastru", [70, 150, 255]],
  ["green", [80, 230, 140]],
  ["verde", [80, 230, 140]],
  ["gold", [255, 200, 90]],
  ["auriu", [255, 200, 90]],
  ["purple", [190, 120, 255]],
  ["violet", [190, 120, 255]],
];

/** Diacritic-free lowercase text — RO input is matched with or without them. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[șş]/g, "s")
    .replace(/[țţ]/g, "t");
}

export function detectLanguage(text: string): PromptLanguage {
  const t = normalizeText(text);
  const score = (hints: readonly string[]) => hints.reduce((s, h) => (t.includes(normalizeText(h)) ? s + 1 : s), 0);
  const ro = score(RO_HINTS);
  const en = score(EN_HINTS);
  if (ro === 0 && en === 0) return "unknown";
  return ro > en ? "ro" : "en";
}

function numberBefore(t: string, unitPattern: string): number | undefined {
  const digits = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:de\\s+)?(?:${unitPattern})`).exec(t);
  if (digits) return Number(digits[1]!.replace(",", "."));
  const words = new RegExp(`\\b([a-z]+)\\s*(?:de\\s+)?(?:${unitPattern})`).exec(t);
  if (words && WORD_NUMBERS[words[1]!] !== undefined) return WORD_NUMBERS[words[1]!];
  return undefined;
}

function metresNear(t: string, keywords: readonly string[]): number | undefined {
  for (const key of keywords) {
    const near = new RegExp(
      `(?:${key})[^.;]{0,24}?(\\d+(?:[.,]\\d+)?)\\s*(?:de\\s+)?(?:m\\b|metri|metrii|metre|metres|meters)|(\\d+(?:[.,]\\d+)?)\\s*(?:de\\s+)?(?:m\\b|metri|metrii|metre|metres|meters)[^.;]{0,24}?(?:${key})`,
    ).exec(t);
    if (near) {
      const raw = near[1] ?? near[2];
      if (raw) return Number(raw.replace(",", "."));
    }
  }
  return undefined;
}

export function parsePrompt(text: string): PromptIntent {
  const t = normalizeText(text);
  const language = detectLanguage(text);

  let concept: ChoreographyConcept | null = null;
  for (const [candidate, words] of CONCEPT_KEYWORDS) {
    if (words.some((w) => t.includes(normalizeText(w)))) {
      concept = candidate;
      break;
    }
  }

  const fleetCount = numberBefore(t, "drones?|drone|dronele");
  const cycles = numberBefore(t, "times|ori|cycles|cicluri|flaps|batai|bataie|x\\b");
  const rotationDeg = numberBefore(t, "degrees?|deg\\b|grade|°");
  const amplitudeDeg = metresNear(t, []) === undefined ? undefined : undefined;

  const forward = metresNear(t, ["forward", "inainte", "across", "traverse", "traverseaz", "depth", "adancime"]);
  const right = metresNear(t, ["right", "dreapta", "left", "stanga", "lateral", "sideways"]);
  const climb = metresNear(t, ["climb", "rise", "ascend", "urca", "urce", "inalt", "higher", "sus"]);
  const leftwards = /\b(left|stanga)\b/.test(t);

  const slower = /(slower|slow|mai lent|mai incet|lin|calm)/.test(t);
  const faster = /(faster|fast|quick|mai repede|rapid)/.test(t);
  const bigger = /(bigger|larger|wider|mai mare|mai lat)/.test(t);
  const smaller = /(smaller|tighter|mai mic|mai strans)/.test(t);
  const bodyStill = /(body still|still body|keep the body|corpul nemiscat|corpul stabil|fara deformare|no body)/.test(t);

  let color: readonly [number, number, number] | undefined;
  let colorName: string | undefined;
  for (const [name, rgb] of COLOR_KEYWORDS) {
    if (new RegExp(`\\b${name}`).test(t)) {
      color = rgb;
      colorName = name;
      break;
    }
  }

  return {
    language,
    concept,
    ...(fleetCount !== undefined ? { fleetCount: Math.round(fleetCount) } : {}),
    ...(cycles !== undefined ? { cycles: Math.max(1, Math.round(cycles)) } : {}),
    ...(slower && !faster ? { speedScale: 1.4 } : {}),
    ...(faster && !slower ? { speedScale: 0.7 } : {}),
    ...(bigger && !smaller ? { sizeScale: 1.25 } : {}),
    ...(smaller && !bigger ? { sizeScale: 0.8 } : {}),
    ...(amplitudeDeg !== undefined ? { amplitudeDeg } : {}),
    ...(rotationDeg !== undefined ? { rotationDeg } : {}),
    ...(forward !== undefined ? { forward } : {}),
    ...(right !== undefined ? { right: leftwards ? -right : right } : {}),
    ...(climb !== undefined ? { climb } : {}),
    ...(bodyStill ? { bodyDeforms: false } : {}),
    ...(color ? { color, colorName: colorName! } : {}),
  };
}
