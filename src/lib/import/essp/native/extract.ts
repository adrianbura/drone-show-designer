/**
 * EXTRACTION (layer A) — imported reference show -> native editable timeline.
 *
 * The forensic report is the segmentation authority; the EXISTING conversion
 * pipeline (`convertReferenceSegmentToDynamicFormation`, optionally narrowed to
 * a drone subset) is the only geometry engine used. Nothing here re-implements
 * decomposition, fitting or fidelity measurement, and nothing mutates the
 * reference show.
 *
 * The produced clips TILE the reference time span with no gaps and no overlaps:
 *
 *   TAKEOFF   [0, firstSceneStart)          transition = ascent, hold = rest
 *   SCENE k   [prevEnd, sceneEnd)           transition = observed travel,
 *                                           hold = observed scene hold
 *   LANDING   [lastSceneEnd, showEnd]       transition = travel to pads,
 *                                           hold = descent
 *
 * Tiling is what makes the ownership rule in `intervals.ts` total: every instant
 * of the imported show belongs to exactly one interval of exactly one clip.
 *
 * SCENE REPRESENTATION (see `decomposition.ts`)
 *   STATIC / DYNAMIC   one native object — the default
 *   COMPOSED_SCENE     several independently editable objects, accepted only
 *                      when the decomposition evidence is strong enough
 */
import type { LightingEffectInstance, LightingProgram } from "../../../show/lighting/types";
import { LIGHTING_SCHEMA_VERSION } from "../../../show/lighting/types";
import type { DynamicFormation } from "../../../show/dynamic/types";
import type { Formation, RGB, TimelineClip, Vector3Tuple } from "../../../show/types";
import { convertReferenceSegmentToDynamicFormation } from "../conversion/convert";
import { collectSceneDependencies } from "../../../library/sceneAsset";
import {
  IDENTITY_INSTANCE_TRANSFORM,
  SCENE_SCHEMA_VERSION,
  newSceneObjectId,
  type FormationScene,
  type SceneFormationInstance,
} from "../../../show/scene/types";
import { segmentEligibility } from "../conversion/types";
import { sequenceFromReferenceShow } from "../forensics/adapter";
import type { ReferenceForensicsReport, ReferenceSceneSegment } from "../forensics/types";
import { colorAt, sampleReferenceShow } from "../playback";
import type { ReferenceDrone, ReferenceShow } from "../types";
import { buildReferenceLayer } from "./layer";
import {
  SCENE_DECOMPOSITION_DEFAULTS,
  proposeSceneDecomposition,
  type SceneDecompositionGroup,
  type SceneDecompositionProposal,
  type SceneDecompositionThresholds,
} from "./decomposition";
import {
  ReferenceLayerError,
  type ReferenceAssetDraft,
  type ReferenceClipBinding,
  type ReferenceClipKind,
  type ReferenceExtractionDiagnostic,
  type ReferenceExtractionResult,
  type ReferenceExtractedSceneSnapshot,
  type ReferenceSceneObjectDiagnostic,

  type ReferenceSceneRepresentation,
} from "./types";

export interface ReferenceExtractionOptions {
  /** Segments shorter than this are not promoted to their own scene clip. */
  readonly minSceneSeconds?: number;
  /** Scene classes converted to an animated formation instead of a static one. */
  readonly animateMotionScenes?: boolean;
  /** Import observed LED behaviour (dark travel + reveal) as lighting effects. */
  readonly importLighting?: boolean;
  /** Attempt evidence-based multi-object decomposition of each scene. */
  readonly decomposeScenes?: boolean;
  readonly decompositionThresholds?: SceneDecompositionThresholds;
  readonly extractedAt?: string;
}

/**
 * Observed reveal/darkness shape of the analysed show, used only when the
 * lighting track confirms a dark travel for that specific scene.
 */
