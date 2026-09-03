/**
 * VISUAL LAYER ROW — presentation only.
 *
 * One readable row of the everyday "Visual layers" list. It owns no selection
 * state, no project state and no maths: every value is passed in already derived
 * from canonical Studio state by SceneComposerPanel.
 */
import { AlertTriangle, Copy, Eye, EyeOff, Pencil, Trash2, Waves } from "lucide-react";

export interface VisualLayerView {
  readonly id: string;
  readonly name: string;
  /** SVG | Text | Line | AI | Asset — inferred from the canonical source asset. */
  readonly typeLabel: string;
  readonly droneCount: number;
  readonly visible: boolean;
  readonly animated: boolean;
  readonly lightingCount: number;
  readonly motionStatus: string;
  readonly warning: string | null;
}

export default function VisualLayerRow({
  layer,
  selected,
  canDelete,
  onSelect,
  onToggleVisible,
  onRename,
  onDuplicate,
  onDelete,
}: {
  layer: VisualLayerView;
  selected: boolean;
  canDelete: boolean;
  onSelect: (additive: boolean) => void;
  onToggleVisible: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      data-testid={`visual-layer-${layer.id}`}
      data-selected={selected ? "1" : "0"}
      data-type={layer.typeLabel}
      className={`rounded border px-1.5 py-1 ${
        selected ? "border-accent bg-accent/10" : "border-border bg-surface-sunken"
      }`}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          data-testid={`composer-object-${layer.id}`}
          aria-pressed={selected}
          onClick={(e) => onSelect(e.ctrlKey || e.metaKey || e.shiftKey)}
          className="min-w-0 flex-1 truncate text-left font-mono text-[10px] text-foreground"
        >
          {layer.name}
          <span className="ml-1 text-muted-foreground" data-testid={`layer-type-${layer.id}`}>
            · {layer.typeLabel}
          </span>
          <span className="ml-1 text-muted-foreground" data-testid={`layer-drones-${layer.id}`}>
            · {layer.droneCount} drones
          </span>
        </button>
        {layer.warning ? (
          <span
            title={layer.warning}
            aria-label={layer.warning}
            data-testid={`layer-warning-${layer.id}`}
            className="text-warning"
          >
            <AlertTriangle className="size-3" />
          </span>
        ) : null}
        <button
          type="button"
          title={layer.visible ? "Hide in editor" : "Show in editor"}
          aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
          data-testid={`layer-visibility-${layer.id}`}
          data-visible={layer.visible ? "1" : "0"}
          onClick={onToggleVisible}
          className="text-muted-foreground hover:text-foreground"
        >
          {layer.visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
        </button>
        <button
          type="button"
          title="Rename"
          aria-label={`Rename ${layer.name}`}
          data-testid={`layer-rename-${layer.id}`}
          onClick={onRename}
          className="text-muted-foreground hover:text-foreground"
        >
          <Pencil className="size-3" />
        </button>
        <button
          type="button"
          title="Duplicate"
          aria-label={`Duplicate ${layer.name}`}
          data-testid={`layer-duplicate-${layer.id}`}
          onClick={onDuplicate}
          className="text-muted-foreground hover:text-foreground"
        >
          <Copy className="size-3" />
        </button>
        <button
          type="button"
          title="Delete"
          aria-label={`Delete ${layer.name}`}
          data-testid={`layer-delete-${layer.id}`}
          disabled={!canDelete}
          onClick={onDelete}
          className="text-muted-foreground hover:text-destructive disabled:opacity-40"
        >
          <Trash2 className="size-3" />
        </button>
      </div>
      <p
        className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-muted-foreground"
        data-testid={`layer-status-${layer.id}`}
      >
        {layer.animated ? <Waves className="size-3" /> : null}
        <span>{layer.animated ? "Animated" : "Static"}</span>
        <span>·</span>
        <span data-testid={`layer-lighting-count-${layer.id}`}>
          {layer.lightingCount} lighting effect{layer.lightingCount === 1 ? "" : "s"}
        </span>
        <span>·</span>
        <span data-testid={`layer-motion-status-${layer.id}`}>{layer.motionStatus}</span>
        {layer.visible ? null : <span data-testid={`layer-hidden-${layer.id}`}>· Hidden</span>}
      </p>
    </div>
  );
}
