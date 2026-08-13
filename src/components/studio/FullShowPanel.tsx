import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { FullShowIssueCategory, FullShowIssueSeverity } from "@/lib/show/fullshow";
import { useStudio } from "@/lib/studio/store";

const CATEGORY_LABEL: Record<FullShowIssueCategory, string> = {
  timeline: "Timeline",
  continuity: "Continuity",
  conflict: "Proximity",
  safety: "Safety",
  homePads: "Home pads",
  takeoff: "Take-off",
  landing: "Landing",
  lighting: "Lighting",
  transition: "Transition",
};

const SEVERITY_ORDER: FullShowIssueSeverity[] = ["error", "warning", "info"];

function num(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "n/a";
  return v.toFixed(digits);
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="uppercase tracking-[0.14em]">{label}</dt>
      <dd className="font-mono text-foreground">{value}</dd>
    </div>
  );
}

export default function FullShowPanel() {
  const {
    fullShowReport: report,
    fullShowBusy,
    fullShowProgress,
    fullShowStale,
    fullShowError,
    analyzeFullShow,
    cancelFullShowAnalysis,
    clearFullShowReport,
    focusIssue,
  } = useStudio();
  const [filter, setFilter] = useState<"all" | FullShowIssueSeverity>("all");

  const issues = useMemo(() => {
    if (!report) return [];
    const list = filter === "all" ? report.issues : report.issues.filter((i) => i.severity === filter);
    return [...list].sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
        (a.time ?? Infinity) - (b.time ?? Infinity),
    );
  }, [report, filter]);

  return (
    <section className="panel-card">
      <h2 className="panel-title">
        <ShieldAlert className="size-3.5" /> Full show validation
      </h2>

      <div className="flex items-center gap-2">
        <button
          onClick={analyzeFullShow}
          disabled={fullShowBusy}
          className="chip-btn flex-1 justify-center"
        >
          {fullShowBusy ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          {fullShowBusy ? "Analyzing…" : "Analyze full show"}
        </button>
        {fullShowBusy && (
          <button onClick={cancelFullShowAnalysis} className="chip-btn justify-center">
            Cancel
          </button>
        )}
        {report && !fullShowBusy && (
          <button onClick={clearFullShowReport} className="chip-btn justify-center">
            Clear
          </button>
        )}
      </div>

      {fullShowBusy && fullShowProgress && (
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          step {fullShowProgress.step}/{fullShowProgress.totalSteps} · {fullShowProgress.label}
        </p>
      )}

      {fullShowError && (
        <p className="rounded border border-destructive/60 bg-destructive/10 p-2 text-[11px] text-destructive">
          {fullShowError.code}: {fullShowError.message}
        </p>
      )}

      {!report && !fullShowBusy && (
        <p className="text-xs text-muted-foreground">
          Composes TAKEOFF → SHOW → LANDING into one trajectory set and validates timing,
          continuity, proximity, flight limits, home pads and the light program.
        </p>
      )}

      {report && (
        <div className="space-y-3">
          <div
            className={`flex items-start gap-2 rounded border p-2 text-[11px] ${
              report.status === "FAIL"
                ? "border-destructive/60 bg-destructive/10 text-destructive"
                : report.status === "PASS_WITH_WARNINGS"
                  ? "border-warning/50 bg-warning/10 text-warning"
                  : "border-safe/50 bg-safe/10 text-safe"
            }`}
          >
            {report.status === "FAIL" ? (
              <XCircle className="mt-[1px] size-3.5 shrink-0" />
            ) : report.status === "PASS_WITH_WARNINGS" ? (
              <AlertTriangle className="mt-[1px] size-3.5 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-[1px] size-3.5 shrink-0" />
            )}
            <span>
              <strong className="font-mono">{report.status.replace(/_/g, " ")}</strong> —{" "}
              {report.errors.length} errors, {report.warnings.length} warnings
            </span>
          </div>

          {fullShowStale && (
            <p className="flex items-start gap-1.5 rounded border border-warning/50 bg-warning/10 p-2 text-[11px] text-warning">
              <Info className="mt-[1px] size-3.5 shrink-0" />
              The project changed after this report was produced. Re-run the analysis before trusting
              or exporting it.
            </p>
          )}

          <p className="text-[10px] leading-relaxed text-muted-foreground">{report.statement}</p>

          <dl className="space-y-1 text-[11px] text-muted-foreground">
            <Metric label="drones" value={String(report.droneCount)} />
            <Metric label="duration" value={`${num(report.showDuration, 1)} s`} />
            <Metric label="sample rate" value={`${report.sampleRate} Hz`} />
            <Metric
              label="min separation"
              value={`${num(report.metrics.minimumDynamicSeparation)} m`}
            />
            <Metric label="max velocity" value={`${num(report.metrics.maximumVelocity)} m/s`} />
            <Metric label="max accel" value={`${num(report.metrics.maximumAcceleration)} m/s²`} />
            <Metric label="max jerk" value={`${num(report.metrics.maximumJerk)} m/s³`} />
            <Metric label="conflicts" value={String(report.metrics.totalConflictCount)} />
            <Metric
              label="distance flown"
              value={`${num(report.metrics.totalDistanceFlown / 1000, 2)} km`}
            />
            <Metric
              label="landed on pad"
              value={`${report.continuity.landedCount}/${report.droneCount}`}
            />
            <Metric
              label="transitions"
              value={`${report.analyzedTransitions}/${report.transitionCount} analysed`}
            />
            <Metric label="runtime" value={`${num(report.metrics.validationRuntimeMs, 0)} ms`} />
            <Metric
              label="memory est."
              value={`${num(report.metrics.trajectoryMemoryEstimateBytes / 1e6, 1)} MB`}
            />
          </dl>

          <div>
            <h3 className="pb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Phases
            </h3>
            <ul className="space-y-1">
              {report.phaseReports.map((p) => (
                <li
                  key={`${p.phase}-${p.start}`}
                  className="flex items-center justify-between gap-2 rounded border border-border/70 px-2 py-1 text-[10px] text-muted-foreground"
                >
                  <span className="font-mono text-foreground">{p.phase}</span>
                  <span className="font-mono">
                    {num(p.start, 0)}–{num(p.end, 0)}s · sep {num(p.minSeparation)} m · v{" "}
                    {num(p.maxVelocity, 1)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="flex items-center justify-between pb-1">
              <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Issues ({issues.length})
              </h3>
              <div className="flex gap-1">
                {(["all", "error", "warning", "info"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                      filter === f ? "bg-accent/20 text-accent" : "text-muted-foreground"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {issues.length === 0 && (
                <li className="text-[11px] text-safe">
                  No issue in this category for the composed show.
                </li>
              )}
              {issues.slice(0, 200).map((issue) => (
                <li key={issue.id}>
                  <button
                    onClick={() => focusIssue(issue)}
                    className={`issue-row ${issue.severity === "error" ? "issue-row-critical" : ""}`}
                  >
                    <span className="font-mono text-[10px]">
                      {typeof issue.time === "number" ? `${issue.time.toFixed(1)}s` : "—"}
                    </span>
                    <span className="truncate">
                      <span className="font-mono text-[9px] uppercase tracking-wider opacity-70">
                        {CATEGORY_LABEL[issue.category]}
                      </span>{" "}
                      {issue.message}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded border border-border/70 p-2 text-[10px] text-muted-foreground">
            <p className="font-mono uppercase tracking-[0.16em]">
              export: {report.exportReadiness.status.replace(/_/g, " ")}
            </p>
            <p className="pt-1 font-mono leading-relaxed">
              {report.showPackageId} · engine {report.engineVersion}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