const REVEAL_DELAY_SECONDS = 2.5;
const REVEAL_DURATION_SECONDS = 3;
const FADE_OUT_DURATION_SECONDS = 2;
/** Mean brightness (0..1) below which a window counts as "dark travel". */
const DARK_BRIGHTNESS = 0.12;
/**
 * Per-group brightness difference required before lighting is claimed to belong
 * to individual scene objects instead of the whole scene. Below it, membership
 * is not convincing and scene-level lighting is kept.
 */
const LIGHTING_GROUP_BRIGHTNESS_DELTA = 0.15;

const SCENE_CLASSES = new Set([
  "STATIC_FORMATION",
  "GLOBAL_TRANSLATION",
  "GLOBAL_ROTATION",
  "RIGID_MOTION",
  "DYNAMIC_DEFORMATION",
]);
const ANIMATED_CLASSES = new Set([
  "GLOBAL_TRANSLATION",
  "GLOBAL_ROTATION",
  "RIGID_MOTION",
  "DYNAMIC_DEFORMATION",
]);

function round(value: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function meanColorAt(show: ReferenceShow, time: number): RGB {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const drone of show.drones) {
    const c = colorAt(drone, time, show.timing.rgbRateHz);
    r += c[0];
    g += c[1];
    b += c[2];
  }
  const n = Math.max(1, show.drones.length);
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)] as RGB;
}

/** Mean brightness (0..1) of one drone subset at one time. */
function groupBrightnessAt(
  show: ReferenceShow,
  indices: readonly number[],
  time: number,
): number {
  if (!indices.length) return 0;
  let sum = 0;
  for (const index of indices) {
    const drone: ReferenceDrone | undefined = show.drones[index];
    if (!drone) continue;
    const c = colorAt(drone, time, show.timing.rgbRateHz);
    sum += (c[0] + c[1] + c[2]) / (3 * 255);
  }
  return sum / indices.length;
}

function brightnessAt(report: ReferenceForensicsReport, time: number): number | null {
  const track = report.lighting?.track;
  if (!track || track.length === 0) return null;
  let best = track[0]!;
  for (const sample of track) {
    if (Math.abs(sample.time - time) < Math.abs(best.time - time)) best = sample;
  }
  return best.meanBrightness;
}

function staticPointsAt(show: ReferenceShow, time: number): Vector3Tuple[] {
  return sampleReferenceShow(show, time).map((s) => s.position as Vector3Tuple);
}

/** Scene segments, in time order, that are long enough to author as clips. */
function sceneSegments(
  report: ReferenceForensicsReport,
  minSceneSeconds: number,
): ReferenceSceneSegment[] {
  return report.segments
    .filter((s) => SCENE_CLASSES.has(s.classification) && s.duration >= minSceneSeconds)
    .filter((s) => {
      const takeoff = report.takeoffInterval;
      const landing = report.landingInterval;
      if (takeoff && s.endTime <= takeoff.endTime + 1e-6) return false;
      if (landing && s.startTime >= landing.startTime - 1e-6) return false;
      return true;
    })
    .sort((a, b) => a.startTime - b.startTime);
}

/** One accepted object of a decomposed scene, with its own bundled geometry. */
interface ComposedObject {
  readonly group: SceneDecompositionGroup;
  readonly formation: Formation;
  readonly dynamic: DynamicFormation | null;
  readonly fidelityRms: number | null;
  readonly fidelityStatus: string | null;
}

/**
 * Extracts TAKEOFF + every stable scene + LANDING into native project content
 * plus the lossless imported trajectory layer that owns their playback.
 */
