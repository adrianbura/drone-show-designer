/**
 * UNIFIED EFFECT CATALOG (pure composition helper).
 *
 * ONE operator-facing list combining the EXISTING canonical colour presets
 * (`LIGHTING_SELECTION_PRESETS`) and motion presets (`MOTION_SELECTION_PRESETS`).
 * This module adds NO new effect type, NO evaluator and NO parameters: every
 * entry points back to a canonical preset id that is applied through the
 * existing canonical store actions.
 *
 * No React, no Three.js, no I/O.
 */
import {
  LIGHTING_SELECTION_PRESETS,
  MOTION_SELECTION_PRESETS,
  type LightingSelectionPresetId,
  type MotionSelectionPresetId,
} from "./selectionEffects";

export type EffectCatalogKind = "COLOR" | "MOTION";

/** Everyday grouping used only to organise the catalog surface. */
export type EffectCatalogCategory = "BASIC" | "RHYTHM" | "GRADIENT" | "SHAPE";

export interface EffectCatalogEntry {
  /** Stable catalog id, namespaced by kind. */
  readonly id: string;
  readonly kind: EffectCatalogKind;
  readonly label: string;
  readonly description: string;
  readonly category: EffectCatalogCategory;
  /** Extra search words (never shown as labels). */
  readonly keywords: readonly string[];
  /** Canonical colour preset id, when `kind === "COLOR"`. */
  readonly lightingPresetId?: LightingSelectionPresetId;
  /** Canonical motion preset id, when `kind === "MOTION"`. */
  readonly motionPresetId?: MotionSelectionPresetId;
}

const COLOR_META: Record<
  LightingSelectionPresetId,
  { category: EffectCatalogCategory; keywords: readonly string[] }
> = {
  SOLID: { category: "BASIC", keywords: ["colour", "color", "fill", "set"] },
  FADE_IN: { category: "BASIC", keywords: ["appear", "reveal", "in"] },
  FADE_OUT: { category: "BASIC", keywords: ["disappear", "hide", "out"] },
  PULSE: { category: "RHYTHM", keywords: ["breathe", "beat", "blink"] },
  SPARKLE: { category: "RHYTHM", keywords: ["twinkle", "flash", "strobe"] },
  COLOUR_WAVE: { category: "GRADIENT", keywords: ["rainbow", "sweep", "travel"] },
  GRADIENT_SWEEP: { category: "GRADIENT", keywords: ["ramp", "blend", "two colours"] },
};

const MOTION_META: Record<
  MotionSelectionPresetId,
  { category: EffectCatalogCategory; keywords: readonly string[] }
> = {
  WAVE: { category: "RHYTHM", keywords: ["ripple", "bands", "ocean"] },
  PULSE_SCALE: { category: "RHYTHM", keywords: ["breathe", "grow", "shrink", "size"] },
  FLOAT: { category: "BASIC", keywords: ["drift", "slow", "hover"] },
  ROTATE: { category: "SHAPE", keywords: ["spin", "orbit", "turn", "yaw"] },
  SWEEP_TWIST: { category: "SHAPE", keywords: ["twist", "spiral", "counter"] },
};

/** The complete unified catalog, colour first then motion. */
export const EFFECT_CATALOG: readonly EffectCatalogEntry[] = [
  ...LIGHTING_SELECTION_PRESETS.map((preset) => ({
    id: `COLOR:${preset.id}`,
    kind: "COLOR" as const,
    label: preset.label,
    description: preset.description,
    category: COLOR_META[preset.id].category,
    keywords: COLOR_META[preset.id].keywords,
    lightingPresetId: preset.id,
  })),
  ...MOTION_SELECTION_PRESETS.map((preset) => ({
    id: `MOTION:${preset.id}`,
    kind: "MOTION" as const,
    label: preset.label,
    description: preset.description,
    category: MOTION_META[preset.id].category,
    keywords: MOTION_META[preset.id].keywords,
    motionPresetId: preset.id,
  })),
];

export const EFFECT_CATALOG_CATEGORY_LABELS: Record<EffectCatalogCategory, string> = {
  BASIC: "Basics",
  RHYTHM: "Rhythm",
  GRADIENT: "Gradients",
  SHAPE: "Shape",
};

export type EffectCatalogFilter = "ALL" | EffectCatalogKind;

const normalise = (value: string): string => value.trim().toLowerCase();

/** Search + kind filter over the unified catalog. Never mutates anything. */
export function filterEffectCatalog(
  query: string,
  filter: EffectCatalogFilter,
  catalog: readonly EffectCatalogEntry[] = EFFECT_CATALOG,
): readonly EffectCatalogEntry[] {
  const needle = normalise(query);
  return catalog.filter((entry) => {
    if (filter !== "ALL" && entry.kind !== filter) return false;
    if (needle.length === 0) return true;
    return (
      normalise(entry.label).includes(needle) ||
      normalise(entry.description).includes(needle) ||
      entry.keywords.some((word) => normalise(word).includes(needle))
    );
  });
}

export interface EffectCatalogGroup {
  readonly category: EffectCatalogCategory;
  readonly label: string;
  readonly entries: readonly EffectCatalogEntry[];
}

const CATEGORY_ORDER: readonly EffectCatalogCategory[] = ["BASIC", "RHYTHM", "GRADIENT", "SHAPE"];

/** Groups matching entries by category, dropping empty categories. */
export function groupEffectCatalog(
  entries: readonly EffectCatalogEntry[],
): readonly EffectCatalogGroup[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    label: EFFECT_CATALOG_CATEGORY_LABELS[category],
    entries: entries.filter((entry) => entry.category === category),
  })).filter((group) => group.entries.length > 0);
}
