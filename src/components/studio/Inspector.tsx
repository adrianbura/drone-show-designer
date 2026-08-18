import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  Plug,
  ShieldCheck,
  Shuffle,
  Wand2,
} from "lucide-react";

import FullShowPanel from "./FullShowPanel";
import LaunchPanel from "./LaunchPanel";
import ParticipationPanel from "./ParticipationPanel";
import SceneObjectsPanel from "./SceneObjectsPanel";
import LightingEffectsPanel from "./LightingEffectsPanel";
import SimulationPanel from "./SimulationPanel";
import DynamicPanel from "./DynamicPanel";
import EsspPanel from "./EsspPanel";
import ForensicsPanel from "./ForensicsPanel";
import ConversionPanel from "./ConversionPanel";


import { ADAPTER_REGISTRY } from "@/lib/adapters";
import { suggestedProjectFileName } from "@/lib/project";
import { evaluateExportEligibility } from "@/lib/adapters/exportEligibility";
import {
  downloadText,
  toGenericShowJson,
  toStudioProject,
  toTrajectoryCsv,
} from "@/lib/adapters/export";
import {
  assignmentStrategyLabel,
  SELECTABLE_ASSIGNMENT_STRATEGIES,
  type AssignmentStrategyId,
} from "@/lib/show/assignment";
import { hexToRgb, rgbToHex } from "@/lib/show/lights";
import { snapToBeat } from "@/lib/show/audio";
import type { Easing, LightEffect } from "@/lib/show/types";
import { useStudio } from "@/lib/studio/store";

const EFFECTS: LightEffect[] = ["solid", "pulse", "rainbow", "chase", "twinkle"];
const EASINGS: Easing[] = ["minJerk", "smooth", "linear"];

function NumberRow({
  label,
  value,
  onChange,
  step = 0.5,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  unit?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
      <span className="uppercase tracking-[0.14em]">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          value={Number(value.toFixed(2))}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="studio-input w-20 text-right font-mono"
        />
        {unit && <span className="font-mono text-[10px]">{unit}</span>}
      </span>
    </label>
  );
}

