/**
 * TRUE SCENE DECOMPOSITION — evidence-driven grouping of ONE imported scene.
 *
 * WHAT THIS IS
 *   A pure, deterministic helper that decides whether one forensic scene segment
 *   genuinely contains SEVERAL coherent visual/motion groups. It answers exactly
 *   one question and returns the evidence for its answer:
 *
 *     SCENE_CONTAINER  one native object (static or animated) — the default
 *     COMPOSED_SCENE   several independently meaningful objects
 *
 * WHAT THIS IS NOT
 *   It is NOT a second clustering engine. Every measurement is taken from the
 *   existing forensic machinery:
 *
 *     - per-drone residuals + fleet rigid-fit series   forensics/metrics
 *     - rigid fit of a cloud onto another              forensics/rigid
 *     - the segment window in source samples           conversion/decompose
 *     - forensic motion clusters                       segment.clusters
 *
 *   The only added maths is a deterministic single-linkage partition on the
 *   SOURCE positions (used solely to propose candidate memberships) plus the
 *   acceptance statistics below. No semantic meaning is ever inferred: groups
 *   are named `Group 1`, `Moving group`, `Stable core`.
 *
 * ACCEPTANCE (all must hold, otherwise the scene stays one object)
 *   1. >= 2 candidate groups, pairwise DISJOINT drone membership
 *   2. every group has >= max(minGroupDrones, minGroupFraction * fleet) drones
 *   3. coverage of the scene's drone population >= minCoverage
 *   4. spatial separation ratio >= minSeparationRatio
 *   5. membership stability through the scene >= minMembershipStability
 *   6. combined confidence >= minConfidence
 */
import { intervalResiduals } from "../forensics/metrics";
import { rigidFitCentered } from "../forensics/rigid";
import type { PointCloudSequence, ReferenceSceneSegment } from "../forensics/types";
import { segmentWindow } from "../conversion/decompose";

export const SCENE_DECOMPOSITION_ALGORITHM_VERSION = "0.1.0";

export interface SceneDecompositionThresholds {
  /** Absolute floor for a meaningful object. */
  readonly minGroupDrones: number;
  /** Relative floor, as a fraction of the scene drone population. */
  readonly minGroupFraction: number;
  /** Link distance = factor * median nearest-neighbour distance. */
  readonly linkDistanceFactor: number;
  /** centroidDistance / (radiusA + radiusB) required between every pair. */
  readonly minSeparationRatio: number;
  /** Fraction of drones that must belong to an accepted group. */
  readonly minCoverage: number;
  /** Membership agreement required across the probe frames (0..1). */
  readonly minMembershipStability: number;
  /** Combined confidence required to accept a multi-object scene. */
  readonly minConfidence: number;
  /** Mean group residual above which the group is treated as animated (m). */
  readonly animatedResidualMeters: number;
  /** Number of frames the membership/coherence probes use. */
  readonly probeFrames: number;
}

export const SCENE_DECOMPOSITION_DEFAULTS: SceneDecompositionThresholds = {
  minGroupDrones: 6,
  minGroupFraction: 0.05,
  linkDistanceFactor: 2.2,
  minSeparationRatio: 1.35,
  minCoverage: 0.9,
  minMembershipStability: 0.9,
  minConfidence: 0.6,
  animatedResidualMeters: 0.25,
  probeFrames: 5,
};

export type SceneRepresentation = "SCENE_CONTAINER" | "COMPOSED_SCENE";
export type DecompositionSource = "FORENSIC_MOTION_CLUSTER" | "SPATIAL_SEPARATION" | "NONE";

export interface SceneDecompositionGroup {
  /** Generic id, e.g. `GROUP_1`. Never semantic. */
  readonly id: string;
  /** Generic name: `Group 1`, `Moving group 1`, `Stable core`. */
  readonly name: string;
  readonly sourceDroneIds: readonly string[];
  readonly droneIndices: readonly number[];
  readonly centroid: readonly [number, number, number];
  readonly radiusMeters: number;
  readonly meanResidualMeters: number;
  /** True when the group's own motion evidence justifies an animated object. */
  readonly animated: boolean;
}

