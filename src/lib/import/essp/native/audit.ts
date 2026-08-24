/**
 * IMPORTED SCENE AUDIT — PURE, READ-ONLY, EVIDENCE-ONLY.
 *
 * WHAT THIS IS
 *   A forensic description of ONE clip of an imported (or saved/reopened)
 *   project, expressed entirely in the current domain model. It answers
 *   "what IS this scene, factually?" so a future focused editor can be designed
 *   against facts instead of assumptions.
 *
 * HARD RULES
 *   - Zero mutation. Nothing here writes to the project, the reference layer,
 *     the library, history or storage. Every returned structure is freshly
 *     built from reads; inputs are never cloned back out mutated.
 *   - Zero repair. A dangling formation / dynamic / group / point reference is
 *     REPORTED, never patched, never substituted with a fallback.
 *   - Zero inference beyond geometry that is literally present. No OCR, no
 *     glyph/letter/font recognition, no semantic naming of imported artwork.
 *     `text` in this module means "what the data does or does not persist about
 *     text", never "what a human reads in the sky".
 *   - Zero ownership effect. Auditing never promotes an interval and never
 *     changes a binding owner or signature.
 *
 * IDENTITY IS NOT ONE NUMBER
 *   "Scene 31" is ambiguous: forensic segment order, extraction order, timeline
 *   position, SHOW-clip ordinal and reference-binding order are DIFFERENT
 *   identities that only coincide by accident. `resolveSceneOrdinal` reports all
 *   of them; the audit itself always takes an explicit clipId.
 */
import type { DynamicFormation, MotionGroup } from "../../../show/dynamic/types";
import type { LightingEffectInstance, LightingTargetKind } from "../../../show/lighting/types";
import { resolveParticipationSettings } from "../../../show/participation";
import type { ParticipationPolicy } from "../../../show/participation/types";
import type { FormationScene, SceneFormationInstance } from "../../../show/scene/types";
import { clipPhase, type ShowProject, type TimelineClip } from "../../../show/types";
import { clipOutputSignature, type ClipSignatureContext } from "./signature";
import { resolveReferenceIntervals } from "./intervals";
import type {
  ReferenceClipBinding,
  ReferenceExtractedSceneSnapshot,
  ReferenceExtractionDiagnostic,
  ReferenceSceneRepresentation,
  ReferenceTrajectoryLayer,
} from "./types";

export const SCENE_AUDIT_VERSION = "1.0.0";

/* ------------------------------------------------------------- identities */

/** Every distinct meaning an operator's "Scene N" can have. */
export interface SceneOrdinalCandidate {
  readonly interpretation:
    | "TIMELINE_INDEX_0_BASED"
    | "TIMELINE_INDEX_1_BASED"
    | "SHOW_CLIP_ORDINAL_1_BASED"
    | "BINDING_ORDER"
    | "FORENSIC_SEGMENT_ORDER_1_BASED";
  readonly clipId: string | null;
  readonly detail: string;
}

export interface SceneOrdinalResolution {
  readonly ordinal: number;
  readonly candidates: readonly SceneOrdinalCandidate[];
  /** Distinct clip ids the ordinal could mean. One entry = unambiguous. */
  readonly distinctClipIds: readonly string[];
}

/**
 * Resolves an operator-facing "Scene N" into every clip it could denote.
 * Pure lookup; it never picks a winner on the operator's behalf.
 */
