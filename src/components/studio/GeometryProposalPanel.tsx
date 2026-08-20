/**
 * GEOMETRY PROPOSAL — BEFORE / AFTER REVIEW UI. DESIGN PREVIEW ONLY.
 *
 * Consumes the canonical read-only optimizer (`optimizeProjectionPreservingStackProposal`)
 * and comparison model. No staggering logic lives in React, nothing is written
 * to project state, and there is intentionally NO apply command.
 */
import { useEffect, useMemo, useState } from "react";
import { Info, Sparkles } from "lucide-react";

import {
  GEOMETRY_PROPOSAL_DEFAULTS,
  GEOMETRY_PROPOSAL_WORDING,
  VERTICAL_STACK_ANALYSIS_DEFAULTS,
  buildGeometryProposalPreview,
  buildGeometryProposalSummary,
  compareGeometryProposal,
  explainProposalCandidates,
  optimizeProjectionPreservingStackProposal,
  proposedPointsOf,
  type AudienceView,
  type ProposalPreviewMode,
} from "@/lib/show/diagnostics";
import type { Vector3Tuple } from "@/lib/show/types";
import { setGeometryProposalPreview } from "@/lib/studio/geometryProposalPreview";
import { useStudio } from "@/lib/studio/store";

const MODES: ProposalPreviewMode[] = ["BEFORE", "AFTER", "OVERLAY"];

function NumberField({
  label,
  value,
  step = 1,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
  testId: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
      {label}
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="studio-input text-right font-mono"
        data-testid={testId}
      />
    </label>
  );
}

