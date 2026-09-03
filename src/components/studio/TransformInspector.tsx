/**
 * TRANSFORM INSPECTOR — presentation only.
 *
 * Everyday Move / Rotate / Scale UX for the current visual selection. This
 * component owns NO transform state and performs NO geometry maths: it renders
 * canonical values and calls the canonical studio actions passed in as props
 * (gizmo mode, per-object transform patch, batch group delta). The scene domain
 * remains the only authority over the resulting geometry.
 */
import { Maximize2, Move3d, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";

import type { SceneGizmoMode } from "@/lib/show/scene";
import type { Vector3Tuple } from "@/lib/show/types";

const AXES = ["X", "Y", "Z"] as const;

const MODES: readonly { readonly mode: SceneGizmoMode; readonly label: string }[] = [
  { mode: "MOVE", label: "Move" },
  { mode: "ROTATE", label: "Rotate" },
  { mode: "SCALE", label: "Scale" },
];

function ModeIcon({ mode }: { mode: SceneGizmoMode }) {
  if (mode === "MOVE") return <Move3d className="size-3" />;
  if (mode === "ROTATE") return <RotateCw className="size-3" />;
  return <Maximize2 className="size-3" />;
}

function Field({
  label,
  suffix,
  value,
  step,
  testId,
  onCommit,
  resetAfterCommit = false,
}: {
  label: string;
  suffix: string;
  value: number;
  step: number;
  testId: string;
  onCommit: (next: number) => void;
  resetAfterCommit?: boolean;
}) {
  const canonical = Number.isFinite(value) ? String(Number(value.toFixed(2))) : "0";
  const [draft, setDraft] = useState(canonical);
  useEffect(() => setDraft(canonical), [canonical]);
  const commit = () => {
    const next = Number(draft);
    if (Number.isFinite(next) && next !== value) onCommit(next);
    if (resetAfterCommit) setDraft("0");
  };
  return (
    <label className="flex min-w-0 flex-col gap-0.5 text-[10px] text-muted-foreground">
      <span className="truncate uppercase tracking-[0.12em]">
        {label} <span className="opacity-60">{suffix}</span>
      </span>
      <input
        type="number"
        step={step}
        value={draft}
        data-testid={testId}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(canonical);
            event.currentTarget.blur();
          }
        }}
        className="studio-input h-7 w-full min-w-0 text-right font-mono"
      />
    </label>
  );
}

export interface TransformInspectorProps {
  /** Number of currently selected visuals (canonical selection). */
  readonly selectedCount: number;
  /** Canonical transform of the primary selected visual (single selection UI). */
  readonly position?: Vector3Tuple;
  readonly rotationDeg?: Vector3Tuple;
  readonly scale?: number;
  readonly gizmoMode: SceneGizmoMode;
  readonly onSetGizmoMode: (mode: SceneGizmoMode) => void;
  /** Absolute per-object edit (single selection). */
  readonly onPatchPosition?: (position: Vector3Tuple) => void;
  readonly onPatchRotation?: (rotationDeg: Vector3Tuple) => void;
  readonly onPatchScale?: (scale: number) => void;
  readonly onReset?: () => void;
  /** Relative group gesture (multi-selection); ONE undoable revision per call. */
  readonly onGroupMove?: (delta: Vector3Tuple) => void;
  readonly onGroupRotate?: (deltaDeg: Vector3Tuple) => void;
  readonly onGroupScale?: (factor: number) => void;
}

