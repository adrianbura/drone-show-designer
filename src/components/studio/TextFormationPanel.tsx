/**
 * FOCUSED TEXT FORMATION EDITOR (first pass, no typographic polish).
 *
 * DOCTRINE
 *   - The operator ENTERS the text. Nothing is inferred, OCR'd or guessed.
 *   - Geometry comes ONLY from the bundled deterministic glyph pack via
 *     `previewTextFormation`; no canvas, no system font.
 *   - Preview mutates NOTHING: no project, no reference layer, no overrides, no
 *     history. Cancel is therefore a true no-op by construction.
 *   - Readiness is NEVER constructed here. The candidate project is built by the
 *     canonical `buildTextCandidateProject`, then the canonical static
 *     consequence preflight, full-show trajectory consequence analysis and
 *     `evaluateGeometryApplyReadiness` decide whether Apply may be enabled.
 *   - Evidence is bound to ONE proposal identity (project revision + target +
 *     recipe hash + assignment strategy). Any change discards it and disables
 *     Apply until it is recomputed.
 */
import { useEffect, useMemo, useState } from "react";
import { Type } from "lucide-react";

import {
  analyzeGeometryProposalConsequences,
  evaluateGeometryApplyReadiness,
  evaluateGeometryTrajectoryConsequence,
  type GeometryConsequencePreflightReport,
  type GeometryTrajectoryConsequenceReport,
} from "@/lib/show/diagnostics";
import { makeTextRecipe, type TextAlignment, type TextStyle, type TextWeight } from "@/lib/show/text";
import type { Vector3Tuple } from "@/lib/show/types";
import { setGeometryProposalPreview } from "@/lib/studio/geometryProposalPreview";
import { onInspectorFocus } from "@/lib/studio/inspectorFocus";
import { useStudio } from "@/lib/studio/store";
import { buildTextCandidateProject } from "@/lib/studio/textFormationApplyCommand";
import { previewTextFormation, discardTextPreview } from "@/lib/studio/textFormationPreview";
import {
  defaultTextRecipe,
  resolveTextRebuildEligibility,
  textEvidenceKey,
  textFormationIdFor,
} from "@/lib/studio/textRebuild";

const WEIGHTS: TextWeight[] = ["LIGHT", "REGULAR", "BOLD"];
const STYLES: TextStyle[] = ["UPRIGHT", "ITALIC"];
const ALIGNMENTS: TextAlignment[] = ["LEFT", "CENTER", "RIGHT"];

function Num({
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
        onChange={(e) => onChange(Number(e.target.value))}
        className="studio-input text-right font-mono"
        data-testid={testId}
      />
    </label>
  );
}

