import { FileArchive, FolderOpen, Sparkles } from "lucide-react";
import { useRef, useState } from "react";

import { useI18n } from "@/i18n";
import { useStudio } from "@/lib/studio/store";
import SetupWizard from "./SetupWizard";

/**
 * NO SHOW OPEN — the explicit empty document state. It offers ONLY the three
 * lifecycle entry points (new, open, import); no playback, validation, export or
 * forensics surface exists here, because there is no document to act on.
 */
export default function NoShowOpen() {
  const { t } = useI18n();
  const { openProjectFile, importEsspFiles, projectFileError, referenceError } = useStudio();
  const [wizard, setWizard] = useState(false);
  const projectInput = useRef<HTMLInputElement | null>(null);
  const esspInput = useRef<HTMLInputElement | null>(null);
  const error = projectFileError ?? referenceError;

  return (
    <div
      data-testid="no-show-open"
      className="flex min-h-0 flex-1 items-center justify-center bg-surface-sunken px-6"
    >
      <div className="w-full max-w-lg space-y-4 text-center">
        <h2 className="font-display text-lg tracking-[0.14em] text-foreground">
          {t("project.noShowTitle")}
        </h2>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("project.noShowBody")}</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            data-testid="no-show-new"
            onClick={() => setWizard(true)}
            className="chip-btn font-mono text-[10px] uppercase tracking-[0.16em]"
          >
            <Sparkles className="size-3" /> {t("topBar.newShow")}
          </button>
          <button
            type="button"
            data-testid="no-show-open-project"
            onClick={() => projectInput.current?.click()}
            className="chip-btn font-mono text-[10px] uppercase tracking-[0.16em]"
          >
            <FolderOpen className="size-3" /> {t("project.open")}
          </button>
          <button
            type="button"
            data-testid="no-show-import-essp"
            onClick={() => esspInput.current?.click()}
            className="chip-btn font-mono text-[10px] uppercase tracking-[0.16em]"
          >
            <FileArchive className="size-3" /> Import ESSP
          </button>
        </div>
        {error ? (
          <p className="text-[10px] leading-relaxed text-critical">
            {error.code}: {error.message}
          </p>
        ) : null}
        <input
          ref={projectInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void openProjectFile(file);
          }}
        />
        <input
          ref={esspInput}
          type="file"
          multiple
          accept=".essp,.zip"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) void importEsspFiles(files);
          }}
        />
      </div>
      <SetupWizard open={wizard} mode="CREATE" onOpenChange={setWizard} />
    </div>
  );
}
