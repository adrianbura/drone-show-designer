import { describe, expect, it } from "vitest";
import { makeTextRecipe } from "../../show/text";
import { hasEsspSourceBytes } from "../../adapters/esspSourceRecovery";
import { resolveReferenceIntervals } from "../../import/essp/native";
import { serializeProject, parseProjectFile } from "../../project/serialize";
import { previewTextFormation, discardTextPreview } from "../textFormationPreview";
import { prepareTextFormationApply } from "../textFormationApplyCommand";
import { installPreparedGeometryApply } from "../geometryApplyStoreTransaction";
import { STRATEGY, importedFixture, readiness, sceneFixture } from "./support/geometryApplyHarness";

function recipeFor(participation: number, text = "RALLY") {
  return makeTextRecipe({
    text,
    weight: "REGULAR",
    style: "UPRIGHT",
    widthMeters: 90,
    heightMeters: 24,
    letterSpacingEm: 0.8,
    alignment: "CENTER",
    participation,
    outlineRatio: 0.7,
    bandOffsetEm: 0.35,
    seed: 11,
  });
}

/** Middle static clip of the imported fixture — has a real neighbour on both sides. */
async function scenario() {
  const { project, layer } = await importedFixture();
  const clip = project.timeline[Math.floor(project.timeline.length / 2)]!;
  const formation = project.formations.find((f) => f.id === clip.formationId)!;
  const request = { clipId: clip.id, recipe: recipeFor(formation.points.length) };
  return { project, layer, clip, formation, request };
}

describe("text preview transaction", () => {
  it("mutates nothing and cancelling discards without side effects", async () => {
    const { project, request } = await scenario();
    const before = JSON.stringify(project);
    const preview = previewTextFormation(project, request);
    expect(preview.ok).toBe(true);
    expect(JSON.stringify(project)).toBe(before);
    expect(discardTextPreview(preview)).toBeNull();
    expect(JSON.stringify(project)).toBe(before);
  });

  it("blocks a participation change and an unknown clip", async () => {
    const { project, request, formation } = await scenario();
    expect(
      previewTextFormation(project, { ...request, recipe: recipeFor(formation.points.length + 1) }),
    ).toMatchObject({ ok: false, blockers: ["PARTICIPATION_MISMATCH"] });
    expect(previewTextFormation(project, { ...request, clipId: "nope" })).toMatchObject({
      ok: false,
      blockers: ["CLIP_NOT_FOUND"],
    });
  });
});