export function resolveSceneOrdinal(
  project: ShowProject,
  layer: ReferenceTrajectoryLayer | null,
  ordinal: number,
): SceneOrdinalResolution {
  const timeline = project.timeline;
  const showClips = timeline.filter((c) => clipPhase(c) === "SHOW");
  const bindings = layer?.bindings ?? [];
  const byOrder = bindings.find((b) => b.order === ordinal) ?? null;
  const sceneBindings = bindings.filter((b) => b.kind === "SCENE");
  const forensic = sceneBindings[ordinal - 1] ?? null;

  const candidates: SceneOrdinalCandidate[] = [
    {
      interpretation: "TIMELINE_INDEX_0_BASED",
      clipId: timeline[ordinal]?.id ?? null,
      detail: `project.timeline[${ordinal}]`,
    },
    {
      interpretation: "TIMELINE_INDEX_1_BASED",
      clipId: timeline[ordinal - 1]?.id ?? null,
      detail: `project.timeline[${ordinal - 1}]`,
    },
    {
      interpretation: "SHOW_CLIP_ORDINAL_1_BASED",
      clipId: showClips[ordinal - 1]?.id ?? null,
      detail: `${ordinal}th clip with phase SHOW`,
    },
    {
      interpretation: "BINDING_ORDER",
      clipId: byOrder?.clipId ?? null,
      detail: `reference binding with order === ${ordinal}`,
    },
    {
      interpretation: "FORENSIC_SEGMENT_ORDER_1_BASED",
      clipId: forensic?.clipId ?? null,
      detail: forensic
        ? `${ordinal}th SCENE binding, forensic segment ${forensic.sourceSegmentId ?? "none"}`
        : `${ordinal}th SCENE binding does not exist`,
    },
  ];
  const distinct = [
    ...new Set(candidates.map((c) => c.clipId).filter((id): id is string => id !== null)),
  ];
  return { ordinal, candidates, distinctClipIds: distinct };
}

/* ----------------------------------------------------------------- shapes */

export interface AuditIdentity {
  readonly clipId: string;
  readonly timelineIndex: number;
  readonly showClipOrdinal: number | null;
  readonly phase: string;
  /** Timeline clips carry no persisted label in this schema. */
  readonly persistedLabel: string | null;
  readonly bindingOrder: number | null;
  readonly bindingKind: string | null;
  readonly forensicSegmentId: string | null;
  readonly sourceClassification: string | null;
  readonly extractionDiagnosticClipId: string | null;
  readonly sceneAssetId: string | null;
  /** EXPLICIT = a FormationScene exists for this clip id; SYNTHESISED = derived. */
  readonly sceneOrigin: "EXPLICIT_SCENE" | "SYNTHESISED_FROM_CLIP";
}

export interface AuditTiming {
  readonly referenceStart: number | null;
  readonly referenceHoldStart: number | null;
  readonly referenceEnd: number | null;
  readonly clipStart: number;
  readonly transition: number;
  readonly hold: number;
  readonly totalDuration: number;
  readonly playbackRate: number | null;
  readonly dynamicStartOffset: number | null;
  /** clipStart - referenceStart, when a binding exists. */
  readonly startDriftSeconds: number | null;
}

export interface AuditObject {
  readonly objectId: string;
  readonly name: string;
  readonly sourceKind: "STATIC" | "DYNAMIC";
  readonly formationId: string | null;
  readonly dynamicFormationId: string | null;
  readonly sourcePointCount: number | null;
  readonly requestedDroneCount: number | null;
  readonly transform: SceneFormationInstance["transform"];
  readonly animation: SceneFormationInstance["animation"] | null;
  readonly assetId: string | null;
  /** From extraction diagnostics; empty when extraction never recorded any. */
  readonly sourceDroneIds: readonly string[];
  readonly meanResidualMeters: number | null;
  /** Reference named by the object that does not resolve in this project. */
  readonly danglingReference: string | null;
}

export interface AuditRepresentation {
  readonly representation: ReferenceSceneRepresentation;
  readonly representationSource: "EXTRACTION_DIAGNOSTIC" | "DERIVED_FROM_PROJECT";
  readonly objectCount: number;
  readonly objects: readonly AuditObject[];
}

export interface AuditMotionGroup {
  readonly groupId: string;
  readonly name: string;
  readonly pointCount: number;
  readonly deformationKeyframeCount: number;
  readonly loop: string;
  readonly loopDuration: number | null;
  readonly phaseOffset: number;
  readonly enabled: boolean;
  readonly unresolvedPointIds: readonly string[];
}

