/**
 * EFFECT STACKS — EVERYDAY LIGHTING + MOTION (Skybrush-inspired).
 *
 * Two ordered stacks scoped to the current selection:
 *   LIGHTING  ordered canonical `LightingEffectInstance` values (stack order ==
 *             priority) created from six everyday presets.
 *   MOTION    canonical dynamic-formation presets applied to the selected
 *             STATIC object, promoting it to a DYNAMIC source.
 *
 * No second lighting engine, no second animation engine, no safety maths here:
 * this panel only composes over the existing canonical authorities.
 */
import { ArrowDown, ArrowUp, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  canonicalStackPresetId,
  stackColorParameters,
  stackOrder,
  reorderEffect,
  type EffectStackPresetId,
} from "@/lib/studio/effectStack";
import { DYNAMIC_PRESETS, type DynamicPresetId } from "@/lib/show/dynamic";
import type { LightingTarget } from "@/lib/show/lighting";
import type { RGB } from "@/lib/show/types";
import { useStudio } from "@/lib/studio/store";

const PRESET_LABEL: Record<EffectStackPresetId, string> = {
  BASE_COLOR: "Set colour",
  FADE: "Fade to",
  PULSE: "Pulse",
  CHASE: "Chase",
  TWINKLE: "Twinkle",
  GRADIENT: "Gradient",
};

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

