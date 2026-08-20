/**
 * AUDIENCE PREVIEW PRESENTATION — pure, read-only mapping helpers.
 *
 * These helpers turn an explicit diagnostic viewpoint into the canonical
 * `AudienceView` consumed by `analyzeAudienceProjection`, and map that analyzer
 * output into normalised 2D preview coordinates. They contain NO perspective
 * math of their own: every projected coordinate comes from the analyzer.
 *
 * Nothing here plans, mutates, tilts or corrects geometry.
 */
import type { AudienceProjectionReport, AudienceView } from "./audienceProjection";

/** Operator-facing viewpoint parameters, in Studio world metres. */
export interface AudienceViewpointParams {
  /** Audience standing distance in front of the image centre (along -Z). */
  readonly viewerDistanceMeters: number;
  /** Audience eye height above ground. */
  readonly viewerHeightMeters: number;
  /** Audience lateral offset from the image centre (+X = viewer's right). */
  readonly viewerOffsetXMeters: number;
  /** Image centre / point of regard height. */
  readonly targetHeightMeters: number;
  /** Image centre lateral offset. */
  readonly targetOffsetXMeters: number;
}

/**
 * DESIGN-PREVIEW DEFAULTS ONLY — a representative viewpoint for judging
 * apparent geometry. These are not a certified or surveyed audience position.
 */
export const AUDIENCE_VIEWPOINT_DEFAULTS: AudienceViewpointParams = {
  viewerDistanceMeters: 150,
  viewerHeightMeters: 1.7,
  viewerOffsetXMeters: 0,
  targetHeightMeters: 60,
  targetOffsetXMeters: 0,
};

export const AUDIENCE_VIEWPOINT_NOTE =
  "REPRESENTATIVE VIEWPOINT — DIAGNOSTIC ONLY. Not a surveyed or certified audience placement.";

export type AudiencePreviewMode = "ORTHOGRAPHIC" | "PERSPECTIVE" | "OVERLAY";

/**
 * Maps operator parameters to a canonical audience view in world coordinates.
 * The audience stands on the -Z side and looks toward +Z; +Y stays world up.
 */
export function resolveAudienceView(params: AudienceViewpointParams): AudienceView {
  return {
    viewer: [
      params.viewerOffsetXMeters,
      params.viewerHeightMeters,
      -Math.abs(params.viewerDistanceMeters),
    ],
    target: [params.targetOffsetXMeters, params.targetHeightMeters, 0],
    up: [0, 1, 0],
  };
}

export interface AudiencePreviewPoint {
  readonly index: number;
  /** Normalised [0,1] preview coordinates, y already flipped for screen space. */
  readonly orthographic: readonly [number, number];
  readonly perspective: readonly [number, number];
  readonly isWorst: boolean;
}

export interface AudiencePreviewModel {
  readonly mode: AudiencePreviewMode;
  readonly showOrthographic: boolean;
  readonly showPerspective: boolean;
  readonly points: readonly AudiencePreviewPoint[];
  /** World-metre bounds the normalisation used: [minX, maxX, minY, maxY]. */
  readonly bounds: readonly [number, number, number, number];
  readonly empty: boolean;
}

const PAD = 0.06;

/**
 * Normalises analyzer output into preview space. Bounds always span the union of
 * both projections so switching modes never rescales the picture — distortion
 * stays visible instead of being normalised away.
 */
export function buildAudiencePreview(
  report: AudienceProjectionReport,
  mode: AudiencePreviewMode,
): AudiencePreviewModel {
  const showOrthographic = mode === "ORTHOGRAPHIC" || mode === "OVERLAY";
  const showPerspective = mode === "PERSPECTIVE" || mode === "OVERLAY";

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of report.points) {
    for (const c of [p.orthographic, p.perspective]) {
      minX = Math.min(minX, c[0]);
      maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]);
      maxY = Math.max(maxY, c[1]);
    }
  }
  if (!report.points.length) {
    return {
      mode,
      showOrthographic,
      showPerspective,
      points: [],
      bounds: [0, 0, 0, 0],
      empty: true,
    };
  }

  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const span = Math.max(spanX, spanY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const norm = (c: readonly [number, number]): [number, number] => [
    PAD + ((c[0] - cx) / span + 0.5) * (1 - 2 * PAD),
    PAD + (0.5 - (c[1] - cy) / span) * (1 - 2 * PAD),
  ];

  return {
    mode,
    showOrthographic,
    showPerspective,
    points: report.points.map((p) => ({
      index: p.index,
      orthographic: norm(p.orthographic),
      perspective: norm(p.perspective),
      isWorst: report.maxDeviationIndex === p.index,
    })),
    bounds: [minX, maxX, minY, maxY],
    empty: false,
  };
}

/** Flattened metric rows for the diagnostic readout. Formatting only. */
export function audienceMetricRows(
  report: AudienceProjectionReport,
): readonly { readonly label: string; readonly value: string }[] {
  const m = (v: number) => `${v.toFixed(2)} m`;
  return [
    { label: "points", value: `${report.projectedCount}/${report.pointCount}` },
    { label: "target distance", value: m(report.targetDistance) },
    { label: "depth extent", value: m(report.depthExtent) },
    {
      label: "persp scale min/max",
      value: `${report.minPerspectiveScale.toFixed(3)} / ${report.maxPerspectiveScale.toFixed(3)}`,
    },
    { label: "mean deviation", value: m(report.meanApparentDeviation) },
    { label: "rms deviation", value: m(report.rmsApparentDeviation) },
    { label: "max deviation", value: m(report.maxApparentDeviation) },
    {
      label: "worst point",
      value: report.maxDeviationIndex === null ? "—" : `#${report.maxDeviationIndex}`,
    },
    {
      label: "perspective w×h",
      value: `${report.perspectiveExtent[0].toFixed(1)} × ${report.perspectiveExtent[1].toFixed(1)} m`,
    },
    {
      label: "orthographic w×h",
      value: `${report.orthographicExtent[0].toFixed(1)} × ${report.orthographicExtent[1].toFixed(1)} m`,
    },
    { label: "behind viewer", value: String(report.invalidCount) },
  ];
}
