/**
 * EXPORT PREFLIGHT — presentation only.
 *
 * Reads the pure model from `buildExportPreflight` (which itself only reads the
 * canonical full-show report, ownership summary and imported clocks). Nothing
 * here computes safety, eligibility or geometry.
 */
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldAlert } from "lucide-react";

import { buildExportPreflight, type PreflightStatus } from "@/lib/adapters/exportPreflight";
import { useStudio } from "@/lib/studio/store";

const STATUS_CLASS: Record<PreflightStatus, string> = {
  READY: "border-safe/60 bg-safe/10 text-safe",
  WARNING: "border-warning/60 bg-warning/10 text-warning",
  BLOCKED: "border-destructive/60 bg-destructive/10 text-destructive",
  STALE: "border-warning/60 bg-warning/10 text-warning",
  NOT_ANALYZED: "border-border bg-muted/30 text-muted-foreground",
};

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <>
      <dt className="uppercase tracking-[0.12em]">{label}</dt>
      <dd className={`text-right ${tone ?? "text-foreground"}`}>{value}</dd>
    </>
  );
}

export default function ExportPreflight() {
  const {
    project,
    plan,
    fullShowReport,
    fullShowStale,
    analysisRevision,
    referenceOwnership,
    esspPreflightSource,
    hasEsspSourceFiles,
    analyzeFullShow,
    fullShowBusy,
  } = useStudio();

  const model = buildExportPreflight({
    droneCount: project.droneCount,
    showDuration: plan.duration,
    report: fullShowReport,
    stale: fullShowStale,
    currentRevision: analysisRevision,
    referenceSource: esspPreflightSource,
    ownership: referenceOwnership,
    hasSourceFiles: hasEsspSourceFiles,
  });

  const StatusIcon =
    model.status === "READY" ? CheckCircle2 : model.status === "BLOCKED" ? ShieldAlert : AlertTriangle;

  return (
    <div
      className="space-y-2 rounded border border-border/70 p-2"
      data-testid="export-preflight"
    >
      <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Generated flight output — preflight
      </p>

      <div
        className={`flex items-start gap-2 rounded border p-2 ${STATUS_CLASS[model.status]}`}
        data-testid="preflight-status"
      >
        <StatusIcon className="mt-0.5 size-3.5 shrink-0" />
        <div className="space-y-0.5">
          <p className="font-mono text-[11px] font-semibold tracking-wide">
            {model.status.replace("_", " ")}
          </p>
          <p className="text-[10px] leading-relaxed">{model.statusDetail}</p>
        </div>
      </div>

      {model.needsValidation && (
        <button
          onClick={analyzeFullShow}
          disabled={fullShowBusy}
          className="chip-btn w-full justify-center disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="preflight-run-validation"
        >
          {fullShowBusy ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          {fullShowBusy ? "Analyzing…" : "Run full-show validation"}
        </button>
      )}

      {model.profileStatus === "EXPERIMENTAL_PROFILE" ? (
        <div
          className="rounded border border-destructive/60 bg-destructive/10 p-2 text-destructive"
          data-testid="preflight-experimental-profile"
        >
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wide">
            Experimental ESSP profile
          </p>
          <p className="font-mono text-[10px] uppercase tracking-wide">
            Reverse-engineered · not hardware verified
          </p>
        </div>
      ) : (
        <div
          className="rounded border border-border bg-muted/30 p-2 text-muted-foreground"
          data-testid="preflight-source-profile"
        >
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wide text-foreground">
            Source profile
          </p>
          <p className="text-[10px] leading-relaxed">
            Original ESSP header/profile reused where applicable. Reverse-engineered format, no vendor
            certification. Validation is still required.
          </p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
        <Row label="drones" value={String(model.droneCount)} />
        <Row label="duration" value={`${model.showDurationSeconds.toFixed(1)} s`} />
        <Row
          label="validation"
          value={model.revisionFresh ? "current" : model.validationRevision ? "stale" : "none"}
        />
        <Row
          label="revision"
          value={(model.validationRevision ?? model.currentRevision).slice(0, 10)}
        />
        <Row label="splice" value={model.spliceStatus.replace("_", " ").toLowerCase()} />
        {model.metrics.map((m) => (
          <Row key={m.label} label={m.label} value={m.value} />
        ))}
        <Row label="essp position rate" value={`${model.positionRateHz} Hz`} />
        <Row label="essp rgb rate" value={`${model.rgbRateHz} Hz`} />
        <Row label="output mode" value={model.outputMode.replace("_", " ").toLowerCase()} />
      </dl>

      {model.ownership && (
        <div
          className="rounded border border-border/70 p-2 font-mono text-[10px] text-muted-foreground"
          data-testid="preflight-ownership"
        >
          <p className="pb-1 font-semibold uppercase tracking-wide text-foreground">
            {model.ownership.authority.replace("_", " ").toLowerCase()}
          </p>
          <p>Reference-owned intervals: {model.ownership.referenceIntervals}</p>
          <p>Planner-owned intervals: {model.ownership.plannerIntervals}</p>
          <p className="pt-0.5 not-italic">Informational only.</p>
        </div>
      )}

      {model.blockers.length > 0 && (
        <ul
          className="list-disc space-y-0.5 rounded border border-destructive/60 bg-destructive/10 p-2 pl-5 text-[10px] leading-relaxed text-destructive"
          data-testid="preflight-blockers"
        >
          {model.blockers.slice(0, 8).map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}

      {model.warnings.length > 0 && (
        <ul
          className="list-disc space-y-0.5 rounded border border-warning/60 bg-warning/10 p-2 pl-5 text-[10px] leading-relaxed text-warning"
          data-testid="preflight-warnings"
        >
          {model.warnings.slice(0, 8).map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