export default function TextFormationPanel() {
  const {
    project,
    selectedClipId,
    analysisRevision,
    assignmentStrategy,
    fullShowAnalysisOptions,
    applyTextFormation,
  } = useStudio();

  const clipId = selectedClipId;
  const eligibility = useMemo(
    () => (clipId ? resolveTextRebuildEligibility(project, clipId) : null),
    [project, clipId],
  );

  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("TEXT");
  const [weight, setWeight] = useState<TextWeight>("REGULAR");
  const [style, setStyle] = useState<TextStyle>("UPRIGHT");
  const [widthMeters, setWidthMeters] = useState(90);
  const [heightMeters, setHeightMeters] = useState(24);
  /**
   * Null until the operator overrides it: the effective default is the mean
   * altitude of the replaced formation, so the rebuilt text stays where the
   * original geometry actually flew instead of sinking through the ground.
   */
  const [altitudeOverride, setAltitudeOverride] = useState<number | null>(null);
  const [letterSpacingEm, setLetterSpacingEm] = useState(0.8);
  const [alignment, setAlignment] = useState<TextAlignment>("CENTER");
  const [outlineRatio, setOutlineRatio] = useState(0.7);
  const [bandOffsetEm, setBandOffsetEm] = useState(0.35);
  const [seed, setSeed] = useState(1);
  const [ghost, setGhost] = useState(true);
  const [acknowledge, setAcknowledge] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  /** Editor opens from the ONE canonical routing path (context menu / palette). */
  useEffect(
    () =>
      onInspectorFocus((request) => {
        if (request.surface === "TEXT") setEditing(true);
      }),
    [],
  );

  // Participation is dictated by the replaced formation, never typed by hand.
  const participation = eligibility?.participation ?? 0;
  const centerAltitudeMeters =
    altitudeOverride ?? Math.max(heightMeters / 2 + 5, eligibility?.centerAltitudeMeters ?? 0);

  const recipe = useMemo(
    () =>
      makeTextRecipe({
        ...defaultTextRecipe(participation, text, centerAltitudeMeters),
        text,
        weight,
        style,
        widthMeters,
        heightMeters,
        centerAltitudeMeters,
        letterSpacingEm,
        alignment,
        participation,
        outlineRatio,
        bandOffsetEm,
        seed,
      }),
    [
      alignment,
      bandOffsetEm,
      centerAltitudeMeters,
      heightMeters,
      letterSpacingEm,
      outlineRatio,
      participation,
      seed,
      style,
      text,
      weight,
      widthMeters,
    ],
  );

  const preview = useMemo(() => {
    if (!editing || !clipId || !eligibility?.available) return null;
    return previewTextFormation(project, {
      clipId,
      ...(eligibility.objectId ? { objectId: eligibility.objectId } : {}),
      recipe,
    });
  }, [editing, clipId, eligibility, project, recipe]);

  const ok = preview?.ok ? preview : null;

  // Ghost markers are ephemeral diagnostics, never project state.
  useEffect(() => {
    if (!ghost || !ok) {
      setGeometryProposalPreview(null);
      return;
    }
    const replaced = project.formations.find((f) => f.id === ok.replacedFormationId);
    setGeometryProposalPreview({
      enabled: true,
      original: (replaced?.points ?? []) as readonly Vector3Tuple[],
      proposed: ok.points.map((p) => [p[0], p[1], p[2]] as Vector3Tuple),
    });
    return () => setGeometryProposalPreview(null);
  }, [ghost, ok, project.formations]);

  /** ONE identity for the canonical evidence. */
  const evidenceKey = useMemo(
    () =>
      ok
        ? textEvidenceKey({
            projectId: project.id,
            analysisRevision,
            clipId: ok.clipId,
            objectId: ok.objectId,
            recipeHash: ok.geometry.recipeHash,
            assignmentStrategy,
          })
        : "",
    [ok, project.id, analysisRevision, assignmentStrategy],
  );

  const [evidence, setEvidence] = useState<{
    key: string;
    preflight: GeometryConsequencePreflightReport | null;
    trajectory: GeometryTrajectoryConsequenceReport | null;
    error: string | null;
  } | null>(null);
  const [evaluating, setEvaluating] = useState(false);

  const stale = !!evidence && evidence.key !== evidenceKey;
  const current = evidence && !stale ? evidence : null;

  const readiness = useMemo(
    () =>
      evaluateGeometryApplyReadiness({
        staticPreflight: current?.preflight ?? null,
        trajectory: current?.trajectory ?? null,
        importedPromotionAcknowledged: acknowledge,
      }),
    [current, acknowledge],
  );

  const evaluate = () => {
    if (!ok) return;
    const key = evidenceKey;
    setEvaluating(true);
    setApplied(null);
    setApplyError(null);
    try {
      const replaced = project.formations.find((f) => f.id === ok.replacedFormationId);
      const preflight = analyzeGeometryProposalConsequences({
        before: (replaced?.points ?? []) as readonly Vector3Tuple[],
        after: ok.points.map((p) => [p[0], p[1], p[2]] as Vector3Tuple),
        area: project.area,
        limits: project.limits,
      });
      const candidate = buildTextCandidateProject({
        project,
        preview: ok,
        formationId: textFormationIdFor(ok.clipId, ok.geometry.recipeHash),
      });
      const trajectory = evaluateGeometryTrajectoryConsequence(
        project,
        candidate.project,
        fullShowAnalysisOptions,
      );
      setEvidence({ key, preflight, trajectory, error: null });
    } catch (err) {
      setEvidence({
        key,
        preflight: null,
        trajectory: null,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setEvaluating(false);
    }
  };

  const canApply = !!ok && !!current && !stale && readiness.canApply;

  const apply = () => {
    if (!canApply || !ok) return;
    setApplyError(null);
    const result = applyTextFormation({
      request: {
        clipId: ok.clipId,
        ...(ok.objectId ? { objectId: ok.objectId } : {}),
        recipe: ok.geometry.recipe,
      },
      // Canonical report, passed through unchanged.
      readiness,
      formationId: textFormationIdFor(ok.clipId, ok.geometry.recipeHash),
      formationName: `Text — ${ok.geometry.recipe.text}`,
      promotedAt: new Date().toISOString(),
    });
    if (!result.ok) {
      setApplyError(`${result.blockers.join(", ")}: ${result.note}`);
      return;
    }
    setEvidence(null);
    setAcknowledge(false);
    setGhost(false);
    setEditing(false);
    setApplied(
      [
        `Applied as one undoable revision (${result.formationId}).`,
        result.promotedReferenceClipIds.length
          ? `Imported ownership promoted REFERENCE → PLANNER: ${result.promotedReferenceClipIds.join(", ")}.`
          : "No imported clip changed ownership.",
        "Previous validation is no longer current — re-run full-show validation before export.",
      ].join(" "),
    );
  };

  /** True no-op cancel: a preview owns no state, so discarding is a pure drop. */
  const cancel = () => {
    discardTextPreview(preview);
    setEvidence(null);
    setAcknowledge(false);
    setGhost(false);
    setEditing(false);
    setApplyError(null);
  };

  // Project-session scope: another document must not inherit this evidence.
  useEffect(() => {
    setEvidence(null);
    setEditing(false);
    setApplied(null);
    setApplyError(null);
    setAcknowledge(false);
  }, [project.id]);

  const promoted = current?.trajectory?.newlyPromotedClipIds ?? [];

  return (
    <section className="panel-card" data-testid="text-formation-panel">
      <h2 className="panel-title">
        <Type className="size-3.5 text-muted-foreground" />
        Rebuild as text
      </h2>

      {!clipId || !eligibility ? (
        <p className="text-[10px] text-muted-foreground" data-testid="text-panel-no-clip">
          Select a clip to rebuild its formation as deterministic text.
        </p>
      ) : !eligibility.available ? (
        <p className="text-[10px] text-warning" data-testid="text-panel-blocked">
          {eligibility.reason}
        </p>
      ) : !editing ? (
        <div className="space-y-2">
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Replaces the static geometry of this target with deterministic text from the bundled
            glyph pack. Timing, lighting, participation and imported source bytes are preserved.
          </p>
          <button
            type="button"
            className="btn-primary w-full"
            data-testid="text-open-editor"
            onClick={() => setEditing(true)}
          >
            Rebuild as Text…
          </button>
          {applied ? (
            <p className="text-[10px] text-muted-foreground" data-testid="text-applied">
              {applied}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Text (entered by the operator)
            <input
              value={text}
              onChange={(e) => setText(e.target.value.toUpperCase())}
              className="studio-input font-mono"
              data-testid="text-input"
            />
          </label>

          <p className="font-mono text-[10px] text-muted-foreground" data-testid="text-glyph-pack">
            pack {recipe.glyphPackId} v{recipe.glyphPackVersion} · alg {recipe.algorithmVersion} ·
            participation {participation}
          </p>

          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              weight
              <select
                value={weight}
                onChange={(e) => setWeight(e.target.value as TextWeight)}
                className="studio-input"
                data-testid="text-weight"
              >
                {WEIGHTS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              style
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value as TextStyle)}
                className="studio-input"
                data-testid="text-style"
              >
                {STYLES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              align
              <select
                value={alignment}
                onChange={(e) => setAlignment(e.target.value as TextAlignment)}
                className="studio-input"
                data-testid="text-alignment"
              >
                {ALIGNMENTS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <Num
              label="width (m)"
              value={widthMeters}
              step={1}
              onChange={setWidthMeters}
              testId="text-width"
            />
            <Num
              label="height (m)"
              value={heightMeters}
              step={1}
              onChange={setHeightMeters}
              testId="text-height"
            />
            <Num
              label="altitude (m)"
              value={centerAltitudeMeters}
              step={1}
              onChange={setAltitudeOverride}
              testId="text-altitude"
            />
            <Num
              label="spacing (em)"
              value={letterSpacingEm}
              step={0.05}
              onChange={setLetterSpacingEm}
              testId="text-spacing"
            />
            <Num
              label="outline"
              value={outlineRatio}
              step={0.05}
              onChange={setOutlineRatio}
              testId="text-outline"
            />
            <Num
              label="band (em)"
              value={bandOffsetEm}
              step={0.05}
              onChange={setBandOffsetEm}
              testId="text-band"
            />
            <Num label="seed" value={seed} step={1} onChange={setSeed} testId="text-seed" />
          </div>

          <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <input
              type="checkbox"
              checked={ghost}
              onChange={(e) => setGhost(e.target.checked)}
              data-testid="text-ghost"
            />
            Viewport ghost
          </label>

          {preview && !preview.ok ? (
            <p className="text-[10px] text-destructive" data-testid="text-preview-blocked">
              {preview.blockers.join(", ")}: {preview.note}
            </p>
          ) : null}

          {ok ? (
            <p className="font-mono text-[10px] text-muted-foreground" data-testid="text-preview-info">
              {ok.points.length} points · replaces {ok.replacedFormationId} ({ok.replacedPointCount})
              · hash {ok.geometry.recipeHash}
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              className="chip-btn"
              disabled={!ok || evaluating}
              data-testid="text-evaluate"
              onClick={evaluate}
            >
              {evaluating ? "Evaluating…" : "Evaluate consequences"}
            </button>
            <button type="button" className="chip-btn" data-testid="text-cancel" onClick={cancel}>
              Cancel
            </button>
          </div>

          {stale ? (
            <p className="text-[10px] text-warning" data-testid="text-evidence-stale">
              The recipe or the document changed — previous canonical analysis was discarded. Re-run
              Evaluate before Apply.
            </p>
          ) : null}

          {current?.error ? (
            <p className="text-[10px] text-destructive" data-testid="text-evidence-error">
              {current.error}
            </p>
          ) : null}

          {current && !current.error ? (
            <div className="space-y-1" data-testid="text-readiness">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em]">
                readiness · {readiness.status}
              </p>
              {readiness.blockers.length ? (
                <ul className="space-y-[2px] text-[10px] text-destructive" data-testid="text-blockers">
                  {readiness.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              ) : null}
              {readiness.warnings.length ? (
                <ul className="space-y-[2px] text-[10px] text-warning" data-testid="text-warnings">
                  {readiness.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
              {promoted.length ? (
                <div data-testid="text-promotion">
                  <p className="text-[10px] text-muted-foreground">
                    Imported clips that become PLANNER-owned: {promoted.join(", ")}
                  </p>
                  <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={acknowledge}
                      onChange={(e) => setAcknowledge(e.target.checked)}
                      data-testid="text-acknowledge"
                    />
                    I acknowledge the REFERENCE → PLANNER promotion
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}

          <button
            type="button"
            className="btn-primary w-full"
            disabled={!canApply}
            data-testid="text-apply"
            onClick={apply}
          >
            Apply as one revision
          </button>

          {applyError ? (
            <p className="text-[10px] text-destructive" data-testid="text-apply-error">
              {applyError}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
