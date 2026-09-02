/**
 * SELECTION EFFECTS — the everyday lighting + motion authoring surface.
 *
 * The operator selects an SVG, a native line, several objects or drone points
 * (Click / Box / Lasso / Brush in the viewport) and applies effects here.
 *
 * PRESENTATION ONLY:
 *   - the target is the CANONICAL scene selection, translated to canonical
 *     `LightingTarget` values by `src/lib/studio/selectionEffects.ts`;
 *   - every preset maps onto an EXISTING canonical lighting preset id or an
 *     EXISTING `DynamicPresetId`; there is no second lighting engine, no second
 *     animation engine and no safety maths here;
 *   - every mutation goes through a canonical store action, so one click is one
 *     undo entry, and browsing presets mutates nothing.
 */
import { Copy, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { instanceDroneCount } from "@/lib/show/scene";
import type { LightingEasing } from "@/lib/show/lighting";
import type { RGB } from "@/lib/show/types";
import {
  SELECTION_LIGHTING_PRESETS,
  SELECTION_MOTION_PRESETS,
  axisOfVector,
  axisVector,
  colorPatchFor,
  effectColors,
  effectDisplayLabel,
  pulseSpeed,
  relevantEffectControls,
  selectionEffectContext,
  selectionLightingParameters,
  selectionLightingTargets,
  type EffectAxis,
  type SelectionLightingPreset,
} from "@/lib/studio/selectionEffects";
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

const EASINGS: readonly LightingEasing[] = ["LINEAR", "SMOOTH", "MIN_JERK"];

export default function EffectStackPanel() {
  const [primaryColor, setPrimaryColor] = useState<RGB>([255, 200, 120]);
  const [secondaryColor, setSecondaryColor] = useState<RGB>([80, 120, 255]);
  const [axis, setAxis] = useState<EffectAxis>("X");
  const [hovered, setHovered] = useState<string | null>(null);

  const {
    project,
    selectedClipId,
    selectedScene,
    selectedSceneObjectIds,
    primarySceneObjectId,
    sceneSelectionMode,
    selectedScenePointIds,
    time,
    lightingEffects,
    selectedLightingEffect,
    selectedLightingEffectId,
    selectLightingEffect,
    addLightingEffectsFromPreset,
    patchLightingEffect,
    patchLightingParameters,
    duplicateLightingEffect,
    removeLightingEffect,
    applyMotionPresetToSceneObject,
  } = useStudio();

  const objects = useMemo(() => selectedScene?.objects ?? [], [selectedScene]);

  /** Canonical drone count of one scene object (scene budget authority). */
  const droneCountOf = useCallback(
    (objectId: string) => {
      const object = objects.find((o) => o.id === objectId);
      return object ? instanceDroneCount(project, object) : 0;
    },
    [objects, project],
  );

  const selectionInput = useMemo(
    () => ({
      mode: sceneSelectionMode,
      objects: objects.map((o) => ({ id: o.id, name: o.name })),
      selectedObjectIds: selectedSceneObjectIds,
      primaryObjectId: primarySceneObjectId,
      selectedPointIds: selectedScenePointIds,
      droneCountOf,
    }),
    [
      sceneSelectionMode,
      objects,
      selectedSceneObjectIds,
      primarySceneObjectId,
      selectedScenePointIds,
      droneCountOf,
    ],
  );

  const context = useMemo(() => selectionEffectContext(selectionInput), [selectionInput]);

  const targets = useMemo(
    () => (selectedClipId ? selectionLightingTargets(selectedClipId, selectionInput) : []),
    [selectedClipId, selectionInput],
  );

  /** Effects of the current selection only — object isolation is visible. */
  const scoped = useMemo(() => {
    const ids = new Set(selectedSceneObjectIds);
    return lightingEffects
      .filter((effect) => {
        if (effect.target.kind === "SCENE") return ids.size === 0;
        if (context.kind === "DRONES") {
          return (
            effect.target.kind === "POINT_GROUP" &&
            effect.target.instanceId === primarySceneObjectId
          );
        }
        return ids.has(effect.target.instanceId);
      })
      .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  }, [lightingEffects, selectedSceneObjectIds, context.kind, primarySceneObjectId]);

  const primaryObject = useMemo(
    () => objects.find((o) => o.id === primarySceneObjectId) ?? null,
    [objects, primarySceneObjectId],
  );
  const motionEligible =
    context.kind === "OBJECTS" && primaryObject !== null && primaryObject.source.kind === "STATIC";

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

  const applyLighting = (preset: SelectionLightingPreset) => {
    if (targets.length === 0) return;
    addLightingEffectsFromPreset(
      clipId,
      preset.canonicalPresetId,
      targets,
      selectionLightingParameters(preset, {
        primary: primaryColor,
        secondary: secondaryColor,
        axis,
      }),
      { anchor: "ABSOLUTE", start: time, duration: preset.duration },
    );
  };

  const applyMotion = (canonicalPreset: (typeof SELECTION_MOTION_PRESETS)[number]) => {
    if (!primaryObject) return;
    applyMotionPresetToSceneObject(clipId, primaryObject.id, canonicalPreset.canonicalPreset);
  };

  const effect = selectedLightingEffect;
  const controls = effect ? relevantEffectControls(effect.type) : [];
  const colors = effect ? effectColors(effect) : { primary: null, secondary: null };

  return (
    <section className="panel-card" data-testid="effect-stacks">
      <h2 className="panel-title flex items-center gap-1.5">
        <Sparkles className="size-3" /> Selection effects
      </h2>

      {/* ---------------- 1. SELECTION CONTEXT ---------------- */}
      <div
        className="rounded border border-border bg-surface-sunken px-1.5 py-1"
        data-testid="selection-effect-context"
        data-target={context.kind}
        data-drones={context.droneCount}
      >
        <p className="truncate font-mono text-[10px] text-foreground" data-testid="selection-name">
          {context.label}
        </p>
        <p
          className="font-mono text-[10px] text-muted-foreground"
          data-testid="effect-target-summary"
          data-target={context.kind}
        >
          Target: {context.kind} · {context.droneCount} drone
          {context.droneCount === 1 ? "" : "s"}
        </p>
        <p
          className="font-mono text-[10px] text-accent"
          data-testid="effect-start-readout"
          data-start={time.toFixed(2)}
        >
          Playhead {time.toFixed(2)}s — new effects start here
        </p>
        {context.empty ? (
          <p
            className="mt-0.5 font-mono text-[10px] text-destructive"
            data-testid="selection-effect-warning"
          >
            Nothing selected. Pick an object or drone points in the viewport first.
          </p>
        ) : null}
      </div>

      {/* ---------------- COLOURS + AXIS ---------------- */}
      <div className="mt-2 grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
          <span>Colour A</span>
          <input
            type="color"
            value={toHex(primaryColor)}
            data-testid="effect-stack-color"
            aria-label="Colour A"
            onChange={(e) => setPrimaryColor(fromHex(e.target.value))}
            className="h-6 w-full cursor-pointer rounded border border-border bg-transparent"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
          <span>Colour B</span>
          <input
            type="color"
            value={toHex(secondaryColor)}
            data-testid="effect-stack-gradient-color"
            aria-label="Colour B"
            onChange={(e) => setSecondaryColor(fromHex(e.target.value))}
            className="h-6 w-full cursor-pointer rounded border border-border bg-transparent"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
          <span>Direction</span>
          <select
            value={axis}
            data-testid="effect-stack-gradient-axis"
            aria-label="Effect direction"
            onChange={(e) => setAxis(e.target.value as EffectAxis)}
            className="studio-input w-full font-mono"
          >
            <option value="X">X</option>
            <option value="Y">Y</option>
            <option value="Z">Z</option>
          </select>
        </label>
      </div>

      {/* ---------------- 2. LIGHTING PRESETS ---------------- */}
      <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
        Lighting
      </p>
      <div className="grid grid-cols-2 gap-1" data-testid="lighting-preset-gallery">
        {SELECTION_LIGHTING_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            disabled={context.empty}
            data-testid={`effect-stack-add-${preset.id}`}
            title={preset.description}
            onMouseEnter={() => setHovered(preset.id)}
            onFocus={() => setHovered(preset.id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => applyLighting(preset)}
            className="rounded border border-border bg-surface-sunken px-1.5 py-1 text-left transition hover:border-accent disabled:opacity-40"
          >
            <span className="block font-mono text-[10px] text-foreground">{preset.label}</span>
            <span className="block text-[9px] leading-tight text-muted-foreground">
              {preset.description}
            </span>
          </button>
        ))}
      </div>

      {/* ---------------- MOTION PRESETS ---------------- */}
      <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
        Motion
      </p>
      {motionEligible ? (
        <div className="grid grid-cols-2 gap-1" data-testid="motion-preset-gallery">
          {SELECTION_MOTION_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              data-testid={`motion-stack-add-${preset.id}`}
              title={preset.description}
              onMouseEnter={() => setHovered(preset.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => applyMotion(preset)}
              className="rounded border border-border bg-surface-sunken px-1.5 py-1 text-left transition hover:border-accent"
            >
              <span className="block font-mono text-[10px] text-foreground">{preset.label}</span>
              <span className="block text-[9px] leading-tight text-muted-foreground">
                {preset.description}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p
          className="font-mono text-[10px] leading-relaxed text-muted-foreground"
          data-testid="motion-unavailable"
        >
          {context.kind === "DRONES"
            ? "Motion applies to a whole object. Switch to Object mode."
            : primaryObject
              ? "This object already animates. Edit its motion in Dynamic formations."
              : "Select one static object to add motion."}
        </p>
      )}

      {hovered ? (
        <p className="mt-1 font-mono text-[9px] text-muted-foreground" data-testid="preset-preview">
          Preview: {hovered} — nothing is applied until you click.
        </p>
      ) : null}

      {/* ---------------- EFFECTS OF THIS SELECTION ---------------- */}
      <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
        Effects on this selection
      </p>
      <ul className="space-y-1" data-testid="effect-stack-list">
        {scoped.length === 0 ? (
          <li
            className="font-mono text-[10px] text-muted-foreground"
            data-testid="effect-stack-empty"
          >
            No effects yet.
          </li>
        ) : null}
        {scoped.map((entry) => (
          <li
            key={entry.id}
            data-testid={`effect-stack-row-${entry.id}`}
            data-selected={selectedLightingEffectId === entry.id ? "1" : "0"}
            className={`flex items-center gap-1 rounded border bg-surface-sunken px-1.5 py-1 ${
              selectedLightingEffectId === entry.id
                ? "border-accent ring-1 ring-accent"
                : "border-border"
            }`}
          >
            <input
              type="checkbox"
              checked={entry.enabled}
              title="Enabled"
              aria-label={`Enable ${effectDisplayLabel(entry)}`}
              data-testid={`effect-stack-enabled-${entry.id}`}
              onChange={(e) => patchLightingEffect(entry.id, { enabled: e.target.checked })}
            />
            <button
              type="button"
              data-testid={`effect-stack-select-${entry.id}`}
              onClick={() => selectLightingEffect(entry.id)}
              title="Focus on the lighting timeline"
              className="min-w-0 flex-1 truncate text-left font-mono text-[10px] text-foreground"
            >
              {effectDisplayLabel(entry)} · {entry.start.toFixed(2)}s
            </button>
            <button
              type="button"
              title="Duplicate"
              data-testid={`effect-stack-duplicate-${entry.id}`}
              onClick={() => duplicateLightingEffect(entry.id)}
              className="text-muted-foreground hover:text-foreground"
            >
              <Copy className="size-3" />
            </button>
            <button
              type="button"
              title="Delete"
              data-testid={`effect-stack-delete-${entry.id}`}
              onClick={() => removeLightingEffect(entry.id)}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3" />
            </button>
          </li>
        ))}
      </ul>

      {/* ---------------- 4. EFFECT INSPECTOR ---------------- */}
      {effect ? (
        <div
          className="mt-2 space-y-1 border-t border-border pt-2"
          data-testid="effect-inspector"
          data-effect={effect.id}
          data-type={effect.type}
        >
          <p className="font-mono text-[10px] text-foreground">{effectDisplayLabel(effect)}</p>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
              <span>Start (s)</span>
              <input
                type="number"
                step={0.25}
                data-testid="effect-inspector-start"
                value={Number(effect.start.toFixed(2))}
                onChange={(e) =>
                  patchLightingEffect(effect.id, { start: Math.max(0, Number(e.target.value)) })
                }
                className="studio-input w-full text-right font-mono"
              />
            </label>
            <label className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
              <span>Duration (s)</span>
              <input
                type="number"
                step={0.25}
                min={0.1}
                data-testid="effect-inspector-duration"
                value={Number(effect.duration.toFixed(2))}
                onChange={(e) =>
                  patchLightingEffect(effect.id, {
                    duration: Math.max(0.1, Number(e.target.value)),
                  })
                }
                className="studio-input w-full text-right font-mono"
              />
            </label>

            {controls.includes("INTENSITY") ? (
              <label className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
                <span>Intensity</span>
                <input
                  type="number"
                  step={0.05}
                  min={0}
                  max={1}
                  data-testid="effect-inspector-intensity"
                  value={effect.parameters.intensity ?? 1}
                  onChange={(e) =>
                    patchLightingParameters(effect.id, {
                      intensity: Math.max(0, Math.min(1, Number(e.target.value))),
                    })
                  }
                  className="studio-input w-full text-right font-mono"
                />
              </label>
            ) : null}

            {controls.includes("SPEED") ? (
              <label className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
                <span>Speed (Hz)</span>
                <input
                  type="number"
                  step={0.25}
                  min={0.05}
                  data-testid="effect-inspector-speed"
                  value={Number(pulseSpeed(effect).toFixed(2))}
                  onChange={(e) =>
                    patchLightingParameters(effect.id, {
                      cycles: Math.max(
                        0.05,
                        Number(e.target.value) * Math.max(0.1, effect.duration),
                      ),
                    })
                  }
                  className="studio-input w-full text-right font-mono"
                />
              </label>
            ) : null}

            {controls.includes("DIRECTION") ? (
              <label className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
                <span>Axis</span>
                <select
                  data-testid="effect-inspector-axis"
                  value={axisOfVector(effect.parameters.direction)}
                  aria-label="Effect axis"
                  onChange={(e) =>
                    patchLightingParameters(effect.id, {
                      direction: axisVector(e.target.value as EffectAxis),
                    })
                  }
                  className="studio-input w-full font-mono"
                >
                  <option value="X">X</option>
                  <option value="Y">Y</option>
                  <option value="Z">Z</option>
                </select>
              </label>
            ) : null}

            {controls.includes("EASING") ? (
              <label className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
                <span>Easing</span>
                <select
                  data-testid="effect-inspector-easing"
                  value={effect.parameters.easing ?? "SMOOTH"}
                  aria-label="Effect easing"
                  onChange={(e) =>
                    patchLightingParameters(effect.id, {
                      easing: e.target.value as LightingEasing,
                    })
                  }
                  className="studio-input w-full font-mono"
                >
                  {EASINGS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {controls.includes("PRIMARY_COLOR") ? (
              <label className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
                <span>Colour 1</span>
                <input
                  type="color"
                  data-testid="effect-inspector-primary-color"
                  aria-label="Effect primary colour"
                  value={toHex(colors.primary ?? [255, 255, 255])}
                  onChange={(e) =>
                    patchLightingParameters(
                      effect.id,
                      colorPatchFor(effect, "primary", fromHex(e.target.value)),
                    )
                  }
                  className="h-6 w-full cursor-pointer rounded border border-border bg-transparent"
                />
              </label>
            ) : null}

            {controls.includes("SECONDARY_COLOR") ? (
              <label className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
                <span>Colour 2</span>
                <input
                  type="color"
                  data-testid="effect-inspector-secondary-color"
                  aria-label="Effect secondary colour"
                  value={toHex(colors.secondary ?? [255, 255, 255])}
                  onChange={(e) =>
                    patchLightingParameters(
                      effect.id,
                      colorPatchFor(effect, "secondary", fromHex(e.target.value)),
                    )
                  }
                  className="h-6 w-full cursor-pointer rounded border border-border bg-transparent"
                />
              </label>
            ) : null}
          </div>

          <div className="flex items-center gap-1 pt-1">
            <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <input
                type="checkbox"
                data-testid="effect-inspector-enabled"
                checked={effect.enabled}
                onChange={(e) => patchLightingEffect(effect.id, { enabled: e.target.checked })}
              />
              Enabled
            </label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="effect-inspector-duplicate"
              className="ml-auto h-6 px-1.5 font-mono text-[9px] uppercase tracking-[0.14em]"
              onClick={() => duplicateLightingEffect(effect.id)}
            >
              Duplicate
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="effect-inspector-delete"
              className="h-6 px-1.5 font-mono text-[9px] uppercase tracking-[0.14em]"
              onClick={() => removeLightingEffect(effect.id)}
            >
              Delete
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