export default function EffectStackPanel() {
  const [color, setColor] = useState<RGB>([255, 200, 120]);
  const [gradientColor, setGradientColor] = useState<RGB>([80, 120, 255]);
  const [gradientAxis, setGradientAxis] = useState<"X" | "Y" | "Z">("X");
  const {
    selectedClipId,
    selectedScene,
    selectedSceneObjectIds,
    primarySceneObjectId,
    sceneSelectionMode,
    selectedScenePointIds,
    time,
    lightingEffects,
    selectedLightingEffectId,
    selectLightingEffect,

    addLightingEffectsFromPreset,
    patchLightingEffect,
    removeLightingEffect,
    createDynamicFromFormation,
    applyDynamicPreset,
    patchSceneObject,
  } = useStudio();

  if (!selectedClipId || !selectedScene) {
    return (
      <section className="panel-card" data-testid="effect-stacks">
        <h2 className="panel-title flex items-center gap-1.5">
          <Sparkles className="size-3" /> Effects
        </h2>
        <p className="font-mono text-[10px] text-muted-foreground">Select a clip to add effects.</p>
      </section>
    );
  }

  const clipId = selectedClipId;
  const primaryId = primarySceneObjectId;
  const targets: LightingTarget[] =
    sceneSelectionMode === "POINT" && primaryId && selectedScenePointIds.length > 0
      ? [
          {
            kind: "POINT_GROUP" as const,
            clipId,
            instanceId: primaryId,
            pointIds: selectedScenePointIds,
          },
        ]
      : selectedSceneObjectIds.length > 0
        ? selectedSceneObjectIds.map((instanceId) => ({
            kind: "SCENE_OBJECT" as const,
            clipId,
            instanceId,
          }))
        : [{ kind: "SCENE" as const, clipId }];

  const scoped = stackOrder(
    lightingEffects.filter((e) =>
      selectedSceneObjectIds.length === 0
        ? true
        : e.target.kind !== "SCENE" && selectedSceneObjectIds.includes(e.target.instanceId),
    ),
  );
  const scopeIds = scoped.map((e) => e.id);

  const primary = selectedScene.objects.find((o) => o.id === primaryId) ?? null;
  const staticFormationId =
    primary && primary.source.kind === "STATIC" ? primary.source.formationId : null;

  const addMotion = (preset: DynamicPresetId) => {
    if (!primary || !staticFormationId) return;
    const dynamic = createDynamicFromFormation(staticFormationId);
    if (!dynamic) return;
    applyDynamicPreset(dynamic.id, preset);
    patchSceneObject(clipId, primary.id, {
      source: { kind: "DYNAMIC", dynamicFormationId: dynamic.id },
    });
  };

  const targetKind: "SCENE" | "OBJECTS" | "POINTS" =
    sceneSelectionMode === "POINT" && primaryId && selectedScenePointIds.length > 0
      ? "POINTS"
      : selectedSceneObjectIds.length > 0
        ? "OBJECTS"
        : "SCENE";

  const targetSummary =
    targetKind === "POINTS"
      ? `${selectedScenePointIds.length} selected drone point${selectedScenePointIds.length === 1 ? "" : "s"}`
      : targetKind === "OBJECTS"
        ? `${selectedSceneObjectIds.length} object${selectedSceneObjectIds.length === 1 ? "" : "s"}`
        : "Whole scene";

  const addPreset = (preset: EffectStackPresetId) =>
    addLightingEffectsFromPreset(
      clipId,
      canonicalStackPresetId(preset),
      targets,
      preset === "GRADIENT"
        ? {
            stops: [
              { position: 0, color },
              { position: 1, color: gradientColor },
            ],
            direction:
              gradientAxis === "X" ? [1, 0, 0] : gradientAxis === "Y" ? [0, 1, 0] : [0, 0, 1],
          }
        : stackColorParameters(preset, color),
      {
        anchor: "ABSOLUTE",
        start: time,
        ...(preset === "BASE_COLOR" ? { duration: 0.05 } : {}),
      },
    );

  const presetButton = (preset: EffectStackPresetId, primaryAction: boolean) => (
    <Button
      key={preset}
      type="button"
      size="sm"
      variant={primaryAction ? "default" : "outline"}
      data-testid={`effect-stack-add-${preset}`}
      title={`${PRESET_LABEL[preset]} · starts at ${time.toFixed(2)}s · ${targetSummary}`}
      className="h-6 px-1.5 font-mono text-[9px] uppercase tracking-[0.14em]"
      onClick={() => addPreset(preset)}
    >
      {PRESET_LABEL[preset]}
    </Button>
  );

  return (
    <section className="panel-card" data-testid="effect-stacks">
      <h2 className="panel-title flex items-center gap-1.5">
        <Sparkles className="size-3" /> Effects
      </h2>

      <p
        className="font-mono text-[10px] leading-relaxed text-muted-foreground"
        data-testid="effect-target-summary"
        data-target={targetKind}
      >
        Target: {targetSummary}
      </p>
      <p
        className="font-mono text-[10px] text-accent"
        data-testid="effect-start-readout"
        data-start={time.toFixed(2)}
      >
        New effects start at {time.toFixed(2)}s (playhead)
      </p>

      <div className="mt-2 space-y-1.5">
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
          Quick lighting
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
              onChange={(event) => setGradientAxis(event.target.value as "X" | "Y" | "Z")}
              className="studio-input w-14 font-mono"
            >
              <option value="X">X</option>
              <option value="Y">Y</option>
              <option value="Z">Z</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-1" data-testid="effect-stack-presets">
          {(["BASE_COLOR", "FADE", "GRADIENT"] as const).map((preset) =>
            presetButton(preset, true),
          )}
        </div>
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
          More effects
        </p>
        <div className="flex flex-wrap gap-1" data-testid="effect-stack-secondary-presets">
          {(["PULSE", "CHASE", "TWINKLE"] as const).map((preset) => presetButton(preset, false))}
        </div>

        <ul className="space-y-1" data-testid="effect-stack-list">
          {scoped.length === 0 && (
            <li
              className="font-mono text-[10px] text-muted-foreground"
              data-testid="effect-stack-empty"
            >
              No effects yet. Pick a colour and apply one of the quick actions above.
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
                {index + 1}. {effect.type}
              </button>

              <input
                type="number"
                step={0.25}
                value={Number(effect.start.toFixed(2))}
                title="Start (s)"
                onChange={(e) =>
                  patchLightingEffect(effect.id, { start: Math.max(0, Number(e.target.value)) })
                }
                className="studio-input w-14 text-right font-mono"
              />
              <input
                type="number"
                step={0.25}
                min={0.05}
                value={Number(effect.duration.toFixed(2))}
                title="Duration (s)"
                onChange={(e) =>
                  patchLightingEffect(effect.id, {
                    duration: Math.max(0.05, Number(e.target.value)),
                  })
                }
                className="studio-input w-14 text-right font-mono"
              />
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
                title="Delete"
                onClick={() => removeLightingEffect(effect.id)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-2 space-y-1.5 border-t border-border pt-2">
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
          Motion
        </p>
        <p className="font-mono text-[9px] leading-relaxed text-muted-foreground">
          One motion per object.
        </p>

        {staticFormationId ? (
          <div className="flex flex-wrap gap-1" data-testid="motion-stack-presets">
            {DYNAMIC_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                size="sm"
                variant="outline"
                title={preset.description}
                data-testid={`motion-stack-add-${preset.id}`}
                className="h-6 px-1.5 font-mono text-[9px] uppercase tracking-[0.14em]"
                onClick={() => addMotion(preset.id)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        ) : (
          <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
            {primary
              ? "This object already animates. Edit its motion in the Dynamic formations panel."
              : "Select a static object to add motion."}
          </p>
        )}
      </div>
    </section>
  );
}
