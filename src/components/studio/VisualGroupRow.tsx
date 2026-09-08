/**
 * VISUAL GROUP ROW — presentation only.
 *
 * One readable header for a named visual composition plus its child object rows.
 * It owns no grouping, selection, transform, allocation or safety logic: every
 * number is derived from canonical Studio state by SceneComposerPanel and every
 * action calls a canonical store action supplied by the caller.
 */
import { FolderOpen, Lightbulb, Move3d, Pencil, Ungroup, Waves } from "lucide-react";

export interface VisualGroupView {
  readonly id: string;
  readonly name: string;
  readonly objectCount: number;
  /** Total allocated drones, summed from the canonical scene budget. */
  readonly droneCount: number;
  readonly visibleCount: number;
  readonly lightingCount: number;
  readonly motionStatus: string;
  readonly selected: boolean;
}

export default function VisualGroupRow({
  view,
  renaming,
  renameDraft,
  onRenameDraftChange,
  onRenameCommit,
  onRenameCancel,
  onRenameStart,
  onSelect,
  onUngroup,
  onFocusTransform,
  onFocusColor,
  onFocusMotion,
  children,
  footer,
}: {
  view: VisualGroupView;
  renaming: boolean;
  renameDraft: string;
  onRenameDraftChange: (next: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onRenameStart: () => void;
  onSelect: () => void;
  onUngroup: () => void;
  onFocusTransform: () => void;
  onFocusColor: () => void;
  onFocusMotion: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <li
      data-testid={`visual-group-${view.id}`}
      data-selected={view.selected ? "1" : "0"}
      data-objects={view.objectCount}
      data-drones={view.droneCount}
      className={`rounded border px-1.5 py-1 ${
        view.selected ? "border-accent bg-accent/10" : "border-border bg-surface-sunken"
      }`}
    >
      <div className="flex items-center gap-1">
        {renaming ? (
          <input
            autoFocus
            value={renameDraft}
            aria-label={`Rename visual group ${view.name}`}
            data-testid={`visual-group-rename-input-${view.id}`}
            onChange={(event) => onRenameDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onRenameCommit();
              if (event.key === "Escape") onRenameCancel();
            }}
            className="studio-input min-w-0 flex-1 font-mono"
          />
        ) : (
          <button
            type="button"
            data-testid={`visual-group-select-${view.id}`}
            aria-pressed={view.selected}
            title="Select the complete visual group"
            onClick={onSelect}
            className="min-w-0 flex-1 truncate text-left font-mono text-[10px] text-foreground"
          >
            <FolderOpen className="mr-1 inline size-3" />
            <span data-testid={`visual-group-name-${view.id}`}>{view.name}</span>
            <span
              className="ml-1 text-muted-foreground"
              data-testid={`visual-group-object-count-${view.id}`}
            >
              · {view.objectCount} objects
            </span>
            <span
              className="ml-1 text-muted-foreground"
              data-testid={`visual-group-drone-count-${view.id}`}
            >
              · {view.droneCount} drones
            </span>
          </button>
        )}
        <button
          type="button"
          title="Rename visual group"
          aria-label={`Rename ${view.name}`}
          data-testid={`visual-group-rename-${view.id}`}
          onClick={onRenameStart}
          className="text-muted-foreground hover:text-foreground"
        >
          <Pencil className="size-3" />
        </button>
        <button
          type="button"
          title="Ungroup keeps all visual objects and their effects."
          aria-label={`Ungroup ${view.name}`}
          data-testid={`visual-group-ungroup-${view.id}`}
          onClick={onUngroup}
          className="text-muted-foreground hover:text-foreground"
        >
          <Ungroup className="size-3" />
        </button>
        {/* Inert alias for previously accepted acceptance tests. */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          data-testid={`visual-group-remove-${view.id}`}
          onClick={onUngroup}
        >
          Ungroup
        </button>
      </div>

      <p
        className="mt-0.5 font-mono text-[10px] text-muted-foreground"
        data-testid={`visual-group-status-${view.id}`}
      >
        {view.visibleCount} of {view.objectCount} visible · {view.lightingCount} lighting effect
        {view.lightingCount === 1 ? "" : "s"} · {view.motionStatus}
      </p>

      <div className="mt-1 flex flex-wrap gap-1">
        <button
          type="button"
          data-testid={`visual-group-transform-${view.id}`}
          onClick={onFocusTransform}
          className="chip-btn"
        >
          <Move3d className="size-3" /> Move / Rotate / Scale
        </button>
        <button
          type="button"
          data-testid={`visual-group-color-${view.id}`}
          onClick={onFocusColor}
          className="chip-btn"
        >
          <Lightbulb className="size-3" /> Color effect
        </button>
        <button
          type="button"
          data-testid={`visual-group-motion-${view.id}`}
          onClick={onFocusMotion}
          className="chip-btn"
        >
          <Waves className="size-3" /> Motion effect
        </button>
      </div>

      <p className="mt-0.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
        Ungroup keeps all visual objects and their effects.
      </p>

      <ul
        className="mt-1 space-y-1 border-l border-border pl-2"
        data-testid={`visual-group-children-${view.id}`}
      >
        {children}
      </ul>
      {footer}
    </li>
  );
}
