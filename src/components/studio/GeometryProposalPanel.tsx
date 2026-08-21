/**
 * GEOMETRY PROPOSAL — BEFORE / AFTER + CANONICAL CONSEQUENCE REVIEW UI.
 *
 * Every number shown here comes from a canonical read-only authority:
 * `optimizeProjectionPreservingStackProposal`, `compareGeometryProposal`,
 * `analyzeGeometryProposalConsequences`, `evaluateGeometryTrajectoryConsequence`
 * and `evaluateGeometryApplyReadiness`. No geometry, safety or readiness policy
 * is re-implemented in React, the viewpoint comes from the SHARED Audience View
 * authority, and there is intentionally NO apply mutation in this pass.
 */
import { useEffect, useMemo, useState } from "react";
import { Info, Sparkles } from "lucide-react";

import {
  CONSEQUENCE_WORDING,
  DERIVED_ASSET_DISCLOSURE,
  GEOMETRY_PROPOSAL_DEFAULTS,
  GEOMETRY_PROPOSAL_WORDING,
  SCENE_MATERIALISER_MISSING_MESSAGE,
  SUBSAMPLED_DISCLOSURE,

  VERTICAL_STACK_ANALYSIS_DEFAULTS,
  analyzeGeometryProposalConsequences,
  applyActionMessage,
  buildGeometryProposalPreview,
  buildGeometryProposalSummary,
  buildStaticPreflightRows,
  buildTrajectoryConsequenceRows,
  compareGeometryProposal,
  evaluateGeometryApplyReadiness,
  evaluateGeometryTrajectoryConsequence,
  explainProposalCandidates,
  optimizeProjectionPreservingStackProposal,
  projectWithFormationPoints,
  proposedPointsOf,
  resolveProposalMaterialisation,
  staticPreflightVerdict,
  type ConsequenceRow,
  type GeometryTrajectoryConsequenceReport,
  type ProposalPreviewMode,
} from "@/lib/show/diagnostics";
import type { Vector3Tuple } from "@/lib/show/types";
import {
  audienceViewOf,
  setAudienceViewSettings,
  useAudienceViewSettings,
} from "@/lib/studio/audienceView";
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

