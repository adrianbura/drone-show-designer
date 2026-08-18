/**
 * Deterministic participation revision.
 *
 * Because SMART_PREPARE reads FUTURE scenes, the revision includes the
 * look-ahead context: editing the NEXT formation changes the CURRENT scene's
 * reserve plan, so an old plan can never look current.
 */
import type { Vector3Tuple } from "../types";
import type { ParticipationCostWeights } from "./cost";
import type {
  ManualParticipationOverride,
  ParticipationPolicy,
  ReserveLightingPolicy,
  ReserveZoneConfig,
} from "./types";

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const r = (n: number) => Math.round(n * 1e4) / 1e4;

function pointsDigest(points: readonly Vector3Tuple[]): string {
  return `${points.length}:${fnv1a(points.map((p) => p.map(r).join(",")).join(";"))}`;
}

export interface ParticipationRevisionInputs {
  readonly clipId: string;
  readonly fleetSize: number;
  readonly policy: ParticipationPolicy;
  readonly current: readonly Vector3Tuple[];
  readonly scenePoints: readonly Vector3Tuple[];
  readonly lookAhead: readonly { readonly clipId: string; readonly points: readonly Vector3Tuple[] }[];
  readonly reserveZone: ReserveZoneConfig;
  readonly reserveLighting: ReserveLightingPolicy;
  readonly weights: ParticipationCostWeights;
  readonly manual?: ManualParticipationOverride | undefined;
  readonly previousActiveIds?: readonly string[] | undefined;
  readonly algorithmVersion: string;
  readonly costModelVersion: string;
}

export function computeParticipationRevision(inputs: ParticipationRevisionInputs): string {
  const payload = [
    inputs.clipId,
    inputs.fleetSize,
    inputs.policy,
    pointsDigest(inputs.current),
    pointsDigest(inputs.scenePoints),
    inputs.lookAhead.map((s) => `${s.clipId}=${pointsDigest(s.points)}`).join("~"),
    JSON.stringify(inputs.reserveZone),
    inputs.reserveLighting,
    JSON.stringify(inputs.weights),
    inputs.manual
      ? fnv1a(
          [
            [...inputs.manual.activeDroneIds].sort().join(","),
            [...(inputs.manual.holdDroneIds ?? [])].sort().join(","),
            [...(inputs.manual.reserveDroneIds ?? [])].sort().join(","),
          ].join("|"),
        )
      : "-",
    inputs.previousActiveIds ? fnv1a([...inputs.previousActiveIds].sort().join(",")) : "-",
    inputs.algorithmVersion,
    inputs.costModelVersion,
  ].join("#");
  return `par-${fnv1a(payload)}`;
}
