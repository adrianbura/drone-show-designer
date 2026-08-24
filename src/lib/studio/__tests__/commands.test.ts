import { describe, expect, it } from "vitest";

import {
  REBUILD_AS_TEXT_REASON,
  findCommand,
  flattenCommands,
  primaryCommandFor,
  resolveTimelineCommands,
  type ClipCommandContext,
} from "../commands";
import { nearestBeat } from "../useTimelineCommands";

function clip(patch: Partial<ClipCommandContext> = {}): ClipCommandContext {
  return {
    kind: "CLIP",
    clipId: "c1",
    label: "Heart",
    phase: "SHOW",
    representation: "STATIC",
    canConvertToScene: true,
    hasAuthoredLighting: false,
    hasImportedRgb: false,
    canSnapToBeat: true,
    ownership: "NONE",
    canCompareReference: false,
    canRestoreReference: false,
    experimentalEnabled: false,
    textRebuild: { available: true },
    ...patch,
  };
}

const ids = (ctx: ClipCommandContext) => flattenCommands(resolveTimelineCommands(ctx)).map((c) => c.id);

describe("command authority", () => {
  it("offers exactly one primary editor per representation", () => {
    expect(primaryCommandFor(clip({ representation: "STATIC" }))).toBe("EDIT_FORMATION");
    expect(primaryCommandFor(clip({ representation: "SCENE" }))).toBe("EDIT_SCENE");
    expect(primaryCommandFor(clip({ representation: "DYNAMIC" }))).toBe("EDIT_DYNAMIC");

    const scene = ids(clip({ representation: "SCENE" }));
    expect(scene).toContain("EDIT_SCENE");
    expect(scene).not.toContain("EDIT_FORMATION");
    expect(scene).not.toContain("EDIT_DYNAMIC");
    // A scene clip is already a scene — no conversion offer.
    expect(scene).not.toContain("CONVERT_TO_SCENE");
  });

  it("omits inapplicable actions instead of disabling them", () => {
    const takeoff = ids(clip({ phase: "TAKEOFF" }));
    expect(takeoff).not.toContain("EDIT_TRANSITION");
    expect(takeoff).not.toContain("TRANSITION_DESIGN");
    expect(takeoff).not.toContain("DUPLICATE_CLIP");

    const show = ids(clip());
    expect(show).toContain("EDIT_TRANSITION");
    expect(show).toContain("DUPLICATE_CLIP");

    // Reference actions never appear for a project without an imported layer.
    expect(show).not.toContain("COMPARE_REFERENCE");
    expect(show).not.toContain("RESTORE_REFERENCE");
    expect(show).not.toContain("VIEW_IMPORTED_RGB");
  });

  it("hides restore until a real restore continuation exists", () => {
    const menu = resolveTimelineCommands(clip({ ownership: "REFERENCE", hasImportedRgb: true }));
    expect(findCommand(menu, "RESTORE_REFERENCE")).toBeUndefined();
    expect(findCommand(menu, "VIEW_IMPORTED_RGB")?.available).toBe(true);


    const noBeats = resolveTimelineCommands(clip({ canSnapToBeat: false }));
    const snap = findCommand(noBeats, "SNAP_START_TO_BEAT");
    expect(snap?.available).toBe(false);
    expect(snap?.unavailableReason).toBeTruthy();
  });

  it("every unavailable command explains itself", () => {
    for (const ctx of [
      clip(),
      clip({ phase: "LANDING" }),
      clip({ representation: "SCENE", ownership: "REFERENCE", experimentalEnabled: true }),
    ]) {
      for (const c of flattenCommands(resolveTimelineCommands(ctx))) {
        if (!c.available) expect(c.unavailableReason, c.id).toBeTruthy();
      }
    }
  });

  it("offers text rebuild for eligible targets and blocks others with the real reason", () => {
    expect(findCommand(resolveTimelineCommands(clip()), "REBUILD_AS_TEXT")).toMatchObject({
      available: true,
      label: "Rebuild as Text…",
    });
    const blockedMenu = resolveTimelineCommands(
      clip({
        representation: "DYNAMIC",
        textRebuild: { available: false, reason: "dynamic clip" },
      }),
    );
    expect(findCommand(blockedMenu, "REBUILD_AS_TEXT")).toMatchObject({
      available: false,
      unavailableReason: "dynamic clip",
    });
    const fallback = resolveTimelineCommands(clip({ textRebuild: { available: false } }));
    expect(findCommand(fallback, "REBUILD_AS_TEXT")?.unavailableReason).toBe(REBUILD_AS_TEXT_REASON);
  });

  it("keeps delete destructive and last", () => {
    const menu = resolveTimelineCommands(clip());
    const last = menu.sections[menu.sections.length - 1]!;
    expect(last.items.map((c) => c.id)).toEqual(["DELETE_CLIP"]);
    expect(last.items[0]!.destructive).toBe(true);
  });

  it("describes empty timeline space, markers and lighting effects", () => {
    expect(
      flattenCommands(resolveTimelineCommands({ kind: "EMPTY_TIMELINE", time: 4, canAddClip: false })).map(
        (c) => [c.id, c.available],
      ),
    ).toEqual([
      ["ADD_CLIP_HERE", false],
      ["ADD_MARKER_HERE", true],
      ["MOVE_PLAYHEAD_HERE", true],
    ]);

    expect(primaryCommandFor({ kind: "MARKER", markerId: "m", label: "Drop" })).toBe("RENAME_MARKER");
    expect(primaryCommandFor({ kind: "LIGHTING_EFFECT", effectId: "e", label: "Pulse" })).toBe(
      "EDIT_LIGHTING_EFFECT",
    );
    expect(primaryCommandFor({ kind: "EMPTY_TIMELINE", time: 0, canAddClip: true })).toBeNull();
  });
});

describe("beat snapping", () => {
  it("picks the nearest beat, or nothing without a grid", () => {
    expect(nearestBeat([0, 2, 4], 2.4)).toBe(2);
    expect(nearestBeat([0, 2, 4], 3.6)).toBe(4);
    expect(nearestBeat([], 1)).toBeNull();
  });
});
