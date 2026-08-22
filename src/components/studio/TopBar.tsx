import {
  Activity,
  FolderOpen,
  Keyboard,
  Radio,
  Save,
  SaveAll,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { useRef, useState } from "react";

import { useI18n } from "@/i18n";
import { LANGUAGES, type Language } from "@/i18n/translate";
import { SHORTCUT_HELP } from "@/lib/studio/shortcuts";
import { authorityLabel, buildProductionStatus } from "@/lib/studio/productionStatus";
import {
  requiresUnsavedConfirmation,
  unsavedWorkPrompt,
  type DestructiveDocumentAction,
} from "@/lib/studio/unsavedWorkGuard";
import { suggestedSaveAsName } from "@/lib/studio/documentLifecycle";
import { useStudio } from "@/lib/studio/store";
import SetupWizard from "./SetupWizard";

function shortTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString();
}

export default function TopBar() {
  const {
    project,
    safety,
    duration,
    fullShowReport,
    fullShowStale,
    fullShowBusy,
    projectDirty,
    projectSavedAt,
    projectAutosavedAt,
    projectFileError,
    clearProjectFileError,
    saveProjectFile,
    saveProjectFileAs,
    documentOpen,
    closeShow,
    documentAction,
    clearDocumentAction,
    projectFileName,
    openProjectFile,
    autosaveRecovery,
    restoreAutosave,
    dismissAutosave,
    referenceOwnership,
  } = useStudio();
  const { t, language, setLanguage } = useI18n();
  const [wizard, setWizard] = useState<"CREATE" | "EDIT" | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  // UNSAVED WORK GUARD — explicit consent before a dirty document is replaced.
  const [pending, setPending] = useState<{
    action: DestructiveDocumentAction;
    run: () => void;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  // DOMINANT production state: canonical export eligibility, mirrored only.
  const readiness = buildProductionStatus(fullShowReport, fullShowStale);
  const authority = authorityLabel(referenceOwnership);
  const status =
    safety.status === "ok" ? "nominal" : safety.status === "warning" ? "review" : "unsafe";
  const statusLabel = t(
    status === "nominal"
      ? "topBar.statusNominal"
      : status === "review"
        ? "topBar.statusReview"
        : "topBar.statusUnsafe",
  );

  const guard = (action: DestructiveDocumentAction, run: () => void) => {
    if (requiresUnsavedConfirmation(action, { projectDirty })) {
      setPending({ action, run });
      return;
    }
    run();
  };
  const prompt = pending ? unsavedWorkPrompt(pending.action) : null;

  return (
    <header className="relative flex items-center gap-4 border-b border-border bg-panel px-4 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-sm font-semibold tracking-[0.22em] text-foreground">
          DRONE SHOW
        </span>
        <span className="font-display text-sm tracking-[0.22em] text-accent">STUDIO</span>
      </div>
      <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:inline">
        {t("topBar.build")}
      </span>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => guard("NEW_SHOW", () => setWizard("CREATE"))}
          className="chip-btn font-mono text-[10px] uppercase tracking-[0.16em]"
        >
          <Sparkles className="size-3" /> {t("topBar.newShow")}
        </button>
        <button
          type="button"
          onClick={() => setWizard("EDIT")}
          className="chip-btn font-mono text-[10px] uppercase tracking-[0.16em]"
        >
          <Settings2 className="size-3" /> {t("topBar.showSetup")}
        </button>
        <button
          type="button"
          onClick={() => saveProjectFile()}
          disabled={!documentOpen}
          className="chip-btn disabled:opacity-40 font-mono text-[10px] uppercase tracking-[0.16em]"
        >
          <Save className="size-3" /> {t("project.save")}
        </button>
        <button
          type="button"
          onClick={() => guard("OPEN_PROJECT", () => fileInput.current?.click())}
          className="chip-btn font-mono text-[10px] uppercase tracking-[0.16em]"
        >
          <FolderOpen className="size-3" /> {t("project.open")}
        </button>
        <button
          type="button"
          data-testid="save-as-project"
          disabled={!documentOpen}
          onClick={() => {
            const next = window.prompt(
              t("project.saveAsPrompt"),
              suggestedSaveAsName(projectFileName, project.name),
            );
            if (next === null) return;
            saveProjectFileAs(next);
          }}
          className="chip-btn font-mono text-[10px] uppercase tracking-[0.16em] disabled:opacity-40"
        >
          <SaveAll className="size-3" /> {t("project.saveAs")}
        </button>
        <button
          type="button"
          data-testid="close-show"
          disabled={!documentOpen}
          onClick={() => guard("CLOSE_SHOW", closeShow)}
          className="chip-btn font-mono text-[10px] uppercase tracking-[0.16em] disabled:opacity-40"
        >
          <X className="size-3" /> {t("project.close")}
        </button>
        <button
          type="button"
          onClick={() => setHelpOpen((v) => !v)}
          aria-label={t("shortcuts.title")}
          className="chip-btn font-mono text-[10px] uppercase tracking-[0.16em]"
        >
          <Keyboard className="size-3" />
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void openProjectFile(file);
          }}
        />
      </div>

      {documentAction ? (
        <button
          type="button"
          data-testid="document-action-feedback"
          onClick={clearDocumentAction}
          title="Dismiss"
          className="metric-pill font-mono text-[10px] uppercase tracking-[0.16em]"
        >
          {documentAction.message}
        </button>
      ) : null}

      <div className="ml-auto flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em]">
        <span className="hidden text-muted-foreground md:inline">
          {documentOpen ? project.name : t("project.noShowTitle")}
        </span>
        {documentOpen ? (
        <>
        <span
          data-testid="project-file-state"
          data-dirty={projectDirty ? "true" : "false"}
          className={`metric-pill ${projectDirty || !projectSavedAt ? "status-review" : ""}`}

          title={
            projectAutosavedAt
              ? t("project.autosaved", { time: shortTime(projectAutosavedAt) })
              : undefined
          }
        >
          {/* A project that was never written to a file is NOT "saved": a new show
              or a loaded sample must never inherit the previous file's badge. */}
          {projectDirty || !projectSavedAt
            ? t("project.unsaved")
            : `${t("project.saved")} ${shortTime(projectSavedAt)}`}
        </span>
        <span className="metric-pill">
          <Radio className="size-3" /> {t("topBar.drones", { count: project.droneCount })}
        </span>
        <span className="metric-pill">{duration.toFixed(0)}s</span>
        {/* SECONDARY: live authoring feedback. Deliberately quieter than the
            dominant readiness pill so it can never read as export approval. */}
        <span
          className="hidden items-center gap-1 border-l border-border pl-2 text-muted-foreground lg:inline-flex"
          title="Live authoring feedback while you edit — it does not authorize export."
          data-testid="topbar-authoring-feedback"
        >
          <Activity className="size-3" /> {statusLabel}
        </span>
        {authority && (
          <span className="metric-pill" title={authority.detail} data-testid="topbar-authority">
            {authority.label}
          </span>
        )}
        {fullShowBusy ? (
          <span className="metric-pill">{t("topBar.validating")}</span>
        ) : (
          <span
            className={`metric-pill status-${readiness.tone === "neutral" ? "review" : readiness.tone}`}
            title={readiness.detail}
            data-testid="topbar-readiness"
          >
            {readiness.readiness.replace(/_/g, " ")}
          </span>
        )}
        </>
        ) : null}
        <div className="flex overflow-hidden rounded border border-border" role="group" aria-label={t("common.language")}>
          {LANGUAGES.map((lng: Language) => (
            <button
              key={lng}
              type="button"
              onClick={() => setLanguage(lng)}
              className={`px-1.5 py-0.5 uppercase transition-colors ${
                language === lng ? "bg-accent/15 text-accent" : "text-muted-foreground"
              }`}
            >
              {lng}
            </button>
          ))}
        </div>
      </div>

      {helpOpen && (
        <div className="absolute right-4 top-12 z-50 w-64 space-y-1 rounded border border-border bg-panel p-3 shadow-lg">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t("shortcuts.title")}
          </p>
          {SHORTCUT_HELP.map((row) => (
            <div key={row.keys} className="flex justify-between gap-2 text-[11px]">
              <span className="text-muted-foreground">{t(row.labelKey)}</span>
              <span className="font-mono text-foreground">{row.keys}</span>
            </div>
          ))}
        </div>
      )}

      {projectFileError && (
        <div className="absolute left-1/2 top-12 z-50 w-80 -translate-x-1/2 space-y-2 rounded border border-destructive bg-panel p-3 shadow-lg">
          <p className="text-[11px] text-destructive">
            {projectFileError.code}: {projectFileError.message}
          </p>
          <button type="button" className="chip-btn" onClick={clearProjectFileError}>
            {t("common.close")}
          </button>
        </div>
      )}

      {autosaveRecovery && (
        <div className="absolute left-1/2 top-12 z-50 w-80 -translate-x-1/2 space-y-2 rounded border border-border bg-panel p-3 shadow-lg">
          <p className="text-xs font-semibold text-foreground">{t("project.recoveryTitle")}</p>
          <p className="text-[11px] text-muted-foreground">
            {t("project.recoveryBody", { time: shortTime(autosaveRecovery.savedAt) })}
          </p>
          <div className="flex gap-1.5">
            <button
              type="button"
              className="chip-btn"
              onClick={() => guard("RESTORE_AUTOSAVE", restoreAutosave)}
            >
              {t("project.restore")}
            </button>
            <button type="button" className="chip-btn" onClick={dismissAutosave}>
              {t("project.discard")}
            </button>
          </div>
        </div>
      )}

      {prompt && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={prompt.title}
          data-testid="unsaved-work-dialog"
          className="absolute left-1/2 top-12 z-50 w-96 -translate-x-1/2 space-y-2 rounded border border-warning/60 bg-panel p-3 shadow-lg"
        >
          <p className="text-xs font-semibold text-foreground">{prompt.title}</p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{prompt.body}</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className="chip-btn"
              data-testid="unsaved-work-save"
              onClick={() => {
                const run = pending?.run;
                setPending(null);
                saveProjectFile();
                run?.();
              }}
            >
              Save, then continue
            </button>
            <button
              type="button"
              className="chip-btn"
              data-testid="unsaved-work-continue"
              onClick={() => {
                const run = pending?.run;
                setPending(null);
                run?.();
              }}
            >
              {prompt.continueLabel}
            </button>
            <button
              type="button"
              className="chip-btn"
              data-testid="unsaved-work-cancel"
              onClick={() => setPending(null)}
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      <SetupWizard
        open={wizard !== null}
        mode={wizard ?? "CREATE"}
        onOpenChange={(open) => setWizard(open ? wizard : null)}
      />
    </header>
  );
}