function EvidenceRows({ rows, testId }: { rows: readonly ConsequenceRow[]; testId: string }) {
  return (
    <ul className="space-y-[2px] pt-1 font-mono text-[10px]" data-testid={testId}>
      {rows.map((row) => (
        <li key={row.label} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-2">
          <span className="uppercase tracking-[0.12em] text-muted-foreground">{row.label}</span>
          <span className="text-right text-muted-foreground">{row.before} →</span>
          <span
            className={`text-right ${
              row.emphasis === "bad"
                ? "text-destructive"
                : row.emphasis === "warn"
                  ? "text-warning"
                  : row.emphasis === "good"
                    ? "text-foreground"
                    : "text-muted-foreground"
            }`}
          >
            {row.after}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function GeometryProposalPanel() {
  const { samplesAtTime, time, project, fullShowAnalysisOptions, analysisRevision } = useStudio();

  // SHARED viewpoint authority — no local distance/eye/target state here.
  const audience = useAudienceViewSettings();

  // Proposal-specific settings stay local by design.
  const [horizontal, setHorizontal] = useState<number>(
    VERTICAL_STACK_ANALYSIS_DEFAULTS.horizontalThresholdMeters,
  );
  const [vertical, setVertical] = useState<number>(
    VERTICAL_STACK_ANALYSIS_DEFAULTS.minVerticalDifferenceMeters,
  );
  const [cap, setCap] = useState<number>(GEOMETRY_PROPOSAL_DEFAULTS.maxDisplacementMeters);
  const [mode, setMode] = useState<ProposalPreviewMode>("OVERLAY");
  const [ghost, setGhost] = useState(false);
  const [showCandidates, setShowCandidates] = useState(false);
  const [acknowledgePromotion, setAcknowledgePromotion] = useState(false);

  const points = useMemo<Vector3Tuple[]>(
    () => samplesAtTime(time).map((s) => s.position as Vector3Tuple),
    [samplesAtTime, time],
  );

  const view = useMemo(() => audienceViewOf(audience), [audience]);

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

  // STATIC preflight is cheap and stays instant.
  const staticPreflight = useMemo(
    () =>
      proposed.length
        ? analyzeGeometryProposalConsequences({
            before: points,
            after: proposed,
            area: project.area,
            limits: project.limits,
          })
        : null,
    [points, proposed, project.area, project.limits],
  );

  // Which hypothetical project can honestly be materialised for this proposal.
  const materialisation = useMemo(
    () => (proposed.length ? resolveProposalMaterialisation(project, time, proposed.length) : null),
    [project, time, proposed.length],
  );

  /**
   * STALE-EVIDENCE KEY. Any change to viewpoint, proposal settings, frame or the
   * canonical analysis inputs invalidates previously computed trajectory
   * evidence, so an old READY can never be shown as current.
   */
  const evidenceKey = useMemo(
    () =>
      [
        analysisRevision,
        time.toFixed(3),
        audience.distanceMeters,
        audience.eyeHeightMeters,
        audience.targetHeightMeters,
        horizontal,
        vertical,
        cap,
      ].join("|"),
    [analysisRevision, time, audience, horizontal, vertical, cap],
  );

  const [evidence, setEvidence] = useState<{
    key: string;
    report: GeometryTrajectoryConsequenceReport | null;
    error: string | null;
  } | null>(null);
  const [evaluating, setEvaluating] = useState(false);

  const stale = !!evidence && evidence.key !== evidenceKey;
  const trajectory = evidence && !stale ? evidence.report : null;

  const readiness = useMemo(
    () =>
      evaluateGeometryApplyReadiness({
        staticPreflight,
        trajectory,
        importedPromotionAcknowledged: acknowledgePromotion,
      }),
    [staticPreflight, trajectory, acknowledgePromotion],
  );

  // Explicit evaluation only: the canonical full-show path is expensive and must
  // never run per render or per animation frame.
  const evaluate = () => {
    if (!materialisation || materialisation.kind === "UNAVAILABLE" || !proposed.length) return;
    setEvaluating(true);
    const key = evidenceKey;
    try {
      let hypothetical;
      if (materialisation.kind === "FORMATION") {
        hypothetical = projectWithFormationPoints(project, materialisation.formationId, proposed);
      } else {
        const scene = materializeStaticSceneGeometryProposal(
          project,
          materialisation.sceneId,
          proposed,
        );
        if (!scene.ok) {
          setEvidence({ key, report: null, error: `${scene.blocker}: ${scene.note}` });
          return;
        }
        hypothetical = scene.project;
      }
      const report = evaluateGeometryTrajectoryConsequence(
        project,
        hypothetical,
        fullShowAnalysisOptions,
      );
      setEvidence({ key, report, error: null });
    } catch (err) {
      setEvidence({ key, report: null, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setEvaluating(false);
    }
  };


  // Ghost preview is ephemeral diagnostic state, never project state.
  useEffect(() => {
    setGeometryProposalPreview(
      ghost && proposed.length ? { enabled: true, original: points, proposed } : null,
    );
    return () => setGeometryProposalPreview(null);
  }, [ghost, points, proposed]);

  const scale = preview ? 260 / Math.max(preview.box.width, preview.box.height) : 1;
  const promoted = trajectory?.newlyPromotedClipIds ?? [];

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

      <p className="pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Shared representative viewpoint
      </p>
      <div className="grid grid-cols-3 gap-2 pb-2">
        <NumberField
          label="dist (m)"
          value={audience.distanceMeters}
          step={10}
          onChange={(v) => setAudienceViewSettings({ distanceMeters: v })}
          testId="gp-distance"
        />
        <NumberField
          label="eye (m)"
          value={audience.eyeHeightMeters}
          step={0.1}
          onChange={(v) => setAudienceViewSettings({ eyeHeightMeters: v })}
          testId="gp-eye"
        />
        <NumberField
          label="target Y (m)"
          value={audience.targetHeightMeters}
          step={5}
          onChange={(v) => setAudienceViewSettings({ targetHeightMeters: v })}
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

          <div className="flex gap-1 pt-2">
            {MODES.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`chip-btn flex-1 justify-center ${mode === m ? "chip-btn-active" : ""}`}
                aria-pressed={mode === m}
                data-testid={`gp-mode-${m.toLowerCase()}`}
              >
                {m}
              </button>
            ))}
          </div>

          {preview ? (
            <svg
              viewBox={`${preview.box.minX} ${-(preview.box.minY + preview.box.height)} ${preview.box.width} ${preview.box.height}`}
              className="mt-2 w-full rounded-sm bg-black/30"
              style={{ aspectRatio: `${preview.box.width} / ${preview.box.height}` }}
              data-testid="gp-preview"
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

          {/* ---- STATIC PREFLIGHT ---- */}
          {staticPreflight ? (
            <div className="mt-3 border-t border-border/60 pt-2" data-testid="gp-static-preflight">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground">
                {CONSEQUENCE_WORDING.staticHeader}
              </p>
              <EvidenceRows rows={buildStaticPreflightRows(staticPreflight)} testId="gp-static-rows" />
              <p
                className={`pt-1 font-mono text-[10px] font-semibold ${
                  staticPreflightVerdict(staticPreflight) === "PASS" ? "text-foreground" : "text-destructive"
                }`}
                data-testid="gp-static-verdict"
              >
                {staticPreflightVerdict(staticPreflight)}
              </p>
              <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
                {CONSEQUENCE_WORDING.staticScope}
              </p>
            </div>
          ) : null}

          {/* ---- TRAJECTORY CONSEQUENCE ---- */}
          <div className="mt-3 border-t border-border/60 pt-2" data-testid="gp-trajectory">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground">
              {CONSEQUENCE_WORDING.trajectoryHeader}
            </p>
            {materialisation && materialisation.kind === "UNAVAILABLE" ? (
              <p className="pt-1 text-[10px] leading-relaxed text-warning" data-testid="gp-trajectory-unavailable">
                {SCENE_MATERIALISER_MISSING_MESSAGE}. {materialisation.reason}
              </p>
            ) : (
              <>
                <button
                  type="button"
                  onClick={evaluate}
                  disabled={evaluating}
                  className="chip-btn mt-1 w-full justify-center"
                  data-testid="gp-evaluate"
                >
                  {evaluating ? "Evaluating…" : "Evaluate trajectory consequences"}
                </button>
                {stale ? (
                  <p className="pt-1 text-[10px] leading-relaxed text-warning" data-testid="gp-stale">
                    {CONSEQUENCE_WORDING.staleEvidence}
                  </p>
                ) : null}
                {evidence && !stale && evidence.error ? (
                  <p className="pt-1 font-mono text-[10px] text-destructive" data-testid="gp-trajectory-error">
                    {evidence.error}
                  </p>
                ) : null}
                {trajectory ? (
                  <>
                    <EvidenceRows
                      rows={buildTrajectoryConsequenceRows(trajectory)}
                      testId="gp-trajectory-rows"
                    />
                    <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
                      {CONSEQUENCE_WORDING.trajectoryScope}
                    </p>
                  </>
                ) : null}
              </>
            )}
          </div>

          {/* ---- IMPORTED OWNERSHIP CHANGE ---- */}
          {promoted.length ? (
            <div className="mt-3 border-t border-border/60 pt-2" data-testid="gp-ownership">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-warning">
                {CONSEQUENCE_WORDING.ownershipHeader}
              </p>
              <p className="pt-1 font-mono text-[10px] text-foreground">
                REFERENCE → PLANNER: {promoted.join(", ")}
              </p>
              <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
                {CONSEQUENCE_WORDING.ownershipExplain}
              </p>
              <label className="flex items-center gap-2 pt-1 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={acknowledgePromotion}
                  onChange={(e) => setAcknowledgePromotion(e.target.checked)}
                  data-testid="gp-ack-promotion"
                />
                Acknowledge imported output ownership change
              </label>
            </div>
          ) : null}

          {/* ---- APPLY READINESS ---- */}
          <div className="mt-3 border-t border-border/60 pt-2" data-testid="gp-readiness">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground">
              {CONSEQUENCE_WORDING.readinessHeader}
            </p>
            <p
              className={`pt-1 font-mono text-[10px] font-semibold ${
                readiness.status === "READY"
                  ? "text-foreground"
                  : readiness.status === "WARNING"
                    ? "text-warning"
                    : "text-destructive"
              }`}
              data-testid="gp-readiness-status"
            >
              {readiness.status}
            </p>
            {readiness.blockers.length ? (
              <ul className="pt-1 text-[10px] leading-relaxed text-destructive" data-testid="gp-blockers">
                {readiness.blockers.map((b) => (
                  <li key={b}>• {b}</li>
                ))}
              </ul>
            ) : null}
            {readiness.warnings.length ? (
              <ul className="pt-1 text-[10px] leading-relaxed text-warning" data-testid="gp-warnings">
                {readiness.warnings.map((w) => (
                  <li key={w}>• {w}</li>
                ))}
              </ul>
            ) : null}
            <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">{readiness.note}</p>
          </div>

          <button
            type="button"
            disabled
            aria-disabled="true"
            className="chip-btn mt-2 w-full cursor-not-allowed justify-center opacity-50"
            data-testid="gp-apply-disabled"
          >
            {applyActionMessage(readiness)}
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
