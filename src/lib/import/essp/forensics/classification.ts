/**
 * Window classification rules (all thresholds injected — see types.ts).
 *
 * Priority order, documented so the behaviour is auditable:
 *  1. ground / vertical-dominant motion (takeoff, landing) — candidates only,
 *     confirmed globally in segmentation.ts,
 *  2. internal deformation (rigid fit fails) -> DYNAMIC_DEFORMATION,
 *     later refined to FORMATION_TRANSITION when the shape change is net and
 *     sustained,
 *  3. rigid motion split into rotation / translation / both,
 *  4. otherwise STATIC_FORMATION.
 *
 * A rigidly rotating formation is NEVER dynamic deformation: rotation is
 * removed before the residual is measured.
 */
import type {
  MotionWindow,
  ReferenceForensicsThresholds,
  ReferenceSegmentClassification,
} from "./types";

function ratioConfidence(value: number, threshold: number): number {
  if (threshold <= 0) return 1;
  const r = value / threshold;
  return Math.max(0.35, Math.min(1, r > 1 ? 1 - 1 / (1 + r) + 0.4 : 0.4 + 0.4 * r));
}

export function classifyWindow(
  w: MotionWindow,
  th: ReferenceForensicsThresholds,
): { classification: ReferenceSegmentClassification; confidence: number } {
  const deforming = w.deformationRmsMeters > th.deformationRmsMeters;
  const rotating =
    w.rotationRateDegPerSec > th.staticRotationRateDegPerSec && w.rotationDeg > th.minRotationDeg;
  const translating = w.centroidSpeedMps > th.staticCentroidSpeedMps;
  const verticalDominant =
    Math.abs(w.verticalSpeedMps) > th.verticalSpeedMps &&
    Math.abs(w.altitudeChange) >= 0.6 * w.centroidTravel;

  if (!deforming && !rotating) {
    if (verticalDominant && w.verticalSpeedMps > 0) {
      return {
        classification: "TAKEOFF_ASCENT",
        confidence: ratioConfidence(w.verticalSpeedMps, th.verticalSpeedMps),
      };
    }
    if (verticalDominant && w.verticalSpeedMps < 0) {
      return {
        classification: "LANDING_DESCENT",
        confidence: ratioConfidence(-w.verticalSpeedMps, th.verticalSpeedMps),
      };
    }
    if (!translating && w.groundFraction > 0.8) {
      return { classification: "GROUND_STATIC", confidence: 0.9 };
    }
  }

  if (deforming) {
    return {
      classification: "DYNAMIC_DEFORMATION",
      confidence: ratioConfidence(w.deformationRmsMeters, th.deformationRmsMeters),
    };
  }
  if (rotating && translating) {
    return {
      classification: "RIGID_MOTION",
      confidence: Math.min(
        ratioConfidence(w.rotationRateDegPerSec, th.staticRotationRateDegPerSec),
        ratioConfidence(w.centroidSpeedMps, th.staticCentroidSpeedMps),
      ),
    };
  }
  if (rotating) {
    return {
      classification: "GLOBAL_ROTATION",
      confidence: ratioConfidence(w.rotationRateDegPerSec, th.staticRotationRateDegPerSec),
    };
  }
  if (translating) {
    return {
      classification: "GLOBAL_TRANSLATION",
      confidence: ratioConfidence(w.centroidSpeedMps, th.staticCentroidSpeedMps),
    };
  }
  return { classification: "STATIC_FORMATION", confidence: 0.9 };
}

export function classifyWindows(
  windows: MotionWindow[],
  th: ReferenceForensicsThresholds,
): MotionWindow[] {
  return windows.map((w) => {
    const { classification, confidence } = classifyWindow(w, th);
    return { ...w, classification, confidence };
  });
}