export interface AuditMotion {
  readonly dynamicFormationId: string;
  readonly name: string;
  readonly pointCount: number;
  readonly stablePointIdsAvailable: boolean;
  readonly duplicatePointIds: readonly string[];
  readonly duration: number;
  readonly loop: string;
  readonly globalTransformKeyframeCount: number;
  readonly groupCount: number;
  readonly groups: readonly AuditMotionGroup[];
  readonly groupsOverlap: boolean;
  readonly overlappingPointIds: readonly string[];
  readonly pointsWithoutGroup: number;
  readonly allGroupPointIdsResolve: boolean;
}

export interface AuditLightingEffect {
  readonly effectId: string;
  readonly type: string;
  readonly targetKind: LightingTargetKind;
  readonly instanceId: string | null;
  readonly groupId: string | null;
  readonly pointIds: readonly string[];
  readonly anchor: string;
  readonly start: number;
  readonly duration: number;
  readonly enabled: boolean;
  /** Extracted effects are approximations; only proven zero-error is exact. */
  readonly fidelity: "SEMANTIC_APPROXIMATION" | "PROVEN_EXACT";
  readonly danglingReference: string | null;
}

export interface AuditLighting {
  /**
   * Always true while the clip's intervals are REFERENCE-owned: the imported
   * per-drone RGB bytes remain the playback authority.
   */
  readonly importedRgbIsAuthority: boolean;
  readonly effectCount: number;
  readonly effects: readonly AuditLightingEffect[];
  readonly exactReconstructionProven: boolean;
  readonly note: string;
}

export interface AuditParticipation {
  readonly defaultPolicy: ParticipationPolicy;
  readonly clipPolicyOverride: ParticipationPolicy | null;
  readonly manualOverride: boolean;
  readonly manualActiveDroneCount: number | null;
  readonly requestedActivePointCount: number;
  readonly fleetSize: number;
  readonly reserveCount: number;
  readonly reserveLighting: string;
  readonly reserveZoneOverridden: boolean;
  readonly wholeFleetParticipates: boolean;
}

export interface AuditOwnership {
  readonly bindingOwner: string | null;
  readonly recordedSignature: string | null;
  readonly currentSignature: string | null;
  readonly signatureMatches: boolean | null;
  readonly promotedAt: string | null;
  readonly promotionReason: string | null;
  readonly snapshotAvailable: boolean;
  readonly snapshotObjectIds: readonly string[];
  readonly snapshotFormationIds: readonly string[];
  readonly snapshotDynamicIds: readonly string[];
  /** Structural comparison of the live scene against the extracted snapshot. */
  readonly matchesExtractedSnapshot: boolean | null;
  readonly snapshotDifferences: readonly string[];
  readonly originalSourceBytesPreserved: boolean;
  readonly sourceFileCount: number;
  /** Intervals a future Apply/promotion of this clip would move to PLANNER. */
  readonly intervalsPromotedOnApply: readonly {
    readonly clipId: string;
    readonly kind: string;
    readonly start: number;
    readonly end: number;
  }[];
}

export interface AuditFidelity {
  readonly fidelityRmsMeters: number | null;
  readonly fidelityStatus: string | null;
  readonly decompositionConfidence: number | null;
  readonly decompositionSource: string | null;
  readonly decompositionReasons: readonly string[];
  readonly warnings: readonly string[];
  readonly danglingReferences: readonly string[];
}

export interface AuditTextFacts {
  readonly persistedSemanticText: string | null;
  readonly persistedFont: string | null;
  readonly glyphOrLetterGrouping: boolean;
  readonly motionGroupsLookLikeLetters: boolean;
  readonly pointIdsCarryLetterIdentity: boolean;
  readonly stablePointIdsAvailable: boolean;
  readonly deterministicPointTransferPossible: boolean;
  readonly humanInterpretationOnly: boolean;
  readonly cannotBeClaimedWithout: readonly string[];
}