export default function Inspector() {
  const {
    project,
    plan,
    trajectorySet,
    sampleRate,
    setSampleRate,
    safety,
    selectedClipId,
    patchClip,
    setLimits,
    beatGrid,
    setTime,
    assignmentStrategy,
    setAssignmentStrategy,
    transitionAnalysis,
    assignmentComparison,
    optimization,
    transitionBusy,
    transitionError,
    analyzeSelectedTransition,
    optimizeSelectedTransition,
    clearTransitionAnalysis,
    applySuggestedDuration,
    canAnalyzeSelectedClip,
    transitionOverrides,
    showPaths,
    setShowPaths,
    showConflicts,
    setShowConflicts,
    fullShowReport,
    fullShowStale,
    preShowReport,
    preShowStale,
  } = useStudio();
  const exportEligibility = evaluateExportEligibility(fullShowReport, fullShowStale);
  const canExportComputedShow = exportEligibility.canExportComputedShow;
  const clip = project.timeline.find((c) => c.id === selectedClipId);
  const analysis =
    transitionAnalysis && transitionAnalysis.clipId === selectedClipId
      ? transitionAnalysis.analysis
      : null;
  const comparison =
    assignmentComparison && assignmentComparison.clipId === selectedClipId
      ? assignmentComparison.comparison
      : null;
  const optimizationResult =
    optimization && optimization.clipId === selectedClipId ? optimization.result : null;
  const isOptimized = !!selectedClipId && !!transitionOverrides[selectedClipId];

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <section className="panel-card">
        <h2 className="panel-title">Clip inspector</h2>
        {!clip ? (
          <p className="text-xs text-muted-foreground">Select a clip on the timeline.</p>
        ) : (
          <div className="space-y-3">
            <select
              value={clip.formationId}
              onChange={(e) => patchClip(clip.id, { formationId: e.target.value })}
              className="studio-input"
              aria-label="Clip formation"
            >
              {project.formations.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <NumberRow
              label="Start"
              value={clip.start}
              unit="s"
              onChange={(v) => patchClip(clip.id, { start: Math.max(0, v) })}
            />
            <NumberRow
              label="Transition"
              value={clip.transition}
              unit="s"
              onChange={(v) => patchClip(clip.id, { transition: Math.max(0.5, v) })}
            />
            <NumberRow
              label="Hold"
              value={clip.hold}
              unit="s"
              onChange={(v) => patchClip(clip.id, { hold: Math.max(0, v) })}
            />
            <button
              onClick={() => patchClip(clip.id, { start: snapToBeat(clip.start, beatGrid) })}
              className="chip-btn w-full justify-center"
            >
              Snap start to beat
            </button>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1.5">
                <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Easing
                </span>
                <select
                  value={clip.easing}
                  onChange={(e) => patchClip(clip.id, { easing: e.target.value as Easing })}
                  className="studio-input"
                >
                  {EASINGS.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Light effect
                </span>
                <select
                  value={clip.effect}
                  onChange={(e) => patchClip(clip.id, { effect: e.target.value as LightEffect })}
                  className="studio-input"
                >
                  {EFFECTS.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Base colour
              <input
                type="color"
                value={rgbToHex(clip.color)}
                onChange={(e) => patchClip(clip.id, { color: hexToRgb(e.target.value) })}
                className="h-7 w-14 cursor-pointer rounded border border-border bg-transparent"
              />
            </label>
          </div>
        )}
      </section>

      <section className="panel-card">
        <h2 className="panel-title">
          <Shuffle className="size-3.5" /> Transition planning
        </h2>
        <label className="space-y-1.5">
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Assignment strategy
          </span>
          <select
            value={assignmentStrategy}
            onChange={(e) => setAssignmentStrategy(e.target.value as AssignmentStrategyId)}
            className="studio-input"
          >
            {SELECTABLE_ASSIGNMENT_STRATEGIES.map((id) => (
              <option key={id} value={id}>
                {assignmentStrategyLabel(id)}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            onClick={analyzeSelectedTransition}
            disabled={!canAnalyzeSelectedClip || transitionBusy}
            className="chip-btn justify-center disabled:opacity-40"
          >
            {transitionBusy ? "Working…" : "Analyse"}
          </button>
          <button
            onClick={optimizeSelectedTransition}
            disabled={!canAnalyzeSelectedClip || transitionBusy}
            className="chip-btn justify-center disabled:opacity-40"
          >
            <Wand2 className="size-3" /> Optimise
          </button>
        </div>
        {!canAnalyzeSelectedClip && (
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Select a SHOW clip. Takeoff and landing keep their dedicated vertical planners.
          </p>
        )}
        {transitionError && (
          <p className="text-[10px] leading-relaxed text-critical">
            {transitionError.code}: {transitionError.message}
          </p>
        )}
        {analysis && (
          <>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1 font-mono text-[10px] text-muted-foreground">
              <dt>strategy</dt>
              <dd className="text-right text-foreground">{analysis.metrics.assignmentStrategy}</dd>
              <dt>total path</dt>
              <dd className="text-right text-foreground">
                {analysis.metrics.totalTravelDistance.toFixed(0)} m
              </dd>
              <dt>max path</dt>
              <dd className="text-right text-foreground">
                {analysis.metrics.maximumTravelDistance.toFixed(1)} m
              </dd>
              <dt>min sep</dt>
              <dd className="text-right text-foreground">
                {analysis.metrics.minimumDynamicSeparation.toFixed(2)} m
              </dd>
              <dt>conflicts</dt>
              <dd
                className={`text-right ${analysis.metrics.criticalConflictCount > 0 ? "text-critical" : "text-safe"}`}
              >
                {analysis.metrics.conflictCount} ({analysis.metrics.criticalConflictCount} crit)
              </dd>
              <dt>crossings</dt>
              <dd className="text-right text-foreground">
                {analysis.metrics.potentialGeometricCrossings}
              </dd>
              <dt>peak v / a</dt>
              <dd className="text-right text-foreground">
                {analysis.metrics.maximumVelocity.toFixed(1)} / {analysis.metrics.maximumAcceleration.toFixed(1)}
              </dd>
              <dt>stagger Σ</dt>
              <dd className="text-right text-foreground">
                {analysis.metrics.totalStartOffset.toFixed(1)} s
              </dd>
              <dt>lanes Σ</dt>
              <dd className="text-right text-foreground">
                {analysis.metrics.totalVerticalOffset.toFixed(1)} m
              </dd>
              <dt>solve time</dt>
              <dd className="text-right text-foreground">{analysis.timings.totalMs.toFixed(0)} ms</dd>
            </dl>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Duration {analysis.feasibility.requestedDuration.toFixed(1)}s ·{" "}
              {analysis.feasibility.feasible ? "feasible" : "INFEASIBLE"} · minimum ≈{" "}
              {analysis.feasibility.minimumEstimatedDuration.toFixed(1)}s (
              {analysis.feasibility.limitingMetric}-limited)
            </p>
            {!analysis.feasibility.feasible && (
              <button onClick={applySuggestedDuration} className="chip-btn w-full justify-center">
                Apply suggested duration
              </button>
            )}
            {comparison && (
              <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
                greedy {comparison.nearestNeighbor.metrics.totalDistance.toFixed(0)} m → optimal{" "}
                {comparison.optimalDistance.metrics.totalDistance.toFixed(0)} m (
                {(comparison.totalDistanceImprovement * 100).toFixed(1)}% shorter)
              </p>
            )}
            {optimizationResult && (
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Optimiser: {optimizationResult.status} in {optimizationResult.iterations} iterations
                {optimizationResult.appliedStrategies.length > 0
                  ? ` · ${optimizationResult.appliedStrategies.join(", ")}`
                  : ""}
                {optimizationResult.warnings.length > 0 ? ` · ${optimizationResult.warnings[0]}` : ""}
              </p>
            )}
            {isOptimized && (
              <button onClick={clearTransitionAnalysis} className="chip-btn w-full justify-center">
                Revert optimised transition
              </button>
            )}
          </>
        )}
        <div className="flex items-center justify-between gap-2 pt-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Eye className="size-3" /> Overlays
          </span>
          <span className="flex gap-2">
            <button
              onClick={() => setShowPaths(!showPaths)}
              className={`chip-btn ${showPaths ? "chip-btn-active" : ""}`}
            >
              paths
            </button>
            <button
              onClick={() => setShowConflicts(!showConflicts)}
              className={`chip-btn ${showConflicts ? "chip-btn-active" : ""}`}
            >
              conflicts
            </button>
          </span>
        </div>
      </section>


      <section className="panel-card">
        <h2 className="panel-title">
          <ShieldCheck className="size-3.5" /> Flight envelope
        </h2>
        <NumberRow
          label="Max velocity"
          value={project.limits.maxVelocity}
          unit="m/s"
          onChange={(v) => setLimits({ maxVelocity: v })}
        />
        <NumberRow
          label="Max accel"
          value={project.limits.maxAcceleration}
          unit="m/s²"
          onChange={(v) => setLimits({ maxAcceleration: v })}
        />
        <NumberRow
          label="Max yaw rate"
          value={project.limits.maxYawRate}
          unit="°/s"
          step={5}
          onChange={(v) => setLimits({ maxYawRate: v })}
        />
        <NumberRow
          label="Min separation"
          value={project.limits.minSeparation}
          unit="m"
          onChange={(v) => setLimits({ minSeparation: v })}
        />
        <NumberRow
          label="Ceiling"
          value={project.limits.maxAltitude}
          unit="m"
          step={5}
          onChange={(v) => setLimits({ maxAltitude: v })}
        />
      </section>

      <section className="panel-card">
        <h2 className="panel-title">
          {safety.status === "ok" ? (
            <CheckCircle2 className="size-3.5 text-safe" />
          ) : (
            <AlertTriangle className="size-3.5 text-warning" />
          )}
          Validation ({safety.errors.length} err / {safety.warnings.length} warn)
        </h2>
        <p className="pb-1 text-[10px] leading-relaxed text-muted-foreground">
          {safety.status === "ok"
            ? "VALIDATED AGAINST CURRENT SAFETY PROFILE — not a real-world safety guarantee."
            : "Violations of the configured safety profile. This is not a real-world safety assessment."}
        </p>
        <label className="flex items-center justify-between gap-2 pb-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Sample rate
          <select
            value={sampleRate}
            onChange={(e) => setSampleRate(Number(e.target.value))}
            className="studio-input w-24 text-right font-mono"
          >
            {[10, 20, 25, 50, 100].map((hz) => (
              <option key={hz} value={hz}>
                {hz} Hz
              </option>
            ))}
          </select>
        </label>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
          <dt>peak v</dt>
          <dd className="text-right text-foreground">{safety.worst.maxVelocity.toFixed(1)} m/s</dd>
          <dt>peak a</dt>
          <dd className="text-right text-foreground">{safety.worst.maxAcceleration.toFixed(1)} m/s²</dd>
          <dt>peak yaw</dt>
          <dd className="text-right text-foreground">{safety.worst.maxYawRate.toFixed(0)} °/s</dd>
          <dt>min sep</dt>
          <dd className="text-right text-foreground">{safety.worst.minSeparation.toFixed(2)} m</dd>
          <dt>peak jerk</dt>
          <dd className="text-right text-foreground">{safety.metrics.maxJerk.toFixed(1)} m/s³</dd>
          <dt>frames</dt>
          <dd className="text-right text-foreground">{safety.frames}</dd>
          <dt>plan errors</dt>
          <dd className="text-right text-foreground">{plan.errors.length}</dd>
        </dl>
        <ul className="max-h-52 space-y-1 overflow-y-auto pt-1">
          {safety.issues.length === 0 && (
            <li className="text-xs text-safe">All checks passed within the flight envelope.</li>
          )}
          {safety.issues.slice(0, 40).map((issue) => (
            <li key={issue.id}>
              <button
                onClick={() => setTime(issue.time)}
                className={`issue-row ${issue.severity === "critical" ? "issue-row-critical" : ""}`}
              >
                <span className="font-mono text-[10px]">{issue.time.toFixed(1)}s</span>
                <span className="truncate">{issue.message}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <LaunchPanel />

      <SceneObjectsPanel />

      <LightingEffectsPanel />

      <ParticipationPanel />

      <DynamicPanel />

      <FullShowPanel />

      <EsspPanel />
      <ForensicsPanel />
      <ConversionPanel />
      <SimulationPanel />


      <section className="panel-card">
        <h2 className="panel-title">
          <Download className="size-3.5" /> Export
        </h2>
        {exportEligibility.reason === "NO_REPORT" && (
          <p
            data-testid="export-gate-no-report"
            className="rounded border border-border bg-muted/30 p-2 text-[10px] leading-relaxed text-muted-foreground"
          >
            Run full-show analysis before exporting computed show data.
          </p>
        )}
        {exportEligibility.reason === "STALE" && (
          <p
            data-testid="export-gate-stale"
            className="rounded border border-warning/60 bg-warning/10 p-2 text-[10px] leading-relaxed text-warning"
          >
            Project changed after validation; run full-show analysis again.
          </p>
        )}
        {exportEligibility.reason === "BLOCKED" && (
          <div
            data-testid="export-gate-blocked"
            className="rounded border border-destructive/60 bg-destructive/10 p-2 text-[10px] leading-relaxed text-destructive"
          >
            <p>Full-show validation BLOCKED — computed show exports are disabled.</p>
            <ul className="list-disc space-y-0.5 pl-4 pt-1">
              {exportEligibility.blockers.slice(0, 8).map((b) => (
                <li key={b}>{b}</li>
              ))}
              {exportEligibility.blockers.length === 0 && <li>See full-show report for details.</li>}
            </ul>
          </div>
        )}
        {exportEligibility.reason === "OK_WITH_WARNINGS" && (
          <div
            data-testid="export-gate-warnings"
            className="rounded border border-warning/60 bg-warning/10 p-2 text-[10px] leading-relaxed text-warning"
          >
            <p>Export allowed with non-blocking warnings.</p>
            <ul className="list-disc space-y-0.5 pl-4 pt-1">
              {exportEligibility.warnings.slice(0, 8).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        <button
          onClick={() =>
            downloadText(
              `${project.name.replace(/\s+/g, "-").toLowerCase()}.dss.show.json`,
              toGenericShowJson({
                project,
                plan,
                set: trajectorySet,
                safety,
                fullShow: fullShowReport,
                fullShowStale,
                preShowReport,
                preShowStale,
              }),
              "application/json",
            )
          }
          disabled={!canExportComputedShow}
          className="chip-btn w-full justify-center disabled:cursor-not-allowed disabled:opacity-40"
        >
          Generic show JSON (documented schema)
        </button>
        <button
          onClick={() =>
            downloadText(
              `${project.name.replace(/\s+/g, "-").toLowerCase()}.trajectories.csv`,
              toTrajectoryCsv(project, trajectorySet),
              "text/csv",
            )
          }
          disabled={!canExportComputedShow}
          className="chip-btn w-full justify-center disabled:cursor-not-allowed disabled:opacity-40"
        >
          Trajectory + light CSV
        </button>
        <button
          onClick={() =>
            downloadText(
              suggestedProjectFileName(project.name),
              toStudioProject(project),
              "application/json",
            )
          }
          className="chip-btn w-full justify-center"
        >
          Studio project file
        </button>
      </section>

      <section className="panel-card">
        <h2 className="panel-title">
          <Plug className="size-3.5" /> Adapters
        </h2>
        <ul className="space-y-2">
          {ADAPTER_REGISTRY.map((a) => (
            <li key={a.id} className="rounded border border-border/70 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs text-foreground">{a.name}</span>
                <span className={`status-pill status-${a.status}`}>{a.status}</span>
              </div>
              <p className="pt-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
                {a.upstream} · {a.license}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
