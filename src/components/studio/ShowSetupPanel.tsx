/**
 * GUIDED SHOW SETUP PANEL — navigation and store wiring only.
 *
 * Projects the canonical project + readiness state with `buildShowSetup` and
 * routes each step's single action to the panel that already owns that work.
 * It computes no safety, geometry or geofence facts and mutates the project only
 * through the actions those panels own.
 */
import { useCallback, useState } from "react";
import { ListChecks } from "lucide-react";

import { buildShowReadiness } from "@/lib/adapters/showReadiness";
import { isSiteUsable } from "@/lib/show/geo";
import { focusStudioSurface } from "@/lib/studio/inspectorFocus";
import { buildShowSetup, type SetupActionId, type SetupStepState } from "@/lib/studio/showSetup";
import { useStudio } from "@/lib/studio/store";
import { requestWorkspaceSection } from "@/lib/studio/workspaceSections";

const TONE: Record<SetupStepState, string> = {
  OK: "text-success",
  WARNING: "text-warning",
  BLOCKED: "text-destructive",
  TODO: "text-muted-foreground",
};

const MARK: Record<SetupStepState, string> = {
  OK: "✓",
  WARNING: "!",
  BLOCKED: "×",
  TODO: "○",
};

function scrollToPanel(testId: string) {
  const el = document.querySelector(`[data-testid="${testId}"]`);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function ShowSetupPanel() {
  const {
    project,
    fullShowReport,
    fullShowStale,
    fullShowBusy,
    projectDirty,
    projectSavedAt,
    analyzeFullShow,
    focusIssue,
    addTakeoffPhase,
    addLandingPhase,
  } = useStudio();
  const [collapsed, setCollapsed] = useState(false);

  const hasFlightSite = isSiteUsable(project.site);
  const readiness = buildShowReadiness({
    projectDirty,
    hasSavedProject: projectSavedAt !== null,
    hasFlightSite,
    report: fullShowReport,
    stale: fullShowStale,
  });
  const model = buildShowSetup({ project, readiness, hasFlightSite });

  const onAction = useCallback(
    (action: SetupActionId) => {
      switch (action) {
        case "CONFIGURE_SITE":
          scrollToPanel("site-panel");
          return;
        case "CONFIGURE_LAUNCH":
          scrollToPanel("launch-panel");
          return;
        case "ADD_VISUAL":
          requestWorkspaceSection("visuals");
          return;
        case "ADD_TAKEOFF":
          addTakeoffPhase();
          return;
        case "ADD_LANDING":
          addLandingPhase();
          return;
        case "EDIT_CLIP":
          focusStudioSurface({ surface: "CLIP" });
          return;
        case "EDIT_TRANSITION":
          focusStudioSurface({ surface: "TRANSITION" });
          return;
        case "EDIT_LIGHTING":
          focusStudioSurface({ surface: "LIGHTING" });
          return;
        case "ANALYZE_FULL_SHOW":
          if (!fullShowBusy) analyzeFullShow();
          return;
        case "OPEN_BLOCKING_ISSUES": {
          const first = readiness.blockingIssues[0];
          if (first) focusIssue(first);
          return;
        }
        case "OPEN_EXPORT":
          scrollToPanel("production-readiness");
          return;
      }
    },
    [addLandingPhase, addTakeoffPhase, analyzeFullShow, focusIssue, fullShowBusy, readiness],
  );

  return (
    <section className="panel-card" data-testid="show-setup-panel">
      <h2 className="panel-title">
        <ListChecks className="size-3.5" /> Show setup
      </h2>
      <div className="flex items-center justify-between gap-2 pb-1">
        <p className="text-[11px] leading-relaxed text-muted-foreground" data-testid="show-setup-headline">
          {model.doneCount}/{model.totalCount} done · {model.headline}
        </p>
        <button
          type="button"
          className="chip-btn text-[10px]"
          onClick={() => setCollapsed(!collapsed)}
          data-testid="show-setup-toggle"
        >
          {collapsed ? "Show steps" : "Hide steps"}
        </button>
      </div>
      {!collapsed && (
        <ol className="space-y-1" data-testid="show-setup-steps">
          {model.steps.map((step) => (
            <li
              key={step.id}
              className="rounded border border-border/70 p-2"
              data-testid={`show-setup-step-${step.id}`}
              data-state={step.state}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-[11px] font-medium">
                  <span className={`font-mono ${TONE[step.state]}`}>{MARK[step.state]}</span>{" "}
                  {step.index}. {step.label}
                </p>
                {step.action && (
                  <button
                    type="button"
                    className="chip-btn shrink-0 text-[10px]"
                    onClick={() => onAction(step.action!.id)}
                    data-testid={`show-setup-action-${step.id}`}
                  >
                    {step.action.label}
                  </button>
                )}
              </div>
              <p className="pt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                {step.detail}
              </p>
            </li>
          ))}
        </ol>
      )}
      <p className="pt-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
        A guided order only. Completing every step does NOT authorise a flight.
      </p>
    </section>
  );
}
