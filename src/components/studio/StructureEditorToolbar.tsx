/**
 * STRUCTURE EDITOR TOOLBAR — presentation only (Sprint 8B2).
 *
 * Gestures are forwarded to the pure editor commands; no geometry logic here.
 */
import { MousePointer2, PenLine, RotateCcw, Redo2, Undo2 } from "lucide-react";

import { useI18n } from "@/i18n";
import type { StructureEditorState } from "@/lib/visual";

export default function StructureEditorToolbar({ editor }: { editor: StructureEditorState }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-1">
      <button
        type="button"
        className="chip-btn"
        aria-pressed={editor.tool === "SELECT"}
        data-active={editor.tool === "SELECT" ? "true" : undefined}
        onClick={() => editor.setTool("SELECT")}
      >
        <MousePointer2 className="size-3" /> {t("image.editor.select")}
      </button>
      <button
        type="button"
        className="chip-btn"
        aria-pressed={editor.tool === "DRAW"}
        data-active={editor.tool === "DRAW" ? "true" : undefined}
        onClick={() => editor.setTool("DRAW")}
      >
        <PenLine className="size-3" /> {t("image.editor.addLine")}
      </button>
      <button
        type="button"
        className="mini-btn"
        disabled={!editor.canUndo}
        aria-label={t("image.editor.undo")}
        onClick={editor.undo}
      >
        <Undo2 className="size-3" />
      </button>
      <button
        type="button"
        className="mini-btn"
        disabled={!editor.canRedo}
        aria-label={t("image.editor.redo")}
        onClick={editor.redo}
      >
        <Redo2 className="size-3" />
      </button>
      <button
        type="button"
        className="mini-btn"
        disabled={!editor.edited}
        aria-label={t("image.editor.reset")}
        onClick={editor.reset}
      >
        <RotateCcw className="size-3" />
      </button>
    </div>
  );
}