export function extractReferenceTimeline(
  show: ReferenceShow,
  report: ReferenceForensicsReport,
  options: ReferenceExtractionOptions = {},
): ReferenceExtractionResult {
  const minSceneSeconds = options.minSceneSeconds ?? 4;
  const animate = options.animateMotionScenes ?? true;
  const importLighting = options.importLighting ?? true;
  const decompose = options.decomposeScenes ?? true;
  const decompositionThresholds = options.decompositionThresholds ?? SCENE_DECOMPOSITION_DEFAULTS;
  const droneCount = show.drones.length;
  if (droneCount === 0) {
    throw new ReferenceLayerError("NO_REFERENCE_SHOW", "The imported show has no drones.");
  }
  const scenes = sceneSegments(report, minSceneSeconds);
  if (scenes.length === 0) {
    throw new ReferenceLayerError(
      "NO_SCENES",
      "The forensic analysis found no stable scene long enough to extract. Lower the minimum scene duration or re-run the analysis with a different preset.",
    );
  }

  const duration = show.timing.playbackDurationSeconds;
  const formations: Formation[] = [];
  const dynamicFormations: DynamicFormation[] = [];
  const sceneCompositions: FormationScene[] = [];
  const timeline: TimelineClip[] = [];
  const bindings: ReferenceClipBinding[] = [];
  const assets: ReferenceAssetDraft[] = [];
  const diagnostics: ReferenceExtractionDiagnostic[] = [];
  const effects: LightingEffectInstance[] = [];
  const warnings: string[] = [];
  /** Built lazily: the analysis sequence is only needed for decomposition. */
  let sequence: ReturnType<typeof sequenceFromReferenceShow> | null = null;

  let order = 0;
  const pushClip = (args: {
    kind: ReferenceClipKind;
    label: string;
    start: number;
    transition: number;
    hold: number;
    segment: ReferenceSceneSegment | null;
    points: Vector3Tuple[];
    dynamic: DynamicFormation | null;
    fidelityRms: number | null;
    fidelityStatus: string | null;
    clipWarnings: string[];
    decomposition?: SceneDecompositionProposal | null;
    composed?: readonly ComposedObject[];
  }) => {
    const index = order++;
    const clipId = `essp-clip-${String(index).padStart(2, "0")}`;
    const composed = args.composed ?? [];
    const formation: Formation = {
      id: `essp-formation-${String(index).padStart(2, "0")}`,
      name: args.label,
      kind: "custom",
      points: args.points.map((p) => [p[0], p[1], p[2]] as Vector3Tuple),
      params: {
        source: "ESSP_IMPORTED_SHOW",
        sourceShowHash: report.source.showHash,
        sourceSegmentId: args.segment?.id ?? "",
        sourceStartTime: round(args.start),
        droneCount,
      },
    };
    formations.push(formation);
    if (args.dynamic) dynamicFormations.push(args.dynamic);
    for (const object of composed) {
      formations.push(object.formation);
      if (object.dynamic) dynamicFormations.push(object.dynamic);
    }

    const representation: ReferenceSceneRepresentation =
      composed.length > 1 ? "COMPOSED_SCENE" : args.dynamic ? "DYNAMIC" : "STATIC";

    const holdMid = args.start + args.transition + args.hold / 2;
    const clip: TimelineClip = {
      id: clipId,
      formationId: formation.id,
      start: round(args.start),
      transition: round(args.transition),
      hold: round(args.hold),
      easing: "minJerk",
      color: meanColorAt(show, Math.min(holdMid, duration)),
      effect: "solid",
      phase: args.kind === "SCENE" ? "SHOW" : args.kind,
      ...(args.dynamic && representation !== "COMPOSED_SCENE"
        ? { dynamicFormationId: args.dynamic.id, playbackRate: 1, dynamicStartOffset: 0 }
        : {}),
    };
    timeline.push(clip);

    /* ------------------------------------------- multi-object composition */
    let objectDiagnostics: ReferenceSceneObjectDiagnostic[] = [];
    let composition: FormationScene | null = null;
    if (representation === "COMPOSED_SCENE") {
      const objects: SceneFormationInstance[] = composed.map((object, k) => ({
        id: `${clipId}-obj-${k + 1}`,
        name: object.group.name,
        source: object.dynamic
          ? { kind: "DYNAMIC", dynamicFormationId: object.dynamic.id }
          : { kind: "STATIC", formationId: object.formation.id },
        transform: IDENTITY_INSTANCE_TRANSFORM,
        requestedDroneCount: object.group.sourceDroneIds.length,
        metadata: {
          note: `Inferred group of ${object.group.sourceDroneIds.length} source drones (confidence ${(
            args.decomposition?.evidence.confidence ?? 0
          ).toFixed(2)}).`,
        },
      }));
      composition = {
        id: clipId,
        name: args.label,
        schemaVersion: SCENE_SCHEMA_VERSION,
        objects,
        transform: IDENTITY_INSTANCE_TRANSFORM,
      };
      sceneCompositions.push(composition);
      objectDiagnostics = composed.map((object, k) => ({
        objectId: objects[k]!.id,
        name: object.group.name,
        droneCount: object.group.sourceDroneIds.length,
        sourceDroneIds: object.group.sourceDroneIds,
        dynamic: !!object.dynamic,
        meanResidualMeters: object.group.meanResidualMeters,
        formationId: object.formation.id,
        dynamicFormationId: object.dynamic?.id ?? null,
      }));
    }

    bindings.push({
      clipId,
      order: index,
      kind: args.kind,
      sourceSegmentId: args.segment?.id ?? null,
      sourceClassification: args.segment?.classification ?? null,
      referenceStart: clip.start,
      referenceHoldStart: round(clip.start + clip.transition),
      referenceEnd: round(clip.start + clip.transition + clip.hold),
      owner: "REFERENCE",
      // Re-seeded against the real project by the caller; the extractor cannot
      // know the final project-level fields (limits, participation, strategy).
      signature: "",
    });
    diagnostics.push({
      clipId,
      kind: args.kind,
      sourceSegmentId: args.segment?.id ?? null,
      classification: args.segment?.classification ?? null,
      referenceStart: clip.start,
      referenceHoldStart: round(clip.start + clip.transition),
      referenceEnd: round(clip.start + clip.transition + clip.hold),
      fidelityRmsMeters: args.fidelityRms,
      fidelityStatus: args.fidelityStatus,
      dynamic: !!args.dynamic,
      representation,
      objects: objectDiagnostics,
      decompositionConfidence: args.decomposition?.evidence.confidence ?? null,
      decompositionSource: args.decomposition?.evidence.source ?? null,
      decompositionReasons: args.decomposition?.evidence.reasons ?? [],
      warnings: args.clipWarnings,
    });

    // Library assets: reusable geometry with explicit ESSP provenance.
    const assetInput = {
      name: args.label,
      description: `Extracted from the imported ESSP show, ${round(args.start)}s - ${round(
        args.start + args.transition + args.hold,
      )}s (${args.segment?.classification ?? args.kind}). Reverse-engineered source; fidelity is measured, not guaranteed.`,
      tags: ["essp", "imported", (args.segment?.classification ?? args.kind).toLowerCase()],
      source: "ESSP_DERIVED" as const,
      sourceRef: {
        kind: "FILE" as const,
        name: "imported ESSP show",
        fingerprint: report.source.showHash,
        params: {
          segmentId: args.segment?.id ?? "",
          startTime: round(args.start),
          endTime: round(args.start + args.transition + args.hold),
          classification: args.segment?.classification ?? args.kind,
          representation,
          ...(args.decomposition
            ? {
                decompositionAlgorithmVersion: args.decomposition.algorithmVersion,
                decompositionConfidence: round(args.decomposition.evidence.confidence),
                decompositionSource: args.decomposition.evidence.source,
              }
            : {}),
        },
      },
    };
    // DRAFT POLICY — exactly ONE user-facing draft per extracted scene:
    //   COMPOSED_SCENE -> the composition (its group geometry travels bundled)
    //   animated       -> the DYNAMIC formation
    //   static visual  -> the STATIC formation
    if (representation === "COMPOSED_SCENE" && composition) {
      assets.push({
        kind: "SCENE",
        scene: composition,
        dependencies: collectSceneDependencies(composition, {
          formations: composed.map((o) => o.formation),
          dynamicFormations: composed
            .map((o) => o.dynamic)
            .filter((d): d is DynamicFormation => !!d),
        }),
        input: assetInput,
      });
    } else if (args.dynamic) {
      assets.push({ kind: "DYNAMIC", formation: args.dynamic, input: assetInput });
    } else if (args.kind === "SCENE") {
      assets.push({ kind: "STATIC", formation, input: assetInput });
    }

    // Observed LED choreography: LEDs off while travelling, reveal after arrival.
    if (importLighting && args.kind === "SCENE" && args.transition > 0) {
      const travelBrightness = brightnessAt(report, args.start + args.transition / 2);
      const darkTravel = travelBrightness !== null && travelBrightness < DARK_BRIGHTNESS;
      if (darkTravel) {
        // LIGHTING GROUP MAPPING: only claim per-object lighting when the groups
        // really do behave differently. Otherwise stay scene-level.
        const perObject =
          composition && composed.length > 1
            ? groupedLightingTargets(show, composed, holdMid, duration)
            : null;
        const targets: LightingEffectInstance["target"][] =
          perObject && composition
            ? composition.objects.map((o) => ({
                kind: "SCENE_OBJECT" as const,
                clipId,
                instanceId: o.id,
              }))
            : [{ kind: "SCENE" as const, clipId }];
        targets.forEach((target, k) => {
          const suffix = targets.length > 1 ? `-o${k + 1}` : "";
          effects.push({
            id: `essp-light-${clipId}${suffix}-in`,
            target,
            type: "FADE_IN",
            anchor: "FORMATION_READY",
            start: Math.min(REVEAL_DELAY_SECONDS, Math.max(0, args.hold - 0.5)),
            duration: Math.min(REVEAL_DURATION_SECONDS, Math.max(0.5, args.hold)),
            parameters: { easing: "SMOOTH", intensity: 1 },
            blendMode: "MULTIPLY_INTENSITY",
            priority: 0,
            enabled: true,
            metadata: {
              note: "Imported from the reference show: dark travel, reveal after arrival.",
            },
          });
          effects.push({
            id: `essp-light-${clipId}${suffix}-out`,
            target,
            type: "FADE_OUT",
            anchor: "SCENE_END",
            start: -Math.min(FADE_OUT_DURATION_SECONDS, Math.max(0.5, args.hold)),
            duration: Math.min(FADE_OUT_DURATION_SECONDS, Math.max(0.5, args.hold)),
            parameters: { easing: "SMOOTH" },
            blendMode: "MULTIPLY_INTENSITY",
            priority: 0,
            enabled: true,
            metadata: {
              note: "Imported from the reference show: LEDs off before the next travel.",
            },
          });
        });
      }
    }
  };

  /* ------------------------------------------------------------- TAKEOFF */
  const firstScene = scenes[0]!;
  const takeoff = report.takeoffInterval;
  const takeoffEnd = takeoff ? Math.min(takeoff.endTime, firstScene.startTime) : firstScene.startTime;
  pushClip({
    kind: "TAKEOFF",
    label: "Imported takeoff",
    start: 0,
    transition: Math.max(0.1, takeoffEnd),
    hold: Math.max(0, firstScene.startTime - Math.max(0.1, takeoffEnd)),
    segment: null,
    points: staticPointsAt(show, Math.max(0, firstScene.startTime - 0.001)),
    dynamic: null,
    fidelityRms: null,
    fidelityStatus: null,
    clipWarnings: takeoff
      ? []
      : ["No takeoff interval was detected; the interval before the first scene is used."],
  });

  /* -------------------------------------------------------------- SCENES */
  scenes.forEach((segment, index) => {
    const previousEnd = index === 0 ? firstScene.startTime : scenes[index - 1]!.endTime;
    const transition = index === 0 ? 0 : Math.max(0, segment.startTime - previousEnd);
    const hold = Math.max(0, segment.endTime - segment.startTime);
    const clipWarnings: string[] = [];
    let dynamic: DynamicFormation | null = null;
    const holdMid = segment.startTime + hold / 2;
    let points = staticPointsAt(show, holdMid);
    let fidelityRms: number | null = null;
    let fidelityStatus: string | null = null;

    if (animate && ANIMATED_CLASSES.has(segment.classification)) {
      const eligibility = segmentEligibility(segment.classification);
      if (eligibility === "UNSUPPORTED") {
        clipWarnings.push(
          `Segment class ${segment.classification} cannot be converted to an animated formation; a static snapshot is used.`,
        );
      } else {
        try {
          const proposal = convertReferenceSegmentToDynamicFormation(show, segment, {
            mode: "EXACT_SAMPLED",
            referenceFrame: "SEGMENT_START",
            name: `Imported scene ${index + 1}`,
            formationId: `essp-dyn-${String(index + 1).padStart(2, "0")}`,
          });
          dynamic = proposal.formation;
          points = proposal.basePoints.map((p) => [p[0], p[1], p[2]] as Vector3Tuple);
          fidelityRms = proposal.fidelityReport.rmsErrorMeters;
          fidelityStatus = proposal.fidelityReport.status;
          if (eligibility === "EXPERIMENTAL") {
            clipWarnings.push("Experimental conversion: this segment may be a topology morph.");
          }
          clipWarnings.push(...proposal.warnings);
        } catch (error) {
          clipWarnings.push(
            `Animated conversion failed (${
              error instanceof Error ? error.message : String(error)
            }); a static snapshot is used.`,
          );
        }
      }
    }

    /* ------------------------------------------ evidence-based decomposition */
    let decomposition: SceneDecompositionProposal | null = null;
    let composed: ComposedObject[] = [];
    if (decompose) {
      sequence ??= sequenceFromReferenceShow(show);
      decomposition = proposeSceneDecomposition(sequence, segment, decompositionThresholds);
      if (decomposition.representation === "COMPOSED_SCENE") {
        composed = buildComposedObjects({
          show,
          segment,
          index,
          holdMid,
          groups: decomposition.groups,
          showHash: report.source.showHash,
          decomposition,
          animate,
          clipWarnings,
        });
        if (composed.length < 2) {
          composed = [];
          clipWarnings.push(
            "The proposed groups could not be built as independent objects; the scene stays one object.",
          );
        }
      }
    }

    pushClip({
      kind: "SCENE",
      label: `Imported scene ${index + 1}`,
      start: index === 0 ? segment.startTime : previousEnd,
      transition,
      hold,
      segment,
      points,
      dynamic,
      fidelityRms,
      fidelityStatus,
      clipWarnings,
      decomposition,
      composed,
    });
  });

  /* ------------------------------------------------------------- LANDING */
  const lastScene = scenes[scenes.length - 1]!;
  const landing = report.landingInterval;
  const landingStart = landing ? Math.max(landing.startTime, lastScene.endTime) : lastScene.endTime;
  const landingEnd = landing ? Math.max(landing.endTime, landingStart) : duration;
  pushClip({
    kind: "LANDING",
    label: "Imported landing",
    start: lastScene.endTime,
    transition: Math.max(0, landingStart - lastScene.endTime),
    hold: Math.max(0.1, landingEnd - landingStart),
    segment: null,
    points: staticPointsAt(show, Math.min(duration, landingEnd)),
    dynamic: null,
    fidelityRms: null,
    fidelityStatus: null,
    clipWarnings: landing
      ? []
      : ["No landing interval was detected; the interval after the last scene is used."],
  });

  if (!report.landingInterval) {
    warnings.push("No landing descent was detected in the imported show.");
  }
  if (scenes.length < report.segments.filter((s) => SCENE_CLASSES.has(s.classification)).length) {
    warnings.push(
      "Short stable segments were absorbed into the surrounding transitions and were not extracted as clips.",
    );
  }

  const lighting: LightingProgram = { schemaVersion: LIGHTING_SCHEMA_VERSION, effects };
  const layer = buildReferenceLayer(show, bindings, options.extractedAt ? { extractedAt: options.extractedAt } : {});

  return {
    formations,
    dynamicFormations,
    scenes: sceneCompositions,
    timeline,
    lighting,
    layer,
    assets,
    diagnostics,
    droneCount,
    durationSeconds: duration,
    warnings,
  };
}

