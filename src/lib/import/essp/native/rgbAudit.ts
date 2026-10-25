/** Reproducible, read-only RGB audit. No semantic recipe inference or source writes. */
import { unzipSync } from "fflate";
import { buildReferenceShow, numericSourceId } from "../reference";
import { bytesEqual, sha256Hex } from "../codec";
import { referenceDroneFileBytes } from "./layer";
import type { ReferenceShow } from "../types";
import { analyzeSpatialRgb, fitSpatialRgbFrame } from "./spatialRgb";

export interface RgbAuditInterval {
  id: string;
  start: number;
  end: number;
  origin: "BENCHMARK" | "FORENSICS" | "WINDOW" | "FULL_SHOW" | "SAVED_BINDING";
}

/** macOS AppleDouble resource forks (`__MACOSX/…`, `._name`) are metadata, never drone files. */
export function isAppleDoubleEntry(name: string): boolean {
  return /(^|\/)__MACOSX\//.test(name) || (name.split("/").pop() ?? "").startsWith("._");
}

export interface RgbAuditArchiveOptions {
  /** Required native clocks; defaults to the original benchmark (XYZ 8 Hz / RGB 12 Hz). */
  clocks?: { positionRateHz: number; rgbRateHz: number } | null;
}

export async function readRgbAuditArchive(
  bytes: Uint8Array,
  archiveName: string,
  options: RgbAuditArchiveOptions = {},
) {
  const clocks =
    options.clocks === undefined ? { positionRateHz: 8, rgbRateHz: 12 } : options.clocks;
  const entries = Object.entries(
    unzipSync(bytes, {
      filter: (entry) => /\.essp$/i.test(entry.name) && !isAppleDoubleEntry(entry.name),
    }),
  );
  const ids = entries.map(([name]) => numericSourceId(name));
  if (
    entries.length !== 150 ||
    new Set(ids).size !== 150 ||
    ids.some((id) => id === null || id < 1 || id > 150)
  )
    throw new Error("Audit requires exactly 150 unique numeric ESSP files (1–150).");
  const files = entries.map(([name, data]) => ({ name, bytes: data }));
  const show = await buildReferenceShow(files, { hashFiles: true });
  if (
    show.drones.length !== 150 ||
    !show.report.invariants.identicalPositionRate ||
    !show.report.invariants.identicalRgbRate ||
    (clocks !== null &&
      (show.timing.positionRateHz !== clocks.positionRateHz ||
        show.timing.rgbRateHz !== clocks.rgbRateHz))
  )
    throw new Error(
      "Audit requires 150 valid files with identical native clocks matching the expected rates.",
    );
  const hash = await sha256Hex(bytes);
  if (!hash) throw new Error("SHA-256 unavailable; provenance cannot be established.");
  const fileEvidence = await Promise.all(
    files.map(async (file) => {
      const id = numericSourceId(file.name);
      const drone = show.drones.find((d) => d.numericSourceId === id);
      if (!drone || !bytesEqual(file.bytes, referenceDroneFileBytes(drone)))
        throw new Error(`Lossless reconstruction failed: ${file.name}`);
      return {
        name: file.name,
        bytes: file.bytes.length,
        sha256: await sha256Hex(file.bytes),
        roundTripIdentical: true,
      };
    }),
  );
  return {
    show,
    provenance: { archiveName, archiveSha256: hash, fileCount: 150, files: fileEvidence },
  };
}

