/**
 * AUDIENCE PROJECTION ANALYSIS — READ ONLY.
 *
 * A drone formation is a 3D point cloud, while the audience judges its apparent
 * 2D silhouette from a viewing position. This module measures that projection
 * without changing the authored geometry. It is deliberately NOT a planner,
 * safety rule, camera controller or export input.
 *
 * MODEL
 *   - `viewer` is the audience eye / representative viewing point in world space.
 *   - `target` is the centre of the authored image / point of regard.
 *   - the projection plane passes through `target` and is perpendicular to the
 *     viewer -> target direction.
 *   - perspective coordinates are the ray/plane intersection of viewer -> point.
 *   - orthographic coordinates are the same point expressed on the target-plane
 *     right/up basis, ignoring depth.
 *
 * Comparing perspective vs orthographic coordinates quantifies how much depth
 * changes the apparent artwork. The model is intentionally explicit: it makes no
 * claim about the real audience location until the operator supplies one.
 */
import type { Vector3Tuple } from "../types";

const EPS = 1e-9;

type Vec3 = readonly [number, number, number];

export interface AudienceView {
  readonly viewer: Vector3Tuple;
  readonly target: Vector3Tuple;
  /** World-space visual up. Defaults to +Y. Must not be parallel to view direction. */
  readonly up?: Vector3Tuple;
}

export interface AudienceProjectedPoint {
  readonly index: number;
  /** Perspective image-plane coordinate in metres on the target plane. */
  readonly perspective: readonly [number, number];
  /** Orthographic target-plane coordinate, i.e. authored apparent coordinate with depth ignored. */
  readonly orthographic: readonly [number, number];
  /** Signed distance from viewer along the view axis, metres. */
  readonly distanceAlongView: number;
  /** targetDistance / distanceAlongView. 1.0 exactly on target plane. */
  readonly perspectiveScale: number;
  /** 2D displacement between perspective and orthographic image positions, metres. */
  readonly apparentDeviation: number;
}

export interface AudienceProjectionReport {
  readonly pointCount: number;
  readonly projectedCount: number;
  readonly invalidCount: number;
  readonly targetDistance: number;
  readonly viewDirection: Vector3Tuple;
  readonly rightDirection: Vector3Tuple;
  readonly upDirection: Vector3Tuple;
  readonly depthExtent: number;
  readonly minPerspectiveScale: number;
  readonly maxPerspectiveScale: number;
  readonly meanApparentDeviation: number;
  readonly rmsApparentDeviation: number;
  readonly maxApparentDeviation: number;
  readonly maxDeviationIndex: number | null;
  readonly perspectiveExtent: readonly [number, number];
  readonly orthographicExtent: readonly [number, number];
  readonly points: readonly AudienceProjectedPoint[];
  readonly note: string;
}

export class AudienceProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudienceProjectionError";
  }
}

const sub = (a: Vec3, b: Vec3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: Vec3, s: number): [number, number, number] => [a[0] * s, a[1] * s, a[2] * s];

function finitePoint(p: Vec3): boolean {
  return Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]);
}

function normalized(v: Vec3, label: string): [number, number, number] {
  const n = length(v);
  if (!Number.isFinite(n) || n <= EPS) throw new AudienceProjectionError(`${label} has zero/invalid length`);
  return scale(v, 1 / n);
}

/** Builds a stable right/up/forward camera basis from an explicit audience view. */
export function audienceViewBasis(view: AudienceView): {
  readonly forward: Vector3Tuple;
  readonly right: Vector3Tuple;
  readonly up: Vector3Tuple;
  readonly targetDistance: number;
} {
  if (!finitePoint(view.viewer) || !finitePoint(view.target)) {
    throw new AudienceProjectionError("viewer and target must contain finite coordinates");
  }
  const delta = sub(view.target, view.viewer);
  const targetDistance = length(delta);
  if (targetDistance <= EPS) throw new AudienceProjectionError("viewer and target must be different points");
  const forward = normalized(delta, "view direction");
  const upHint = view.up ?? ([0, 1, 0] as const);
  if (!finitePoint(upHint)) throw new AudienceProjectionError("up vector must contain finite coordinates");

  // right = up x forward: for viewer south of +Z target, +X remains screen-right.
  const rightRaw = cross(upHint, forward);
  if (length(rightRaw) <= EPS) {
    throw new AudienceProjectionError("up vector must not be parallel to the viewer-target direction");
  }
  const right = normalized(rightRaw, "right direction");
  const up = normalized(cross(forward, right), "camera up direction");
  return { forward, right, up, targetDistance };
}