export default function TransformInspector({
  selectedCount,
  position,
  rotationDeg,
  scale,
  gizmoMode,
  onSetGizmoMode,
  onPatchPosition,
  onPatchRotation,
  onPatchScale,
  onReset,
  onGroupMove,
  onGroupRotate,
  onGroupScale,
}: TransformInspectorProps) {
  if (selectedCount === 0) return null;
  const group = selectedCount > 1;

  return (
    <div
      className="mt-2 rounded border border-border bg-surface-sunken p-2"
      data-testid="transform-section"
      data-selected-count={selectedCount}
      data-mode={gizmoMode}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Transform
      </p>
      <p
        className="mt-0.5 font-mono text-[10px] text-foreground"
        data-testid="transform-selection-label"
      >
        {group ? `${selectedCount} visuals selected` : "1 visual selected"}
      </p>

      <div
        className="mt-1.5 grid grid-cols-3 gap-1"
        role="group"
        aria-label="Transform mode"
        data-testid="transform-mode-group"
        data-active-mode={gizmoMode}
      >
        {MODES.map(({ mode, label }) => {
          const active = gizmoMode === mode;
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={active}
              data-active={active ? "1" : "0"}
              data-testid={`transform-mode-${mode.toLowerCase()}`}
              onClick={() => onSetGizmoMode(mode)}
              className={`chip-btn h-7 min-w-0 justify-center gap-1 truncate ${
                active ? "mini-btn-accent border-accent ring-1 ring-accent" : "opacity-70"
              }`}
            >
              <ModeIcon mode={mode} /> {label}
            </button>
          );
        })}
      </div>

      {!group && position && rotationDeg && typeof scale === "number" ? (
        <div className="mt-2 space-y-1.5" data-testid="transform-single">
          <div className="grid grid-cols-3 gap-1">
            {AXES.map((axis, i) => (
              <Field
                key={`pos-${axis}`}
                label={`Pos ${axis}`}
                suffix="m"
                value={position[i]!}
                step={0.5}
                testId={`transform-position-${axis}`}
                onCommit={(next) => {
                  const value: [number, number, number] = [position[0], position[1], position[2]];
                  value[i] = next;
                  onPatchPosition?.(value);
                }}
              />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1">
            {AXES.map((axis, i) => (
              <Field
                key={`rot-${axis}`}
                label={`Rot ${axis}`}
                suffix="°"
                value={rotationDeg[i]!}
                step={5}
                testId={`transform-rotation-${axis}`}
                onCommit={(next) => {
                  const value: [number, number, number] = [
                    rotationDeg[0],
                    rotationDeg[1],
                    rotationDeg[2],
                  ];
                  value[i] = next;
                  onPatchRotation?.(value);
                }}
              />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1">
            <Field
              label="Scale"
              suffix="×"
              value={scale}
              step={0.05}
              testId="transform-scale"
              onCommit={(next) => onPatchScale?.(Math.max(0.01, next))}
            />
            <button
              type="button"
              data-testid="transform-reset"
              onClick={() => onReset?.()}
              className="chip-btn col-span-2 mt-3 h-7 justify-center"
            >
              Reset transform
            </button>
          </div>
        </div>
      ) : null}

      {group ? (
        <div className="mt-2 space-y-1.5" data-testid="transform-group">
          <div className="grid grid-cols-3 gap-1">
            {AXES.map((axis, i) => (
              <Field
                key={`gmove-${axis}`}
                label={`Move ${axis}`}
                suffix="m"
                value={0}
                step={1}
                testId={`transform-group-move-${axis}`}
                resetAfterCommit
                onCommit={(next) => {
                  if (!next) return;
                  const delta: [number, number, number] = [0, 0, 0];
                  delta[i] = next;
                  onGroupMove?.(delta);
                }}
              />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1">
            {AXES.map((axis, i) => (
              <Field
                key={`grot-${axis}`}
                label={`Rot ${axis}`}
                suffix="°"
                value={0}
                step={5}
                testId={`transform-group-rotate-${axis}`}
                resetAfterCommit
                onCommit={(next) => {
                  if (!next) return;
                  const delta: [number, number, number] = [0, 0, 0];
                  delta[i] = next;
                  onGroupRotate?.(delta);
                }}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              data-testid="transform-group-scale-down"
              onClick={() => onGroupScale?.(0.9)}
              className="chip-btn h-7 justify-center"
            >
              Scale −10%
            </button>
            <button
              type="button"
              data-testid="transform-group-scale-up"
              onClick={() => onGroupScale?.(1.1)}
              className="chip-btn h-7 justify-center"
            >
              Scale +10%
            </button>
          </div>
        </div>
      ) : null}

      <p
        className="mt-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground"
        data-testid="transform-guidance"
      >
        Drag the coloured handles in the viewport or enter exact values here.
        {group
          ? " Changes for several visuals are applied together around the middle of the selection, so their spacing stays the same."
          : " Values are in metres and degrees."}
      </p>
    </div>
  );
}
