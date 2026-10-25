/** Local Bun CLI only: read-only RGB structure audit of forensic segments. */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { readRgbAuditArchive } from "../src/lib/import/essp/native/rgbAudit";
import { analyzeReferenceShow } from "../src/lib/import/essp/forensics/report";
import { analyzeRgbStructure } from "../src/lib/import/essp/native/rgbStructure";

const args = process.argv.slice(2);
const generic = args.includes("--generic");
const [zip, out, sha] = args.filter((a) => !a.startsWith("--"));
if (!zip || !out || !sha)
  throw new Error("Usage: bun scripts/auditRgbStructure.ts [--generic] a.zip out.json sha256");
const bytes = new Uint8Array(readFileSync(zip));
const digest = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
if (digest !== sha) throw new Error("Archive checksum mismatch."); // before decoding
const { show, provenance } = await readRgbAuditArchive(
  bytes,
  basename(zip),
  generic ? { generic, clocks: null } : {},
);
const before = show.drones.map((d) => d.rgbSamples.slice());
const segments = analyzeReferenceShow(show).segments.map((s) => {
  const r = analyzeRgbStructure(show, {
    clipId: s.id,
    order: 0,
    kind: "SCENE",
    sourceSegmentId: null,
    sourceClassification: null,
    referenceStart: s.startTime,
    referenceHoldStart: s.startTime,
    referenceEnd: s.endTime,
    owner: "REFERENCE",
    signature: "",
  });
  return {
    id: s.id,
    start: s.startTime,
    end: s.endTime,
    groups: r.groups.status,
    groupCount: r.groups.groups.length,
    ambiguous: r.groups.ambiguousFraction,
    temporal: r.temporal.status,
    period: r.temporal.periodSeconds,
    heldOut: r.temporal.heldOutCorrelation,
    waveR2: r.temporal.waveHeldOutR2,
    best: r.reconstruction.best,
    models: "models" in r.reconstruction ? r.reconstruction.models : [],
  };
});
if (show.drones.some((d, i) => d.rgbSamples.some((v, j) => v !== before[i]![j])))
  throw new Error("Source mutation detected.");
const count = (k: "groups" | "temporal" | "best") =>
  Object.fromEntries(
    [...new Set(segments.map((s) => s[k]))]
      .sort()
      .map((v) => [v, segments.filter((s) => s[k] === v).length]),
  );
const summary = {
  archive: provenance.archiveName,
  sha256: digest,
  clocks: show.timing,
  segments: segments.length,
  groups: count("groups"),
  temporal: count("temporal"),
  reconstruction: count("best"),
  recipe: "UNKNOWN",
};
writeFileSync(
  out,
  JSON.stringify({ schemaVersion: 1, algorithm: "rgb-structure-v1", summary, segments }, null, 2) +
    "\n",
);
console.log(JSON.stringify(summary));
