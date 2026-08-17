import { Activity, FolderOpen, Keyboard, Radio, Save, Settings2, Sparkles } from "lucide-react";
import { useRef, useState } from "react";

import { useI18n } from "@/i18n";
import { LANGUAGES, type Language } from "@/i18n/translate";
import { SHORTCUT_HELP } from "@/lib/studio/shortcuts";
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
    openProjectFile,
    autosaveRecovery,
    restoreAutosave,
    dismissAutosave,
  } = useStudio();
  const { t, language, setLanguage } = useI18n();
  const [wizard, setWizard] = useState<"CREATE" | "EDIT" | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const status =
    safety.status === "ok" ? "nominal" : safety.status === "warning" ? "review" : "unsafe";
  const statusLabel = t(
    status === "nominal"
      ? "topBar.statusNominal"
      : status === "review"
        ? "topBar.statusReview"
        : "topBar.statusUnsafe",
  );

  return (
    <header className="flex items-center gap-4 border-b border-border bg-panel px-4 py-2.5">
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
          onClick={() => setWizard("CREATE")}
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
          onClick={saveProjectFile}
          className="chip-btn font-mono text-[10px] uppercase tracking-[0.16em]"
        >
          <Save className="size-3" /> {t("project.save")}
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="chip-btn font-mono text-[10px] uppercase tracking-[0.16em]"
        >
          <FolderOpen className="size-3" /> {t("project.open")}
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

      <div className="ml-auto flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em]">
        <span className="hidden text-muted-foreground md:inline">{project.name}</span>
        <span
          className={`metric-pill ${projectDirty ? "status-review" : ""}`}
          title={
            projectAutosavedAt
              ? t("project.autosaved", { time: shortTime(projectAutosavedAt) })
              : undefined
          }
        >
          {projectDirty
            ? t("project.unsaved")
            : `${t("project.saved")}${projectSavedAt ? ` ${shortTime(projectSavedAt)}` : ""}`}
        </span>
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
        <span className="metric-pill">
          <Radio className="size-3" /> {t("topBar.drones", { count: project.droneCount })}
        </span>
        <span className="metric-pill">{duration.toFixed(0)}s</span>
        <span className={`metric-pill status-${status}`}>
          <Activity className="size-3" /> {statusLabel}
        </span>
        {fullShowBusy ? (
          <span className="metric-pill">{t("topBar.validating")}</span>
        ) : fullShowReport ? (
          <span
            className={`metric-pill status-${
              fullShowReport.status === "FAIL"
                ? "unsafe"
                : fullShowReport.status === "PASS_WITH_WARNINGS"
                  ? "review"
                  : "nominal"
            }`}
            title={fullShowReport.statement}
          >
            {t(fullShowReport.status === "FAIL" ? "topBar.fullShowFail" : "topBar.fullShowPass")}
            {fullShowStale ? ` · ${t("topBar.stale")}` : ""}
          </span>
        ) : null}
      </div>

      <SetupWizard
        open={wizard !== null}
        mode={wizard ?? "CREATE"}
        onOpenChange={(open) => setWizard(open ? wizard : null)}
      />
    </header>
  );
}