export interface ReferenceClipAuditFound {
  readonly found: true;
  readonly auditVersion: string;
  readonly identity: AuditIdentity;
  readonly timing: AuditTiming;
  readonly representation: AuditRepresentation;
  readonly motion: readonly AuditMotion[];
  readonly lighting: AuditLighting;
  readonly participation: AuditParticipation;
  readonly ownership: AuditOwnership;
  readonly fidelity: AuditFidelity;
  readonly text: AuditTextFacts;
  /** Requested object, when `objectId` was supplied and resolves. */
  readonly focusedObject: AuditObject | null;
  readonly focusedObjectFound: boolean | null;
}

export interface ReferenceClipAuditNotFound {
  readonly found: false;
  readonly auditVersion: string;
  readonly clipId: string;
  readonly reason: "CLIP_NOT_IN_TIMELINE";
  readonly knownClipIds: readonly string[];
}

export type ReferenceClipAudit = ReferenceClipAuditFound | ReferenceClipAuditNotFound;

export interface AuditReferenceClipInput {
  readonly project: ShowProject;
  readonly clipId: string;
  readonly objectId?: string | undefined;
  readonly layer?: ReferenceTrajectoryLayer | null | undefined;
  readonly diagnostics?: readonly ReferenceExtractionDiagnostic[] | undefined;
  readonly signatureContext?: ClipSignatureContext | undefined;
  /** True when the original archive bytes are still recoverable in session. */
  readonly sourceBytesPresent?: boolean | undefined;
  readonly sourceFileCount?: number | undefined;
}

/* ------------------------------------------------------------------ audit */

/**
 * Builds the complete factual audit of ONE clip. Pure: for identical inputs it
 * returns an identical report and performs no mutation of any kind.
 */
export function auditReferenceClip(input: AuditReferenceClipInput): ReferenceClipAudit {
  const { project, clipId } = input;
  const clip = project.timeline.find((c) => c.id === clipId);
  if (!clip) {
    return {
      found: false,
      auditVersion: SCENE_AUDIT_VERSION,
      clipId,
      reason: "CLIP_NOT_IN_TIMELINE",
      knownClipIds: project.timeline.map((c) => c.id),
    };
  }
  const layer = input.layer ?? null;
  const binding = layer?.bindings.find((b) => b.clipId === clipId) ?? null;
  const diagnostic = input.diagnostics?.find((d) => d.clipId === clipId) ?? null;
  const scene = project.scenes?.find((s) => s.id === clipId) ?? null;
  const snapshot = layer?.extractedScenes?.find((s) => s.clipId === clipId) ?? null;
  const dangling: string[] = [];

  const identity = buildIdentity(project, clip, binding, diagnostic, scene);
  const timing = buildTiming(clip, binding);
  const representation = buildRepresentation(project, clip, scene, diagnostic, dangling);
  const motion = buildMotion(project, representation, dangling);
  const lighting = buildLighting(project, clipId, binding, scene, motion, dangling);
  const participation = buildParticipation(project, clip, representation);
  const ownership = buildOwnership(project, clip, layer, binding, snapshot, scene, input);
  const fidelity: AuditFidelity = {
    fidelityRmsMeters: diagnostic?.fidelityRmsMeters ?? null,
    fidelityStatus: diagnostic?.fidelityStatus ?? null,
    decompositionConfidence: diagnostic?.decompositionConfidence ?? null,
    decompositionSource: diagnostic?.decompositionSource ?? null,
    decompositionReasons: diagnostic?.decompositionReasons ?? [],
    warnings: diagnostic?.warnings ?? [],
    danglingReferences: dangling,
  };
  const text = buildTextFacts(representation, motion);
  const focused =
    input.objectId != null
      ? (representation.objects.find((o) => o.objectId === input.objectId) ?? null)
      : null;

  return {
    found: true,
    auditVersion: SCENE_AUDIT_VERSION,
    identity,
    timing,
    representation,
    motion,
    lighting,
    participation,
    ownership,
    fidelity,
    text,
    focusedObject: focused,
    focusedObjectFound: input.objectId != null ? focused !== null : null,
  };
}

