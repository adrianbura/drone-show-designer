import { describe, expect, it } from "vitest";
import { createDefaultProject } from "../../../../show/defaultProject";
import type { ShowProject } from "../../../../show/types";
import { auditReferenceClip, resolveSceneOrdinal, SCENE_AUDIT_VERSION } from "../audit";
import type { ReferenceTrajectoryLayer } from "../types";
import { REFERENCE_LAYER_KIND } from "../types";

function project(): ShowProject {
  const base = createDefaultProject(10);
  return {
    ...base,
    droneCount: 10,
    formations: [
      { id: "f-1", name: "A", kind: "grid", points: [[0, 0, 0], [1, 0, 0]], params: {} },
    ],
    dynamicFormations: [
      {
        id: "d-1",
        name: "D",
        points: [
          { id: "FP-001", base: [0, 0, 0] },
          { id: "FP-002", base: [1, 0, 0] },
        ],
        pivot: [0, 0, 0],
        duration: 4,
        loop: "NONE",
        transform: [],
        groups: [
          {
            id: "G-1",
            name: "G",
            pointIds: ["FP-001", "FP-404"],
            color: [255, 0, 0],
            keyframes: [],
            loop: "NONE",
            phaseOffset: 0,
            enabled: true,
          },
        ],
        seed: 1,
        algorithmVersion: "1",
      },
    ],
    timeline: [
      {
        id: "c-1",
        formationId: "f-1",
        start: 0,
        transition: 2,
        hold: 3,
        easing: "EASE_IN_OUT",
        color: [255, 255, 255],
        effect: "NONE",
        phase: "SHOW",
      },
      {
        id: "c-2",
        formationId: "f-1",
        dynamicFormationId: "d-1",
        start: 5,
        transition: 2,
        hold: 2,
        easing: "EASE_IN_OUT",
        color: [255, 255, 255],
        effect: "NONE",
        phase: "SHOW",
      },
    ],
  } as unknown as ShowProject;
}

function layer(): ReferenceTrajectoryLayer {
  return {
    kind: REFERENCE_LAYER_KIND,
    schemaVersion: 1,
    importedAt: "2026-01-01T00:00:00.000Z",
    extractedAt: "2026-01-01T00:00:00.000Z",
    extractionAlgorithmVersion: "1",
    showHash: "hash",
    positionRateHz: 4,
    rgbRateHz: 4,
    positionSampleCount: 10,
    rgbSampleCount: 10,
    positionDurationSeconds: 9,
    playbackDurationSeconds: 9,
    experimental: "",
    rgbDurationSeconds: 9,
    metersPerUnit: 1,
    axisMapping: "ESSP_XYZ",
    drones: [],
    bindings: [
      {
        clipId: "c-1",
        order: 1,
        kind: "SCENE",
        sourceSegmentId: "SEG-1",
        sourceClassification: "STATIC_FORMATION",
        referenceStart: 0,
        referenceHoldStart: 2,
        referenceEnd: 5,
        owner: "REFERENCE",
        signature: "sig-1",
      },
      {
        clipId: "c-2",
        order: 2,
        kind: "SCENE",
        sourceSegmentId: "SEG-2",
        sourceClassification: "GLOBAL_TRANSLATION",
        referenceStart: 5,
        referenceHoldStart: 7,
        referenceEnd: 9,
        owner: "REFERENCE",
        signature: "sig-2",
      },
    ],
  } as unknown as ReferenceTrajectoryLayer;
}

