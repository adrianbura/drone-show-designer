/**
 * VERTICAL STACK ANALYSIS — DIAGNOSTICS ONLY, presentation layer.
 *
 * Reads the pure analyzers in `@/lib/show/diagnostics`. It computes no safety
 * verdict, gates no export and never mutates the show. "Unsafe" wording belongs
 * exclusively to the canonical SafetyValidator.
 */
import { useMemo, useState } from "react";
import { Layers, Info } from "lucide-react";

import {
  VERTICAL_STACK_ANALYSIS_DEFAULTS,
  analyzePointCloudGeometry,
  analyzeTrajectoryVerticalStackRisk,
  analyzeVerticalStackRisk,
} from "@/lib/show/diagnostics";
import type { Vector3Tuple } from "@/lib/show/types";
import { useStudio } from "@/lib/studio/store";

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <>
      <dt className="uppercase tracking-[0.12em]">{label}</dt>
      <dd className={`text-right ${tone ?? "text-foreground"}`}>{value}</dd>
    </>
  );
}

export default function VerticalStackPanel() {
  const { trajectorySet, samplesAtTime, time, setTime } = useStudio();
  const [horizontal, setHorizontal] = useState(
    VERTICAL_STACK_ANALYSIS_DEFAULTS.horizontalThresholdMeters,
  );
  const [vertical, setVertical] = useState(
    VERTICAL_STACK_ANALYSIS_DEFAULTS.minVerticalDifferenceMeters,
  );
  const [showShow, setShowShow] = useState(false);

  const framePoints = useMemo<Vector3Tuple[]>(
    () => samplesAtTime(time).map((s) => s.position as Vector3Tuple),
    [samplesAtTime, time],
  );

  const frame = useMemo(
    () =>
      analyzeVerticalStackRisk(framePoints, {
        horizontalThresholdMeters: horizontal,
        minVerticalDifferenceMeters: vertical,
        maxReportedPairs: 20,
      }),
    [framePoints, horizontal, vertical],
  );
  const geometry = useMemo(() => analyzePointCloudGeometry(framePoints), [framePoints]);
  const show = useMemo(
    () =>
      showShow
        ? analyzeTrajectoryVerticalStackRisk(trajectorySet, {
            horizontalThresholdMeters: horizontal,
            minVerticalDifferenceMeters: vertical,
          })
        : null,
    [showShow, trajectorySet, horizontal, vertical],
  );

  const tone = frame.candidatePairCount > 0 ? "text-warning" : "text-muted-foreground";

  return (
    <section className="panel-card" data-testid="vertical-stack-analysis">
      <h2 className="panel-title">
        <Layers className={`size-3.5 ${tone}`} />
        Vertical stack analysis
      </h2>
      <p className="pb-1 text-[10px] leading-relaxed text-muted-foreground">
        INFORMATIONAL — not an export gate and not a safety verdict. Detects pairs that are nearly
        vertically stacked (small horizontal offset, real altitude difference) at the current frame.
        Vertical means world +Y.
      </p>

      <div className="grid grid-cols-2 gap-2 pb-1">
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Horizontal ≤ (m)
          <input
            type="number"
            step={0.5}
            min={0}
            value={horizontal}
            onChange={(e) => setHorizontal(Math.max(0, Number(e.target.value) || 0))}
            className="studio-input text-right font-mono"
            data-testid="vertical-stack-horizontal"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Vertical ≥ (m)
          <input
            type="number"
            step={0.5}
            min={0}
            value={vertical}
            onChange={(e) => setVertical(Math.max(0, Number(e.target.value) || 0))}
            className="studio-input text-right font-mono"
            data-testid="vertical-stack-vertical"
          />
        </label>
      </div>

      <dl
        className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground"
        data-testid="vertical-stack-frame"
      >
        <Row label="frame" value={`${time.toFixed(2)} s`} />
        <Row label="points" value={String(frame.pointCount)} />
        <Row
          label="candidate pairs"
          value={String(frame.candidatePairCount)}
          tone={frame.candidatePairCount > 0 ? "text-right text-warning" : "text-right"}
        />
        <Row
          label="worst horizontal"
          value={
            frame.worstPair ? `${frame.worstPair.horizontalDistanceXZ.toFixed(2)} m` : "—"
          }
        />
        <Row
          label="vertical offset"
          value={frame.worstPair ? `${frame.worstPair.verticalDistance.toFixed(2)} m` : "—"}
        />
        <Row
          label="3D distance"
          value={frame.worstPair ? `${frame.worstPair.distance3D.toFixed(2)} m` : "—"}
        />
        <Row
          label="min horiz (v-sep pairs)"
          value={
            Number.isFinite(frame.minHorizontalAmongVerticallySeparated)
              ? `${frame.minHorizontalAmongVerticallySeparated.toFixed(2)} m`
              : "—"
          }
        />
        <Row label="depth extent Z" value={`${geometry.extentZ.toFixed(2)} m`} />
        <Row label="depth spread σZ" value={`${geometry.depthSpread.toFixed(2)} m`} />
        <Row label="width extent X" value={`${geometry.extentX.toFixed(2)} m`} />
        <Row label="altitude extent Y" value={`${geometry.extentY.toFixed(2)} m`} />
        <Row label="depth↔height corr" value={geometry.depthHeightCorrelation.toFixed(3)} />
        <Row
          label="plane tilt"
          value={geometry.planeTiltDegrees === null ? "—" : `${geometry.planeTiltDegrees.toFixed(1)}°`}
        />
        <Row
          label="plane residual"
          value={geometry.planeResidualRms === null ? "—" : `${geometry.planeResidualRms.toFixed(2)} m`}
        />
      </dl>

      {frame.candidates.length > 0 && (
        <ul className="max-h-32 space-y-1 overflow-y-auto pt-1" data-testid="vertical-stack-pairs">
          {frame.candidates.map((c) => (
            <li
              key={`${c.indexA}-${c.indexB}`}
              className="flex justify-between gap-2 font-mono text-[10px] text-muted-foreground"
            >
              <span className="truncate">
                {c.labelA} ↕ {c.labelB}
              </span>
              <span className="text-warning">
                h {c.horizontalDistanceXZ.toFixed(2)} / v {c.verticalDistance.toFixed(2)} m
              </span>
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={() => setShowShow((v) => !v)}
        className="chip-btn mt-2 w-full justify-center"
        data-testid="vertical-stack-show-toggle"
      >
        {showShow ? "Hide show-wide sampled analysis" : "Analyse whole show (sampled)"}
      </button>

      {show && (
        <dl
          className="grid grid-cols-2 gap-x-3 gap-y-1 pt-2 font-mono text-[10px] text-muted-foreground"
          data-testid="vertical-stack-show"
        >
          <Row label="analysis rate" value={`${show.analysisSampleRateHz} Hz`} />
          <Row label="frames" value={String(show.framesAnalyzed)} />
          <Row
            label="frames w/ candidates"
            value={`${show.framesWithCandidates} (${show.framePercentWithCandidates.toFixed(1)}%)`}
          />
          <Row label="affected pairs" value={String(show.affectedPairCount)} />
          <Row
            label="first risk"
            value={show.firstRiskTime === null ? "—" : `${show.firstRiskTime.toFixed(2)} s`}
          />
          <Row
            label="last risk"
            value={show.lastRiskTime === null ? "—" : `${show.lastRiskTime.toFixed(2)} s`}
          />
          <Row
            label="worst time"
            value={show.worstTime === null ? "—" : `${show.worstTime.toFixed(2)} s`}
          />
          <Row
            label="worst pair"
            value={show.worstPair ? `${show.worstPair.labelA}↕${show.worstPair.labelB}` : "—"}
          />
        </dl>
      )}

      {show?.worstTime != null && (
        <button
          onClick={() => setTime(show.worstTime!)}
          className="chip-btn mt-2 w-full justify-center"
        >
          Go to worst time
        </button>
      )}

      <p className="flex gap-1 pt-2 text-[10px] leading-relaxed text-muted-foreground">
        <Info className="mt-[1px] size-3 shrink-0" />
        <span>
          Sampled-time analysis: only analysed frames are inspected, so an occurrence entirely
          between frames can be missed. This never replaces continuous 3D conflict detection, and
          thresholds above are analysis values, not certified limits.
        </span>
      </p>
    </section>
  );
}