/**
 * Geometry per accepted group. STATIC groups get a native formation containing
 * only that group's points; animated groups reuse the EXISTING converter through
 * its drone-subset boundary. No decomposition maths is duplicated here.
 */
function buildComposedObjects(args: {
  show: ReferenceShow;
  segment: ReferenceSceneSegment;
  index: number;
  holdMid: number;
  groups: readonly SceneDecompositionGroup[];
  showHash: string;
  decomposition: SceneDecompositionProposal;
  animate: boolean;
  clipWarnings: string[];
}): ComposedObject[] {
  const { show, segment, index, holdMid, groups, showHash, decomposition } = args;
  const worldAtHold = staticPointsAt(show, holdMid);
  const out: ComposedObject[] = [];
  groups.forEach((group, k) => {
    const suffix = `${String(index + 1).padStart(2, "0")}-g${k + 1}`;
    const provenance: Record<string, number | string> = {
      source: "ESSP_IMPORTED_SHOW",
      sourceShowHash: showHash,
      sourceSegmentId: segment.id,
      sourceDroneIds: group.sourceDroneIds.join(" "),
      groupId: group.id,
      droneCount: group.sourceDroneIds.length,
      decompositionAlgorithmVersion: decomposition.algorithmVersion,
      decompositionSource: decomposition.evidence.source,
      decompositionConfidence: round(decomposition.evidence.confidence),
    };
    const groupFormation: Formation = {
      id: `essp-group-${suffix}`,
      name: group.name,
      kind: "custom",
      points: group.droneIndices.map((i) => {
        const p = worldAtHold[i] ?? [0, 0, 0];
        return [p[0], p[1], p[2]] as Vector3Tuple;
      }),
      params: provenance,
    };
    let dynamic: DynamicFormation | null = null;
    let fidelityRms: number | null = null;
    let fidelityStatus: string | null = null;
    if (args.animate && group.animated && ANIMATED_CLASSES.has(segment.classification)) {
      try {
        const proposal = convertReferenceSegmentToDynamicFormation(show, segment, {
          mode: "EXACT_SAMPLED",
          referenceFrame: "SEGMENT_START",
          name: group.name,
          formationId: `essp-groupdyn-${suffix}`,
          sourceDroneIds: group.sourceDroneIds,
        });
        dynamic = { ...proposal.formation, sourceFormationId: groupFormation.id };
        fidelityRms = proposal.fidelityReport.rmsErrorMeters;
        fidelityStatus = proposal.fidelityReport.status;
        out.push({
          group,
          formation: {
            ...groupFormation,
            points: proposal.basePoints.map((p) => [p[0], p[1], p[2]] as Vector3Tuple),
          },
          dynamic,
          fidelityRms,
          fidelityStatus,
        });
        return;
      } catch (error) {
        args.clipWarnings.push(
          `Animated conversion of ${group.name} failed (${
            error instanceof Error ? error.message : String(error)
          }); a static snapshot is used for that group.`,
        );
      }
    }
    out.push({ group, formation: groupFormation, dynamic: null, fidelityRms, fidelityStatus });
  });
  return out;
}

/**
 * True when the imported LED behaviour of the groups differs enough for the
 * lighting to be attributed to individual objects. When it does not, the caller
 * keeps scene-level lighting instead of guessing membership.
 */
function groupedLightingTargets(
  show: ReferenceShow,
  composed: readonly ComposedObject[],
  holdMid: number,
  duration: number,
): boolean {
  const time = Math.min(holdMid, duration);
  const brightness = composed.map((o) => groupBrightnessAt(show, o.group.droneIndices, time));
  const min = Math.min(...brightness);
  const max = Math.max(...brightness);
  return max - min >= LIGHTING_GROUP_BRIGHTNESS_DELTA;
}
