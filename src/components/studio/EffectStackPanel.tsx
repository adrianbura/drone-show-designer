/**
 * SELECTION EFFECTS — everyday lighting + motion authoring for the CURRENT
 * SELECTION (scene objects, or the selected drone points of one object).
 *
 * PRESENTATION ONLY.
 *   - Targets, preset vocabulary and inspector relevance come from the pure
 *     `src/lib/studio/selectionEffects.ts` composition helpers.
 *   - Lighting instances are created by the canonical store action
 *     `addLightingEffectsFromPreset` (ONE revision == ONE undo entry) from
 *     EXISTING canonical `LIGHTING_PRESETS` ids.
 *   - Motion is applied by the canonical store action
 *     `applyMotionPresetToSceneSelection`. There is no second motion engine,
 *     no second selection model, no second timeline and no effect evaluation
 *     inside React.
 *   - Browsing presets mutates nothing: applying is an explicit click.
 */
import { ArrowDown, ArrowUp, Copy, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import MotionInspector from "@/components/studio/MotionInspector";
import { Button } from "@/components/ui/button";
import { reorderEffect, stackOrder } from "@/lib/studio/effectStack";
import {
  LIGHTING_SELECTION_PRESETS,
  MOTION_SELECTION_PRESETS,
  axisDirection,
  directionAxis,
  effectPresetLabel,
  effectsForSelection,
  lightingPresetParameters,
  lightingPresetTiming,
  lightingSelectionPreset,
  pulseCycles,
  relevantInspectorControls,
  selectionEffectContext,
  type EffectAxis,
  type LightingSelectionPresetId,
  type MotionSelectionPresetId,
} from "@/lib/studio/selectionEffects";
import { LIGHTING_EASINGS, type LightingEasing } from "@/lib/show/lighting";
import type { RGB } from "@/lib/show/types";
import { useStudio } from "@/lib/studio/store";

const toHex = (rgb: RGB): string =>
  `#${rgb
    .map((c) =>
      Math.max(0, Math.min(255, Math.round(c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

const fromHex = (hex: string): RGB => [
  parseInt(hex.slice(1, 3), 16) || 0,
  parseInt(hex.slice(3, 5), 16) || 0,
  parseInt(hex.slice(5, 7), 16) || 0,
];

export type EffectStackView = "ALL" | "COLOR" | "MOTION";

export default function EffectStackPanel({ view = "ALL" }: { view?: EffectStackView }) {
  const [color, setColor] = useState<RGB>([255, 200, 120]);
  const [gradientColor, setGradientColor] = useState<RGB>([80, 120, 255]);
  const [gradientAxis, setGradientAxis] = useState<EffectAxis>("X");
  const {
    selectedClipId,
    selectedScene,
    selectedSceneBudget,
    selectedSceneObjectIds,
    primarySceneObjectId,
    sceneSelectionMode,
    selectedScenePointIds,
    time,
    lightingEffects,
    selectedLightingEffectId,
    selectedLightingEffect,
    selectLightingEffect,
    previewLightingEffectsFromPreset,
    lightingEffectPreview,
    applyLightingEffectPreview,
    cancelLightingEffectPreview,
    patchLightingEffect,
    patchLightingParameters,
    removeLightingEffect,
    duplicateLightingEffect,
    previewMotionPresetToSceneSelection,
    motionEffectPreviewIds,
    applyMotionEffectPreview,
    cancelMotionEffectPreview,
  } = useStudio();

  const previewSelectionKey = `${selectedClipId ?? ""}|${primarySceneObjectId ?? ""}|${sceneSelectionMode}|${selectedSceneObjectIds.join(",")}|${selectedScenePointIds.join(",")}`;
  useEffect(() => {
    cancelLightingEffectPreview();
    cancelMotionEffectPreview();
    return () => {
      cancelLightingEffectPreview();
      cancelMotionEffectPreview();
    };
  }, [cancelLightingEffectPreview, cancelMotionEffectPreview, previewSelectionKey]);

  if (!selectedClipId || !selectedScene) {
    return (
      <section className="panel-card" data-testid="effect-stacks">
        <h2 className="panel-title flex items-center gap-1.5">
          <Sparkles className="size-3" /> Selection effects
        </h2>
        <p className="font-mono text-[10px] text-muted-foreground">Select a clip to add effects.</p>
      </section>
    );
  }

  const clipId = selectedClipId;

  const context = selectionEffectContext({
    clipId,
    selectionMode: sceneSelectionMode,
    objectIds: selectedSceneObjectIds,
    primaryObjectId: primarySceneObjectId,
    pointIds: selectedScenePointIds,
    objectNames: new Map(selectedScene.objects.map((o) => [o.id, o.name])),
    objectDroneCounts: new Map(
      (selectedSceneBudget?.objects ?? []).map((o) => [o.instanceId, o.count]),
    ),
  });

  const scoped = stackOrder(effectsForSelection(lightingEffects, context));
  const scopeIds = scoped.map((e) => e.id);
  const canApply = context.canApply;

  const applyLighting = (id: LightingSelectionPresetId) => {
    if (!canApply) return;
    previewLightingEffectsFromPreset(
      clipId,
      lightingSelectionPreset(id).canonicalPresetId,
      context.targets,
      lightingPresetParameters(id, {
        primary: color,
        secondary: gradientColor,
        axis: gradientAxis,
      }),
      lightingPresetTiming(id, time),
    );
  };

  const applyMotion = (id: MotionSelectionPresetId) => {
    if (!canApply) return;
    const preset = MOTION_SELECTION_PRESETS.find((p) => p.id === id);
    if (preset) previewMotionPresetToSceneSelection(preset.canonicalPresetId);
  };

  const selected =
    selectedLightingEffect && scopeIds.includes(selectedLightingEffect.id)
      ? selectedLightingEffect
      : null;
  const controls = selected ? relevantInspectorControls(selected.type) : [];
  const has = (id: (typeof controls)[number]) => controls.includes(id);

  return (
    <section className="panel-card" data-testid="effect-stacks">
      <h2 className="panel-title flex items-center gap-1.5">
        <Sparkles className="size-3" />{" "}
        {view === "MOTION" ? "Motion" : view === "COLOR" ? "Color" : "Selection effects"}
      </h2>

      {/* ---------------------------------------------------- selection context */}
      <div
        className="rounded border border-border bg-surface-sunken px-1.5 py-1"
        data-testid="effect-selection-context"
        data-target={context.kind}
        data-drones={context.droneCount}
      >
        <p
          className="truncate font-mono text-[10px] text-foreground"
          data-testid="effect-selection-name"
        >
          {context.name}
        </p>
        <p
          className="font-mono text-[10px] text-muted-foreground"
          data-testid="effect-target-summary"
          data-target={context.kind}
        >
          {context.kind === "NONE"
            ? "No target"
            : `${context.kind === "DRONES" ? "Drones" : "Objects"} · ${context.droneCount} drone${
                context.droneCount === 1 ? "" : "s"
              }`}
        </p>
        <p
          className="font-mono text-[10px] text-accent"
          data-testid="effect-start-readout"
          data-start={time.toFixed(2)}
        >
          Playhead {time.toFixed(2)}s
        </p>
      </div>

      {!canApply && (
        <p
          className="mt-1 rounded border border-warning/50 bg-warning/10 px-1.5 py-1 font-mono text-[10px] text-warning"
          data-testid="effect-selection-warning"
        >
          Select an object or drone points first. Effects are never applied to the whole scene by
          accident.
        </p>
      )}

      {/* ------------------------------------------------------------ lighting */}
      {view !== "MOTION" ? (
        <div className="mt-2 space-y-1.5">
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
            Lighting
          </p>
          <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-[0.14em]">Colour A</span>
            <input
              type="color"
              value={toHex(color)}
              data-testid="effect-stack-color"
              aria-label="Colour A"
              onChange={(e) => setColor(fromHex(e.target.value))}
              className="h-6 w-16 cursor-pointer rounded border border-border bg-transparent"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
              <span>Colour B</span>
              <input
                type="color"
                value={toHex(gradientColor)}
                data-testid="effect-stack-gradient-color"
                aria-label="Colour B"
                onChange={(event) => setGradientColor(fromHex(event.target.value))}
                className="h-6 w-14 cursor-pointer rounded border border-border bg-transparent"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
              <span>Direction</span>
              <select
                value={gradientAxis}
                data-testid="effect-stack-gradient-axis"
                aria-label="Gradient direction"
                onChange={(event) => setGradientAxis(event.target.value as EffectAxis)}
                className="studio-input w-14 font-mono"
              >
                <option value="X">X</option>
                <option value="Y">Y</option>
                <option value="Z">Z</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-1" data-testid="effect-stack-presets">
            {LIGHTING_SELECTION_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                size="sm"
                variant={preset.id === "SOLID" ? "default" : "outline"}
                disabled={!canApply}
                data-testid={`effect-stack-add-${preset.id}`}
                title={`${preset.description} Starts at ${time.toFixed(2)}s on ${context.name}.`}
                className="h-6 px-1.5 font-mono text-[9px] uppercase tracking-[0.14em]"
                onClick={() => applyLighting(preset.id)}
              >
                {preset.label}
              </Button>
            ))}
          </div>

          <ul className="space-y-1" data-testid="effect-stack-list">
            {scoped.length === 0 && (
              <li
                className="font-mono text-[10px] text-muted-foreground"
                data-testid="effect-stack-empty"
              >
                {canApply
                  ? "No effects on this selection yet."
                  : "Nothing selected, so no effects are listed."}
              </li>
            )}
            {scoped.map((effect, index) => (
              <li
                key={effect.id}
                data-testid={`effect-stack-row-${effect.id}`}
                data-selected={selectedLightingEffectId === effect.id ? "1" : "0"}
                className={`flex items-center gap-1 rounded border bg-surface-sunken px-1.5 py-1 ${
                  selectedLightingEffectId === effect.id
                    ? "border-accent ring-1 ring-accent"
                    : "border-border"
                }`}
              >
                <input
                  type="checkbox"
                  checked={effect.enabled}
                  title="Enabled"
                  data-testid={`effect-stack-enabled-${effect.id}`}
                  onChange={(e) => patchLightingEffect(effect.id, { enabled: e.target.checked })}
                />
                <button
                  type="button"
                  data-testid={`effect-stack-select-${effect.id}`}
                  onClick={() => selectLightingEffect(effect.id)}
                  title="Focus on the lighting timeline"
                  className="min-w-0 flex-1 truncate text-left font-mono text-[10px] text-foreground"
                >
                  {index + 1}. {effectPresetLabel(effect)}
                </button>
                <button
                  type="button"
                  title="Move up"
                  disabled={index === 0}
                  onClick={() => {
                    const next = reorderEffect(lightingEffects, scopeIds, effect.id, -1);
                    next.forEach((e) => patchLightingEffect(e.id, { priority: e.priority }));
                  }}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <ArrowUp className="size-3" />
                </button>
                <button
                  type="button"
                  title="Move down"
                  disabled={index === scoped.length - 1}
                  onClick={() => {
                    const next = reorderEffect(lightingEffects, scopeIds, effect.id, 1);
                    next.forEach((e) => patchLightingEffect(e.id, { priority: e.priority }));
                  }}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <ArrowDown className="size-3" />
                </button>
                <button
                  type="button"
                  title="Duplicate"
                  data-testid={`effect-stack-duplicate-${effect.id}`}
                  onClick={() => duplicateLightingEffect(effect.id)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Copy className="size-3" />
                </button>
                <button
                  type="button"
                  title="Delete"
                  data-testid={`effect-stack-delete-${effect.id}`}
                  onClick={() => removeLightingEffect(effect.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3" />
                </button>
              </li>
            ))}
          </ul>

          {/* -------------------------------------------------------- inspector */}
          {selected && (
            <div
              className="space-y-1 rounded border border-accent/40 bg-surface-sunken px-1.5 py-1"
              data-testid="effect-inspector"
              data-effect={selected.id}
              data-type={selected.type}
            >
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
                {effectPresetLabel(selected)}
              </p>
              <div className="grid grid-cols-2 gap-1">
                <label className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
                  <span>Start</span>
                  <input
                    type="number"
                    step={0.25}
                    data-testid="effect-inspector-start"
                    value={Number(selected.start.toFixed(2))}
                    onChange={(e) =>
                      patchLightingEffect(selected.id, {
                        start: Math.max(0, Number(e.target.value)),
                      })
                    }
                    className="studio-input w-14 text-right font-mono"
                  />
                </label>
                <label className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
                  <span>Length</span>
                  <input
                    type="number"
                    step={0.25}
                    min={0.05}
                    data-testid="effect-inspector-duration"
                    value={Number(selected.duration.toFixed(2))}
                    onChange={(e) =>
                      patchLightingEffect(selected.id, {
                        duration: Math.max(0.05, Number(e.target.value)),
                      })
                    }
                    className="studio-input w-14 text-right font-mono"
                  />
                </label>
                {has("intensity") && (
                  <label className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
                    <span>Intensity</span>
                    <input
                      type="number"
                      step={0.05}
                      min={0}
                      max={1}
                      data-testid="effect-inspector-intensity"
                      value={selected.parameters.intensity ?? 1}
                      onChange={(e) =>
                        patchLightingParameters(selected.id, {
                          intensity: Math.max(0, Math.min(1, Number(e.target.value))),
                        })
                      }
                      className="studio-input w-14 text-right font-mono"
                    />
                  </label>
                )}
                {has("speed") && (
                  <label className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
                    <span>Cycles</span>
                    <input
                      type="number"
                      step={1}
                      min={1}
                      data-testid="effect-inspector-speed"
                      value={pulseCycles(selected)}
                      onChange={(e) =>
                        patchLightingParameters(selected.id, {
                          cycles: Math.max(1, Math.round(Number(e.target.value))),
                        })
                      }
                      className="studio-input w-14 text-right font-mono"
                    />
                  </label>
                )}
                {has("axis") && (
                  <label className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
                    <span>Axis</span>
                    <select
                      data-testid="effect-inspector-axis"
                      value={directionAxis(selected.parameters.direction)}
                      onChange={(e) =>
                        patchLightingParameters(selected.id, {
                          direction: axisDirection(e.target.value as EffectAxis),
                        })
                      }
                      className="studio-input w-14 font-mono"
                    >
                      <option value="X">X</option>
                      <option value="Y">Y</option>
                      <option value="Z">Z</option>
                    </select>
                  </label>
                )}
                {has("easing") && (
                  <label className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
                    <span>Easing</span>
                    <select
                      data-testid="effect-inspector-easing"
                      value={selected.parameters.easing ?? "SMOOTH"}
                      onChange={(e) =>
                        patchLightingParameters(selected.id, {
                          easing: e.target.value as LightingEasing,
                        })
                      }
                      className="studio-input w-20 font-mono"
                    >
                      {LIGHTING_EASINGS.map((easing) => (
                        <option key={easing} value={easing}>
                          {easing}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {has("primaryColor") && (
                  <label className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
                    <span>Colour</span>
                    <input
                      type="color"
                      data-testid="effect-inspector-primary-color"
                      aria-label="Effect colour"
                      value={toHex(
                        selected.parameters.toColor ??
                          selected.parameters.color ??
                          selected.parameters.stops?.[0]?.color ?? [255, 255, 255],
                      )}
                      onChange={(e) => {
                        const next = fromHex(e.target.value);
                        if (selected.type === "COLOR_SWEEP") {
                          const stops = selected.parameters.stops ?? [];
                          patchLightingParameters(selected.id, {
                            stops: [{ position: 0, color: next }, ...stops.slice(1)],
                          });
                        } else if (selected.type === "COLOR_TRANSITION") {
                          patchLightingParameters(selected.id, { toColor: next });
                        } else {
                          patchLightingParameters(selected.id, { color: next });
                        }
                      }}
                      className="h-6 w-14 cursor-pointer rounded border border-border bg-transparent"
                    />
                  </label>
                )}
                {has("secondaryColor") && (
                  <label className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
                    <span>Colour 2</span>
                    <input
                      type="color"
                      data-testid="effect-inspector-secondary-color"
                      aria-label="Secondary effect colour"
                      value={toHex(
                        selected.type === "COLOR_TRANSITION"
                          ? (selected.parameters.fromColor ?? [255, 255, 255])
                          : (selected.parameters.stops?.at(-1)?.color ?? [255, 255, 255]),
                      )}
                      onChange={(e) => {
                        const next = fromHex(e.target.value);
                        if (selected.type === "COLOR_TRANSITION") {
                          patchLightingParameters(selected.id, { fromColor: next });
                        } else {
                          const stops = selected.parameters.stops ?? [];
                          patchLightingParameters(selected.id, {
                            stops: [
                              ...stops.slice(0, Math.max(1, stops.length - 1)),
                              { position: 1, color: next },
                            ],
                          });
                        }
                      }}
                      className="h-6 w-14 cursor-pointer rounded border border-border bg-transparent"
                    />
                  </label>
                )}
              </div>
            </div>
          )}

          {lightingEffectPreview.length > 0 ? (
            <div
              className="sticky bottom-0 z-10 mt-2 rounded border border-accent bg-panel p-2"
              data-testid="lighting-effect-preview"
            >
              <p className="font-mono text-[10px] text-accent">
                Preview · {lightingEffectPreview.length} effect
                {lightingEffectPreview.length === 1 ? "" : "s"} · project unchanged
              </p>
              <div className="mt-1 grid grid-cols-2 gap-1">
                <Button
                  type="button"
                  size="sm"
                  data-testid="lighting-preview-apply"
                  onClick={applyLightingEffectPreview}
                >
                  Apply
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="lighting-preview-cancel"
                  onClick={cancelLightingEffectPreview}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* -------------------------------------------------------------- motion */}
      {view !== "COLOR" ? (
        <div className="mt-2 space-y-1.5 border-t border-border pt-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
            Motion
          </p>
          <div className="flex flex-wrap gap-1" data-testid="motion-stack-presets">
            {MOTION_SELECTION_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                size="sm"
                variant="outline"
                disabled={!canApply}
                title={preset.description}
                data-testid={`motion-stack-add-${preset.id}`}
                className="h-6 px-1.5 font-mono text-[9px] uppercase tracking-[0.14em]"
                onClick={() => applyMotion(preset.id)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          {motionEffectPreviewIds.length > 0 ? (
            <div
              className="sticky bottom-0 z-10 rounded border border-accent bg-panel p-2"
              data-testid="motion-effect-preview"
            >
              <p className="font-mono text-[10px] text-accent">
                Live preview · {motionEffectPreviewIds.length} motion
                {motionEffectPreviewIds.length === 1 ? "" : "s"} · project unchanged
              </p>
              <div className="mt-1 grid grid-cols-2 gap-1">
                <Button
                  type="button"
                  size="sm"
                  data-testid="motion-preview-apply"
                  onClick={applyMotionEffectPreview}
                >
                  Apply
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="motion-preview-cancel"
                  onClick={cancelMotionEffectPreview}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          <MotionInspector />
        </div>
      ) : null}
    </section>
  );
}
