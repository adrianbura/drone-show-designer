/**
 * Persisted text recipe compatibility policy.
 *
 * `centerAltitudeMeters` changed deterministic geometry and therefore canonical
 * hashing, so the schema and algorithm versions were bumped. A recipe written
 * before that MUST NOT be silently interpreted as the new algorithm.
 */
import { describe, expect, it } from "vitest";

import {
  TEXT_GEOMETRY_ALGORITHM_VERSION,
  TEXT_RECIPE_SCHEMA_VERSION,
  TextGeometryError,
  classifyPersistedTextRecipe,
  generateTextGeometry,
  upgradeLegacyTextRecipe,
  type TextGeometryRecipe,
} from "../index";
import { defaultTextRecipe } from "@/lib/studio/textRebuild";

const current = (): TextGeometryRecipe => defaultTextRecipe(60, "SUPER", 60);

/** Simulates a recipe persisted by the pre-altitude build. */
function legacyPersisted(): TextGeometryRecipe {
  const { centerAltitudeMeters: _drop, ...rest } = current();
  return { ...rest, schemaVersion: 1, algorithmVersion: "1.0.0" } as TextGeometryRecipe;
}

describe("text recipe compatibility", () => {
  it("classifies a current recipe as regenerable", () => {
    const report = classifyPersistedTextRecipe(current());
    expect(report.compatibility).toBe("CURRENT");
    expect(report.regenerable).toBe(true);
    expect(report.currentSchemaVersion).toBe(TEXT_RECIPE_SCHEMA_VERSION);
    expect(report.currentAlgorithmVersion).toBe(TEXT_GEOMETRY_ALGORITHM_VERSION);
  });

  it("treats a pre-altitude recipe as readable data that must not be regenerated", () => {
    const report = classifyPersistedTextRecipe(legacyPersisted());
    expect(report.compatibility).toBe("LEGACY_UPGRADE_REQUIRED");
    expect(report.regenerable).toBe(false);
    expect(report.upgradable).toBe(true);
    expect(report.missingFields).toContain("centerAltitudeMeters");
  });

  it("refuses to generate geometry from a legacy recipe", () => {
    expect(() => generateTextGeometry(legacyPersisted())).toThrow(TextGeometryError);
  });

  it("refuses recipes newer than this build", () => {
    const future = { ...current(), schemaVersion: TEXT_RECIPE_SCHEMA_VERSION + 1 };
    const report = classifyPersistedTextRecipe(future);
    expect(report.compatibility).toBe("UNSUPPORTED");
    expect(report.upgradable).toBe(false);
    expect(upgradeLegacyTextRecipe(future, { centerAltitudeMeters: 60 }).ok).toBe(false);
  });

  it("upgrades only with an explicit altitude decision, producing a new identity", () => {
    const legacy = legacyPersisted();
    expect(upgradeLegacyTextRecipe(legacy, { centerAltitudeMeters: Number.NaN }).ok).toBe(false);

    const upgraded = upgradeLegacyTextRecipe(legacy, { centerAltitudeMeters: 60 });
    expect(upgraded.ok).toBe(true);
    if (!upgraded.ok) return;
    expect(upgraded.recipe.schemaVersion).toBe(TEXT_RECIPE_SCHEMA_VERSION);
    expect(upgraded.recipe.algorithmVersion).toBe(TEXT_GEOMETRY_ALGORITHM_VERSION);

    const geometry = generateTextGeometry(upgraded.recipe);
    expect(geometry.points.length).toBe(upgraded.recipe.participation);
    // Explicit altitude means the glyph plane is in the air, not through ground.
    expect(Math.min(...geometry.points.map((p) => p[1]))).toBeGreaterThan(0);
  });

  it("survives a JSON save/open round trip without changing classification", () => {
    const reopenedCurrent = JSON.parse(JSON.stringify(current())) as TextGeometryRecipe;
    expect(classifyPersistedTextRecipe(reopenedCurrent).compatibility).toBe("CURRENT");
    expect(generateTextGeometry(reopenedCurrent).recipeHash).toBe(
      generateTextGeometry(current()).recipeHash,
    );

    const reopenedLegacy = JSON.parse(JSON.stringify(legacyPersisted())) as TextGeometryRecipe;
    expect(classifyPersistedTextRecipe(reopenedLegacy).compatibility).toBe(
      "LEGACY_UPGRADE_REQUIRED",
    );
  });
});
