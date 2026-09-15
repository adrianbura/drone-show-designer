/**
 * SHOW READINESS PANEL — store wiring only.
 *
 * Reads canonical project/report/export state, projects it with
 * `buildShowReadiness` and routes every action to the authority that owns it.
 * No safety, geofence or trajectory computation happens here.
 */
import { FileText } from "lucide-react";
import { useCallback, useState } from "react";

import ShowReadinessView from "./ShowReadinessView";
import { buildSimulationHandoff } from "@/lib/adapters/simulationHandoff";
import { downloadBytes } from "@/lib/adapters/export";
import { projectFileToJson } from "@/lib/project/serialize";
import { buildShowReadiness, type ReadinessActionId } from "@/lib/adapters/showReadiness";
import {
  buildValidationReport,
  renderValidationReportPdf,
  validationReportFileName,
} from "@/lib/report";
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
    projectSavedAt,
    analyzeFullShow,
    saveProjectFile,
    buildProjectFile,
    focusIssue,
  } = useStudio();
  const [exportError, setExportError] = useState<string | null>(null);

  const model = buildShowReadiness({
    projectDirty,
    hasSavedProject: projectSavedAt !== null,
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

  const downloadValidationReport = useCallback(() => {
    if (!fullShowReport) return;
    setExportError(null);
    try {
      const generatedAt = new Date().toISOString();
      const doc = buildValidationReport({ project, report: fullShowReport, generatedAt });
      downloadBytes(
        validationReportFileName(project, generatedAt),
        renderValidationReportPdf(doc),
        "application/pdf",
      );
    } catch (error) {
      setExportError(
        error instanceof Error ? error.message : "Could not build the validation report.",
      );
    }
  }, [fullShowReport, project]);

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
      <button
        type="button"
        className="flex w-full items-center justify-center gap-1.5 rounded border border-border bg-secondary/40 px-2 py-1.5 text-[10px] font-medium text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
        onClick={downloadValidationReport}
        disabled={!fullShowReport || fullShowBusy}
        title={
          fullShowReport
            ? "Download a printable PDF of the current analysis. It does not authorise the flight."
            : "Run the full-show analysis first."
        }
        data-testid="readiness-download-validation-report"
      >
        <FileText className="h-3 w-3" aria-hidden />
        Download validation report (PDF)
        {fullShowStale && fullShowReport ? " · stale" : ""}
      </button>
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
