/**
 * Deterministic analysis revision id.
 *
 * Two analyses of the same project + settings produce the same revision, and
 * ANY change that can alter geometry, timing, limits, deconfliction or validated
 * machine-facing output changes it. The UI compares the live revision to the
 * report revision to decide whether a report is stale — nothing is ever guessed
 * from timestamps.
 */
import type { ReferenceTrajectoryLayer } from "../../import/essp/native/types";
import type { ClipTransitionOverride } from "../trajectory/schedule";
import type { ShowProject } from "../types";

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export interface RevisionInputs {
  readonly sampleRate: number;
  readonly assignmentStrategy: string;
  readonly transitionOverrides?: Readonly<Record<string, ClipTransitionOverride>>;
  /**
   * Imported ESSP authority. Ownership decides WHICH samples are validated and
   * exported, so any change of the layer identity or of a clip's ownership must
   * make an existing report stale.
   */
  readonly referenceLayer?: ReferenceTrajectoryLayer | null;
}

/** Stable, order-independent digest of everything the analysis depends on. */
export function computeAnalysisRevision(project: ShowProject, inputs: RevisionInputs): string {
  const clips = [...project.timeline]
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
    .map((c) =>
      [
        c.id,
        c.formationId,
        c.phase ?? "SHOW",
        round(c.start),
        round(c.transition),
        round(c.hold),
        c.easing,
        c.effect,
        c.color.join(","),
        c.dynamicFormationId ?? "",
        round(c.playbackRate ?? 1),
        round(c.dynamicStartOffset ?? 0),
      ].join("|"),
    );
  const formations = [...project.formations]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((f) =>
      [
        f.id,
        f.kind,
        f.points.length,
        // Point geometry digest keeps the revision small but sensitive.
        fnv1a(f.points.map((p) => p.map(round).join(",")).join(";")),
      ].join("|"),
    );
  // Dynamic formations change geometry over time: base cloud, global track and
  // every motion group must all invalidate the analysis.
  const dynamics = [...(project.dynamicFormations ?? [])]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((d) =>
      [
        d.id,
        d.points.length,
        round(d.duration),
        d.loop,
        d.seed,
        d.algorithmVersion,
        d.pivot.map(round).join(","),
        fnv1a(d.points.map((p) => `${p.id}:${p.base.map(round).join(",")}`).join(";")),
        fnv1a(JSON.stringify(d.transform)),
        fnv1a(JSON.stringify(d.groups)),
      ].join("|"),
    );
  // Scene transforms, object budgets and source assignments directly alter the
  // composed fleet geometry. Sort by id so container order alone is irrelevant.
  const scenes = [...(project.scenes ?? [])]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((scene) => `${scene.id}:${fnv1a(JSON.stringify(scene))}`);
  // Lighting does not move drones, but it is validated by the full-show pass and
  // is part of machine-facing show output. A lighting edit must therefore make
  // the previous validation report stale before computed export is allowed.
  const lighting = fnv1a(JSON.stringify(project.lighting ?? null));
  const overrides = Object.entries(inputs.transitionOverrides ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([clipId, o]) =>
        `${clipId}:${o.strategy}:${fnv1a(
          [
            o.targetPointIndex.join(","),
            o.startOffsets.map(round).join(","),
            o.laneOffsets.map(round).join(","),
            o.boundarySourcePositions?.map((p) => p.map(round).join(",")).join(";") ?? "-",
            o.boundaryTargetPositions?.map((p) => p.map(round).join(",")).join(";") ?? "-",
            o.boundarySourceVelocities?.map((p) => p.map(round).join(",")).join(";") ?? "-",
            o.boundaryTargetVelocities?.map((p) => p.map(round).join(",")).join(";") ?? "-",
          ].join("|"),
        )}`,
    );

  // The imported layer is part of the flown output: identity of the archive,
  // its clocks and per-clip ownership all change the effective trajectory.
  const layer = inputs.referenceLayer ?? null;
  const reference = layer
    ? [
        layer.showHash,
        round(layer.positionRateHz),
        round(layer.rgbRateHz),
        round(layer.metersPerUnit),
        fnv1a(JSON.stringify(layer.axisMapping)),
        fnv1a(
          [...layer.bindings]
            .sort((a, b) => a.order - b.order || a.clipId.localeCompare(b.clipId))
            .map((b) =>
              [
                b.clipId,
                b.order,
                b.owner,
                b.signature,
                round(b.referenceStart),
                round(b.referenceHoldStart),
                round(b.referenceEnd),
              ].join("|"),
            )
            .join(";"),
        ),
      ].join("|")
    : "none";

  const payload = [
    project.id,
    project.droneCount,
    project.seed,
    JSON.stringify(project.area),
    JSON.stringify(project.limits),
    JSON.stringify(project.altitudes),
    JSON.stringify(project.versions),
    // Any launch/staging/grouping change invalidates the analysis.
    `ps=${JSON.stringify(project.preShow ?? null)}`,
    // Participation settings change WHICH drones fly the image and where the
    // remaining fleet goes, so they invalidate the whole analysis.
    `pa=${JSON.stringify(project.participation ?? null)}`,
    `li=${lighting}`,
    `sr=${inputs.sampleRate}`,
    `as=${inputs.assignmentStrategy}`,
    `ref=${reference}`,
    clips.join("~"),
    formations.join("~"),
    dynamics.join("~"),
    scenes.join("~"),
    overrides.join("~"),
  ].join("#");

  return `rev-${fnv1a(payload)}-${fnv1a(payload.split("").reverse().join(""))}`;
}

/** Identifier of the validated show package (revision + engine version). */
export function showPackageId(revision: string, engineVersion: string): string {
  return `${revision}@${engineVersion}`;
}
