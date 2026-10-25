/** Read-only evidence from source samples; never an effect-recipe recognizer. */
import { sampleReferenceShow } from "../playback";
import type { ReferenceShow } from "../types";
import type { ReferenceClipBinding } from "./types";
import { analyzeSpatialRgb } from "./spatialRgb";
import { analyzeRgbStructure } from "./rgbStructure";

export function sourceSceneEvidence(show: ReferenceShow, binding: ReferenceClipBinding) {
  const start = binding.referenceStart;
  const hold = binding.referenceHoldStart;
  const end = binding.referenceEnd;
  const previewTime = hold + Math.max(0, end - hold) / 2;
  let rgbSamples = 0;
  let changes = 0;
  let dark = 0;
  const colors = new Set<number>();
  for (const drone of show.drones) {
    const first = Math.max(0, Math.ceil(start * show.timing.rgbRateHz));
    const stop = Math.min(drone.rgbSampleCount, Math.ceil(end * show.timing.rgbRateHz));
    for (let sample = first; sample < stop; sample++) {
      const offset = sample * 3;
      const r = drone.rgbSamples[offset];
      const g = drone.rgbSamples[offset + 1];
      const b = drone.rgbSamples[offset + 2];
      if (r === undefined || g === undefined || b === undefined) continue;
      rgbSamples++;
      colors.add((r << 16) | (g << 8) | b);
      if (r === 0 && g === 0 && b === 0) dark++;
      if (
        sample > first &&
        (r !== drone.rgbSamples[offset - 3] ||
          g !== drone.rgbSamples[offset - 2] ||
          b !== drone.rgbSamples[offset - 1])
      )
        changes++;
    }
  }
  return {
    start,
    hold,
    end,
    previewTime,
    transitionSeconds: Math.max(0, hold - start),
    preview: sampleReferenceShow(show, previewTime),
    motion: binding.sourceClassification ?? "UNKNOWN",
    lighting: {
      status: rgbSamples > 0 ? ("OBSERVED_RGB" as const) : ("NO_RGB_SAMPLES" as const),
      rgbSamples,
      changes,
      distinctColors: colors.size,
      darkFraction: rgbSamples ? dark / rgbSamples : null,
      spatial: analyzeSpatialRgb(show, binding),
      structure: analyzeRgbStructure(show, binding),
      // ESSP contains the LED result, not authoring effect names/parameters.
      recipe: "UNKNOWN" as const,
    },
    semanticImage: "UNKNOWN" as const,
    boundary: "INFERRED" as const,
    owner: binding.owner,
  };
}