describe("text apply transaction", () => {
  it("prepares one atomic revision that preserves clip identity, timing and lighting", async () => {
    const { project, layer, clip, request } = await scenario();
    const prepared = prepareTextFormationApply({
      project,
      request,
      readiness: readiness("READY"),
      formationId: "f-text-apply-1",
      transitionOverrides: {},
      referenceLayer: layer,
      assignmentStrategy: STRATEGY,
      promotedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const after = prepared.prepared.after.project;
    const afterClip = after.timeline.find((c) => c.id === clip.id)!;
    expect(afterClip.formationId).toBe("f-text-apply-1");
    expect(afterClip.start).toBe(clip.start);
    expect(afterClip.transition).toBe(clip.transition);
    expect(afterClip.hold).toBe(clip.hold);
    expect(afterClip.easing).toBe(clip.easing);
    expect(afterClip.color).toEqual(clip.color);
    expect(afterClip.effect).toBe(clip.effect);
    expect(after.droneCount).toBe(project.droneCount);
    expect(after.lighting).toEqual(project.lighting);

    // No other clip changed, and the replaced asset is still available.
    for (const original of project.timeline.filter((c) => c.id !== clip.id)) {
      expect(after.timeline.find((c) => c.id === original.id)).toEqual(original);
    }
    expect(after.formations.some((f) => f.id === clip.formationId)).toBe(true);

    // Imported source bytes remain recoverable.
    expect(hasEsspSourceBytes(prepared.prepared.after.referenceLayer)).toBe(
      hasEsspSourceBytes(layer),
    );
  });

  it("promotes only the edited hold and its necessary transition boundaries", async () => {
    const { project, layer, clip, request } = await scenario();
    const prepared = prepareTextFormationApply({
      project,
      request,
      readiness: readiness("READY"),
      formationId: "f-text-apply-2",
      transitionOverrides: {},
      referenceLayer: layer,
      assignmentStrategy: STRATEGY,
      promotedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const intervals = prepared.newlyPlannedIntervals;
    expect(intervals.length).toBeGreaterThan(0);
    const clipIds = [...new Set(intervals.map((i) => i.clipId))];
    const order = project.timeline.map((c) => c.id);
    const editedIndex = order.indexOf(clip.id);
    for (const id of clipIds) {
      // Only the edited clip and its immediate successor may be affected.
      expect([order[editedIndex], order[editedIndex + 1]]).toContain(id);
    }
    expect(intervals.some((i) => i.clipId === clip.id && i.kind === "HOLD")).toBe(true);

    // Everything else stays reference owned.
    const after = resolveReferenceIntervals(prepared.prepared.after.referenceLayer!);
    expect(after.some((i) => i.owner === "REFERENCE")).toBe(true);
  });

  it("installs, undoes and redoes as exactly one history entry", async () => {
    const { project, layer, clip, request } = await scenario();
    const prepared = prepareTextFormationApply({
      project,
      request,
      readiness: readiness("READY"),
      formationId: "f-text-apply-3",
      transitionOverrides: {},
      referenceLayer: layer,
      assignmentStrategy: STRATEGY,
      promotedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const installed = installPreparedGeometryApply(prepared.prepared, { past: [], future: [] });
    expect(installed.history.past).toHaveLength(1);
    expect(installed.history.future).toHaveLength(0);
    expect(installed.invalidateDerivedAnalysis).toBe(true);

    // UNDO: restore the single snapshot.
    const undone = installed.history.past[0]!;
    expect(undone.project.timeline.find((c) => c.id === clip.id)!.formationId).toBe(clip.formationId);
    expect(undone.project.formations.some((f) => f.id === "f-text-apply-3")).toBe(false);
    expect(undone.referenceLayer).toBe(layer);

    // REDO: reinstalling produces the identical applied state.
    const redone = installPreparedGeometryApply(prepared.prepared, { past: [], future: [] });
    expect(JSON.stringify(redone.project)).toBe(JSON.stringify(installed.project));
  });

  it("reproduces identical geometry after Save -> Open", async () => {
    const { project, layer, clip, request } = await scenario();
    const prepared = prepareTextFormationApply({
      project,
      request,
      readiness: readiness("READY"),
      formationId: "f-text-apply-4",
      transitionOverrides: {},
      referenceLayer: layer,
      assignmentStrategy: STRATEGY,
      promotedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const applied = prepared.prepared.after.project;
    const reopened = parseProjectFile(JSON.stringify(serializeProject(applied))).project;
    const before = applied.formations.find((f) => f.id === "f-text-apply-4")!;
    const after = reopened.formations.find((f) => f.id === "f-text-apply-4")!;
    expect(after.points).toEqual(before.points);
    expect(after.text?.recipeHash).toBe(before.text?.recipeHash);
    expect(after.text?.recipe).toEqual(before.text?.recipe);
    expect(reopened.timeline.find((c) => c.id === clip.id)!.formationId).toBe("f-text-apply-4");
  });
});

describe("text apply guards", () => {
  it("refuses to apply without canonical readiness evidence", async () => {
    const { project, layer, request } = await scenario();
    const base = {
      project,
      request,
      formationId: "f-text-guard-1",
      transitionOverrides: {},
      referenceLayer: layer,
      assignmentStrategy: STRATEGY,
      promotedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(prepareTextFormationApply({ ...base, readiness: null })).toMatchObject({
      ok: false,
      blockers: ["READINESS_MISSING"],
    });
    expect(prepareTextFormationApply({ ...base, readiness: readiness("BLOCKED") })).toMatchObject({
      ok: false,
      blockers: ["READINESS_BLOCKED"],
    });
  });

  it("rejects a formation id that already exists", async () => {
    const { project, layer, clip, request } = await scenario();
    expect(
      prepareTextFormationApply({
        project,
        request,
        readiness: readiness("READY"),
        formationId: clip.formationId,
        transitionOverrides: {},
        referenceLayer: layer,
        assignmentStrategy: STRATEGY,
        promotedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toMatchObject({ ok: false, blockers: ["FORMATION_ID_COLLISION"] });
  });

  it("edits only the explicit scene object and leaves the legacy clip fallback intact", () => {
    const { project, scene } = sceneFixture(2);
    const target = scene.objects[0]!;
    const formation = project.formations.find(
      (f) => f.id === (target.source as { formationId: string }).formationId,
    )!;
    const prepared = prepareTextFormationApply({
      project,
      request: {
        clipId: scene.id,
        objectId: target.id,
        recipe: recipeFor(formation.points.length),
      },
      readiness: readiness("READY"),
      formationId: "f-text-object-1",
      transitionOverrides: {},
      referenceLayer: null,
      assignmentStrategy: STRATEGY,
      promotedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const after = prepared.prepared.after.project;
    // Legacy clip fallback is untouched.
    expect(after.timeline).toEqual(project.timeline);
    const afterScene = after.scenes!.find((s) => s.id === scene.id)!;
    expect(afterScene.objects[0]!.source).toEqual({
      kind: "STATIC",
      formationId: "f-text-object-1",
    });
    // Sibling object keeps its own source.
    expect(afterScene.objects[1]!.source).toEqual(scene.objects[1]!.source);
  });
});
