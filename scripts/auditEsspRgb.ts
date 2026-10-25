/** Local Bun CLI only; never imported by the app or run on the server. */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  readRgbAuditArchive,
  auditRgbInterval,
  benchmarkRgbIntervals,
  rgbAuditWindows,
  rgbAuditMarkdown,
} from "../src/lib/import/essp/native/rgbAudit";
import { analyzeReferenceShow } from "../src/lib/import/essp/forensics/report";

const [zipPath, outputDirectory, expectedSha] = process.argv.slice(2);
if (!zipPath || !outputDirectory)
  throw new Error(
    "Usage: bun scripts/auditEsspRgb.ts original.zip output-directory [expected-sha256]",
  );
const { show, provenance } = await readRgbAuditArchive(
  new Uint8Array(readFileSync(zipPath)),
  basename(zipPath),
);
if (expectedSha && expectedSha !== provenance.archiveSha256)
  throw new Error("Archive checksum mismatch.");
const benchmark = readFileSync(resolve(import.meta.dir, "../docs/ESSP_SHOW_BENCHMARK.md"), "utf8");
const forensics = analyzeReferenceShow(show);
const end = Math.max(
  show.timing.rgbSampleCount / show.timing.rgbRateHz,
  show.timing.positionSampleCount / show.timing.positionRateHz,
);
const intervals = [
  { id: "full-show", start: 0, end, origin: "FULL_SHOW" as const },
  ...benchmarkRgbIntervals(benchmark),
  ...forensics.segments.map((s) => ({
    id: s.id,
    start: s.startTime,
    end: s.endTime,
    origin: "FORENSICS" as const,
  })),
  ...rgbAuditWindows(end),
];
const sourceBefore = show.drones.map((d) => ({
  xyz: d.positionSamples.slice(),
  rgb: d.rgbSamples.slice(),
}));
const reportBefore = JSON.stringify(show.report);
const report = {
  schemaVersion: 1,
  algorithm: "native-rgb-affine-audit-v1",
  provenance,
  clocks: show.timing,
  forensicAlgorithm: forensics.algorithmVersion,
  intervals: intervals.map((i) => auditRgbInterval(show, i)),
  limitations: [
    "Archive checksum identifies the supplied ZIP; no historical checksum exists in the benchmark document to establish an earlier upload's identity.",
    "RGB byte values are not calibrated intensity or perceptual hue. Recipe is always UNKNOWN.",
    "Low per-channel affine fit is evidence against one linear field, not proof of a nonlinear effect or multiple authored groups.",
    "Exact color groups are descriptive only; multiple gradient axes are a linear multi-axis indicator, not inferred semantic masks.",
    "Fits are in-sample, not confidence probabilities. Planar geometry leaves the normal direction unobserved.",
    "Every original RGB tick is paired with interpolated XYZ only within original position coverage. No held RGB or extrapolation.",
    "Benchmark/forensic/window intervals overlap and cannot be summed. Last unpaired RGB endpoint remains in coverage counts.",
    "Original archive and saved-project bindings are different evidence sources; this report does not claim to audit the 23 saved bindings.",
  ],
};
if (
  JSON.stringify(show.report) !== reportBefore ||
  show.drones.some((d, i) => {
    const before = sourceBefore[i];
    return (
      !before ||
      d.positionSamples.some((v, j) => v !== before.xyz[j]) ||
      d.rgbSamples.some((v, j) => v !== before.rgb[j])
    );
  })
)
  throw new Error("Source mutation detected.");
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(resolve(outputDirectory, "rgb-audit.json"), JSON.stringify(report, null, 2) + "\n");
writeFileSync(resolve(outputDirectory, "rgb-audit.md"), rgbAuditMarkdown(report));
console.log(
  JSON.stringify({
    archive: provenance.archiveName,
    sha256: provenance.archiveSha256,
    files: show.drones.length,
    benchmark: intervals.filter((i) => i.origin === "BENCHMARK").length,
    forensics: forensics.segments.length,
    windows: intervals.filter((i) => i.origin === "WINDOW").length,
    sourceUnchanged: true,
    outputDirectory,
  }),
);
