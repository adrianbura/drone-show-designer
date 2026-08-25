/**
 * FLIGHT-OUTPUT SIGNATURE of one timeline clip.
 *
 * Promotion of a reference-owned interval must be SEMANTIC, not incidental:
 * only an edit that changes what the drones would actually do — geometry,
 * motion, timing, participation, assignment/planning or LED output — may
 * promote an interval. Anything an editor changes for the human (selection,
 * zoom, names, labels, tags, markers, notes, favourites, saving) must not.
 *
 * The signature therefore hashes ONLY output-relevant inputs:
 *
 *   geometry   canonical resolved clip target (base formation points, composed
 *              scene objects and transforms, dynamic entry state) via the SAME
 *              resolver the scheduler uses, so the signature can never disagree
 *              with the planner about what the clip is
 *   motion     the animated dynamic formation content (keyframes, groups,
 *              pivot, duration), playback rate and start offset
 *   timing     phase, start, transition, hold, easing
 *   fleet      drone count and the safety limits that shape every trajectory
 *   planning   assignment strategy (transition overrides are interval-local and
 *              must not promote an otherwise unchanged reference HOLD)
 *   people     per-clip and global fleet participation settings
 *   lighting   clip base colour/effect and every lighting effect targeting it
 *
 * Explicitly EXCLUDED: project/formation/clip names, markers, music sections,
 * audio metadata, area, editor preferences, library assets, forensic reports.
 */
import { buildDroneDefinitions } from "../../../show/drones";
import { resolveParticipationSettings } from "../../../show/participation";
import type { ClipTransitionOverride } from "../../../show/trajectory/schedule";
import { canonicalClipTarget } from "../../../show/trajectory/target";
import {
  clipPhase,
  resolveDynamicFormation,
  type ShowProject,
  type TimelineClip,
  type Vector3Tuple,
} from "../../../show/types";
import { dynamicFormationSignature } from "../conversion/convert";

export interface ClipSignatureContext {
  readonly assignmentStrategy: string;
  readonly transitionOverrides: Readonly<Record<string, ClipTransitionOverride>>;
}

function q(value: number): string {
  return Number.isFinite(value) ? Number(value.toFixed(4)).toFixed(4) : "0.0000";
}

function quantizePoints(points: readonly Vector3Tuple[]): string {
  return points.map((p) => `${q(p[0])},${q(p[1])},${q(p[2])}`).join(";");
}

/** FNV-1a over the canonical signature string (compact, deterministic). */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i) & 0xff;
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function lightingSignature(project: ShowProject, clipId: string): string {
  const effects = (project.lighting?.effects ?? [])
    .filter((e) => e.target.clipId === clipId)
    .map((e) =>
      [
        e.type,
        e.anchor,
        q(e.start),
        q(e.duration),
        e.blendMode,
        e.priority,
        e.enabled ? "1" : "0",
        e.target.kind,
        JSON.stringify(e.parameters ?? {}),
      ].join("~"),
    )
    .sort();
  return effects.length ? fnv1a(effects.join("|")) : "-";
}

function participationSignature(project: ShowProject, clipId: string): string {
  const settings = resolveParticipationSettings(project.participation) as unknown as Record<
    string,
    unknown
  > & { clips?: Record<string, unknown> };
  const { clips, ...global } = settings;
  return fnv1a(JSON.stringify({ global, clip: clips?.[clipId] ?? null }));
}

function geometrySignature(project: ShowProject, clip: TimelineClip): string {
  const home = buildDroneDefinitions(project).map((d) => d.homePosition);
  try {
    const resolved = canonicalClipTarget(project, clip, home);
    return [
      resolved.kind,
      resolved.dynamicFormationId ?? "-",
      resolved.rawTarget.length,
      fnv1a(quantizePoints(resolved.rawTarget)),
    ].join("~");
  } catch {
    // A clip whose geometry cannot be resolved still needs a stable signature:
    // fall back to the stored formation points instead of pretending nothing
    // changed.
    const points = project.formations.find((f) => f.id === clip.formationId)?.points ?? [];
    return ["unresolved", "-", points.length, fnv1a(quantizePoints(points))].join("~");
  }
}

/**
 * Signature of everything about clip `clipId` that changes flight or LED output.
 * Returns null when the clip no longer exists.
 */
export function clipOutputSignature(
  project: ShowProject,
  clipId: string,
  context: ClipSignatureContext,
): string | null {
  const clip = project.timeline.find((c) => c.id === clipId);
  if (!clip) return null;
  const dynamic = resolveDynamicFormation(project, clip);
  const parts = [
    "v1",
    clipPhase(clip),
    q(clip.start),
    q(clip.transition),
    q(clip.hold),
    clip.easing,
    q(clip.playbackRate ?? 1),
    q(clip.dynamicStartOffset ?? 0),
    clip.color.join(","),
    clip.effect,
    project.droneCount,
    geometrySignature(project, clip),
    dynamic ? dynamicFormationSignature(dynamic) : "-",
    q(project.limits.maxVelocity),
    q(project.limits.maxAcceleration),
    q(project.limits.maxJerk),
    q(project.limits.maxYawRate),
    q(project.limits.minSeparation),
    q(project.limits.minAltitude),
    q(project.limits.maxAltitude),
    q(project.altitudes.takeoff),
    q(project.altitudes.show),
    q(project.altitudes.landing),
    project.preShow?.enabled ? "preshow" : "no-preshow",
    context.assignmentStrategy,
    participationSignature(project, clipId),
    lightingSignature(project, clipId),
  ];
  return fnv1a(parts.join("|"));
}
