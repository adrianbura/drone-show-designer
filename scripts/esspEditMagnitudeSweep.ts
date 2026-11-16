/**
 * Local Bun CLI only: largest feasible tapered edit per target on a real archive.
 * Usage: bun scripts/esspEditMagnitudeSweep.ts archive.zip [--quick]
 * Every "feasible" verdict is the FULL canonical gate (analyzeFullShow +
 * buildEsspExportPackage) with the derived safety profile; nothing is relaxed.
 * Read-only: the archive and the forensic report are never modified.
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

const zip = process.argv[2];
if (!zip) throw new Error("Usage: bun scripts/esspEditMagnitudeSweep.ts archive.zip");
const entries = Object.entries(
  unzipSync(new Uint8Array(readFileSync(zip)), {
    filter: (e) => /\.essp$/i.test(e.name) && !/(^|\/)\._/.test(e.name),
  }),
).map(([name, bytes]) => ({ name: name.split("/").pop()!, bytes }));
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

type Verdict = { ok: boolean; limit: string; detail?: string };
function classify(text: string): string {
  const t = text.toLowerCase();
  if (t.includes("splice")) return "splice";
  if (t.includes("separation") || t.includes("collision")) return "separation";
  if (t.includes("acceler") || t.includes("a=")) return "acceleration";
  if (t.includes("velocity") || t.includes("speed") || t.includes("v=")) return "velocity";
  if (t.includes("altitude") || t.includes("ground")) return "altitude";
  if (t.includes("area") || t.includes("boundary") || t.includes("geofence")) return "area";
  return text.slice(0, 60);
}
function fullGate(clipIds: readonly string[], op: AgentOp): Verdict {
  const prepared = prepareImportedEdit(project, show, layer, clipIds, op, ctx);
  if (!prepared.ok) {
    const r = prepared.reason;
    const v = /v=([\d.]+)\/([\d.]+)/.exec(r), a = /a=([\d.]+)\/([\d.]+)/.exec(r);
    const lim = v && Number(v[1]) > Number(v[2]) ? "velocity" : a && Number(a[1]) > Number(a[2]) ? "acceleration" : classify(r);
    return { ok: false, limit: lim, detail: r };
  }
  const tx = prepared.transaction;
  const analyzed = analyzeFullShow(tx.project, { ...ctx, sampleRate: show.timing.positionRateHz, reference: { show, layer: tx.layer } });
  const pkg = buildEsspExportPackage({ project: tx.project, plan: buildShowPlan(tx.project, ctx), reference: { show, layer: tx.layer }, fullShow: analyzed.report, fullShowStale: false });
  if (pkg.ok && analyzed.report.splice?.ok !== false) return { ok: true, limit: "-" };
  const first = JSON.stringify(pkg.blockers[0] ?? analyzed.report.splice ?? "unknown");
  return { ok: false, limit: classify(first), detail: first.slice(0, 160) };
}
/** Largest magnitude m in (0, hi] passing gate(m); exponential then bisection. */
function largest(gate: (m: number) => Verdict, lo: number, hi: number, iters: number) {
  let best = 0, failLimit = "none (cap)";
  let probe = lo;
  for (;;) {
    const v = gate(probe);
    if (!v.ok) { failLimit = v.limit; hi = probe; break; }
    best = probe;
    if (probe >= hi) return { best, limit: "cap" };
    probe = Math.min(hi, probe * 2);
  }
  for (let i = 0; i < iters; i++) {
    const mid = (best + hi) / 2;
    const v = gate(mid);
    if (v.ok) best = mid; else { hi = mid; failLimit = v.limit; }
  }
  return { best, limit: failLimit };
}

const groups = clipSceneGroups(report, layer);
const dur = (g: (typeof groups)[number]) => g.end - g.start;
const dyn = groups.filter((g) => g.kind === "DYNAMIC");
const pick = [
  { name: "dynamic multi-segment (Stage 3)", g: dyn.find((g) => g.clipIds.length > 1) },
  { name: "static (Stage 3)", g: groups.find((g) => g.kind === "STATIC") },
  { name: "shortest group", g: [...groups].sort((a, b) => dur(a) - dur(b))[0] },
  { name: "longest group", g: [...groups].sort((a, b) => dur(b) - dur(a))[0] },
];
const quick = process.argv.includes("--quick");
const iters = quick ? 3 : 5;
const rows: unknown[] = [];
for (const { name, g } of pick) {
  if (!g) continue;
  const guard = 2 / show.timing.positionRateHz;
  const probe = prepareImportedEdit(project, show, layer, g.clipIds, { kind: "MOVE_SCENE", offset: [0, 0.001, 0] }, ctx);
  const ramp = probe.ok ? probe.transaction.edit.rampSeconds : NaN;
  const row: Record<string, unknown> = { target: name, kind: g.kind, start: g.start, durationS: +dur(g).toFixed(3), clips: g.clipIds.length, rampS: +ramp.toFixed(3), guardS: guard };
  const t0 = performance.now();
  for (const axis of [0, 1, 2] as const) {
    const r = largest((m) => fullGate(g.clipIds, { kind: "MOVE_SCENE", offset: [0, 1, 2].map((i) => (i === axis ? m : 0)) as [number, number, number] }), 0.05, 50, iters);
    row[`move${"XYZ"[axis]}_m`] = { max: +r.best.toFixed(3), limit: r.limit };
  }
  const rot = largest((m) => fullGate(g.clipIds, { kind: "ROTATE_SCENE", axis: "Y", degrees: m }), 0.25, 180, iters);
  row.rotateY_deg = { max: +rot.best.toFixed(2), limit: rot.limit };
  const up = largest((m) => fullGate(g.clipIds, { kind: "SCALE_SCENE", factor: 1 + m }), 0.005, 1, iters);
  row.scaleUp = { max: +(1 + up.best).toFixed(4), limit: up.limit };
  const down = largest((m) => fullGate(g.clipIds, { kind: "SCALE_SCENE", factor: 1 - m }), 0.005, 0.5, iters);
  row.scaleDown = { min: +(1 - down.best).toFixed(4), limit: down.limit };
  const realistic: Record<string, string> = {};
  for (const [label, op] of [
    ["move Y 1 m", { kind: "MOVE_SCENE", offset: [0, 1, 0] }],
    ["move Y 5 m", { kind: "MOVE_SCENE", offset: [0, 5, 0] }],
    ["move X 1 m", { kind: "MOVE_SCENE", offset: [1, 0, 0] }],
    ["rotate Y 5°", { kind: "ROTATE_SCENE", axis: "Y", degrees: 5 }],
    ["rotate Y 20°", { kind: "ROTATE_SCENE", axis: "Y", degrees: 20 }],
    ["scale 0.9", { kind: "SCALE_SCENE", factor: 0.9 }],
    ["scale 1.2", { kind: "SCALE_SCENE", factor: 1.2 }],
  ] as [string, AgentOp][]) {
    const v = fullGate(g.clipIds, op);
    realistic[label] = v.ok ? "ACCEPTED" : `REFUSED (${v.limit})`;
  }
  row.realistic = realistic;
  row.seconds = +((performance.now() - t0) / 1000).toFixed(1);
  rows.push(row);
  console.log(JSON.stringify(row));
}
console.log(JSON.stringify({ policy: process.env.RAMP_POLICY ?? "default", rows }));
