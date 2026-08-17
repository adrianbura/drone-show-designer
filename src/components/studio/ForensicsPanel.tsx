import { Activity, Download, Radar } from "lucide-react";

import type { ReferenceSegmentClassification } from "@/lib/import/essp/forensics";
import { useStudio } from "@/lib/studio/store";

const SHORT: Record<ReferenceSegmentClassification, string> = {
  GROUND_STATIC: "ground",
  TAKEOFF_ASCENT: "takeoff",
  STATIC_FORMATION: "static",
  POSSIBLE_STAGING: "staging?",
  GLOBAL_TRANSLATION: "translation",
  GLOBAL_ROTATION: "rotation",
  RIGID_MOTION: "rigid",
  DYNAMIC_DEFORMATION: "dynamic",
  FORMATION_TRANSITION: "transition",
  LANDING_DESCENT: "landing",
  UNKNOWN: "unknown",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </>
  );
}

const fmtTime = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

/**
 * REFERENCE FORENSICS — heuristic motion analysis of the imported reference
 * show. Analysis only: the imported tracks are never modified, and labels stay
 * generic unless the operator renames a segment manually.
 */
export default function ForensicsPanel() {
  const {
    referenceShow,
    forensicsReport,
    forensicsBusy,
    forensicsError,
    forensicsPreset,
    setForensicsPreset,
    forensicsStale,
    analyzeReferenceMotion,
    cancelReferenceAnalysis,
    selectedForensicSegmentId,
    selectForensicSegment,
    selectedForensicSegment,
    showForensicActiveDrones,
    setShowForensicActiveDrones,
    labelForensicSegment,
    exportForensicsReport,
  } = useStudio();

  if (!referenceShow) return null;
  const counts = forensicsReport?.counts;
  const seg = selectedForensicSegment;

  return (
    <section className="panel-card">
      <h2 className="panel-title">
        <Radar className="size-3.5" /> Reference forensics
      </h2>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Heuristic segmentation of observed motion. It does not reconstruct the original storyboard
        and never renames formations by meaning.
      </p>

      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          onClick={forensicsBusy ? cancelReferenceAnalysis : analyzeReferenceMotion}
          className="chip-btn justify-center"
        >
          <Activity className="size-3" /> {forensicsBusy ? "Cancel" : "Analyze motion"}
        </button>
        <select
          value={forensicsPreset}
          onChange={(e) => setForensicsPreset(e.target.value as typeof forensicsPreset)}
          className="studio-input"
          aria-label="Threshold preset"
        >
          <option value="CONSERVATIVE">Conservative</option>
          <option value="BALANCED">Balanced</option>
          <option value="SENSITIVE">Sensitive</option>
        </select>
      </div>

      {forensicsError && <p className="text-[10px] text-critical">{forensicsError}</p>}
      {forensicsStale && (
        <p className="text-[10px] text-warning">
          Report is stale — thresholds or source changed. Re-run the analysis.
        </p>
      )}

      {forensicsReport && counts && (
        <div className="space-y-2 pt-1">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
            <Row label="segments" value={String(counts.total)} />
            <Row label="static" value={String(counts.STATIC_FORMATION + counts.GROUND_STATIC)} />
            <Row label="transitions" value={String(counts.FORMATION_TRANSITION)} />
            <Row
              label="rigid"
              value={String(counts.RIGID_MOTION + counts.GLOBAL_ROTATION + counts.GLOBAL_TRANSLATION)}
            />
            <Row label="dynamic" value={String(counts.DYNAMIC_DEFORMATION)} />
            <Row label="unknown" value={String(counts.UNKNOWN)} />
            <Row
              label="takeoff"
              value={
                forensicsReport.takeoffInterval
                  ? `${fmtTime(forensicsReport.takeoffInterval.startTime)}–${fmtTime(forensicsReport.takeoffInterval.endTime)}`
                  : "—"
              }
            />
            <Row
              label="landing"
              value={
                forensicsReport.landingInterval
                  ? `${fmtTime(forensicsReport.landingInterval.startTime)}–${fmtTime(forensicsReport.landingInterval.endTime)}`
                  : "—"
              }
            />
            <Row
              label="staging?"
              value={
                forensicsReport.possibleStaging
                  ? `${fmtTime(forensicsReport.possibleStaging.startTime)}–${fmtTime(forensicsReport.possibleStaging.endTime)}`
                  : "—"
              }
            />
            <Row label="holds" value={String(forensicsReport.holds.length)} />
            <Row label="algorithm" value={`v${forensicsReport.algorithmVersion}`} />
          </dl>

          <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <input
              type="checkbox"
              checked={showForensicActiveDrones}
              onChange={(e) => setShowForensicActiveDrones(e.target.checked)}
            />
            Show active drones
          </label>

          <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
            {forensicsReport.segments.map((s) => (
              <button
                key={s.id}
                onClick={() => selectForensicSegment(s.id)}
                className={`flex w-full items-center justify-between gap-2 rounded border px-2 py-1 text-left text-[10px] ${
                  s.id === selectedForensicSegmentId
                    ? "border-accent bg-accent/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-accent/50"
                }`}
              >
                <span className="truncate">{s.label}</span>
                <span className="font-mono">
                  {fmtTime(s.startTime)} · {s.duration.toFixed(1)}s
                </span>
              </button>
            ))}
          </div>

          {seg && (
            <div className="space-y-1.5 rounded border border-border p-2">
              <input
                value={seg.label}
                onChange={(e) => labelForensicSegment(seg.id, e.target.value)}
                className="studio-input"
                aria-label="Segment label"
              />
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
                <Row label="class" value={SHORT[seg.classification]} />
                <Row label="confidence" value={seg.confidence.toFixed(2)} />
                <Row label="start" value={`${seg.startTime.toFixed(2)} s`} />
                <Row label="end" value={`${seg.endTime.toFixed(2)} s`} />
                <Row label="duration" value={`${seg.duration.toFixed(2)} s`} />
                <Row
                  label="centroid travel"
                  value={`${seg.metrics.centroidTravelMeters.toFixed(2)} m`}
                />
                <Row label="rotation" value={`${seg.metrics.maxRotationDeg.toFixed(1)}°`} />
                <Row label="scale" value={seg.metrics.meanScale.toFixed(3)} />
                <Row label="rigid rms" value={`${seg.metrics.rigidRmsMeters.toFixed(2)} m`} />
                <Row
                  label="deform rms"
                  value={`${seg.metrics.deformationRmsMeters.toFixed(2)} m`}
                />
                <Row
                  label="deform max"
                  value={`${seg.metrics.maxDeformationMeters.toFixed(2)} m`}
                />
                <Row label="net shape Δ" value={`${seg.metrics.netShapeChangeMeters.toFixed(2)} m`} />
                <Row
                  label="active"
                  value={`${(seg.metrics.activeFraction * 100).toFixed(0)}% (${seg.activeDroneIds.length})`}
                />
                <Row label="periodic" value={seg.periodicity.periodic ? "yes" : "no"} />
                <Row
                  label="period"
                  value={
                    seg.periodicity.estimatedPeriodSeconds
                      ? `${seg.periodicity.estimatedPeriodSeconds.toFixed(2)} s`
                      : "—"
                  }
                />
                <Row label="light Δ" value={seg.metrics.lightingChangeEnergy.toFixed(3)} />
              </dl>
            </div>
          )}

          <button onClick={exportForensicsReport} className="chip-btn w-full justify-center">
            <Download className="size-3" /> Export forensics report
          </button>
        </div>
      )}
    </section>
  );
}
