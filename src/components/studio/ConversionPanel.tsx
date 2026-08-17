import { Check, Crosshair, GitCompare, Layers, RefreshCw, X } from "lucide-react";

import type { ComparisonMode, ConversionMode } from "@/lib/import/essp/conversion";
import { useStudio } from "@/lib/studio/store";

const STATUS_CLASS: Record<string, string> = {
  EXCELLENT: "text-safe",
  GOOD: "text-safe",
  APPROXIMATE: "text-warning",
  POOR: "text-critical",
};

const COMPARISON_MODES: ComparisonMode[] = ["ORIGINAL", "RECONSTRUCTED", "OVERLAY", "ERROR_VECTORS"];

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={`text-right ${className ?? "text-foreground"}`}>{value}</dd>
    </>
  );
}

/**
 * REFERENCE SEGMENT -> EDITABLE DYNAMIC FORMATION.
 *
 * Conversion is a proposal first: nothing is added to the project until Apply,
 * and the imported reference show is never modified. Every accuracy claim shown
 * here is a MEASURED reconstruction error through the native sampler.
 */
export default function ConversionPanel() {
  const {
    referenceShow,
    selectedForensicSegment,
    canConvertSelectedSegment,
    conversionMode,
    setConversionMode,
    conversionTolerance,
    setConversionTolerance,
    conversionRotationFit,
    setConversionRotationFit,
    conversionSuggestGroups,
    setConversionSuggestGroups,
    conversionBusy,
    conversionError,
    conversionProposal,
    analyzeSegmentConversion,
    discardConversionProposal,
    applyConversionProposal,
    comparisonMode,
    setComparisonMode,
    errorVectorScale,
    setErrorVectorScale,
    conversionComparisonFrame,
    seekToConversionWorstFrame,
    appliedConversionFidelity,
    appliedConversionFormationId,
    conversionFidelityStale,
    conversionSourceAvailable,
    recompareConversionToSource,
    conversionTolerancePresets,
    conversionAlgorithmVersion,
    addDynamicClip,
    dynamicReport,
  } = useStudio();

  if (!referenceShow) return null;
  const seg = selectedForensicSegment;
  const proposal = conversionProposal;
  const fidelity = proposal?.fidelityReport;

  return (
    <section className="panel-card">
      <h2 className="panel-title">
        <GitCompare className="size-3.5" /> Segment → dynamic formation
      </h2>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Converts a selected forensic segment into a NEW editable dynamic formation. The reference
        show is read-only and never changed. Accuracy below is measured, not claimed.
      </p>

      {!seg && <p className="text-[10px] text-muted-foreground">Select a forensic segment first.</p>}

      {seg && (
        <div className="space-y-2 pt-1">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
            <Row label="segment" value={seg.id} />
            <Row label="class" value={seg.classification.toLowerCase()} />
            <Row label="start" value={`${seg.startTime.toFixed(2)} s`} />
            <Row label="end" value={`${seg.endTime.toFixed(2)} s`} />
            <Row label="duration" value={`${seg.duration.toFixed(2)} s`} />
            <Row label="drones" value={String(referenceShow.drones.length)} />
            <Row label="converter" value={`v${conversionAlgorithmVersion}`} />
          </dl>

          {!canConvertSelectedSegment && (
            <p className="text-[10px] text-warning">
              {seg.classification} is not a recommended conversion source (takeoff / landing /
              ground phases).
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <select
              value={conversionMode}
              onChange={(e) => setConversionMode(e.target.value as ConversionMode)}
              className="studio-input"
              aria-label="Conversion mode"
            >
              <option value="EXACT_SAMPLED">Exact sampled</option>
              <option value="SIMPLIFIED">Simplified</option>
            </select>
            <select
              value={conversionRotationFit}
              onChange={(e) =>
                setConversionRotationFit(e.target.value as typeof conversionRotationFit)
              }
              className="studio-input"
              aria-label="Rotation fit"
            >
              <option value="KABSCH">Kabsch fit</option>
              <option value="ROBUST">Robust fit</option>
            </select>
          </div>

          {conversionMode === "SIMPLIFIED" && (
            <label className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Tolerance
              <select
                value={conversionTolerance}
                onChange={(e) => setConversionTolerance(Number(e.target.value))}
                className="studio-input w-32"
                aria-label="Reconstruction tolerance"
              >
                <option value={conversionTolerancePresets.HIGH_FIDELITY}>0.01 m — high</option>
                <option value={conversionTolerancePresets.BALANCED}>0.05 m — balanced</option>
                <option value={conversionTolerancePresets.COMPACT}>0.10 m — compact</option>
              </select>
            </label>
          )}

          <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <input
              type="checkbox"
              checked={conversionSuggestGroups}
              onChange={(e) => setConversionSuggestGroups(e.target.checked)}
            />
            Suggest motion groups
          </label>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={analyzeSegmentConversion}
              disabled={conversionBusy}
              className="chip-btn justify-center"
            >
              <RefreshCw className="size-3" /> {conversionBusy ? "Analyzing…" : "Analyze"}
            </button>
            <button
              onClick={discardConversionProposal}
              disabled={!proposal}
              className="chip-btn justify-center"
            >
              <X className="size-3" /> Cancel
            </button>
          </div>

          {conversionError && <p className="text-[10px] text-critical">{conversionError}</p>}

          {proposal && fidelity && (
            <div className="space-y-2 rounded border border-border p-2">
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Fidelity —{" "}
                <span className={STATUS_CLASS[fidelity.status] ?? "text-foreground"}>
                  {fidelity.status}
                </span>{" "}
                <span className="text-muted-foreground">({proposal.nativeSampleSettings.mode})</span>
              </p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
                <Row label="mean" value={`${fidelity.meanErrorMeters.toFixed(4)} m`} />
                <Row label="rms" value={`${fidelity.rmsErrorMeters.toFixed(4)} m`} />
                <Row label="p95" value={`${fidelity.p95ErrorMeters.toFixed(4)} m`} />
                <Row label="p99" value={`${fidelity.p99ErrorMeters.toFixed(4)} m`} />
                <Row label="max" value={`${fidelity.maxErrorMeters.toFixed(4)} m`} />
                <Row label="worst drone" value={fidelity.maxErrorDroneId || "—"} />
                <Row label="worst time" value={`${fidelity.maxErrorTime.toFixed(2)} s`} />
                <Row label="compared" value={String(fidelity.totalComparedPositions)} />
                <Row
                  label="translation err"
                  value={`${fidelity.globalTranslationErrorRms.toFixed(4)} m`}
                />
                <Row
                  label="rotation resid"
                  value={`${fidelity.globalRotationResidualRms.toFixed(4)} m`}
                />
                <Row
                  label="internal err"
                  value={`${fidelity.internalDeformationErrorRms.toFixed(4)} m`}
                />
                <Row label="source frames" value={String(proposal.keyframes.sourceFrames)} />
                <Row label="keyframes" value={String(proposal.keyframes.totalKeyframes)} />
                <Row
                  label="exact keyframes"
                  value={String(proposal.keyframes.exactTotalKeyframes)}
                />
                <Row
                  label="reduction"
                  value={`${(proposal.keyframes.reduction * 100).toFixed(0)}%`}
                />
                <Row
                  label="loop candidate"
                  value={proposal.loop.loopCandidate ? "yes" : "no"}
                />
                <Row
                  label="loop closure"
                  value={`${proposal.loop.loopClosureRms.toFixed(3)} m`}
                />
                <Row
                  label="suggested groups"
                  value={String(proposal.suggestedMotionGroups.length)}
                />
              </dl>

              {proposal.warnings.map((w) => (
                <p key={w} className="text-[10px] text-warning">
                  {w}
                </p>
              ))}

              <div className="grid grid-cols-2 gap-2">
                <select
                  value={comparisonMode}
                  onChange={(e) => setComparisonMode(e.target.value as ComparisonMode)}
                  className="studio-input"
                  aria-label="Comparison mode"
                >
                  {COMPARISON_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m.replace("_", " ").toLowerCase()}
                    </option>
                  ))}
                </select>
                <button onClick={seekToConversionWorstFrame} className="chip-btn justify-center">
                  <Crosshair className="size-3" /> Worst frame
                </button>
              </div>

              {comparisonMode === "ERROR_VECTORS" && (
                <label className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Vector ×{errorVectorScale}
                  <input
                    type="range"
                    min={1}
                    max={200}
                    step={1}
                    value={errorVectorScale}
                    onChange={(e) => setErrorVectorScale(Number(e.target.value))}
                    className="w-28"
                  />
                </label>
              )}
              {comparisonMode === "ERROR_VECTORS" && errorVectorScale > 1 && (
                <p className="text-[10px] text-warning">
                  Error vectors are visually exaggerated ×{errorVectorScale}.
                </p>
              )}
              {conversionComparisonFrame && (
                <p className="font-mono text-[10px] text-muted-foreground">
                  t={conversionComparisonFrame.time.toFixed(3)}s · frame{" "}
                  {conversionComparisonFrame.frameIndex} · rms{" "}
                  {conversionComparisonFrame.rmsError.toFixed(4)} m · max{" "}
                  {conversionComparisonFrame.maxError.toFixed(4)} m
                </p>
              )}

              <button
                onClick={() => applyConversionProposal()}
                className="chip-btn w-full justify-center"
              >
                <Check className="size-3" /> Apply conversion
              </button>
            </div>
          )}

          {appliedConversionFidelity && appliedConversionFormationId && (
            <div className="space-y-1.5 rounded border border-border p-2">
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Applied conversion
              </p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
                <Row label="rms" value={`${appliedConversionFidelity.rmsErrorMeters.toFixed(4)} m`} />
                <Row label="max" value={`${appliedConversionFidelity.maxErrorMeters.toFixed(4)} m`} />
                <Row
                  label="status"
                  value={appliedConversionFidelity.status}
                  className={STATUS_CLASS[appliedConversionFidelity.status] ?? "text-foreground"}
                />
                <Row label="validation" value={dynamicReport?.status ?? "—"} />
              </dl>
              {conversionFidelityStale && (
                <p className="text-[10px] text-warning">MODIFIED SINCE CONVERSION — fidelity is stale.</p>
              )}
              {!conversionSourceAvailable && (
                <p className="text-[10px] text-warning">SOURCE REFERENCE CHANGED / UNAVAILABLE.</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={recompareConversionToSource}
                  className="chip-btn justify-center"
                  disabled={!conversionSourceAvailable}
                >
                  <RefreshCw className="size-3" /> Compare again
                </button>
                <button
                  onClick={() => addDynamicClip(appliedConversionFormationId)}
                  className="chip-btn justify-center"
                >
                  <Layers className="size-3" /> Add to timeline
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