export default function GeometryProposalPanel() {
  const { samplesAtTime, time } = useStudio();

  const [distance, setDistance] = useState(150);
  const [eyeHeight, setEyeHeight] = useState(1.7);
  const [targetHeight, setTargetHeight] = useState(60);
  const [horizontal, setHorizontal] = useState(
    VERTICAL_STACK_ANALYSIS_DEFAULTS.horizontalThresholdMeters,
  );
  const [vertical, setVertical] = useState(
    VERTICAL_STACK_ANALYSIS_DEFAULTS.minVerticalDifferenceMeters,
  );
  const [cap, setCap] = useState<number>(GEOMETRY_PROPOSAL_DEFAULTS.maxDisplacementMeters);
  const [mode, setMode] = useState<ProposalPreviewMode>("OVERLAY");
  const [ghost, setGhost] = useState(false);
  const [showCandidates, setShowCandidates] = useState(false);

  const points = useMemo<Vector3Tuple[]>(
    () => samplesAtTime(time).map((s) => s.position as Vector3Tuple),
    [samplesAtTime, time],
  );

  const view = useMemo<AudienceView>(
    () => ({ viewer: [0, eyeHeight, -Math.abs(distance)], target: [0, targetHeight, 0] }),
    [distance, eyeHeight, targetHeight],
  );

  // Memoised by points + viewpoint + thresholds + proposal options.
  const result = useMemo(() => {
    if (points.length < 2) return null;
    try {
      return optimizeProjectionPreservingStackProposal(points, view, {
        horizontalThresholdMeters: horizontal,
        minVerticalDifferenceMeters: vertical,
        maxDisplacementMeters: cap,
      });
    } catch {
      return null;
    }
  }, [points, view, horizontal, vertical, cap]);

  const best = result?.best ?? null;
  const proposed = useMemo(() => (best ? proposedPointsOf(best) : []), [best]);

  const comparison = useMemo(() => {
    if (!best) return null;
    try {
      return compareGeometryProposal(points, view, best);
    } catch {
      return null;
    }
  }, [best, points, view]);

  const preview = useMemo(
    () => (proposed.length ? buildGeometryProposalPreview(points, proposed, view) : null),
    [points, proposed, view],
  );

  const summary = useMemo(
    () => (result ? buildGeometryProposalSummary(result, comparison) : []),
    [result, comparison],
  );
  const candidates = useMemo(() => (result ? explainProposalCandidates(result) : []), [result]);

  // Ghost preview is ephemeral diagnostic state, never project state.
  useEffect(() => {
    setGeometryProposalPreview(
      ghost && proposed.length ? { enabled: true, original: points, proposed } : null,
    );
    return () => setGeometryProposalPreview(null);
  }, [ghost, points, proposed]);

  const scale = preview ? 260 / Math.max(preview.box.width, preview.box.height) : 1;

  return (
    <section className="panel-card" data-testid="geometry-proposal">
      <h2 className="panel-title">
        <Sparkles className="size-3.5 text-muted-foreground" />
        Geometry proposal
      </h2>
      <p className="pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-warning">
        {GEOMETRY_PROPOSAL_WORDING.header}
      </p>
      <p className="pb-2 text-[10px] leading-relaxed text-muted-foreground">
        Projection-preserving depth staggering proposed by the canonical read-only optimizer. Nothing
        is applied: formations, assignments, planner output, safety thresholds and export are
        untouched.
      </p>

      <div className="grid grid-cols-3 gap-2 pb-2">
        <NumberField label="dist (m)" value={distance} step={10} onChange={setDistance} testId="gp-distance" />
        <NumberField label="eye (m)" value={eyeHeight} step={0.1} onChange={setEyeHeight} testId="gp-eye" />
        <NumberField
          label="target Y (m)"
          value={targetHeight}
          step={5}
          onChange={setTargetHeight}
          testId="gp-target"
        />
        <NumberField
          label="horiz ≤ (m)"
          value={horizontal}
          step={0.5}
          onChange={(v) => setHorizontal(Math.max(0, v))}
          testId="gp-horizontal"
        />
        <NumberField
          label="vert ≥ (m)"
          value={vertical}
          step={0.5}
          onChange={(v) => setVertical(Math.max(0, v))}
          testId="gp-vertical"
        />
        <NumberField
          label="cap (m)"
          value={cap}
          step={0.5}
          onChange={(v) => setCap(Math.max(0, v))}
          testId="gp-cap"
        />
      </div>
      <p className="pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {GEOMETRY_PROPOSAL_WORDING.capLabel}
      </p>

      <dl
        className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground"
        data-testid="geometry-proposal-summary"
      >
        {summary.map((row) => (
          <div key={row.label} className="col-span-2 grid grid-cols-2 gap-x-3">
            <dt className="uppercase tracking-[0.12em]">{row.label}</dt>
            <dd
              className={`text-right ${
                row.emphasis === "warn"
                  ? "text-warning"
                  : row.emphasis === "good"
                    ? "text-foreground"
                    : "text-muted-foreground"
              }`}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {result && !best ? (
        <p className="pt-2 text-[10px] leading-relaxed text-muted-foreground" data-testid="gp-no-proposal">
          {result.note}
        </p>
      ) : null}

      {best && comparison ? (
        <>
          <p className="pt-2 text-[10px] leading-relaxed text-muted-foreground" data-testid="gp-stack-claim">
            {GEOMETRY_PROPOSAL_WORDING.stackClaim}: {comparison.candidatePairsBefore} →{" "}
            {comparison.candidatePairsAfter} candidate pairs at this frame. Canonical
            SafetyValidator is untouched and unchanged by this preview.
          </p>
          <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground" data-testid="gp-silhouette">
            {GEOMETRY_PROPOSAL_WORDING.silhouette} — viewer [{view.viewer.map((v) => v.toFixed(1)).join(", ")}]
            → target [{view.target.map((v) => v.toFixed(1)).join(", ")}]. Max apparent error{" "}
            {comparison.maxAudienceImageDriftMeters.toFixed(3)} m, RMS{" "}
            {comparison.rmsAudienceImageDriftMeters.toFixed(3)} m. Other audience positions are not
            evaluated.
          </p>

          <div className="flex gap-1 pt-2" role="group" aria-label="Proposal preview mode">
            {MODES.map((mo) => (
              <button
                key={mo}
                onClick={() => setMode(mo)}
                aria-pressed={mode === mo}
                className={`chip-btn flex-1 justify-center ${mode === mo ? "chip-btn-active" : ""}`}
                data-testid={`gp-mode-${mo.toLowerCase()}`}
              >
                {mo}
              </button>
            ))}
          </div>

          {preview ? (
            <svg
              viewBox={`${preview.box.minX} ${-(preview.box.minY + preview.box.height)} ${preview.box.width} ${preview.box.height}`}
              className="mt-2 w-full rounded border border-border/60 bg-background/60"
              style={{ aspectRatio: `${preview.box.width} / ${preview.box.height}` }}
              data-testid="geometry-proposal-preview"
              role="img"
              aria-label={`Audience-viewpoint ${mode} preview of the geometry proposal`}
            >
              <g transform="scale(1,-1)">
                {mode !== "AFTER" &&
                  preview.points.map((p) => (
                    <circle
                      key={`b-${p.index}`}
                      cx={p.before[0]}
                      cy={p.before[1]}
                      r={0.9 / scale}
                      fill="#38e0d0"
                      opacity={mode === "OVERLAY" ? 0.55 : 0.9}
                    />
                  ))}
                {mode !== "BEFORE" &&
                  preview.points.map((p) => (
                    <circle
                      key={`a-${p.index}`}
                      cx={p.after[0]}
                      cy={p.after[1]}
                      r={0.7 / scale}
                      fill="#9be7ff"
                      opacity={0.9}
                    />
                  ))}
                {mode === "OVERLAY" && preview.driftIsNonTrivial
                  ? preview.points
                      .filter((p) => p.driftMeters > 0.05)
                      .map((p) => (
                        <line
                          key={`d-${p.index}`}
                          x1={p.before[0]}
                          y1={p.before[1]}
                          x2={p.after[0]}
                          y2={p.after[1]}
                          stroke="#ffb347"
                          strokeWidth={0.6 / scale}
                        />
                      ))
                  : null}
              </g>
            </svg>
          ) : null}

          <p className="pt-1 text-[10px] text-muted-foreground" data-testid="gp-drift-note">
            {preview?.driftIsNonTrivial
              ? `Projection drift is visible: max ${preview.maxDriftMeters.toFixed(3)} m on the audience plane.`
              : "Before and after overlap within numerical noise from this viewpoint."}
          </p>

          <button
            onClick={() => setGhost((v) => !v)}
            className="chip-btn mt-2 w-full justify-center"
            aria-pressed={ghost}
            data-testid="gp-ghost-toggle"
          >
            {ghost ? "Hide proposed geometry in 3D" : "Preview proposed geometry in 3D"}
          </button>

          <button
            onClick={() => setShowCandidates((v) => !v)}
            className="chip-btn mt-1 w-full justify-center"
            data-testid="gp-candidates-toggle"
          >
            {showCandidates ? "Hide candidate amplitudes" : "Why this amplitude won"}
          </button>

          {showCandidates ? (
            <ul className="max-h-36 space-y-1 overflow-y-auto pt-2" data-testid="gp-candidates">
              {candidates.map((c) => (
                <li
                  key={c.amplitudeMeters}
                  className={`font-mono text-[10px] leading-relaxed ${c.selected ? "text-foreground" : "text-muted-foreground"}`}
                >
                  {c.selected ? "▸ " : "  "}
                  {c.amplitudeMeters.toFixed(2)} m — pairs {c.candidatePairsAfter}, min horiz{" "}
                  {c.minHorizontalAfter.toFixed(2)} m, max move {c.maxDisplacementMeters.toFixed(2)} m
                  <span className="block pl-3 font-sans">{c.reason}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <button
            type="button"
            disabled
            aria-disabled="true"
            className="chip-btn mt-2 w-full cursor-not-allowed justify-center opacity-50"
            data-testid="gp-apply-disabled"
          >
            {GEOMETRY_PROPOSAL_WORDING.applyDisabled}
          </button>
        </>
      ) : null}

      <p className="flex gap-1 pt-2 text-[10px] leading-relaxed text-muted-foreground">
        <Info className="mt-[1px] size-3 shrink-0" />
        <span>
          Diagnostic evidence only. Reduced vertical-stack candidates and a preserved silhouette do
          not imply a flyable or validated show; any future applied geometry must be replanned and
          pass canonical validation and export gates.
        </span>
      </p>
    </section>
  );
}
