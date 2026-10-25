/**
 * IMPORTED SCENE -> PERSONAL LIBRARY (exact, read-only extraction).
 *
 * Turns the HOLD interval of one imported ESSP scene binding into a
 * DYNAMIC_FORMATION library asset that keeps:
 *  - the original XYZ trajectory of every source drone (EXACT_SAMPLED
 *    conversion, measured fidelity carried as provenance),
 *  - the exact recorded RGB bytes of every source drone at the source RGB clock,
 *  - source timing (hold start/end, rates) and provenance (show hash, ids).
 *
 * Never writes the ReferenceShow, its sample arrays or the binding. Never
 * infers an effect recipe: RGB is stored as recorded samples, not as an effect.
 * Changing the drone count of such an asset is NOT offered: no validated
 * mechanism exists to add or re-time exact trajectories without inventing them.
 */
import { convertReferenceSegmentToDynamicFormation } from "../conversion";
import { referenceShowHash } from "../forensics/adapter";
import type { ReferenceSceneSegment } from "../forensics/types";
import type { ReferenceShow } from "../types";
import type { ReferenceClipBinding } from "./types";
import type { DynamicFormation, SampledPointColors } from "../../../show/dynamic/types";
import { assetFromDynamicFormation } from "../../../library/serialize";
import type { FormationAsset } from "../../../library/types";

export const MIN_EXACT_SCENE_SECONDS = 0.5;

export type ExactSceneAssetError =
  "NO_DRONES" | "INTERVAL_TOO_SHORT" | "NO_RGB" | "TAKEOFF_OR_LANDING";

export interface ExactSceneAssetResult {
  readonly asset: FormationAsset | null;
  readonly error: ExactSceneAssetError | null;
  readonly fidelityRmsMeters: number | null;
}

/** Exact RGB bytes per point id over [start, end) at the source RGB clock. */
export function exactSampledColors(
  show: ReferenceShow,
  sourceDroneIds: readonly string[],
  pointIds: readonly string[],
  start: number,
  end: number,
): SampledPointColors | null {
  const rate = show.timing.rgbRateHz;
  if (!(rate > 0)) return null;
  const first = Math.max(0, Math.floor(start * rate + 1e-9));
  const last = Math.max(first, Math.ceil(end * rate - 1e-9));
  const byPoint: Record<string, number[]> = {};
  for (let i = 0; i < pointIds.length; i++) {
    const drone = show.drones.find((d) => d.sourceId === sourceDroneIds[i]);
    if (!drone || drone.rgbSampleCount < last) return null;
    byPoint[pointIds[i]!] = Array.from(drone.rgbSamples.subarray(first * 3, last * 3));
  }
  return {
    source: "ESSP_EXACT",
    rateHz: rate,
    frameCount: last - first,
    sourceStartFrame: first,
    byPoint,
  };
}

export function buildExactSceneAsset(
  show: ReferenceShow,
  binding: ReferenceClipBinding,
  input: { name: string; tags?: readonly string[]; formationId: string },
): ExactSceneAssetResult {
  const fail = (error: ExactSceneAssetError): ExactSceneAssetResult => ({
    asset: null,
    error,
    fidelityRmsMeters: null,
  });
  if (binding.kind === "TAKEOFF" || binding.kind === "LANDING") return fail("TAKEOFF_OR_LANDING");
  if (!show.drones.length) return fail("NO_DRONES");
  const start = Math.max(binding.referenceStart, binding.referenceHoldStart);
  const end = binding.referenceEnd;
  if (!(end - start >= MIN_EXACT_SCENE_SECONDS)) return fail("INTERVAL_TOO_SHORT");
  const classification = binding.sourceClassification ?? "DYNAMIC_DEFORMATION";
  const segment: ReferenceSceneSegment = {
    id: binding.sourceSegmentId ?? `binding-${binding.clipId}`,
    label: input.name,
    startTime: start,
    endTime: end,
    duration: end - start,
    classification,
    confidence: 1,
    metrics: {} as ReferenceSceneSegment["metrics"],
    periodicity: { periodic: false, estimatedPeriodSeconds: null, confidence: 0 },
    activeDroneIds: show.drones.map((d) => d.sourceId),
    clusters: [],
    inferred: true,
  };
  const proposal = convertReferenceSegmentToDynamicFormation(show, segment, {
    mode: "EXACT_SAMPLED",
    suggestMotionGroups: false,
    formationId: input.formationId,
    name: input.name,
  });
  const pointIds = proposal.formation.points.map((p) => p.id);
  const colors = exactSampledColors(show, proposal.provenance.sourceDroneIds, pointIds, start, end);
  if (!colors) return fail("NO_RGB");
  const formation: DynamicFormation = {
    ...proposal.formation,
    name: input.name,
    loop: "NONE",
    sampledColors: colors,
  };
  const asset = assetFromDynamicFormation(formation, {
    name: input.name,
    tags: [...(input.tags ?? []), "essp-exact"],
    source: "ESSP_DERIVED",
    sourceRef: {
      kind: "FILE",
      name: "imported ESSP show",
      fingerprint: referenceShowHash(show),
      params: {
        clipId: binding.clipId,
        segmentId: binding.sourceSegmentId ?? "",
        classification: binding.sourceClassification ?? "",
        holdStart: start,
        end,
        positionRateHz: show.timing.positionRateHz,
        rgbRateHz: show.timing.rgbRateHz,
        conversion: "EXACT_SAMPLED",
        fidelityRmsMeters: proposal.fidelityReport.rmsErrorMeters,
        fidelityStatus: proposal.fidelityReport.status,
        effectRecipe: "UNKNOWN",
        droneCountAdaptation: "UNAVAILABLE_VALIDATION_PENDING",
      },
    },
  });
  return { asset, error: null, fidelityRmsMeters: proposal.fidelityReport.rmsErrorMeters };
}

/** Exact recorded color of `pointId` at formation-local time; null if not sampled. */
export function sampledColorAt(
  colors: SampledPointColors | undefined,
  pointId: string,
  localTime: number,
): [number, number, number] | null {
  if (!colors || !(localTime >= 0)) return null;
  const arr = colors.byPoint[pointId];
  if (!arr || colors.frameCount <= 0) return null;
  const f = Math.min(colors.frameCount - 1, Math.floor(localTime * colors.rateHz + 1e-9));
  return [arr[f * 3]!, arr[f * 3 + 1]!, arr[f * 3 + 2]!];
}
