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
import { applyAgentOpToGroup } from "../src/lib/agent/operations";
import { clipSceneGroups } from "../src/lib/import/essp/native/sceneGroups";
import { reconcileReferenceLayer } from "../src/lib/import/essp/native/intervals";
import { sampleEffectiveTrajectorySet } from "../src/lib/show/fullshow/effective";
import { sampleReferenceShow } from "../src/lib/import/essp/playback";
import { prepareImportedEdit } from "../src/lib/import/essp/native/editTransaction";
import type { AgentOp } from "../src/lib/agent/operations";

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

// Optional real-archive edit probe; never writes back to the imported archive.
if (process.argv.includes("--edit")) {
  const targets = clipSceneGroups(report, layer);
  const selected = [
    targets.find((g) => g.kind === "DYNAMIC" && g.clipIds.length > 1),
    targets.find((g) => g.kind === "STATIC"),
  ];
  const ops: AgentOp[] = [
    { kind: "MOVE_SCENE", offset: [0, 0.03, 0] },
    { kind: "ROTATE_SCENE", axis: "Y", degrees: 0.1 },
    { kind: "SCALE_SCENE", factor: 1.001 },
  ];
  for (const target of selected)
    for (const op of ops) {
      if (!target) throw new Error("Required dynamic/static target missing");
      const prepared = prepareImportedEdit(project, show, layer, target.clipIds, op, ctx);
      if (!prepared.ok) throw new Error(prepared.reason);
      const tx = prepared.transaction,
        edited = tx.project;
      const rec = {
        layer: tx.layer,
        promotions: tx.layer.bindings.filter((b) => b.owner === "PLANNER"),
      };
      const analyzed = analyzeFullShow(edited, {
        ...ctx,
        sampleRate: show.timing.positionRateHz,
        reference: { show, layer: rec.layer },
      });
      const editedPlan = buildShowPlan(edited, ctx);
      const exported = buildEsspExportPackage({
        project: edited,
        plan: editedPlan,
        reference: { show, layer: rec.layer },
        fullShow: analyzed.report,
        fullShowStale: false,
      });
      let worstPosition = 0;
      let rgbMismatchesOutside = 0;
      let roundTrip = null;
      let xyzMismatchesOutside = 0,
        changedXyzValues = 0,
        rgbMismatchesTotal = 0;
      if (exported.ok) {
        const back = await buildReferenceShow(
          exported.files.map((f) => ({ name: f.name, bytes: f.bytes })),
        );
        const effective = sampleEffectiveTrajectorySet(editedPlan, {
          sampleRate: show.timing.positionRateHz,
          startTime: 0,
          endTime: show.timing.positionDurationSeconds,
          reference: { show, layer: rec.layer },
        }).set;
        for (let f = 0; f < show.timing.positionSampleCount; f++) {
          const samples = sampleReferenceShow(back, f / show.timing.positionRateHz);
          samples.forEach((s, i) => {
            const expected = effective.drones[i]?.samples[f]?.position;
            if (!expected) throw new Error("Missing effective sample");
            worstPosition = Math.max(
              worstPosition,
              Math.hypot(...s.position.map((v, axis) => v - (expected[axis] ?? 0))),
            );
            const source = show.drones[i],
              drone = back.drones[i];
            if (!source || !drone) throw new Error("Missing drone");
            for (let axis = 0; axis < 3; axis++)
              if (source.positionSamples[f * 3 + axis] !== drone.positionSamples[f * 3 + axis]) {
                changedXyzValues++;
                const t = f / show.timing.positionRateHz;
                if (t < tx.edit.start || t >= tx.edit.end) xyzMismatchesOutside++;
              }
          });
        }
        for (let f = 0; f < show.timing.rgbSampleCount; f++) {
          const t = f / show.timing.rgbRateHz;
          back.drones.forEach((d, i) => {
            const source = show.drones[i];
            if (!source) throw new Error("Missing source drone");
            for (let axis = 0; axis < 3; axis++)
              if (d.rgbSamples[f * 3 + axis] !== source.rgbSamples[f * 3 + axis]) {
                rgbMismatchesTotal++;
                if (t < tx.edit.start || t >= tx.edit.end) rgbMismatchesOutside++;
              }
          });
        }
        roundTrip = {
          drones: back.drones.length,
          timing: back.timing,
          worstPositionMeters: worstPosition,
          rgbMismatchesOutside,
        };
      }
      console.log(
        JSON.stringify(
          {
            op: op.kind,
            editGroup: target,
            promoted: rec.promotions.length,
            exportOk: exported.ok,
            splice: analyzed.report.splice,
            maxVelocity: analyzed.report.metrics.maximumVelocity,
            maxAcceleration: analyzed.report.metrics.maximumAcceleration,
            xyzMismatchesOutside,
            changedXyzValues,
            rgbMismatchesTotal,
            roundTrip,
            reportUnchanged: JSON.stringify(report) === reportBefore,
          },
          null,
          1,
        ),
      );
      if (
        !exported.ok ||
        !analyzed.report.splice?.ok ||
        !roundTrip ||
        worstPosition > 0.009 ||
        xyzMismatchesOutside ||
        rgbMismatchesTotal ||
        !changedXyzValues ||
        backTimingMismatch(roundTrip.timing, show.timing) ||
        JSON.stringify(report) !== reportBefore
      )
        throw new Error("Edited export acceptance failed");
    }
  const target = selected[0];
  if (!target) throw new Error("target");
  const impossible = prepareImportedEdit(
    project,
    show,
    layer,
    target.clipIds,
    { kind: "MOVE_SCENE", offset: [0, 200, 0] },
    ctx,
  );
  if (impossible.ok) throw new Error("Infeasible edit incorrectly accepted");
  console.log(JSON.stringify({ infeasibleRefused: true, reason: impossible.reason }));
}
function backTimingMismatch(a: typeof show.timing, b: typeof show.timing) {
  return JSON.stringify(a) !== JSON.stringify(b);
}
if (!pkg.ok || identical !== 150 || JSON.stringify(report) !== reportBefore)
  throw new Error("Untouched fidelity failed");