export interface SceneDecompositionEvidence {
  readonly source: DecompositionSource;
  readonly separationRatio: number;
  readonly membershipStability: number;
  readonly coherenceGain: number;
  readonly coverage: number;
  readonly fleetRigidRmsMeters: number;
  readonly groupedRigidRmsMeters: number;
  readonly confidence: number;
  readonly reasons: readonly string[];
}

export interface SceneDecompositionProposal {
  readonly segmentId: string;
  readonly representation: SceneRepresentation;
  readonly groups: readonly SceneDecompositionGroup[];
  readonly evidence: SceneDecompositionEvidence;
  readonly algorithmVersion: string;
  readonly thresholds: SceneDecompositionThresholds;
}

/* ------------------------------------------------------------------ helpers */

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function positionAt(
  sequence: PointCloudSequence,
  frame: number,
  index: number,
): [number, number, number] {
  const o = (frame * sequence.droneCount + index) * 3;
  return [sequence.positions[o]!, sequence.positions[o + 1]!, sequence.positions[o + 2]!];
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Deterministic single-linkage partition of one frame at a link distance. */
function linkPartition(
  points: readonly [number, number, number][],
  linkDistance: number,
): number[][] {
  const n = points.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (a: number): number => {
    let r = a;
    while (parent[r]! !== r) r = parent[r]!;
    while (parent[a]! !== a) {
      const next = parent[a]!;
      parent[a] = r;
      a = next;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const limit = linkDistance * linkDistance;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = points[i]!;
      const b = points[j]!;
      const d2 = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
      if (d2 <= limit) union(i, j);
    }
  }
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const list = buckets.get(r);
    if (list) list.push(i);
    else buckets.set(r, [i]);
  }
  return [...buckets.values()]
    .sort((a, b) => b.length - a.length || a[0]! - b[0]!)
    .map((ids) => [...ids].sort((x, y) => x - y));
}

/** Median nearest-neighbour distance of one frame — the natural link scale. */
function medianNearestNeighbour(points: readonly [number, number, number][]): number {
  const n = points.length;
  const nearest: number[] = [];
  for (let i = 0; i < n; i++) {
    let best = Number.POSITIVE_INFINITY;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const a = points[i]!;
      const b = points[j]!;
      const d2 = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
      if (d2 < best) best = d2;
    }
    if (Number.isFinite(best)) nearest.push(Math.sqrt(best));
  }
  return median(nearest);
}

function centroidOf(
  points: readonly [number, number, number][],
  members: readonly number[],
): [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const i of members) {
    const p = points[i]!;
    x += p[0];
    y += p[1];
    z += p[2];
  }
  const k = Math.max(1, members.length);
  return [x / k, y / k, z / k];
}

/** RMS radius of a member set about its own centroid. */
function radiusOf(
  points: readonly [number, number, number][],
  members: readonly number[],
  centroid: readonly [number, number, number],
): number {
  let sq = 0;
  for (const i of members) {
    const p = points[i]!;
    sq += (p[0] - centroid[0]) ** 2 + (p[1] - centroid[1]) ** 2 + (p[2] - centroid[2]) ** 2;
  }
  return Math.sqrt(sq / Math.max(1, members.length));
}

/** Centred cloud of a member subset at one frame, for the forensic rigid fit. */
function centeredSubset(
  sequence: PointCloudSequence,
  frame: number,
  members: readonly number[],
): Float64Array {
  const out = new Float64Array(members.length * 3);
  let cx = 0;
  let cy = 0;
  let cz = 0;
  members.forEach((index, k) => {
    const p = positionAt(sequence, frame, index);
    out[k * 3] = p[0];
    out[k * 3 + 1] = p[1];
    out[k * 3 + 2] = p[2];
    cx += p[0];
    cy += p[1];
    cz += p[2];
  });
  const n = Math.max(1, members.length);
  cx /= n;
  cy /= n;
  cz /= n;
  for (let k = 0; k < members.length; k++) {
    out[k * 3] = out[k * 3]! - cx;
    out[k * 3 + 1] = out[k * 3 + 1]! - cy;
    out[k * 3 + 2] = out[k * 3 + 2]! - cz;
  }
  return out;
}

