/**
 * REFERENCE SHOW FORENSICS — analysis-only domain model.
 *
 * The imported ESSP reference show is IMMUTABLE. Everything here is derived,
 * read-only analysis data. Segmentation is heuristic: it classifies observed
 * sampled motion, it does NOT reconstruct the original designer storyboard.
 *
 * Motion model:  P_i(t) = C(t) + R(t) * Q_i(ref) + D_i(t)
 *   C(t)   fleet centroid translation
 *   R(t)   global best-fit rigid rotation (Kabsch / Horn quaternion)
 *   D_i(t) internal deformation residual
 */

export const ESSP_FORENSICS_ALGORITHM_VERSION = "0.1.0";

/** Immutable point-cloud sequence in STUDIO METRES, derived from raw samples. */
export interface PointCloudSequence {
  droneIds: string[];
  droneCount: number;
  sampleCount: number;
  /** Sample rate of the source data (8 Hz for the reference archive). */
  rateHz: number;
  /** t = index / rateHz */
  times: Float64Array;
  /** Flat [sample][drone][xyz] — length sampleCount * droneCount * 3. */
  positions: Float64Array;
}

export type ForensicsPresetName = "CONSERVATIVE" | "BALANCED" | "SENSITIVE";

/** All classification thresholds. No magic numbers elsewhere. */
export interface ReferenceForensicsThresholds {
  /** Analysis window length in seconds. */
  windowSeconds: number;
  /** Window stride in seconds. */
  strideSeconds: number;
  /** Below this centroid speed a window counts as translation-free (m/s). */
  staticCentroidSpeedMps: number;
  /** Below this rate a window counts as rotation-free (deg/s). */
  staticRotationRateDegPerSec: number;
  /** Minimum absolute rotation inside a window to count as rotating (deg). */
  minRotationDeg: number;
  /** Rigid-fit residual RMS above which internal deformation is claimed (m). */
  deformationRmsMeters: number;
  /** Per-drone residual above which a drone is "active" (m). */
  activeDroneResidualMeters: number;
  /** Net (start->end) shape change that turns deformation into a transition (m). */
  transitionNetResidualMeters: number;
  /** Uniform-scale deviation treated as a global scale change (fraction). */
  scaleDeviation: number;
  /** Segments shorter than this are absorbed into neighbours (s). */
  minSegmentSeconds: number;
  /** Minimum duration of a reported hold (s). */
  holdMinSeconds: number;
  /** Altitude at or below which drones count as on the ground (m). */
  groundAltitudeMeters: number;
  /** Mean vertical speed that marks ascent/descent (m/s). */
  verticalSpeedMps: number;
  /** Change-point sensitivity: feature-distance multiple of its own median. */
  changePointSensitivity: number;
  /** Minimum autocorrelation peak to claim periodicity (0..1). */
  periodicityMinConfidence: number;
}

export type ReferenceSegmentClassification =
  | "GROUND_STATIC"
  | "TAKEOFF_ASCENT"
  | "STATIC_FORMATION"
  | "POSSIBLE_STAGING"
  | "GLOBAL_TRANSLATION"
  | "GLOBAL_ROTATION"
  | "RIGID_MOTION"
  | "DYNAMIC_DEFORMATION"
  | "FORMATION_TRANSITION"
  | "LANDING_DESCENT"
  | "UNKNOWN";

/** Rigid fit of one centred cloud onto another. */
export interface RigidFit {
  /** Row-major 3x3 rotation matrix. */
  rotation: number[];
  /** Rotation angle in degrees (0..180). */
  angleDeg: number;
  /** Unit rotation axis. */
  axis: [number, number, number];
  /** Best-fit uniform scale (measured, NOT applied to the residual). */
  scale: number;
  /** Residual RMS after translation + rotation removal (m). */
  rmsError: number;
  /** Largest single-drone residual (m). */
  maxResidual: number;
}

/** Per-window motion descriptor, computed on raw 8 Hz samples. */
export interface MotionWindow {
  index: number;
  startTime: number;
  endTime: number;
  startSample: number;
  endSample: number;
  centroidStart: [number, number, number];
  centroidEnd: [number, number, number];
  centroidTravel: number;
  centroidSpeedMps: number;
  meanAltitude: number;
  altitudeChange: number;
  verticalSpeedMps: number;
  groundFraction: number;
  rotationDeg: number;
  rotationRateDegPerSec: number;
  scale: number;
  rigidRmsMeters: number;
  deformationRmsMeters: number;
  deformationMaxMeters: number;
  deformationMedianMeters: number;
  activeFraction: number;
  /** Peak deformation energy sample-by-sample inside the window (m). */
  deformationEnergy: number;
  classification: ReferenceSegmentClassification;
  confidence: number;
}

export interface PeriodicityResult {
  periodic: boolean;
  estimatedPeriodSeconds: number | null;
  confidence: number;
}

export interface MotionCluster {
  id: string;
  droneIds: string[];
  meanResidualMeters: number;
}

export interface SegmentMetrics {
  centroidTravelMeters: number;
  meanCentroidSpeedMps: number;
  maxRotationDeg: number;
  totalRotationDeg: number;
  meanScale: number;
  rigidRmsMeters: number;
  deformationRmsMeters: number;
  maxDeformationMeters: number;
  medianDeformationMeters: number;
  netShapeChangeMeters: number;
  activeFraction: number;
  meanAltitudeMeters: number;
  altitudeChangeMeters: number;
  lightingChangeEnergy: number;
}

