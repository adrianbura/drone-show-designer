import { describe, expect, it } from "vitest";

import { createProjectFromSetup, DEFAULT_SETUP_DRAFT } from "../../show/setup";
import { clipPhase } from "../../show/types";
import { applyShowTemplate, SHOW_TEMPLATES } from "../showTemplates";

describe("show templates", () => {
  const project = () => createProjectFromSetup({ ...DEFAULT_SETUP_DRAFT, name: "Template test" });

  it("keeps Blank genuinely empty", () => {
    const source = project();
    expect(applyShowTemplate(source, "BLANK")).toBe(source);
    expect(source.timeline).toEqual([]);
  });

  it.each([
    ["SHORT_OPENER", 2],
    ["CLASSIC_ARC", 3],
  ] as const)("builds %s through canonical phases with %i SHOW moments", (id, count) => {
    const result = applyShowTemplate(project(), id);
    expect(result.timeline.filter((clip) => clipPhase(clip) === "TAKEOFF")).toHaveLength(1);
    expect(result.timeline.filter((clip) => clipPhase(clip) === "SHOW")).toHaveLength(count);
    expect(result.timeline.filter((clip) => clipPhase(clip) === "LANDING")).toHaveLength(1);
    expect(result.timeline.map((clip) => clip.start)).toEqual(
      [...result.timeline].map((clip) => clip.start).sort((a, b) => a - b),
    );
    expect(new Set(result.timeline.map((clip) => clip.id)).size).toBe(result.timeline.length);
  });

  it("has a unique, discoverable descriptor for every template", () => {
    expect(SHOW_TEMPLATES.map((template) => template.id)).toEqual([
      "BLANK",
      "SHORT_OPENER",
      "CLASSIC_ARC",
    ]);
    expect(new Set(SHOW_TEMPLATES.map((template) => template.id)).size).toBe(SHOW_TEMPLATES.length);
  });

  it("does not produce dangling formation references", () => {
    const result = applyShowTemplate(project(), "CLASSIC_ARC");
    const formationIds = new Set(result.formations.map((formation) => formation.id));
    expect(result.timeline.every((clip) => formationIds.has(clip.formationId))).toBe(true);
  });
});
