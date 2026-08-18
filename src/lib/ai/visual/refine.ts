/**
 * REFINEMENT INSTRUCTIONS -> DETERMINISTIC DIRECTIVES (EN / RO).
 *
 * Refinement never mutates geometry: it only rewrites the prompt used for the
 * next reference image. An unrecognised instruction is passed through verbatim
 * instead of being silently dropped.
 */
import { normalizeText } from "../prompt";

export interface RefineRule {
  readonly id: string;
  readonly keywords: readonly string[];
  readonly directive: string;
}

export const REFINE_RULES: readonly RefineRule[] = [
  {
    id: "WINGS_WIDER",
    keywords: ["wings wider", "wider wings", "aripi mai late", "aripile mai late", "wingspan"],
    directive: "make the wings noticeably wider and the wingspan larger",
  },
  {
    id: "WINGS_OPEN",
    keywords: [
      "open wings",
      "wings more open",
      "open wings more",
      "fully open",
      "aripile deschise",
      "deschide aripile",
      "complet deschise",
    ],
    directive: "open the wings further, fully spread and clearly separated from the body",
  },
  {
    id: "LESS_FEATHER_DETAIL",
    keywords: [
      "reduce feather",
      "less feather",
      "fewer feathers",
      "less detail",
      "mai putin detaliu",
      "mai putine pene",
      "fara pene",
    ],
    directive: "reduce feather and texture detail, keep only large flat shapes",
  },
  {
    id: "MORE_SYMMETRIC",
    keywords: ["more symmetric", "symmetrical", "simetric", "mai simetric"],
    directive: "make the composition strictly mirror-symmetric left to right",
  },
  {
    id: "HEAD_LARGER",
    keywords: ["enlarge head", "bigger head", "larger head", "cap mai mare", "mareste capul"],
    directive: "enlarge the head so it stays recognizable at low point counts",
  },
  {
    id: "BOLDER_OUTLINE",
    keywords: ["bolder", "thicker outline", "stronger outline", "contur mai gros", "mai clar"],
    directive: "strengthen and thicken the outer contour",
  },
  {
    id: "MORE_CONTRAST",
    keywords: ["more contrast", "contrast", "mai mult contrast"],
    directive: "increase the contrast between subject and background",
  },
  {
    id: "CLEANER_BACKGROUND",
    keywords: ["clean background", "remove background", "fundal curat", "fara fundal"],
    directive: "remove every background element, leave one plain uniform area",
  },
];

/** Maps a free-text instruction onto stable directives. Deterministic. */
export function parseRefineInstruction(instruction: string): readonly string[] {
  const text = normalizeText(instruction).trim();
  if (text.length === 0) return [];
  const matched: string[] = [];
  for (const rule of REFINE_RULES) {
    if (rule.keywords.some((k) => text.includes(normalizeText(k)))) {
      matched.push(rule.directive);
    }
  }
  if (matched.length === 0) matched.push(instruction.trim());
  return matched;
}
