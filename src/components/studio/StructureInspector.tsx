/**
 * STRUCTURE INSPECTOR — the selected primitive only (Sprint 8B2).
 *
 * Shows type / status / importance / point count / part and the two actions.
 * No raw JSON, no compiler internals.
 */
import { Trash2 } from "lucide-react";

import { useI18n } from "@/i18n";
import {
  STRUCTURE_IMPORTANCE_LEVELS,
  importanceOf,
  type StructureEditorState,
  type StructureImportance,
  type VisualPrimitive,
} from "@/lib/visual";

function pointCount(primitive: VisualPrimitive): number {
  switch (primitive.type) {
    case "POLYLINE":
    case "CLOSED_CONTOUR":
      return primitive.path.length;
    case "REGION":
      return primitive.outline.length + (primitive.holes ?? []).reduce((s, h) => s + h.length, 0);
    case "POINT_FEATURE":
      return 1;
    default:
      return 0;
  }
}

export default function StructureInspector({ editor }: { editor: StructureEditorState }) {
  const { t } = useI18n();
  const primitive = editor.draft.primitives.find((p) => p.id === editor.selectedId);
  if (!primitive) {
    return <p className="text-[10px] text-muted-foreground">{t("image.editor.noSelection")}</p>;
  }
  const enabled = primitive.enabled !== false;
  const holes = primitive.type === "REGION" ? (primitive.holes ?? []).length : 0;

  return (
    <div className="space-y-1.5 rounded border border-border/60 bg-muted/20 p-1.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {primitive.type} · {pointCount(primitive)} {t("image.editor.points")}
        {holes > 0 ? ` · ${holes} ${t("image.editor.holes")}` : ""}
      </div>
      <div className="font-mono text-[10px] text-muted-foreground">
        {t("image.editor.id")} {primitive.id}
        {primitive.part ? ` · ${primitive.part}` : ""}
      </div>
      <label className="block space-y-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {t("image.editor.importance")}
        </span>
        <select
          value={importanceOf(primitive)}
          onChange={(e) => editor.setImportance(primitive.id, e.target.value as StructureImportance)}
          className="studio-input w-full"
          aria-label={t("image.editor.importance")}
        >
          {STRUCTURE_IMPORTANCE_LEVELS.map((level) => (
            <option key={level} value={level}>
              {t(`image.editor.importance.${level}` as "image.editor.importance.LOW")}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className="chip-btn"
          onClick={() => editor.setEnabled(primitive.id, !enabled)}
        >
          {enabled ? t("image.editor.disable") : t("image.editor.enable")}
        </button>
        <button type="button" className="chip-btn" onClick={() => editor.remove(primitive.id)}>
          <Trash2 className="size-3" /> {t("image.editor.delete")}
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        {enabled ? t("image.editor.statusEnabled") : t("image.editor.statusDisabled")}
      </p>
    </div>
  );
}
