/**
 * REFERENCE SHOW FORENSICS — analysis only. See docs/ESSP_REFERENCE_FORENSICS.md.
 * Pure domain code: no React, no Three.js, no mutation of the reference show.
 */
export * from "./types";
export * from "./rigid";
export * from "./centroid";
export * from "./motion";
export * from "./classification";
export * from "./periodicity";
export * from "./metrics";
export * from "./segmentation";
export * from "./adapter";
export {
  analyzeSequence,
  analyzeReferenceShow,
  forensicsReportToJson,
  ForensicsCancelled,
  type AnalyzeOptions,
} from "./report";
