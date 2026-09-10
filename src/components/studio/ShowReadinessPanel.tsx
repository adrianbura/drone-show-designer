/**
 * SHOW READINESS PANEL — store wiring only.
 *
 * Reads canonical project/report/export state, projects it with
 * `buildShowReadiness` and routes every action to the authority that owns it.
 * No safety, geofence or trajectory computation happens here.
 */
import { useCallback, useState } from "react";

import ShowReadinessView from "./ShowReadinessView";
import { buildSimulationHandoff } from "@/lib/adapters/simulationHandoff";
import { downloadBytes } from "@/lib/adapters/export";
import { projectFileToJson } from "@/lib/project/serialize";
import { buildShowReadiness, type ReadinessActionId } from "@/lib/adapters/showReadiness";
import { isSiteUsable } from "@/lib/show/geo";
import { useStudio } from "@/lib/studio/store";

export default function ShowReadinessPanel() {
  const {
    project,
    plan,
    trajectorySet,
    safety,
    referenceColorsAt,
    fullShowReport,
    fullShowStale,
    fullShowBusy,
    fullShowProgress,
    preShowReport,
    preShowStale,
    projectDirty,
    analyzeFullShow,
    saveProjectFile,
    buildProjectFile,
    focusIssue,
  } = useStudio();
  const [exportError, setExportError] = useState<string | null>(null);

  const model = buildShowReadiness({
    projectDirty,
    hasFlightSite: isSiteUsable(project.site),
    report: fullShowReport,
    stale: fullShowStale,
  });

  const exportSimulatorPackage = useCallback(async () => {
    const built = await buildSimulationHandoff({
      project,
      plan,
      set: trajectorySet,
      safety,
      fullShow: fullShowReport,
      fullShowStale,
      preShowReport,
      preShowStale,
      referenceColorsAt,
      projectFileJson: projectFileToJson(buildProjectFile()),
    });
    if (!built.ok) {
      setExportError(built.reason);
      return;
    }
    setExportError(null);
    downloadBytes(built.fileName, built.zip, "application/zip");
  }, [
    project,
    plan,
    trajectorySet,
    safety,
    fullShowReport,
    fullShowStale,
    preShowReport,
    preShowStale,
    referenceColorsAt,
    buildProjectFile,
  ]);

  const onAction = useCallback(
    (action: ReadinessActionId) => {
      switch (action) {
        case "SAVE_PROJECT":
          saveProjectFile();
          return;
        case "CONFIGURE_SITE": {
          const site = document.querySelector('[data-testid="site-panel"]');
          site?.scrollIntoView({ block: "start" });
          return;
        }
        case "ANALYZE_FULL_SHOW":
          if (!fullShowBusy) analyzeFullShow();
          return;
        case "OPEN_BLOCKING_ISSUES": {
          const first = model.blockingIssues[0];
          if (first) focusIssue(first);
          return;
        }
        case "EXPORT_SIMULATOR_PACKAGE":
          void exportSimulatorPackage();
          return;
      }
    },
    [analyzeFullShow, exportSimulatorPackage, focusIssue, fullShowBusy, model, saveProjectFile],
  );

  return (
    <div className="min-w-0 space-y-1">
      <ShowReadinessView
        model={model}
        busy={fullShowBusy}
        progress={
          fullShowProgress
            ? `step ${fullShowProgress.step}/${fullShowProgress.totalSteps} · ${fullShowProgress.label}`
            : null
        }
        onAction={onAction}
      />
      {exportError && (
        <p
          className="rounded border border-destructive/60 bg-destructive/10 p-2 text-[10px] text-destructive"
          data-testid="readiness-export-error"
        >
          {exportError}
        </p>
      )}
    </div>
  );
}
