/** Local Bun CLI only: read-only comparison of two saved RGB audit JSON reports. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const [aPath, bPath, outPath] = process.argv.slice(2);
if (!aPath || !bPath || !outPath)
  throw new Error("Usage: bun scripts/compareRgbAudits.ts a.json b.json out.md");
type I = {
  id: string;
  origin: string;
  start: number;
  end: number;
  spatial: { status: string };
  coverage: { rgbSamples: number; pairedSamples: number; pairedFraction: number | null };
  colors: { darkFraction: number | null; distinctRgb: number };
  channels: { channel: string; meanFit: number | null }[];
  totalFit: { energyWeightedFit: number | null };
};
const load = (p: string) => {
  const raw = readFileSync(p);
  return { sha: createHash("sha256").update(raw).digest("hex"), r: JSON.parse(raw.toString()) };
};
const A = load(aPath),
  B = load(bPath);
const f = (v: number | null | undefined, d = 3) =>
  v === null || v === undefined || !Number.isFinite(v) ? "unknown" : v.toFixed(d);
const full = (r: { intervals: I[] }) => r.intervals.find((i) => i.origin === "FULL_SHOW")!;
const win = (r: { intervals: I[] }) => r.intervals.filter((i) => i.origin === "WINDOW");
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]! : null;
};
const stats = (xs: number[]) =>
  xs.length
    ? `${f(q(xs, 0))} / ${f(q(xs, 0.25))} / ${f(q(xs, 0.5))} / ${f(q(xs, 0.75))} / ${f(q(xs, 1))}`
    : "unknown";
const status = (ws: I[]) => {
  const m = new Map<string, number>();
  ws.forEach((w) => m.set(w.spatial.status, (m.get(w.spatial.status) ?? 0) + 1));
  return [...m]
    .sort()
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
};
const nums = (ws: I[], g: (w: I) => number | null) =>
  ws.map(g).filter((v): v is number => v !== null && Number.isFinite(v));
const rows: string[] = [];
const side = (label: string, x: { sha: string; r: ReturnType<typeof JSON.parse> }) => {
  const fs = full(x.r),
    c = x.r.clocks;
  rows.push(
    `| ${label} | ${x.r.provenance.archiveName} | ${x.r.provenance.archiveSha256.slice(0, 12)}… | ${x.r.mode ?? "BENCHMARK (pre-mode field)"} | ${c.positionRateHz} Hz / ${c.positionSampleCount} | ${c.rgbRateHz} Hz / ${c.rgbSampleCount} | ${f(c.playbackDurationSeconds, 2)} | ${fs.coverage.pairedSamples}/${fs.coverage.rgbSamples} (${f(fs.coverage.pairedFraction, 4)}) | ${f(fs.colors.darkFraction)} | ${fs.channels.map((ch) => f(ch.meanFit)).join(" / ")} | ${f(fs.totalFit.energyWeightedFit)} | ${fs.spatial.status} |`,
  );
};
side("A", A);
side("B", B);
const wa = win(A.r),
  wb = win(B.r);
const top = (ws: I[], label: string) =>
  [...ws]
    .map((w) => ({ w, fit: w.totalFit.energyWeightedFit }))
    .filter((x) => x.fit !== null)
    .sort((x, y) => y.fit! - x.fit! || x.w.start - y.w.start)
    .slice(0, 5)
    .map(
      ({ w }) =>
        `| ${label} | ${w.id} | ${f(w.start, 2)}–${f(w.end, 2)} | ${w.spatial.status} | ${f(w.totalFit.energyWeightedFit)} | ${f(w.colors.darkFraction)} |`,
    );
const n = Math.min(wa.length, wb.length);
const diffs = Array.from({ length: n }, (_, i) => ({
  a: wa[i]!,
  b: wb[i]!,
  d: Math.abs((wa[i]!.colors.darkFraction ?? 0) - (wb[i]!.colors.darkFraction ?? 0)),
}))
  .sort((x, y) => y.d - x.d || x.a.start - y.a.start)
  .slice(0, 8)
  .map(
    ({ a, b, d }) =>
      `| ${a.id} | ${f(a.start, 2)}–${f(a.end, 2)} / ${f(b.start, 2)}–${f(b.end, 2)} | ${f(a.colors.darkFraction)} | ${f(b.colors.darkFraction)} | ${f(d)} | ${f(a.totalFit.energyWeightedFit)} | ${f(b.totalFit.energyWeightedFit)} |`,
  );
const md = [
  "# Read-only RGB audit comparison",
  "",
  `A source: \`${aPath}\` (JSON sha256 ${A.sha})`,
  `B source: \`${bPath}\` (JSON sha256 ${B.sha})`,
  "",
  "Recipe: UNKNOWN for both. Shows are different productions; intervals are compared only by clock time, never as equivalent scenes.",
  "",
  "## Full show",
  "",
  "| Side | Archive | Archive SHA | Mode | XYZ rate / samples | RGB rate / samples | Duration (s) | Paired/RGB | Dark | Fit R/G/B | Energy fit | Status |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...rows,
  "",
  "## 5 s windows",
  "",
  "| Metric | A | B |",
  "|---|---|---|",
  `| Window count | ${wa.length} | ${wb.length} |`,
  `| Status counts | ${status(wa)} | ${status(wb)} |`,
  `| Dark fraction min/q1/median/q3/max | ${stats(nums(wa, (w) => w.colors.darkFraction))} | ${stats(nums(wb, (w) => w.colors.darkFraction))} |`,
  `| Energy fit min/q1/median/q3/max | ${stats(nums(wa, (w) => w.totalFit.energyWeightedFit))} | ${stats(nums(wb, (w) => w.totalFit.energyWeightedFit))} |`,
  `| Distinct RGB per window median | ${f(
    q(
      wa.map((w) => w.colors.distinctRgb),
      0.5,
    ),
    0,
  )} | ${f(
    q(
      wb.map((w) => w.colors.distinctRgb),
      0.5,
    ),
    0,
  )} |`,
  `| Forensic segments | ${A.r.intervals.filter((i: I) => i.origin === "FORENSICS").length} | ${B.r.intervals.filter((i: I) => i.origin === "FORENSICS").length} |`,
  `| Benchmark intervals | ${A.r.intervals.filter((i: I) => i.origin === "BENCHMARK").length} | ${B.r.intervals.filter((i: I) => i.origin === "BENCHMARK").length} |`,
  "",
  "## Highest energy-fit windows (descriptive only)",
  "",
  "| Side | Window | Time (s) | Status | Energy fit | Dark |",
  "|---|---|---|---|---|---|",
  ...top(wa, "A"),
  ...top(wb, "B"),
  "",
  `## Largest dark-fraction differences at the same clock window (first ${n} windows)`,
  "",
  "| Window | Time A / B (s) | Dark A | Dark B | |Δ| | Fit A | Fit B |",
  "|---|---|---|---|---|---|---|",
  ...diffs,
  "",
  "## Limitations",
  "- Same-time windows belong to unrelated choreographies; a difference is not a scene mismatch or error.",
  "- XYZ clocks differ (see table); paired-sample counts reflect each show's own native clocks with interpolated XYZ.",
  "- Fits are in-sample affine fits per tick, not probabilities; low fit is not proof of a specific effect.",
  "- Overlapping intervals are not additive. Forensic segmentation is per-show and not aligned.",
  "- Source audit JSON files are only read; their SHA-256 is listed above.",
  "",
].join("\n");
writeFileSync(outPath, md);
console.log(
  JSON.stringify({ a: A.sha, b: B.sha, windowsA: wa.length, windowsB: wb.length, out: outPath }),
);