/** Parses only numeric broad-interval rows, never semantic labels, from the existing benchmark. */
export function benchmarkRgbIntervals(markdown: string): RgbAuditInterval[] {
  return Array.from(
    markdown.matchAll(/^\|\s*(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*\|/gm),
    (match, i) => ({
      id: `benchmark-${i + 1}`,
      start: Number(match[1]),
      end: Number(match[2]),
      origin: "BENCHMARK" as const,
    }),
  );
}

export function rgbAuditWindows(end: number, seconds = 5): RgbAuditInterval[] {
  if (!Number.isFinite(end) || end < 0 || !Number.isFinite(seconds) || seconds <= 0)
    throw new Error("Invalid window duration.");
  return Array.from({ length: Math.ceil(end / seconds) }, (_, i) => ({
    id: `window-${i + 1}`,
    start: i * seconds,
    end: Math.min(end, (i + 1) * seconds),
    origin: "WINDOW" as const,
  }));
}

export function auditRgbInterval(show: ReferenceShow, interval: RgbAuditInterval) {
  if (
    !Number.isFinite(interval.start) ||
    !Number.isFinite(interval.end) ||
    interval.end < interval.start
  )
    throw new Error("Invalid audit interval.");
  const spatial = analyzeSpatialRgb(show, {
    clipId: interval.id,
    order: 0,
    kind: "SCENE",
    sourceSegmentId: null,
    sourceClassification: null,
    referenceStart: interval.start,
    referenceHoldStart: interval.start,
    referenceEnd: interval.end,
    owner: "REFERENCE",
    signature: "",
  });
  const reasons = {
    noPairs: 0,
    uniform: 0,
    insufficientGeometryOrFleet: 0,
    lowChannelFit: 0,
    multipleGradientAxes: 0,
    supportedSingleAxis: 0,
  };
  let rgbSamples = 0,
    darkSamples = 0,
    pairedDarkSamples = 0,
    pairedDistinctSum = 0;
  let distinctMin: number | null = null,
    distinctMax = 0,
    largestColorGroupSum = 0;
  let eligibleFrames = 0,
    residualEnergy = 0,
    totalEnergy = 0;
  const varianceSum = [0, 0, 0],
    residualSum = [0, 0, 0],
    fitSum = [0, 0, 0],
    fitCount = [0, 0, 0];
  const palette = new Map<number, number>();
  for (let index = spatial.rgbFrameRange[0]; index < spatial.rgbFrameRange[1]; index++) {
    const frame = fitSpatialRgbFrame(show, index);
    const colorGroups = new Map<number, number>();
    const time = index / show.timing.rgbRateHz;
    for (const drone of show.drones) {
      if (index >= drone.rgbSampleCount) continue;
      const r = drone.rgbSamples[index * 3],
        g = drone.rgbSamples[index * 3 + 1],
        b = drone.rgbSamples[index * 3 + 2];
      if (r === undefined || g === undefined || b === undefined) continue;
      const key = (r << 16) | (g << 8) | b;
      rgbSamples++;
      if (key === 0) darkSamples++;
      palette.set(key, (palette.get(key) ?? 0) + 1);
      if (
        !drone.positionSampleCount ||
        time > (drone.positionSampleCount - 1) / show.timing.positionRateHz
      )
        continue;
      colorGroups.set(key, (colorGroups.get(key) ?? 0) + 1);
      if (key === 0) pairedDarkSamples++;
    }
    if (frame.count === 0) {
      reasons.noPairs++;
      continue;
    }
    pairedDistinctSum += colorGroups.size;
    distinctMin = distinctMin === null ? colorGroups.size : Math.min(distinctMin, colorGroups.size);
    distinctMax = Math.max(distinctMax, colorGroups.size);
    largestColorGroupSum += Math.max(0, ...colorGroups.values()) / frame.count;
    for (let c = 0; c < 3; c++) {
      varianceSum[c] = (varianceSum[c] ?? 0) + (frame.varianceByChannel[c] ?? 0);
      residualSum[c] = (residualSum[c] ?? 0) + (frame.residualByChannel[c] ?? 0);
      const fit = frame.fitByChannel[c];
      if (fit !== null && fit !== undefined) {
        fitSum[c] = (fitSum[c] ?? 0) + fit;
        fitCount[c] = (fitCount[c] ?? 0) + 1;
      }
    }
    if (frame.coherence !== null) {
      eligibleFrames++;
      totalEnergy += frame.varianceByChannel.reduce((a, b) => a + b, 0) * frame.count;
      residualEnergy += frame.residualByChannel.reduce((a, b) => a + b, 0) * frame.count;
    }
    if (frame.uniform) reasons.uniform++;
    else if (frame.coherence === null) reasons.insufficientGeometryOrFleet++;
    else if (frame.fitByChannel.some((fit) => fit !== null && fit < 0.85)) reasons.lowChannelFit++;
    else if (
      frame.dominantGradientEnergyFraction !== null &&
      frame.dominantGradientEnergyFraction < 0.9
    )
      reasons.multipleGradientAxes++;
    else if (frame.direction) reasons.supportedSingleAxis++;
    else reasons.insufficientGeometryOrFleet++;
  }
  const mean = (sum: number, count: number) => (count ? sum / count : null);
  return {
    ...interval,
    recipe: "UNKNOWN" as const,
    spatial,
    coverage: {
      rgbSamples,
      pairedSamples: spatial.pairedSamples,
      pairedFraction: mean(spatial.pairedSamples, rgbSamples),
      evaluatedFrames: spatial.evaluatedFrames,
      pairedFrames: spatial.pairedFrames,
    },
    colors: {
      distinctRgb: palette.size,
      darkFraction: mean(darkSamples, rgbSamples),
      pairedDarkFraction: mean(pairedDarkSamples, spatial.pairedSamples),
      pairedDistinctPerTick: {
        minimum: distinctMin,
        maximum: spatial.pairedFrames ? distinctMax : null,
        mean: mean(pairedDistinctSum, spatial.pairedFrames),
      },
      meanLargestExactColorGroupFraction: mean(largestColorGroupSum, spatial.pairedFrames),
      // Top exact byte triplets, not semantic palette names or inferred masks.
      topRgb: [...palette]
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .slice(0, 8)
        .map(([key, samples]) => ({
          rgb: [(key >> 16) & 255, (key >> 8) & 255, key & 255],
          samples,
        })),
    },
    channels: ["R", "G", "B"].map((channel, c) => ({
      channel,
      meanVarianceByteSquared: mean(varianceSum[c] ?? 0, spatial.pairedFrames),
      meanResidualByteSquared: mean(residualSum[c] ?? 0, spatial.pairedFrames),
      meanFit: mean(fitSum[c] ?? 0, fitCount[c] ?? 0),
      fittedFrames: fitCount[c] ?? 0,
    })),
    totalFit: {
      eligibleFrames,
      varianceEnergy: totalEnergy,
      residualEnergy,
      energyWeightedFit: totalEnergy
        ? Math.max(0, Math.min(1, 1 - residualEnergy / totalEnergy))
        : null,
    },
    reasons,
  };
}

export function rgbAuditMarkdown(report: {
  provenance: { archiveName: string; archiveSha256: string };
  intervals: ReturnType<typeof auditRgbInterval>[];
  limitations: string[];
}) {
  const number = (v: number | null) =>
    v !== null && Number.isFinite(v) ? v.toFixed(3) : "unknown";
  return [
    "# ESSP native-clock RGB audit",
    "",
    `Archive: ${report.provenance.archiveName}`,
    `SHA-256: ${report.provenance.archiveSha256}`,
    "",
    "Recipe: UNKNOWN. Intervals are half-open; overlapping summaries are not additive.",
    "",
    "| Interval | Origin | Time (s) | Status | Paired/RGB | Dark | Fit R/G/B | Low-channel / multi-axis ticks |",
    "|---|---|---|---|---|---|---|---|",
    ...report.intervals.map(
      (i) =>
        `| ${i.id} | ${i.origin} | ${number(i.start)}–${number(i.end)} | ${i.spatial.status} | ${i.coverage.pairedSamples}/${i.coverage.rgbSamples} | ${number(i.colors.darkFraction)} | ${i.channels.map((c) => number(c.meanFit)).join(" / ")} | ${i.reasons.lowChannelFit} / ${i.reasons.multipleGradientAxes} |`,
    ),
    "",
    "## Limitations",
    ...report.limitations.map((l) => `- ${l}`),
    "",
  ].join("\n");
}
