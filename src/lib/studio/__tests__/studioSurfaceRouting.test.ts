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
  registerInspectorHost,
  selectVisibleHost,
  onInspectorFocus,
  resolveStudioFocus,
  type StudioSurfaceId,
  type StudioFocusRequest,
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
    // Minimal DOM event surface — the channel only needs addEventListener /
    // dispatchEvent, so no browser environment is required to prove routing.
    const target = new EventTarget();
    (globalThis as { window?: unknown }).window = target;
    (globalThis as { CustomEvent?: unknown }).CustomEvent ??= class extends Event {
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        super(type);
        this.detail = init?.detail;
      }
    };
    const seen: string[] = [];
    const off = onInspectorFocus((r) => seen.push(`${r.panel}:${r.clipId ?? "-"}`));
    focusStudioSurface({ surface: "TRANSITION", clipId: "clip-7" });
    focusStudioSurface({ surface: "REFERENCE" });
    off();
    focusStudioSurface({ surface: "SCENE", clipId: "clip-9" });
    expect(seen).toEqual(["transition-panel:clip-7", "essp-panel:-"]);
    delete (globalThis as { window?: unknown }).window;
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

describe("visible surface hosts", () => {
  it("reveals through the highest-priority visible host, never a hidden one", () => {
    const seen: string[] = [];
    const desktop = {
      priority: 20,
      visible: true,
      isVisible() {
        return this.visible;
      },
      reveal: (r: StudioFocusRequest) => seen.push(`desktop:${r.panel}`),
    };
    const narrow = {
      priority: 0,
      isVisible: () => true,
      reveal: (r: StudioFocusRequest) => seen.push(`narrow:${r.panel}`),
    };
    const offDesktop = registerInspectorHost(desktop);
    const offNarrow = registerInspectorHost(narrow);

    expect(selectVisibleHost([desktop, narrow])).toBe(desktop);
    focusStudioSurface({ surface: "LIGHTING", clipId: "c1" });
    // Wide layout hidden (narrow window): the narrow host must take over.
    desktop.visible = false;
    expect(selectVisibleHost([desktop, narrow])).toBe(narrow);
    focusStudioSurface({ surface: "LIGHTING", clipId: "c1" });
    offDesktop();
    offNarrow();
    expect(seen).toEqual(["desktop:lighting-panel", "narrow:lighting-panel"]);
  });

  it("hands the narrow host the exact resolved request", () => {
    const got: StudioFocusRequest[] = [];
    const off = registerInspectorHost({
      priority: 0,
      isVisible: () => true,
      reveal: (r) => got.push(r),
    });
    const request = focusStudioSurface({ surface: "TRANSITION", clipId: "clip-42" });
    off();
    expect(got).toHaveLength(1);
    expect(got[0]).toEqual(request);
    expect(got[0]?.panel).toBe("transition-panel");
    expect(got[0]?.group).toBe("AUTHORING");
    expect(got[0]?.clipId).toBe("clip-42");
  });

  it("selects no host when every host is hidden, and still resolves the request", () => {
    const revealed: string[] = [];
    const hidden = {
      priority: 20,
      isVisible: () => false,
      reveal: () => revealed.push("hidden"),
    };
    const off = registerInspectorHost(hidden);
    expect(selectVisibleHost([hidden])).toBeNull();
    const request = focusStudioSurface({ surface: "LIGHTING" });
    off();
    expect(revealed).toEqual([]);
    expect(request.panel).toBe("lighting-panel");
  });

  it("gives repeated identical surface requests distinct ids so a repeat re-reveals", () => {
    const ids: number[] = [];
    const off = registerInspectorHost({
      priority: 0,
      isVisible: () => true,
      reveal: (r) => ids.push(r.requestId),
    });
    focusStudioSurface({ surface: "LIGHTING", clipId: "c1" });
    focusStudioSurface({ surface: "LIGHTING", clipId: "c1" });
    off();
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBeGreaterThan(ids[0]!);
  });
});


describe("narrow dock host contract", () => {
  // Transforming the real component module can exceed the default 5s budget on
  // a cold cache; the assertions themselves are synchronous.
  it("is a candidate only below xl and always loses to the visible docked aside", async () => {
    const { isNarrowLayout, INSPECTOR_DOCK_PRIORITY, DOCKED_INSPECTOR_PRIORITY, XL } =
      await import("@/components/studio/InspectorDock");
    expect(isNarrowLayout(900)).toBe(true);
    expect(isNarrowLayout(1024)).toBe(true);
    // At 1366 the docked aside is visible again, so the dock must stand down.
    expect(isNarrowLayout(1366)).toBe(false);
    expect(isNarrowLayout(XL)).toBe(false);
    expect(INSPECTOR_DOCK_PRIORITY).toBeLessThan(DOCKED_INSPECTOR_PRIORITY);

    const docked = {
      priority: DOCKED_INSPECTOR_PRIORITY,
      isVisible: () => true,
      reveal: () => {},
    };
    const dock = { priority: INSPECTOR_DOCK_PRIORITY, isVisible: () => true, reveal: () => {} };
    expect(selectVisibleHost([dock, docked])).toBe(docked);
    expect(selectVisibleHost([{ ...docked, isVisible: () => false }, dock])).toBe(dock);
  }, 30000);
});
