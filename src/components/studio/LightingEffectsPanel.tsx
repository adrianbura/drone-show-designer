/**
 * LIGHTING EFFECTS PANEL — inspector surface of the lighting engine (Sprint 7.4).
 *
 * PRESENTATION ONLY: presets are immutable recipes, every edit goes through the
 * store, and no colour is computed here. Effects always belong to the selected
 * scene, so the panel never needs a second selection model.
 */
import { Lightbulb, Trash2 } from "lucide-react";
import { useMemo } from "react";

import { useI18n } from "@/i18n";
import {
  LIGHTING_ANCHORS,
  LIGHTING_BLEND_MODES,
  LIGHTING_EASINGS,
  LIGHTING_PRESETS,
  type LightingPresetGroup,
  type LightingTarget,
} from "@/lib/show/lighting";
import { hexToRgb, rgbToHex } from "@/lib/show/lights";
import { useStudio } from "@/lib/studio/store";

const GROUPS: LightingPresetGroup[] = ["APPEAR", "COLOR", "RHYTHM", "ADVANCED"];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export default function LightingEffectsPanel() {
  const { t } = useI18n();
  const {
    project,
    selectedClipId,
    selectedScene,
    lightingEffects,
    lightingReport,
    selectedLightingEffect,
    selectLightingEffect,
    addLightingEffectFromPreset,
    patchLightingEffect,
    patchLightingParameters,
    removeLightingEffect,
    lightingPreview,
    setLightingPreview,
  } = useStudio();

  const grouped = useMemo(
    () => GROUPS.map((group) => ({ group, presets: LIGHTING_PRESETS.filter((p) => p.group === group) })),
    [],
  );

  const objects = selectedScene?.objects ?? [];
  const effect = selectedLightingEffect;
  const params = effect?.parameters ?? {};

  return (
    <section className="panel-card">
      <h2 className="panel-title">
        <Lightbulb className="size-3.5" /> {t("lighting.title")}
      </h2>

      <label className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          checked={lightingPreview}
          onChange={(e) => setLightingPreview(e.target.checked)}
        />
        {t("lighting.preview")}
      </label>

      {!selectedClipId ? (
        <p className="text-[11px] text-muted-foreground">{t("lighting.noClip")}</p>
      ) : (
        <>
          {grouped.map(({ group, presets }) => (
            <div key={group} className="mb-2">
              <p className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                {t(`lighting.group.${group}` as "lighting.group.APPEAR")}
              </p>
              <div className="flex flex-wrap gap-1">
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => addLightingEffectFromPreset(selectedClipId, preset.id)}
                    className="rounded border border-border bg-panel-2 px-2 py-1 text-[10px] hover:border-accent"
                    title={t("lighting.addPreset")}
                  >
                    {t(preset.labelKey as "lighting.preset.fadeIn")}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <p className="mb-1 mt-3 text-[10px] uppercase tracking-widest text-muted-foreground">
            {t("lighting.effects")}
          </p>
          {lightingEffects.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t("lighting.noEffects")}</p>
          ) : (
            <ul className="mb-2 space-y-1">
              {lightingEffects.map((e) => (
                <li key={e.id} className="flex items-center gap-1">
                  <button
                    onClick={() => selectLightingEffect(e.id)}
                    className={`flex-1 truncate rounded border px-2 py-1 text-left text-[11px] ${
                      selectedLightingEffect?.id === e.id ? "border-accent" : "border-border"
                    } ${e.enabled ? "" : "opacity-50"}`}
                  >
                    {t(`lighting.type.${e.type}` as "lighting.type.FADE_IN")}
                    <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                      {e.start.toFixed(1)}s · {e.duration.toFixed(1)}s
                    </span>
                  </button>
                  <button
                    onClick={() => removeLightingEffect(e.id)}
                    aria-label={t("common.delete")}
                    className="rounded border border-border p-1 text-destructive hover:border-destructive"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {effect ? (
            <div className="grid grid-cols-2 gap-2 border-t border-border pt-2">
              <Field label={t("lighting.anchor")}>
                <select
                  value={effect.anchor}
                  onChange={(ev) =>
                    patchLightingEffect(effect.id, {
                      anchor: ev.target.value as (typeof LIGHTING_ANCHORS)[number],
                    })
                  }
                  className="input-field"
                >
                  {LIGHTING_ANCHORS.map((a) => (
                    <option key={a} value={a}>
                      {t(`lighting.anchor.${a}` as "lighting.anchor.ABSOLUTE")}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t("lighting.target")}>
                <select
                  value={effect.target.kind === "SCENE" ? "SCENE" : (effect.target.instanceId ?? "SCENE")}
                  onChange={(ev) => {
                    const next: LightingTarget =
                      ev.target.value === "SCENE"
                        ? { kind: "SCENE", clipId: effect.target.clipId }
                        : {
                            kind: "SCENE_OBJECT",
                            clipId: effect.target.clipId,
                            instanceId: ev.target.value,
                          };
                    patchLightingEffect(effect.id, { target: next });
                  }}
                  className="input-field"
                >
                  <option value="SCENE">{t("lighting.target.SCENE")}</option>
                  {objects.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t("lighting.start")}>
                <input
                  type="number"
                  step={0.1}
                  value={effect.start}
                  onChange={(ev) => patchLightingEffect(effect.id, { start: Number(ev.target.value) })}
                  className="input-field"
                />
              </Field>
              <Field label={t("lighting.duration")}>
                <input
                  type="number"
                  step={0.1}
                  min={0.1}
                  value={effect.duration}
                  onChange={(ev) =>
                    patchLightingEffect(effect.id, {
                      duration: Math.max(0.1, Number(ev.target.value)),
                    })
                  }
                  className="input-field"
                />
              </Field>

              <Field label={t("lighting.intensity")}>
                <input
                  type="number"
                  step={0.05}
                  min={0}
                  max={1}
                  value={params.intensity ?? 1}
                  onChange={(ev) =>
                    patchLightingParameters(effect.id, { intensity: Number(ev.target.value) })
                  }
                  className="input-field"
                />
              </Field>
              <Field label={t("lighting.softness")}>
                <input
                  type="number"
                  step={0.05}
                  min={0}
                  max={1}
                  value={params.softness ?? 0}
                  onChange={(ev) =>
                    patchLightingParameters(effect.id, { softness: Number(ev.target.value) })
                  }
                  className="input-field"
                />
              </Field>

              {effect.type === "DIRECTIONAL_REVEAL" || effect.type === "COLOR_SWEEP" ? (
                <Field label={t("lighting.angle")}>
                  <input
                    type="number"
                    step={5}
                    value={params.angleDeg ?? 0}
                    onChange={(ev) =>
                      patchLightingParameters(effect.id, { angleDeg: Number(ev.target.value) })
                    }
                    className="input-field"
                  />
                </Field>
              ) : null}

              {effect.type === "PULSE" ? (
                <Field label={t("lighting.cycles")}>
                  <input
                    type="number"
                    step={1}
                    min={1}
                    value={params.cycles ?? 1}
                    onChange={(ev) =>
                      patchLightingParameters(effect.id, { cycles: Math.max(1, Number(ev.target.value)) })
                    }
                    className="input-field"
                  />
                </Field>
              ) : null}

              {effect.type === "COLOR_TRANSITION" ? (
                <>
                  <Field label={t("lighting.fromColor")}>
                    <input
                      type="color"
                      value={rgbToHex(params.fromColor ?? [255, 255, 255])}
                      onChange={(ev) =>
                        patchLightingParameters(effect.id, { fromColor: hexToRgb(ev.target.value) })
                      }
                      className="h-8 w-full rounded border border-border bg-panel-2"
                    />
                  </Field>
                  <Field label={t("lighting.toColor")}>
                    <input
                      type="color"
                      value={rgbToHex(params.toColor ?? [255, 255, 255])}
                      onChange={(ev) =>
                        patchLightingParameters(effect.id, { toColor: hexToRgb(ev.target.value) })
                      }
                      className="h-8 w-full rounded border border-border bg-panel-2"
                    />
                  </Field>
                </>
              ) : (
                <Field label={t("lighting.color")}>
                  <input
                    type="color"
                    value={rgbToHex(params.color ?? [255, 255, 255])}
                    onChange={(ev) =>
                      patchLightingParameters(effect.id, { color: hexToRgb(ev.target.value) })
                    }
                    className="h-8 w-full rounded border border-border bg-panel-2"
                  />
                </Field>
              )}

              <Field label={t("lighting.easing")}>
                <select
                  value={params.easing ?? "LINEAR"}
                  onChange={(ev) =>
                    patchLightingParameters(effect.id, {
                      easing: ev.target.value as (typeof LIGHTING_EASINGS)[number],
                    })
                  }
                  className="input-field"
                >
                  {LIGHTING_EASINGS.map((e) => (
                    <option key={e} value={e}>
                      {t(`lighting.easing.${e}` as "lighting.easing.LINEAR")}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t("lighting.blend")}>
                <select
                  value={effect.blendMode}
                  onChange={(ev) =>
                    patchLightingEffect(effect.id, {
                      blendMode: ev.target.value as (typeof LIGHTING_BLEND_MODES)[number],
                    })
                  }
                  className="input-field"
                >
                  {LIGHTING_BLEND_MODES.map((b) => (
                    <option key={b} value={b}>
                      {t(`lighting.blend.${b}` as "lighting.blend.REPLACE")}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t("lighting.priority")}>
                <input
                  type="number"
                  step={1}
                  value={effect.priority}
                  onChange={(ev) => patchLightingEffect(effect.id, { priority: Number(ev.target.value) })}
                  className="input-field"
                />
              </Field>

              <label className="col-span-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={effect.enabled}
                  onChange={(ev) => patchLightingEffect(effect.id, { enabled: ev.target.checked })}
                />
                {t("lighting.enabled")}
              </label>
            </div>
          ) : null}
        </>
      )}

      <p className="mt-3 text-[10px] uppercase tracking-widest text-muted-foreground">
        {t("lighting.issues")}
      </p>
      {lightingReport.issues.length === 0 ? (
        <p className="text-[11px] text-safe">{t("lighting.allGood")}</p>
      ) : (
        <ul className="space-y-1">
          {lightingReport.issues.slice(0, 20).map((issue) => (
            <li
              key={issue.id}
              className={`text-[11px] ${issue.severity === "error" ? "text-destructive" : "text-warning"}`}
            >
              {t(`lighting.issue.${issue.code}` as "lighting.issue.INVALID_COLOR")}
            </li>
          ))}
        </ul>
      )}
      {/* Lighting never influences flight computation — it is image only. */}
      <p className="mt-2 text-[10px] text-muted-foreground">
        {project.lighting?.effects.length ?? 0} / {project.timeline.length}
      </p>
    </section>
  );
}
