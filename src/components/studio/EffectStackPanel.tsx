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
  EFFECT_STACK_PRESETS,
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
  BASE_COLOR: "Base colour",
  FADE: "Fade",
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
  const {
    selectedClipId,
    selectedScene,
    selectedSceneObjectIds,
    lightingEffects,
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
  const targets: LightingTarget[] =
    selectedSceneObjectIds.length > 0
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

  const primaryId = selectedSceneObjectIds[selectedSceneObjectIds.length - 1] ?? null;
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

  return (
    <section className="panel-card" data-testid="effect-stacks">
      <h2 className="panel-title flex items-center gap-1.5">
        <Sparkles className="size-3" /> Effects
      </h2>

      <p className="font-mono text-[10px] text-muted-foreground">
        {selectedSceneObjectIds.length > 0
          ? `${selectedSceneObjectIds.length} object(s) selected`
          : "Whole scene selected"}
      </p>

      <div className="mt-2 space-y-1.5">
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
          Lighting stack
        </p>
        <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="uppercase tracking-[0.14em]">Colour</span>
          <input
            type="color"
            value={toHex(color)}
            data-testid="effect-stack-color"
            onChange={(e) => setColor(fromHex(e.target.value))}
            className="h-6 w-16 cursor-pointer rounded border border-border bg-transparent"
          />
        </label>
        <div className="flex flex-wrap gap-1" data-testid="effect-stack-presets">
          {EFFECT_STACK_PRESETS.map((preset) => (
            <Button
              key={preset}
              type="button"
              size="sm"
              variant="outline"
              data-testid={`effect-stack-add-${preset}`}
              className="h-6 px-1.5 font-mono text-[9px] uppercase tracking-[0.14em]"
              onClick={() =>
                addLightingEffectsFromPreset(
                  clipId,
                  canonicalStackPresetId(preset),
                  targets,
                  stackColorParameters(preset, color),
                )
              }
            >
              {PRESET_LABEL[preset]}
            </Button>
          ))}
        </div>

        <ul className="space-y-1" data-testid="effect-stack-list">
          {scoped.length === 0 && (
            <li className="font-mono text-[10px] text-muted-foreground">No effects yet.</li>
          )}
          {scoped.map((effect, index) => (
            <li
              key={effect.id}
              className="flex items-center gap-1 rounded border border-border bg-surface-sunken px-1.5 py-1"
            >
              <input
                type="checkbox"
                checked={effect.enabled}
                title="Enabled"
                data-testid={`effect-stack-enabled-${effect.id}`}
                onChange={(e) => patchLightingEffect(effect.id, { enabled: e.target.checked })}
              />
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-foreground">
                {index + 1}. {effect.type}
              </span>
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