export interface ReferenceSceneSegment {
  id: string;
  /** Generic auto label, e.g. "Static formation 03". Never semantic. */
  label: string;
  startTime: number;
  endTime: number;
  duration: number;
  classification: ReferenceSegmentClassification;
  confidence: number;
  metrics: SegmentMetrics;
  periodicity: PeriodicityResult;
  activeDroneIds: string[];
  clusters: MotionCluster[];
  inferred: true;
}

export interface HoldPeriod {
  startTime: number;
  endTime: number;
  duration: number;
  meanCentroidSpeedMps: number;
}

export interface PerDroneMotionMetric {
  droneId: string;
  distanceTraveledMeters: number;
  meanResidualMeters: number;
  maxResidualMeters: number;
  participationScore: number;
  velocityRmsMps: number;
}

export interface LightingWindowSample {
  time: number;
  meanBrightness: number;
  colorVariance: number;
  darkFraction: number;
  changingFraction: number;
  changeEnergy: number;
}

export interface LightingStatistics {
  sampleRateHz: number;
  meanBrightness: number;
  maxChangeEnergy: number;
  /** Times where lighting change energy spikes. */
  changeEventTimes: number[];
  track: LightingWindowSample[];
}

export interface MotionStatistics {
  maxCentroidSpeedMps: number;
  totalCentroidTravelMeters: number;
  maxRotationRateDegPerSec: number;
  maxDeformationRmsMeters: number;
  maxAltitudeMeters: number;
}

/** Scalar tracks for timeline visualisation. */
export interface MotionEnergyTracks {
  times: number[];
  globalTranslationEnergy: number[];
  globalRotationEnergy: number[];
  internalDeformationEnergy: number[];
  lightingChangeEnergy: number[];
}

export interface DynamicFormationObservation {
  segmentId: string;
  referenceTime: number;
  centroidTrack: [number, number, number][];
  rigidRotationTrack: number[];
  residualTrack: number[];
  activeDroneIds: string[];
  periodicity: PeriodicityResult;
}

export interface ReferenceForensicsReport {
  algorithmVersion: string;
  analyzedAt: string;
  preset: ForensicsPresetName;
  thresholds: ReferenceForensicsThresholds;
  /** Provenance of the analysed reference show — never modified. */
  source: {
    importedAt: string;
    droneCount: number;
    sampleRateHz: number;
    positionSampleCount: number;
    showDurationSeconds: number;
    showHash: string;
  };
  segments: ReferenceSceneSegment[];
  holds: HoldPeriod[];
  possibleStaging: { startTime: number; endTime: number } | null;
  takeoffInterval: { startTime: number; endTime: number } | null;
  landingInterval: { startTime: number; endTime: number } | null;
  counts: Record<ReferenceSegmentClassification, number> & { total: number };
  motion: MotionStatistics;
  lighting: LightingStatistics | null;
  energy: MotionEnergyTracks;
  perDrone: PerDroneMotionMetric[];
  dynamicObservations: DynamicFormationObservation[];
  /** Motion boundaries that coincide with lighting boundaries. */
  correlatedBoundaries: number[];
  limitations: string[];
}

export const BALANCED_THRESHOLDS: ReferenceForensicsThresholds = {
  windowSeconds: 0.5,
  strideSeconds: 0.25,
  staticCentroidSpeedMps: 0.15,
  staticRotationRateDegPerSec: 2,
  minRotationDeg: 1.5,
  deformationRmsMeters: 0.4,
  activeDroneResidualMeters: 0.3,
  transitionNetResidualMeters: 2,
  scaleDeviation: 0.05,
  minSegmentSeconds: 1,
  holdMinSeconds: 3,
  groundAltitudeMeters: 1.5,
  verticalSpeedMps: 0.3,
  changePointSensitivity: 2.5,
  periodicityMinConfidence: 0.5,
};

export const FORENSICS_PRESETS: Record<ForensicsPresetName, ReferenceForensicsThresholds> = {
  BALANCED: BALANCED_THRESHOLDS,
  CONSERVATIVE: {
    ...BALANCED_THRESHOLDS,
    staticCentroidSpeedMps: 0.3,
    staticRotationRateDegPerSec: 4,
    minRotationDeg: 3,
    deformationRmsMeters: 0.8,
    activeDroneResidualMeters: 0.6,
    transitionNetResidualMeters: 4,
    minSegmentSeconds: 2,
    holdMinSeconds: 5,
    changePointSensitivity: 3.5,
    periodicityMinConfidence: 0.65,
  },
  SENSITIVE: {
    ...BALANCED_THRESHOLDS,
    staticCentroidSpeedMps: 0.07,
    staticRotationRateDegPerSec: 1,
    minRotationDeg: 0.75,
    deformationRmsMeters: 0.2,
    activeDroneResidualMeters: 0.15,
    transitionNetResidualMeters: 1,
    minSegmentSeconds: 0.5,
    holdMinSeconds: 2,
    changePointSensitivity: 1.8,
    periodicityMinConfidence: 0.35,
  },
};

export const FORENSICS_LIMITATIONS = [
  "Forensic segmentation is heuristic. It classifies observed sampled motion only.",
  "It does NOT reconstruct the original designer storyboard with certainty.",
  "Segment labels are generic; no object or artistic meaning is inferred.",
  "Analysis runs on raw 8 Hz samples; motion faster than the sample rate is invisible.",
  "Reference trajectories are never modified, re-planned or re-exported by this analysis.",
];
