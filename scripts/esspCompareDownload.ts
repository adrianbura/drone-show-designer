/**
 * Local Bun CLI only: prove a browser-downloaded ESSP zip is the file the CLI
 * pipeline produces for the same edit, and that it re-imports faithfully.
 * Usage: bun scripts/esspCompareDownload.ts source.zip downloaded.zip '<AgentOp JSON>'
 * Target: the first dynamic multi-scene group (the first Timeline group bar).
 */
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { buildReferenceShow } from "../src/lib/import/essp/reference";
import { analyzeReferenceShow } from "../src/lib/import/essp/forensics/report";
import { extractReferenceTimeline } from "../src/lib/import/essp/native/extract";
import { reseedReferenceSignatures } from "../src/lib/import/essp/native/intervals";
import { deriveImportedSafetyProfile } from "../src/lib/import/essp/native/safetyProfile";
import { clipSceneGroups } from "../src/lib/import/essp/native/sceneGroups";
import { buildEsspExportPackage } from "../src/lib/adapters/esspExport";
import { analyzeFullShow } from "../src/lib/show/fullshow";
import { buildShowPlan } from "../src/lib/show/trajectory/schedule";
import { createDefaultProject } from "../src/lib/show/defaultProject";
import type { ShowProject } from "../src/lib/show/types";
import type { AgentOp } from "../src/lib/agent/operations";
import { prepareImportedEdit } from "../src/lib/import/essp/native/editTransaction";

const [srcZip, dlZip, opJson] = process.argv.slice(2);
if (!srcZip || !dlZip || !opJson) throw new Error("usage");
const read = (z: string) =>
  Object.entries(
    unzipSync(new Uint8Array(readFileSync(z)), {
      filter: (e) => /\.essp$/i.test(e.name) && !/(^|\/)\._/.test(e.name),
    }),
  ).map(([name, bytes]) => ({ name: name.split("/").pop()!, bytes }));
const entries = read(srcZip);
const show = await buildReferenceShow(entries);
const report = analyzeReferenceShow(show);
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
const group = clipSceneGroups(report, layer).find((g) => g.kind === "DYNAMIC" && g.clipIds.length > 1)!;
const op = JSON.parse(opJson) as AgentOp;
const prepared = prepareImportedEdit(project, show, layer, group.clipIds, op, ctx);
if (!prepared.ok) throw new Error(prepared.reason);
const tx = prepared.transaction;
const analyzed = analyzeFullShow(tx.project, { ...ctx, sampleRate: show.timing.positionRateHz, reference: { show, layer: tx.layer } });
const pkg = buildEsspExportPackage({ project: tx.project, plan: buildShowPlan(tx.project, ctx), reference: { show, layer: tx.layer }, fullShow: analyzed.report, fullShowStale: false });
const downloaded = read(dlZip);
const dlByName = new Map(downloaded.map((e) => [e.name, e.bytes]));
let sameAsCli = 0;
for (const f of pkg.files) {
  const d = dlByName.get(f.name);
  if (d && d.length === f.bytes.length && d.every((b, i) => b === f.bytes[i])) sameAsCli++;
}
const srcByName = new Map(entries.map((e) => [e.name, e.bytes]));
let untouchedFilesIdentical = 0;
for (const e of downloaded) {
  const s = srcByName.get(e.name);
  if (s && s.length === e.bytes.length && s.every((b, i) => b === e.bytes[i])) untouchedFilesIdentical++;
}
const back = await buildReferenceShow(downloaded);
let xyzOutside = 0, xyzChanged = 0, rgbDiff = 0;
const hz = show.timing.positionRateHz;
back.drones.forEach((d, i) => {
  const s = show.drones[i]!;
  for (let k = 0; k < s.positionSamples.length; k++)
    if (d.positionSamples[k] !== s.positionSamples[k]) {
      xyzChanged++;
      const t = Math.floor(k / 3) / hz;
      if (t < tx.edit.start || t >= tx.edit.end) xyzOutside++;
    }
  for (let k = 0; k < s.rgbSamples.length; k++) if (d.rgbSamples[k] !== s.rgbSamples[k]) rgbDiff++;
});
const out = {
  op, group: { start: group.start, end: group.end, clips: group.clipIds.length }, rampS: tx.edit.rampSeconds,
  cliExportOk: pkg.ok, files: pkg.files.length, downloadedFiles: downloaded.length, byteIdenticalToCli: sameAsCli,
  dronesFilesUnchangedVsSource: untouchedFilesIdentical, drones: back.drones.length,
  timingEqual: JSON.stringify(back.timing) === JSON.stringify(show.timing),
  xyzChangedValues: xyzChanged, xyzChangedOutsideEdit: xyzOutside, rgbDiffValues: rgbDiff,
};
console.log(JSON.stringify(out, null, 1));
if (!pkg.ok || sameAsCli !== pkg.files.length || downloaded.length !== pkg.files.length || xyzOutside || rgbDiff || !out.timingEqual)
  throw new Error("Downloaded export does not match the CLI pipeline");