function probeFrames(first: number, last: number, count: number): number[] {
  if (last <= first) return [first];
  const k = Math.max(2, count);
  const out: number[] = [];
  for (let i = 0; i < k; i++) {
    const frame = Math.round(first + ((last - first) * i) / (k - 1));
    if (out[out.length - 1] !== frame) out.push(frame);
  }
  return out;
}

/** Agreement between two partitions of the same index set (0..1). */
function partitionAgreement(a: number[][], b: number[][], n: number): number {
  if (n === 0) return 1;
  let matched = 0;
  for (const group of a) {
    const set = new Set(group);
    let best = 0;
    for (const other of b) {
      let overlap = 0;
      for (const i of other) if (set.has(i)) overlap++;
      if (overlap > best) best = overlap;
    }
    matched += best;
  }
  return clamp01(matched / n);
}

/* ------------------------------------------------------------- the analysis */

interface Candidate {
  readonly source: DecompositionSource;
  readonly members: number[][];
}

function forensicClusterCandidate(
  segment: ReferenceSceneSegment,
  sequence: PointCloudSequence,
): Candidate | null {
  if (segment.clusters.length < 2) return null;
  const indexById = new Map<string, number>();
  sequence.droneIds.forEach((id, i) => indexById.set(id, i));
  const members: number[][] = [];
  const used = new Set<number>();
  for (const cluster of segment.clusters) {
    const ids: number[] = [];
    for (const droneId of cluster.droneIds) {
      const index = indexById.get(droneId);
      if (index === undefined || used.has(index)) continue;
      used.add(index);
      ids.push(index);
    }
    if (ids.length) members.push(ids.sort((a, b) => a - b));
  }
  return members.length >= 2 ? { source: "FORENSIC_MOTION_CLUSTER", members } : null;
}

function spatialCandidate(
  sequence: PointCloudSequence,
  midFrame: number,
  thresholds: SceneDecompositionThresholds,
): Candidate | null {
  const points = Array.from({ length: sequence.droneCount }, (_, i) =>
    positionAt(sequence, midFrame, i),
  );
  const scale = medianNearestNeighbour(points);
  if (scale <= 0) return null;
  const members = linkPartition(points, scale * thresholds.linkDistanceFactor);
  return members.length >= 2 ? { source: "SPATIAL_SEPARATION", members } : null;
}

interface Evaluation {
  readonly accepted: boolean;
  readonly groups: SceneDecompositionGroup[];
  readonly evidence: SceneDecompositionEvidence;
}

