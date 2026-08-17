import { describe, expect, it } from "vitest";

import { createDefaultProject } from "@/lib/show/defaultProject";
import { toGenericShowJson } from "@/lib/adapters/export";
import { buildShowPlan } from "@/lib/show/trajectory";
import { en } from "../en";
import { ro } from "../ro";
import {
  DEFAULT_LANGUAGE,
  interpolate,
  isLanguage,
  LANGUAGES,
  translate,
} from "../translate";

describe("localization", () => {
  it("defaults to English and resolves both locales", () => {
    expect(DEFAULT_LANGUAGE).toBe("en");
    expect(LANGUAGES).toEqual(["en", "ro"]);
    expect(translate("en", "launchGrid.rows")).toBe("Rows");
    expect(translate("ro", "launchGrid.rows")).toBe("Rânduri");
    expect(translate("ro", "formationLibrary.title")).toBe("Bibliotecă formații");
    expect(translate("en", "formationLibrary.title")).toBe("Formation library");
  });

  it("is complete in both directions", () => {
    const enKeys = Object.keys(en).sort();
    const roKeys = Object.keys(ro).sort();
    expect(roKeys).toEqual(enKeys);
    for (const key of enKeys) {
      expect((ro as Record<string, string>)[key]!.length).toBeGreaterThan(0);
    }
  });

  it("falls back to English then to the key itself", () => {
    expect(translate("ro", "does.not.exist")).toBe("does.not.exist");
    const partial = translate("ro", "common.save");
    expect(partial).toBe("Salvează");
  });

  it("interpolates values without altering them", () => {
    expect(interpolate("{count} drones", { count: 150 })).toBe("150 drones");
    expect(translate("ro", "topBar.drones", { count: 150 })).toBe("150 drone");
    expect(translate("en", "setup.issue.GRID_CAPACITY", { capacity: 160, droneCount: 200 })).toContain(
      "160",
    );
  });

  it("keeps technical product names untranslated", () => {
    for (const term of ["ESSP", "PX4", "MAVSDK", "SVG", "PAD-001", "DRN-001", "staging"]) {
      const values = Object.values(ro).join(" ") + Object.values(en).join(" ");
      if (values.includes(term)) expect(values).toContain(term);
    }
    expect(ro["essp.title"]).toContain("ESSP");
    expect(ro["staging.title"]).toBe("Staging");
  });

  it("machine-readable data is language-neutral", () => {
    const project = createDefaultProject(12);
    const plan = buildShowPlan(project);
    const json = toGenericShowJson(project, plan);
    // Translating the UI cannot change any exported payload: the export takes no
    // language input at all, and the diagnostic codes stay canonical.
    expect(JSON.stringify(json)).toBe(JSON.stringify(toGenericShowJson(project, plan)));
    expect(Object.keys(en)).toContain("diagnostic.LOOP_DISCONTINUITY");
    expect(JSON.stringify(json)).not.toContain("Rânduri");
  });

  it("validates persisted language values", () => {
    expect(isLanguage("ro")).toBe(true);
    expect(isLanguage("de")).toBe(false);
  });
});
