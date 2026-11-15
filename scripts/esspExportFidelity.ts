/**
 * Local Bun CLI only: export fidelity of an UNTOUCHED "Make editable" import.
 * Usage: bun scripts/esspExportFidelity.ts archive.zip
 * Reproduces the store's extraction (derived safety profile + reseed), builds
 * the real ESSP export and compares every file byte-for-byte with the source.
 * Read-only: the archive and the forensic report are never modified.
 */
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { buildReferenceShow } from "../src/lib/import/essp/reference";
import { analyzeReferenceShow } from "../src/lib/import/essp/forensics/report";
import { extractReferenceTimeline } from "../src/lib/import/essp/native/extract";
import { reseedReferenceSignatures } from "../src/lib/import/essp/native/intervals";
import { deriveImportedSafetyProfile } from "../src/lib/import/essp/native/safetyProfile";
import { displayedSceneGroups } from "../src/lib/import/essp/native/sceneGroups";
import { buildEsspExportPackage } from "../src/lib/adapters/esspExport";
import { analyzeFullShow } from "../src/lib/show/fullshow";
import { buildShowPlan } from "../src/lib/show/trajectory/schedule";
import { createDefaultProject } from "../src/lib/show/defaultProject";
import type { ShowProject } from "../src/lib/show/types";

const zip = process.argv[2];
if (!zip) throw new Error("Usage: bun scripts/esspExportFidelity.ts archive.zip");
const entries = Object.entries(
  unzipSync(new Uint8Array(readFileSync(zip)), {
    filter: (e) => /\.essp$/i.test(e.name) && !/(^|\/)\._/.test(e.name),
  }),
).map(([name, bytes]) => ({ name: name.split("/").pop()!, bytes }));
const show = await buildReferenceShow(entries);
const report = analyzeReferenceShow(show);
const reportBefore = JSON.stringify(report);
const result = extractReferenceTimeline(show, report);
const derived = deriveImportedSafetyProfile(show, report);
const base = createDefaultProject();
const project: ShowProject = {
  ...base,
  droneCount: result.droneCount,
  formations: [...result.formations],
  timeline: [...result.timeline],
  dynamicFormations: [...result.dynamicFormations],
  scenes: [...result.scenes],
  lighting: result.lighting,
  area: derived.area,
  altitudes: derived.altitudes,
  limits: derived.limits,
  safetyProfile: derived.profile,
  ...(base.preShow ? { preShow: { ...base.preShow, enabled: false } } : {}),
};
const ctx = { assignmentStrategy: "nearestNeighbor" as const, transitionOverrides: {} };
const layer = reseedReferenceSignatures(project, result.layer, ctx);
const { report: fullShow } = analyzeFullShow(project, { ...ctx, reference: { show, layer } });
const pkg = buildEsspExportPackage({
  project,
  plan: buildShowPlan(project, ctx),
  reference: { show, layer },
  fullShow,
  fullShowStale: false,
});
const byName = new Map(entries.map((e) => [e.name, e.bytes]));
let identical = 0;
for (const f of pkg.files) {
  const src = byName.get(f.sourceFile ?? f.name);
  if (src && src.length === f.bytes.length && src.every((b, i) => b === f.bytes[i])) identical++;
}
const groups = displayedSceneGroups(report);
console.log(
  JSON.stringify(
    {
      drones: show.drones.length,
      positionRateHz: show.timing.positionRateHz,
      rgbRateHz: show.timing.rgbRateHz,
      clips: project.timeline.length,
      groups: {
        total: groups.length,
        static: groups.filter((g) => g.kind === "STATIC").length,
        dynamic: groups.filter((g) => g.kind === "DYNAMIC").length,
      },
      allReference: layer.bindings.every((b) => b.owner === "REFERENCE"),
      exportOk: pkg.ok,
      exportMode: pkg.mode,
      blockers: pkg.blockers.slice(0, 5),
      files: pkg.files.length,
      byteIdenticalFiles: identical,
      reportUnchanged: JSON.stringify(report) === reportBefore,
    },
    null,
    1,
  ),
);