/**
 * Projects a world point onto the audience target plane.
 * Returns null for a point at/behind the viewer because a forward audience image
 * is undefined there.
 */
export function projectPointForAudience(
  point: Vector3Tuple,
  view: AudienceView,
): AudienceProjectedPoint | null {
  const basis = audienceViewBasis(view);
  return projectPointWithBasis(point, view, basis, 0);
}

function projectPointWithBasis(
  point: Vector3Tuple,
  view: AudienceView,
  basis: ReturnType<typeof audienceViewBasis>,
  index: number,
): AudienceProjectedPoint | null {
  if (!finitePoint(point)) return null;
  const fromViewer = sub(point, view.viewer);
  const distanceAlongView = dot(fromViewer, basis.forward);
  if (distanceAlongView <= EPS) return null;

  const scaleFactor = basis.targetDistance / distanceAlongView;
  const screenXFromViewer = dot(fromViewer, basis.right);
  const screenYFromViewer = dot(fromViewer, basis.up);
  const perspective: [number, number] = [
    screenXFromViewer * scaleFactor,
    screenYFromViewer * scaleFactor,
  ];

  const fromTarget = sub(point, view.target);
  const orthographic: [number, number] = [dot(fromTarget, basis.right), dot(fromTarget, basis.up)];
  const apparentDeviation = Math.hypot(
    perspective[0] - orthographic[0],
    perspective[1] - orthographic[1],
  );

  return {
    index,
    perspective,
    orthographic,
    distanceAlongView,
    perspectiveScale: scaleFactor,
    apparentDeviation,
  };
}

function extent2(points: readonly (readonly [number, number])[]): [number, number] {
  if (!points.length) return [0, 0];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  return [maxX - minX, maxY - minY];
}

/**
 * Measures perspective distortion of a 3D point cloud from an explicit audience
 * position. Input is never mutated and output ordering follows input ordering.
 */
export function analyzeAudienceProjection(
  points: readonly Vector3Tuple[],
  view: AudienceView,
): AudienceProjectionReport {
  const basis = audienceViewBasis(view);
  const projected: AudienceProjectedPoint[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const result = projectPointWithBasis(points[i]!, view, basis, i);
    if (result) projected.push(result);
  }

  let minDepth = Infinity;
  let maxDepth = -Infinity;
  let minScale = Infinity;
  let maxScale = -Infinity;
  let sumDeviation = 0;
  let sumDeviation2 = 0;
  let maxDeviation = 0;
  let maxDeviationIndex: number | null = null;

  for (const p of projected) {
    minDepth = Math.min(minDepth, p.distanceAlongView);
    maxDepth = Math.max(maxDepth, p.distanceAlongView);
    minScale = Math.min(minScale, p.perspectiveScale);
    maxScale = Math.max(maxScale, p.perspectiveScale);
    sumDeviation += p.apparentDeviation;
    sumDeviation2 += p.apparentDeviation * p.apparentDeviation;
    if (p.apparentDeviation > maxDeviation) {
      maxDeviation = p.apparentDeviation;
      maxDeviationIndex = p.index;
    }
  }

  const n = projected.length;
  return {
    pointCount: points.length,
    projectedCount: n,
    invalidCount: points.length - n,
    targetDistance: basis.targetDistance,
    viewDirection: basis.forward,
    rightDirection: basis.right,
    upDirection: basis.up,
    depthExtent: n ? maxDepth - minDepth : 0,
    minPerspectiveScale: n ? minScale : 0,
    maxPerspectiveScale: n ? maxScale : 0,
    meanApparentDeviation: n ? sumDeviation / n : 0,
    rmsApparentDeviation: n ? Math.sqrt(sumDeviation2 / n) : 0,
    maxApparentDeviation: maxDeviation,
    maxDeviationIndex,
    perspectiveExtent: extent2(projected.map((p) => p.perspective)),
    orthographicExtent: extent2(projected.map((p) => p.orthographic)),
    points: projected,
    note:
      "READ-ONLY perspective diagnostic. Results depend on the supplied audience position and do not imply safety, optimal tilt or certified viewing geometry.",
  };
}