function evaluate(
  candidate: Candidate,
  sequence: PointCloudSequence,
  frames: number[],
  residualMean: readonly number[],
  fleetRigidRms: number,
  thresholds: SceneDecompositionThresholds,
): Evaluation {
  const reasons: string[] = [];
  const n = sequence.droneCount;
  const midFrame = frames[Math.floor(frames.length / 2)]!;
  const points = Array.from({ length: n }, (_, i) => positionAt(sequence, midFrame, i));
  const minSize = Math.max(
    thresholds.minGroupDrones,
    Math.ceil(thresholds.minGroupFraction * n),
  );

  // 1 + 2: disjoint membership, meaningful sizes.
  const seen = new Set<number>();
  let disjoint = true;
  for (const group of candidate.members) {
    for (const i of group) {
      if (seen.has(i)) disjoint = false;
      seen.add(i);
    }
  }
  const kept = candidate.members.filter((g) => g.length >= minSize);
  const coverage = n ? kept.reduce((s, g) => s + g.length, 0) / n : 0;
  if (!disjoint) reasons.push("Candidate groups share drones; membership is not disjoint.");
  if (kept.length < 2) {
    reasons.push(
      `Only ${kept.length} candidate group(s) reach the minimum of ${minSize} drones.`,
    );
  }
  if (coverage < thresholds.minCoverage) {
    reasons.push(
      `Accepted groups cover ${(coverage * 100).toFixed(0)}% of the drones (minimum ${(
        thresholds.minCoverage * 100
      ).toFixed(0)}%).`,
    );
  }

  // 4: pairwise spatial separation at the middle of the scene.
  const centroids = kept.map((g) => centroidOf(points, g));
  const radii = kept.map((g, i) => radiusOf(points, g, centroids[i]!));
  let separationRatio = Number.POSITIVE_INFINITY;
  for (let a = 0; a < kept.length; a++) {
    for (let b = a + 1; b < kept.length; b++) {
      const ca = centroids[a]!;
      const cb = centroids[b]!;
      const distance = Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]);
      const extent = radii[a]! + radii[b]!;
      const ratio = extent > 1e-6 ? distance / extent : Number.POSITIVE_INFINITY;
      if (ratio < separationRatio) separationRatio = ratio;
    }
  }
  if (!Number.isFinite(separationRatio)) separationRatio = 0;
  if (kept.length >= 2 && separationRatio < thresholds.minSeparationRatio) {
    reasons.push(
      `Spatial separation ratio ${separationRatio.toFixed(2)} is below ${thresholds.minSeparationRatio}; the groups overlap too much to be separate objects.`,
    );
  }

  // 5: does the membership survive the whole scene?
  let stability = 1;
  if (candidate.source === "SPATIAL_SEPARATION") {
    for (const frame of frames) {
      const framePoints = Array.from({ length: n }, (_, i) => positionAt(sequence, frame, i));
      const scale = medianNearestNeighbour(framePoints);
      if (scale <= 0) continue;
      const partition = linkPartition(framePoints, scale * thresholds.linkDistanceFactor);
      stability = Math.min(stability, partitionAgreement(kept, partition, n));
    }
  } else {
    // Forensic clusters are residual-derived: membership is defined once for the
    // whole segment, so it is stable by construction.
    reasons.push("Membership comes from the forensic motion clusters of the whole segment.");
  }
  if (stability < thresholds.minMembershipStability) {
    reasons.push(
      `Group membership only agrees ${(stability * 100).toFixed(0)}% through the scene (minimum ${(
        thresholds.minMembershipStability * 100
      ).toFixed(0)}%).`,
    );
  }

  // 6: does per-group rigid motion explain the scene better than one fit?
  let groupedRms = 0;
  let weight = 0;
  for (const group of kept) {
    if (group.length < 3) continue;
    const reference = centeredSubset(sequence, frames[0]!, group);
    let sum = 0;
    let count = 0;
    for (const frame of frames) {
      sum += rigidFitCentered(reference, centeredSubset(sequence, frame, group)).rmsError;
      count++;
    }
    if (count) {
      groupedRms += (sum / count) * group.length;
      weight += group.length;
    }
  }
  groupedRms = weight ? groupedRms / weight : 0;
  const informative = fleetRigidRms > 0.05;
  const coherenceGain = informative ? clamp01(1 - groupedRms / fleetRigidRms) : 0;
  if (!informative) {
    reasons.push(
      "The scene is rigid at fleet level, so per-group motion coherence carries no extra evidence; separation and stability decide.",
    );
  }

  const separationScore = clamp01((separationRatio - 1) / 1.5);
  const coherenceScore = informative ? clamp01(coherenceGain / 0.5) : 0.5;
  const confidence =
    kept.length >= 2 && disjoint
      ? clamp01(0.55 * separationScore + 0.25 * stability + 0.2 * coherenceScore)
      : 0;

  const accepted =
    disjoint &&
    kept.length >= 2 &&
    coverage >= thresholds.minCoverage &&
    separationRatio >= thresholds.minSeparationRatio &&
    stability >= thresholds.minMembershipStability &&
    confidence >= thresholds.minConfidence;

  if (accepted) {
    reasons.unshift(
      `${kept.length} coherent groups: separation ${separationRatio.toFixed(
        2,
      )}, membership stability ${(stability * 100).toFixed(0)}%, coherence gain ${(
        coherenceGain * 100
      ).toFixed(0)}%.`,
    );
  } else if (confidence < thresholds.minConfidence) {
    reasons.push(
      `Combined confidence ${confidence.toFixed(2)} is below ${thresholds.minConfidence}.`,
    );
  }

  const movingGroups = kept.filter(
    (g) => groupResidual(g, residualMean) > thresholds.animatedResidualMeters,
  ).length;
  const groups: SceneDecompositionGroup[] = kept.map((group, index) => {
    const residual = groupResidual(group, residualMean);
    const animated = residual > thresholds.animatedResidualMeters;
    return {
      id: `GROUP_${index + 1}`,
      name: groupName(index, animated, movingGroups, kept.length),
      sourceDroneIds: group.map((i) => sequence.droneIds[i] ?? `SRC-${i + 1}`),
      droneIndices: group,
      centroid: centroids[index]!,
      radiusMeters: radii[index]!,
      meanResidualMeters: residual,
      animated,
    };
  });

  return {
    accepted,
    groups,
    evidence: {
      source: candidate.source,
      separationRatio,
      membershipStability: stability,
      coherenceGain,
      coverage,
      fleetRigidRmsMeters: fleetRigidRms,
      groupedRigidRmsMeters: groupedRms,
      confidence,
      reasons,
    },
  };
}