function buildIdentity(
  project: ShowProject,
  clip: TimelineClip,
  binding: ReferenceClipBinding | null,
  diagnostic: ReferenceExtractionDiagnostic | null,
  scene: FormationScene | null,
): AuditIdentity {
  const timelineIndex = project.timeline.findIndex((c) => c.id === clip.id);
  const showClips = project.timeline.filter((c) => clipPhase(c) === "SHOW");
  const showOrdinal = showClips.findIndex((c) => c.id === clip.id);
  return {
    clipId: clip.id,
    timelineIndex,
    showClipOrdinal: showOrdinal >= 0 ? showOrdinal + 1 : null,
    phase: clipPhase(clip),
    persistedLabel: null,
    bindingOrder: binding?.order ?? null,
    bindingKind: binding?.kind ?? null,
    forensicSegmentId: binding?.sourceSegmentId ?? diagnostic?.sourceSegmentId ?? null,
    sourceClassification: binding?.sourceClassification ?? diagnostic?.classification ?? null,
    extractionDiagnosticClipId: diagnostic?.clipId ?? null,
    sceneAssetId: scene ? scene.id : null,
    sceneOrigin: scene ? "EXPLICIT_SCENE" : "SYNTHESISED_FROM_CLIP",
  };
}

function buildTiming(clip: TimelineClip, binding: ReferenceClipBinding | null): AuditTiming {
  return {
    referenceStart: binding?.referenceStart ?? null,
    referenceHoldStart: binding?.referenceHoldStart ?? null,
    referenceEnd: binding?.referenceEnd ?? null,
    clipStart: clip.start,
    transition: clip.transition,
    hold: clip.hold,
    totalDuration: clip.transition + clip.hold,
    playbackRate: clip.playbackRate ?? null,
    dynamicStartOffset: clip.dynamicStartOffset ?? null,
    startDriftSeconds: binding ? clip.start - binding.referenceStart : null,
  };
}

function buildRepresentation(
  project: ShowProject,
  clip: TimelineClip,
  scene: FormationScene | null,
  diagnostic: ReferenceExtractionDiagnostic | null,
  dangling: string[],
): AuditRepresentation {
  const diagObjects = diagnostic?.objects ?? [];
  const instances: readonly SceneFormationInstance[] = scene
    ? scene.objects
    : syntheticInstances(clip);

  const objects = instances.map((instance) => {
    const diag = diagObjects.find((d) => d.objectId === instance.id) ?? null;
    const isDynamic = instance.source.kind === "DYNAMIC";
    const formationId = instance.source.kind === "STATIC" ? instance.source.formationId : null;
    const dynamicId = isDynamic ? instance.source.dynamicFormationId : null;
    let pointCount: number | null = null;
    let danglingRef: string | null = null;
    if (dynamicId) {
      const dyn = project.dynamicFormations?.find((d) => d.id === dynamicId) ?? null;
      if (dyn) pointCount = dyn.points.length;
      else danglingRef = `dynamicFormationId:${dynamicId}`;
    } else if (formationId) {
      const formation = project.formations.find((f) => f.id === formationId) ?? null;
      if (formation) pointCount = formation.points.length;
      else danglingRef = `formationId:${formationId}`;
    } else {
      danglingRef = "source:MISSING";
    }
    if (danglingRef) dangling.push(`${instance.id} -> ${danglingRef}`);
    return {
      objectId: instance.id,
      name: instance.name,
      sourceKind: instance.source.kind,
      formationId,
      dynamicFormationId: dynamicId,
      sourcePointCount: pointCount,
      requestedDroneCount: instance.requestedDroneCount ?? null,
      transform: instance.transform,
      animation: instance.animation ?? null,
      assetId: instance.assetId ?? null,
      sourceDroneIds: diag?.sourceDroneIds ?? [],
      meanResidualMeters: diag?.meanResidualMeters ?? null,
      danglingReference: danglingRef,
    } satisfies AuditObject;
  });

  const derived: ReferenceSceneRepresentation = scene
    ? "COMPOSED_SCENE"
    : clip.dynamicFormationId
      ? "DYNAMIC"
      : "STATIC";
  return {
    representation: diagnostic?.representation ?? derived,
    representationSource: diagnostic ? "EXTRACTION_DIAGNOSTIC" : "DERIVED_FROM_PROJECT",
    objectCount: objects.length,
    objects,
  };
}

