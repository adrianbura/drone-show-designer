/** Read-only visual identity, separate from the forensic motion descriptors. */
import { centeredCloud } from "../forensics/centroid";
import { rigidFitCentered } from "../forensics/rigid";
import type { PointCloudSequence } from "../forensics/types";

function radius(cloud: Float64Array): number {
  let squared = 0;
  for (const value of cloud) squared += value * value;
  return Math.sqrt(squared / Math.max(1, cloud.length / 3));
}

/** Similarity-fit residual in metres, retaining correspondence by drone ID.
 * Uniform expansion is motion, not a different outline. Absolute extent stays
 * in the source/motion metrics; only this identity comparison removes scale.
 */
export function visualIdentityResidual(
  sequence: PointCloudSequence,
  referenceSample: number,
  candidateSample: number,
): number {
  const reference = centeredCloud(sequence, referenceSample);
  const candidate = centeredCloud(sequence, candidateSample);
  const referenceRadius = radius(reference);
  const candidateRadius = radius(candidate);
  if (referenceRadius === 0 || candidateRadius === 0) {
    return rigidFitCentered(reference, candidate).rmsError;
  }
  const scale = referenceRadius / candidateRadius;
  return rigidFitCentered(reference, Float64Array.from(candidate, (value) => value * scale))
    .rmsError;
}