function groupResidual(group: readonly number[], residualMean: readonly number[]): number {
  if (!group.length) return 0;
  let sum = 0;
  for (const i of group) sum += residualMean[i] ?? 0;
  return sum / group.length;
}

/** Generic, non-semantic naming. Never "wing", never "head". */
function groupName(index: number, animated: boolean, moving: number, total: number): string {
  if (moving > 0 && moving < total) return animated ? `Moving group ${index + 1}` : "Stable core";
  return `Group ${index + 1}`;
}

/**
 * Decides how one scene segment should be represented. The reference show and
 * the forensic report are only read.
 */
export function proposeSceneDecomposition(
  sequence: PointCloudSequence,
  segment: ReferenceSceneSegment,
  thresholds: SceneDecompositionThresholds = SCENE_DECOMPOSITION_DEFAULTS,
): SceneDecompositionProposal {
  const window = segmentWindow(sequence, segment.startTime, segment.endTime);
  const frames = probeFrames(window.firstIndex, window.lastIndex, thresholds.probeFrames);
  const stride = Math.max(1, Math.round((window.lastIndex - window.firstIndex) / 240));
  const residuals = intervalResiduals(sequence, window.firstIndex, window.lastIndex, stride);
  const fleetRigidRms = residuals.rmsSeries.length
    ? residuals.rmsSeries.reduce((a, b) => a + b, 0) / residuals.rmsSeries.length
    : 0;

  const candidates: Candidate[] = [];
  const forensic = forensicClusterCandidate(segment, sequence);
  if (forensic) candidates.push(forensic);
  const spatial = spatialCandidate(sequence, frames[Math.floor(frames.length / 2)]!, thresholds);
  if (spatial) candidates.push(spatial);

  let best: Evaluation | null = null;
  for (const candidate of candidates) {
    const evaluation = evaluate(
      candidate,
      sequence,
      frames,
      residuals.mean,
      fleetRigidRms,
      thresholds,
    );
    if (!best) best = evaluation;
    else if (evaluation.accepted && !best.accepted) best = evaluation;
    else if (
      evaluation.accepted === best.accepted &&
      evaluation.evidence.confidence > best.evidence.confidence
    ) {
      best = evaluation;
    }
  }

  if (!best) {
    return {
      segmentId: segment.id,
      representation: "SCENE_CONTAINER",
      groups: [],
      evidence: {
        source: "NONE",
        separationRatio: 0,
        membershipStability: 0,
        coherenceGain: 0,
        coverage: 0,
        fleetRigidRmsMeters: fleetRigidRms,
        groupedRigidRmsMeters: 0,
        confidence: 0,
        reasons: [
          "No candidate grouping was found: neither forensic motion clusters nor spatial separation split this scene.",
        ],
      },
      algorithmVersion: SCENE_DECOMPOSITION_ALGORITHM_VERSION,
      thresholds,
    };
  }

  return {
    segmentId: segment.id,
    representation: best.accepted ? "COMPOSED_SCENE" : "SCENE_CONTAINER",
    groups: best.accepted ? best.groups : [],
    evidence: best.evidence,
    algorithmVersion: SCENE_DECOMPOSITION_ALGORITHM_VERSION,
    thresholds,
  };
}