/**
 * A non-composed clip has exactly one implicit visual object. It is described
 * as such for audit symmetry; NO scene is created and nothing is persisted.
 */
function syntheticInstances(clip: TimelineClip): readonly SceneFormationInstance[] {
  const source: SceneFormationInstance["source"] = clip.dynamicFormationId
    ? { kind: "DYNAMIC", dynamicFormationId: clip.dynamicFormationId }
    : { kind: "STATIC", formationId: clip.formationId };
  return [
    {
      id: `${clip.id}:implicit`,
      name: "(implicit single object)",
      source,
      transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: 1 },
      ...(clip.playbackRate != null || clip.dynamicStartOffset != null
        ? {
            animation: {
              ...(clip.playbackRate != null ? { playbackRate: clip.playbackRate } : {}),
              ...(clip.dynamicStartOffset != null
                ? { startOffset: clip.dynamicStartOffset }
                : {}),
            },
          }
        : {}),
    },
  ];
}

function buildMotion(
  project: ShowProject,
  representation: AuditRepresentation,
  dangling: string[],
): readonly AuditMotion[] {
  const ids = [
    ...new Set(
      representation.objects
        .map((o) => o.dynamicFormationId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const reports: AuditMotion[] = [];
  for (const id of ids) {
    const dyn = project.dynamicFormations?.find((d) => d.id === id) ?? null;
    if (!dyn) continue; // already reported as dangling by buildRepresentation
    reports.push(auditDynamicFormation(dyn, dangling));
  }
  return reports;
}

function auditDynamicFormation(dyn: DynamicFormation, dangling: string[]): AuditMotion {
  const pointIds = dyn.points.map((p) => p.id);
  const known = new Set(pointIds);
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const id of pointIds) {
    if (seen.has(id)) duplicates.push(id);
    seen.add(id);
  }
  const membership = new Map<string, number>();
  const groups: AuditMotionGroup[] = dyn.groups.map((group: MotionGroup) => {
    const unresolved = group.pointIds.filter((pid) => !known.has(pid));
    for (const pid of group.pointIds) membership.set(pid, (membership.get(pid) ?? 0) + 1);
    if (unresolved.length > 0) {
      dangling.push(`${dyn.id}/${group.id} -> unresolved pointIds:${unresolved.length}`);
    }
    return {
      groupId: group.id,
      name: group.name,
      pointCount: group.pointIds.length,
      deformationKeyframeCount: group.keyframes.length,
      loop: group.loop,
      loopDuration: group.loopDuration ?? null,
      phaseOffset: group.phaseOffset,
      enabled: group.enabled,
      unresolvedPointIds: unresolved,
    };
  });
  const overlapping = [...membership.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  const grouped = new Set(dyn.groups.flatMap((g) => g.pointIds));
  return {
    dynamicFormationId: dyn.id,
    name: dyn.name,
    pointCount: dyn.points.length,
    stablePointIdsAvailable: pointIds.length > 0 && pointIds.every((id) => id.length > 0),
    duplicatePointIds: duplicates,
    duration: dyn.duration,
    loop: dyn.loop,
    globalTransformKeyframeCount: dyn.transform.length,
    groupCount: dyn.groups.length,
    groups,
    groupsOverlap: overlapping.length > 0,
    overlappingPointIds: overlapping,
    pointsWithoutGroup: pointIds.filter((id) => !grouped.has(id)).length,
    allGroupPointIdsResolve: groups.every((g) => g.unresolvedPointIds.length === 0),
  };
}

function buildLighting(
  project: ShowProject,
  clipId: string,
  binding: ReferenceClipBinding | null,
  scene: FormationScene | null,
  motion: readonly AuditMotion[],
  dangling: string[],
): AuditLighting {
  const all = project.lighting?.effects ?? [];
  const mine = all.filter((e: LightingEffectInstance) => e.target.clipId === clipId);
  const objectIds = new Set(scene ? scene.objects.map((o) => o.id) : []);
  const groupIds = new Set(motion.flatMap((m) => m.groups.map((g) => g.groupId)));
  const knownPointIds = new Set(
    (project.dynamicFormations ?? []).flatMap((d) => d.points.map((p) => p.id)),
  );

  const effects = mine.map((effect) => {
    const target = effect.target;
    const instanceId = "instanceId" in target ? target.instanceId : null;
    const groupId = target.kind === "MOTION_GROUP" ? target.groupId : null;
    const pointIds = target.kind === "POINT_GROUP" ? target.pointIds : [];
    let danglingRef: string | null = null;
    if (instanceId != null && objectIds.size > 0 && !objectIds.has(instanceId)) {
      danglingRef = `instanceId:${instanceId}`;
    } else if (groupId != null && !groupIds.has(groupId)) {
      danglingRef = `groupId:${groupId}`;
    } else {
      const missing = pointIds.filter((p) => !knownPointIds.has(p));
      if (missing.length > 0) danglingRef = `pointIds:${missing.length} unresolved`;
    }
    if (danglingRef) dangling.push(`effect ${effect.id} -> ${danglingRef}`);
    return {
      effectId: effect.id,
      type: effect.type,
      targetKind: target.kind,
      instanceId,
      groupId,
      pointIds,
      anchor: effect.anchor,
      start: effect.start,
      duration: effect.duration,
      enabled: effect.enabled,
      // Extraction-produced effects are heuristic descriptions of the imported
      // RGB. Nothing in the project proves zero sample error, so nothing here
      // may be reported as an exact reconstruction.
      fidelity: "SEMANTIC_APPROXIMATION" as const,
      danglingReference: danglingRef,
    } satisfies AuditLightingEffect;
  });

  return {
    importedRgbIsAuthority: binding?.owner === "REFERENCE",
    effectCount: effects.length,
    effects,
    exactReconstructionProven: false,
    note:
      binding?.owner === "REFERENCE"
        ? "Playback LED truth is the imported per-drone RGB of the reference layer. Listed effects are authoring metadata only."
        : "Interval is planner-owned: LED output comes from the project lighting program, not the imported RGB.",
  };
}

function buildParticipation(
  project: ShowProject,
  clip: TimelineClip,
  representation: AuditRepresentation,
): AuditParticipation {
  const settings = resolveParticipationSettings(project);
  const clipSettings = settings.clips?.[clip.id];
  const requested = representation.objects.reduce(
    (sum, o) => sum + (o.requestedDroneCount ?? o.sourcePointCount ?? 0),
    0,
  );
  const manual = clipSettings?.manual ?? null;
  return {
    defaultPolicy: settings.defaultPolicy,
    clipPolicyOverride: clipSettings?.policy ?? null,
    manualOverride: manual !== null,
    manualActiveDroneCount: manual ? manual.activeDroneIds.length : null,
    requestedActivePointCount: requested,
    fleetSize: project.droneCount,
    reserveCount: Math.max(0, project.droneCount - requested),
    reserveLighting: settings.reserveLighting,
    reserveZoneOverridden: clipSettings?.reserveZone != null,
    wholeFleetParticipates: requested === project.droneCount,
  };
}

function buildOwnership(
  project: ShowProject,
  clip: TimelineClip,
  layer: ReferenceTrajectoryLayer | null,
  binding: ReferenceClipBinding | null,
  snapshot: ReferenceExtractedSceneSnapshot | null,
  scene: FormationScene | null,
  input: AuditReferenceClipInput,
): AuditOwnership {
  const context = input.signatureContext ?? null;
  const currentSignature = context ? clipOutputSignature(project, clip.id, context) : null;
  const intervals = layer
    ? resolveReferenceIntervals(layer).filter(
        (i) =>
          i.clipId === clip.id ||
          (binding != null &&
            layer.bindings.some((b) => b.order === binding.order + 1 && b.clipId === i.clipId) &&
            i.kind === "TRANSITION"),
      )
    : [];
  const differences = snapshot && scene ? compareScene(scene, snapshot.scene) : [];
  return {
    bindingOwner: binding?.owner ?? null,
    recordedSignature: binding?.signature ?? null,
    currentSignature,
    signatureMatches:
      binding && currentSignature ? binding.signature === currentSignature : null,
    promotedAt: binding?.promotedAt ?? null,
    promotionReason: binding?.promotionReason ?? null,
    snapshotAvailable: snapshot !== null,
    snapshotObjectIds: snapshot?.scene.objects.map((o) => o.id) ?? [],
    snapshotFormationIds: snapshot?.formations.map((f) => f.id) ?? [],
    snapshotDynamicIds: snapshot?.dynamicFormations.map((d) => d.id) ?? [],
    matchesExtractedSnapshot: snapshot && scene ? differences.length === 0 : null,
    snapshotDifferences: differences,
    originalSourceBytesPreserved:
      input.sourceBytesPresent ?? (layer != null && layer.drones.length > 0),
    sourceFileCount: input.sourceFileCount ?? layer?.drones.length ?? 0,
    intervalsPromotedOnApply: intervals.map((i) => ({
      clipId: i.clipId,
      kind: i.kind,
      start: i.start,
      end: i.end,
    })),
  };
}

/** Structural, order-sensitive comparison. Reports differences; repairs none. */
function compareScene(current: FormationScene, extracted: FormationScene): string[] {
  const diffs: string[] = [];
  if (current.objects.length !== extracted.objects.length) {
    diffs.push(`objectCount ${extracted.objects.length} -> ${current.objects.length}`);
  }
  const byId = new Map(extracted.objects.map((o) => [o.id, o]));
  for (const object of current.objects) {
    const before = byId.get(object.id);
    if (!before) {
      diffs.push(`object added: ${object.id}`);
      continue;
    }
    if (JSON.stringify(object.source) !== JSON.stringify(before.source)) {
      diffs.push(`object source changed: ${object.id}`);
    }
    if (JSON.stringify(object.transform) !== JSON.stringify(before.transform)) {
      diffs.push(`object transform changed: ${object.id}`);
    }
    if ((object.requestedDroneCount ?? null) !== (before.requestedDroneCount ?? null)) {
      diffs.push(`object requestedDroneCount changed: ${object.id}`);
    }
  }
  for (const object of extracted.objects) {
    if (!current.objects.some((o) => o.id === object.id)) {
      diffs.push(`object removed: ${object.id}`);
    }
  }
  if (JSON.stringify(current.transform) !== JSON.stringify(extracted.transform)) {
    diffs.push("scene transform changed");
  }
  return diffs;
}

/**
 * TEXT FACTS — what the DATA persists, never what a human reads.
 *
 * The domain model has no glyph, font, letter or word entity. The only place a
 * semantic hint could live is `SceneObjectMetadata.semanticType`, so its
 * absence is a hard fact: no persisted text identity exists.
 */
function buildTextFacts(
  representation: AuditRepresentation,
  motion: readonly AuditMotion[],
): AuditTextFacts {
  const stable = motion.length > 0 && motion.every((m) => m.stablePointIdsAvailable);
  return {
    persistedSemanticText: null,
    persistedFont: null,
    glyphOrLetterGrouping: false,
    motionGroupsLookLikeLetters: false,
    pointIdsCarryLetterIdentity: false,
    stablePointIdsAvailable: stable,
    // A transfer is deterministic when point identity exists on both sides.
    deterministicPointTransferPossible: stable,
    humanInterpretationOnly: true,
    cannotBeClaimedWithout: [
      "OCR or manual operator input: which letters/words the artwork depicts",
      "manual operator input: which points belong to which letter",
      "manual operator input: font family, weight, tracking, baseline",
      "manual operator input: intended text for a rebuild-as-text operation",
      ...(representation.objectCount <= 1
        ? ["scene decomposition or operator grouping: any per-letter object identity"]
        : []),
    ],
  };
}
