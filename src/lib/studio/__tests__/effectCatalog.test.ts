import { describe, expect, it } from "vitest";

import {
  EFFECT_CATALOG,
  filterEffectCatalog,
  groupEffectCatalog,
} from "../effectCatalog";
import {
  LIGHTING_SELECTION_PRESETS,
  MOTION_SELECTION_PRESETS,
} from "../selectionEffects";

describe("unified effect catalog", () => {
  it("exposes every canonical colour and motion preset exactly once", () => {
    expect(EFFECT_CATALOG).toHaveLength(
      LIGHTING_SELECTION_PRESETS.length + MOTION_SELECTION_PRESETS.length,
    );
    expect(new Set(EFFECT_CATALOG.map((entry) => entry.id)).size).toBe(EFFECT_CATALOG.length);
    for (const entry of EFFECT_CATALOG) {
      if (entry.kind === "COLOR") expect(entry.lightingPresetId).toBeDefined();
      else expect(entry.motionPresetId).toBeDefined();
    }
  });

  it("filters by kind", () => {
    expect(filterEffectCatalog("", "COLOR").every((e) => e.kind === "COLOR")).toBe(true);
    expect(filterEffectCatalog("", "MOTION")).toHaveLength(MOTION_SELECTION_PRESETS.length);
  });

  it("searches labels, descriptions and keywords", () => {
    expect(filterEffectCatalog("rainbow", "ALL").map((e) => e.id)).toContain("COLOR:COLOUR_WAVE");
    expect(filterEffectCatalog("spin", "ALL").map((e) => e.id)).toContain("MOTION:ROTATE");
    expect(filterEffectCatalog("nothing-like-this", "ALL")).toHaveLength(0);
  });

  it("groups matches and drops empty categories", () => {
    const groups = groupEffectCatalog(filterEffectCatalog("rainbow", "ALL"));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.category).toBe("GRADIENT");
  });
});
