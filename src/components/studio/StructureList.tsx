/**
 * STRUCTURE LIST — click-free fallback for every editor operation.
 *
 * The STRUCTURE preview is small inside the left panel, so thin contours can be
 * hard to hit precisely. Every primitive is therefore also reachable from this
 * list: select, enable/disable and delete.
 */
import { Eye, EyeOff, Trash2 } from "lucide-react";

import { useI18n } from "@/i18n";
import { importanceOf, type StructureEditorState } from "@/lib/visual";

export default function StructureList({ editor }: { editor: StructureEditorState }) {
  const { t } = useI18n();
  return (
    <ul className="max-h-40 space-y-1 overflow-y-auto">
      {editor.draft.primitives.map((p) => {
        const enabled = p.enabled !== false;
        const selected = editor.selectedId === p.id;
        return (
          <li key={p.id} className="formation-row">
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              aria-pressed={selected}
              onClick={() => editor.select(selected ? null : p.id)}
            >
              <p
                className={
                  selected
                    ? "truncate text-xs text-primary"
                    : enabled
                      ? "truncate text-xs text-foreground"
                      : "truncate text-xs text-muted-foreground line-through"
                }
              >
                {p.type}
              </p>
              <p className="font-mono text-[10px] text-muted-foreground">
                {importanceOf(p)} · {p.id}
              </p>
            </button>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="mini-btn"
                aria-label={enabled ? t("image.editor.disable") : t("image.editor.enable")}
                onClick={() => editor.setEnabled(p.id, !enabled)}
              >
                {enabled ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
              </button>
              <button
                type="button"
                className="mini-btn"
                aria-label={t("image.editor.delete")}
                onClick={() => editor.remove(p.id)}
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
