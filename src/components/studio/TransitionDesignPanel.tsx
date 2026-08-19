import { useMemo, useState } from "react";
import { Layers, Timer } from "lucide-react";

import {
  departureGroups,
  describeTransitionDesign,
  staggerPatternLabel,
  STAGGER_DISTRIBUTIONS,
  STAGGER_PATTERNS,
  TRANSITION_MODES,
  type StaggerDistributionId,
  type StaggerPatternId,
  type TransitionModeId,
} from "@/lib/show/transition";
import { clipPhase } from "@/lib/show/types";
import { useStudio } from "@/lib/studio/store";

const MODE_HINT: Record<TransitionModeId, string> = {
  AUTO: "Planner default: no authored offsets, canonical assignment.",
  SYNCHRONIZED: "Every drone departs together, canonical assignment preserved.",
  STAGGERED: "Authored departure wave derived from the transition source geometry.",
  MANUAL: "Advanced: edit the per-drone start and lane offsets of this transition.",
};

/**
 * DESIGNER-FACING TRANSITION MODE UI.
 *
 * Everything here is presentation over the existing planning authority: the
 * store translates a mode into the SAME `ClipTransitionOverride` the optimiser
 * writes, so the preview in the viewport is already the committed result.
 */
export default function TransitionDesignPanel() {
  const {
    project,
    selectedClipId,
    canAnalyzeSelectedClip,
    transitionOverrides,
    transitionDesignFor,
    transitionDesignNeedsRecalculation,
    setTransitionDesign,
    patchTransitionDroneOffset,
  } = useStudio();
  const [manualOpen, setManualOpen] = useState(false);

  const clip = project.timeline.find((c) => c.id === selectedClipId);
  const design = selectedClipId ? transitionDesignFor(selectedClipId) : null;
  const override = selectedClipId ? transitionOverrides[selectedClipId] : undefined;
  const stale = selectedClipId ? transitionDesignNeedsRecalculation(selectedClipId) : false;

  const groups = useMemo(
    () => (override ? departureGroups(override.startOffsets) : null),
    [override],
  );

  if (!clip || !design) {
    return (
      <section className="panel-card" data-testid="transition-design-panel">
        <h2 className="panel-title">
          <Timer className="size-3.5" /> Transition design
        </h2>
        <p className="text-xs text-muted-foreground">Select a clip on the timeline.</p>
      </section>
    );
  }

  const phase = clipPhase(clip);
  const authorable = canAnalyzeSelectedClip;

  return (
    <section className="panel-card" data-testid="transition-design-panel">
      <h2 className="panel-title">
        <Timer className="size-3.5" /> Transition design
      </h2>

      <div className="flex items-center justify-between gap-2">
        <span
          data-testid="transition-design-summary"
          className="rounded border border-border bg-muted/40 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground"
        >
          {describeTransitionDesign(design)}
        </span>
        {stale && (
          <span
            data-testid="transition-design-stale"
            className="rounded border border-warning/60 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-warning"
          >
            Needs recalculation
          </span>
        )}
      </div>

      {!authorable ? (
        <p
          data-testid="transition-design-locked"
          className="text-[10px] leading-relaxed text-muted-foreground"
        >
          {phase === "TAKEOFF" || phase === "LANDING"
            ? `${phase} keeps its dedicated vertical planner — transition design is not authorable here.`
            : "This clip is not optimizable (partial-fleet participation or non-permutable target), so its transition stays planner-owned."}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 pt-1">
            {TRANSITION_MODES.map((mode) => (
              <button
                key={mode}
                data-testid={`transition-mode-${mode}`}
                aria-pressed={design.mode === mode}
                onClick={() => setTransitionDesign(clip.id, { mode })}
                className={`chip-btn justify-center ${
                  design.mode === mode ? "border-primary text-primary" : ""
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            {MODE_HINT[design.mode]}
          </p>

          {design.mode === "STAGGERED" && (
            <div className="space-y-2 pt-1">
              <label className="space-y-1.5">
                <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Stagger pattern
                </span>
                <select
                  value={design.pattern}
                  aria-label="Stagger pattern"
                  data-testid="stagger-pattern"
                  onChange={(e) =>
                    setTransitionDesign(clip.id, {
                      pattern: e.target.value as StaggerPatternId,
                    })
                  }
                  className="studio-input"
                >
                  {STAGGER_PATTERNS.map((p) => (
                    <option key={p} value={p}>
                      {p.replace("_", " → ")} ({staggerPatternLabel(p)})
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Total stagger
                  <span className="font-mono text-foreground">
                    {design.totalStagger.toFixed(1)} s
                  </span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={0.1}
                  value={design.totalStagger}
                  data-testid="stagger-total"
                  aria-label="Total stagger"
                  onChange={(e) =>
                    setTransitionDesign(clip.id, { totalStagger: Number(e.target.value) })
                  }
                  className="w-full accent-primary"
                />
                <span className="block text-[10px] text-muted-foreground">
                  Clamped by the scheduler to half the transition (
                  {(clip.transition * 0.5).toFixed(1)} s).
                </span>
              </label>
              <label className="space-y-1.5">
                <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Distribution
                </span>
                <select
                  value={design.distribution}
                  aria-label="Stagger distribution"
                  onChange={(e) =>
                    setTransitionDesign(clip.id, {
                      distribution: e.target.value as StaggerDistributionId,
                    })
                  }
                  className="studio-input"
                >
                  {STAGGER_DISTRIBUTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {/* DEPARTURE TIMING — lightweight DOM histogram, no 3D work. */}
          {groups && groups.maxOffset > 0 && (
            <div className="space-y-1 pt-1" data-testid="transition-departure-viz">
              <div className="flex items-end gap-0.5" style={{ height: 34 }}>
                {groups.histogram.map((count, i) => {
                  const peak = Math.max(1, ...groups.histogram);
                  return (
                    <span
                      key={i}
                      title={`${count} drones`}
                      className="flex-1 rounded-t bg-primary/60"
                      style={{ height: `${Math.max(2, (count / peak) * 100)}%` }}
                    />
                  );
                })}
              </div>
              <p className="font-mono text-[10px] text-muted-foreground">
                early {groups.early} · mid {groups.middle} · late {groups.late} · spread{" "}
                {groups.maxOffset.toFixed(2)} s
              </p>
            </div>
          )}

          {design.mode === "MANUAL" && override && (
            <div className="space-y-2 pt-1">
              <button
                onClick={() => setManualOpen((v) => !v)}
                className="chip-btn w-full justify-center"
                data-testid="manual-offsets-toggle"
              >
                <Layers className="size-3" /> {manualOpen ? "Hide" : "Show"} per-drone offsets (
                {override.startOffsets.length})
              </button>
              {manualOpen && (
                <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                  {override.startOffsets.map((offset, i) => (
                    <div key={i} className="flex items-center gap-2 font-mono text-[10px]">
                      <span className="w-10 text-muted-foreground">#{i + 1}</span>
                      <input
                        type="number"
                        step={0.1}
                        min={0}
                        max={clip.transition * 0.5}
                        value={offset}
                        aria-label={`Start offset drone ${i + 1}`}
                        onChange={(e) =>
                          patchTransitionDroneOffset(clip.id, i, {
                            startOffset: Number(e.target.value),
                          })
                        }
                        className="studio-input h-7 flex-1"
                      />
                      <input
                        type="number"
                        step={0.5}
                        value={override.laneOffsets[i] ?? 0}
                        aria-label={`Lane offset drone ${i + 1}`}
                        onChange={(e) =>
                          patchTransitionDroneOffset(clip.id, i, {
                            laneOffset: Number(e.target.value),
                          })
                        }
                        className="studio-input h-7 flex-1"
                      />
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Columns: start offset (s) and vertical lane offset (m) — the same arrays the
                planner flies.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