describe("imported scene audit", () => {
  it("reports a missing clip instead of guessing", () => {
    const result = auditReferenceClip({ project: project(), clipId: "nope", layer: layer() });
    expect(result.found).toBe(false);
    if (result.found) return;
    expect(result.reason).toBe("CLIP_NOT_IN_TIMELINE");
    expect(result.knownClipIds).toEqual(["c-1", "c-2"]);
    expect(result.auditVersion).toBe(SCENE_AUDIT_VERSION);
  });

  it("never mutates the project or the layer and is deterministic", () => {
    const p = project();
    const l = layer();
    const before = JSON.stringify({ p, l });
    const a = auditReferenceClip({ project: p, clipId: "c-2", layer: l });
    const b = auditReferenceClip({ project: p, clipId: "c-2", layer: l });
    expect(JSON.stringify({ p, l })).toBe(before);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("describes identity, timing and ownership from the binding", () => {
    const result = auditReferenceClip({ project: project(), clipId: "c-1", layer: layer() });
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.identity.bindingOrder).toBe(1);
    expect(result.identity.forensicSegmentId).toBe("SEG-1");
    expect(result.identity.sceneOrigin).toBe("SYNTHESISED_FROM_CLIP");
    expect(result.timing.startDriftSeconds).toBe(0);
    expect(result.ownership.bindingOwner).toBe("REFERENCE");
    // Applying this clip closes the following transition too.
    expect(result.ownership.intervalsPromotedOnApply.map((i) => i.kind)).toContain("TRANSITION");
  });

  it("reports dangling motion-group point ids without repairing them", () => {
    const result = auditReferenceClip({ project: project(), clipId: "c-2", layer: layer() });
    expect(result.found).toBe(true);
    if (!result.found) return;
    const motion = result.motion[0]!;
    expect(motion.allGroupPointIdsResolve).toBe(false);
    expect(motion.groups[0]!.unresolvedPointIds).toEqual(["FP-404"]);
    expect(result.fidelity.danglingReferences.length).toBeGreaterThan(0);
  });

  it("claims no text semantics whatsoever", () => {
    const result = auditReferenceClip({ project: project(), clipId: "c-2", layer: layer() });
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.text.persistedSemanticText).toBeNull();
    expect(result.text.persistedFont).toBeNull();
    expect(result.text.glyphOrLetterGrouping).toBe(false);
    expect(result.text.motionGroupsLookLikeLetters).toBe(false);
    expect(result.text.humanInterpretationOnly).toBe(true);
    expect(result.text.stableSourceIdentityAvailable).toBe(true);
    // Stable SOURCE ids never imply a deterministic transfer.
    expect(result.text.targetCorrespondenceAvailable).toBe(false);
    expect(result.text.deterministicPointTransferPossible).toBe(false);
    expect(result.text.pointTransferBlockers.length).toBeGreaterThan(0);
  });

  it("never claims exact lighting reconstruction", () => {
    const result = auditReferenceClip({ project: project(), clipId: "c-1", layer: layer() });
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.lighting.exactReconstructionProven).toBe(false);
    expect(result.lighting.importedRgbIsAuthority).toBe(true);
  });

  it("exposes every meaning of an operator ordinal", () => {
    const resolution = resolveSceneOrdinal(project(), layer(), 2);
    expect(resolution.candidates).toHaveLength(5);
    expect(resolution.distinctClipIds).toContain("c-2");
  });
});

describe("scene audit — source byte contract", () => {
  function drone(id: number, bytes: string) {
    return {
      sourceId: `S-${id}`,
      numericSourceId: id,
      sourceFile: `${id}.essp`,
      fileBase64: bytes,
    };
  }

  it("never claims preserved source bytes from drone count alone", () => {
    const withCountOnly: ReferenceTrajectoryLayer = {
      ...layer(),
      drones: [drone(1, ""), drone(2, "")],
    };
    const result = auditReferenceClip({
      project: project(),
      clipId: "c-1",
      layer: withCountOnly,
    });
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.ownership.sourceFileCount).toBe(2);
    expect(result.ownership.sourceFilesWithBytes).toBe(0);
    expect(result.ownership.allExpectedSourceBytesPresent).toBe(false);
    expect(result.ownership.originalSourceBytesPreserved).toBe(false);
  });

  it("fails the contract when only SOME files carry bytes", () => {
    const partial: ReferenceTrajectoryLayer = {
      ...layer(),
      drones: [drone(1, "AAAA"), drone(2, "")],
    };
    const result = auditReferenceClip({ project: project(), clipId: "c-1", layer: partial });
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.ownership.sourceFilesWithBytes).toBe(1);
    expect(result.ownership.allExpectedSourceBytesPresent).toBe(false);
  });

  it("passes only when every expected source file carries bytes", () => {
    const full: ReferenceTrajectoryLayer = {
      ...layer(),
      drones: [drone(1, "AAAA"), drone(2, "BBBB")],
    };
    const result = auditReferenceClip({ project: project(), clipId: "c-1", layer: full });
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.ownership.sourceFileCount).toBe(2);
    expect(result.ownership.sourceFilesWithBytes).toBe(2);
    expect(result.ownership.allExpectedSourceBytesPresent).toBe(true);
    expect(result.ownership.originalSourceBytesPreserved).toBe(true);
  });

  it("fails when an expected file is missing entirely from the layer", () => {
    const short: ReferenceTrajectoryLayer = { ...layer(), drones: [drone(1, "AAAA")] };
    const result = auditReferenceClip({
      project: project(),
      clipId: "c-1",
      layer: short,
      sourceFileCount: 2,
    });
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.ownership.sourceFileCount).toBe(2);
    expect(result.ownership.sourceFilesWithBytes).toBe(1);
    expect(result.ownership.allExpectedSourceBytesPresent).toBe(false);
  });
});
