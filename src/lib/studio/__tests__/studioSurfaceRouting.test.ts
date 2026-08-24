// @vitest-environment jsdom
/**
 * SURFACE ROUTING — every navigation command must resolve to exactly one
 * existing Inspector panel, in the group that owns it. Routing is navigation:
 * it never touches project state, so no authored history can be created here.
 */
import { describe, expect, it } from "vitest";

import {
  INSPECTOR_PANEL_GROUP,
  STUDIO_SURFACE_PANEL,
  focusStudioSurface,
  onInspectorFocus,
  resolveStudioFocus,
  type StudioSurfaceId,
} from "@/lib/studio/inspectorFocus";
import { primaryCommandFor } from "@/lib/studio/commands";

const SURFACES: readonly StudioSurfaceId[] = [
  "CLIP",
  "SCENE",
  "FORMATION",
  "DYNAMIC",
  "LIGHTING",
  "TRANSITION",
  "REFERENCE",
  "VALIDATION",
];

describe("studio surface routing", () => {
  it("maps every surface to a panel whose owning group is known", () => {
    for (const surface of SURFACES) {
      const request = resolveStudioFocus({ surface, clipId: "c1" });
      expect(STUDIO_SURFACE_PANEL[surface]).toBe(request.panel);
      expect(request.group).toBe(INSPECTOR_PANEL_GROUP[request.panel]);
      expect(request.clipId).toBe("c1");
    }
  });

  it("gives every request a fresh id so repeats still re-reveal", () => {
    const a = resolveStudioFocus({ surface: "LIGHTING" });
    const b = resolveStudioFocus({ surface: "LIGHTING" });
    expect(b.requestId).toBeGreaterThan(a.requestId);
  });

  it("broadcasts the request to listeners with the target clip preserved", () => {
    const seen: string[] = [];
    const off = onInspectorFocus((r) => seen.push(`${r.panel}:${r.clipId ?? "-"}`));
    focusStudioSurface({ surface: "TRANSITION", clipId: "clip-7" });
    focusStudioSurface({ surface: "REFERENCE" });
    off();
    focusStudioSurface({ surface: "SCENE", clipId: "clip-9" });
    expect(seen).toEqual(["transition-panel:clip-7", "essp-panel:-"]);
  });

  it("routes the double-click primary command to a real surface", () => {
    const ctx = {
      kind: "CLIP",
      clipId: "c1",
      label: "Clip",
      phase: "SHOW",
      representation: "SCENE",
      canConvertToScene: false,
      hasAuthoredLighting: false,
      hasImportedRgb: false,
      canSnapToBeat: false,
      ownership: "NONE",
      canCompareReference: false,
      canRestoreReference: false,
      experimentalEnabled: false,
    } as const;
    expect(primaryCommandFor(ctx)).toBe("EDIT_SCENE");
    expect(resolveStudioFocus({ surface: "SCENE" }).panel).toBe("scene-panel");
  });
});
