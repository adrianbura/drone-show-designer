/**
 * SCENE OBJECTS PANEL (Sprint 7.3.5).
 *
 * One artistic SCENE may contain SEVERAL formation objects at the same time.
 * This panel edits that composition only: object list, per-object transform,
 * drone budget and advisory footprint proximity. It owns no physical drone
 * identity — the fleet participation planner, assignment engine, trajectory
 * planner and validator stay fully authoritative.
 */
import { Copy, FlipHorizontal2, Layers, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import type { SceneAlignment } from "@/lib/show/scene";
import { useStudio } from "@/lib/studio/store";

const ALIGNMENTS: SceneAlignment[] = ["CENTER_X", "CENTER_Y", "DISTRIBUTE_X", "DISTRIBUTE_Y"];

function AxisRow({
  label,
  values,
  step,
  onChange,
}: {
  label: string;
  values: readonly [number, number, number];
  step: number;
  onChange: (next: [number, number, number]) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-1.5 text-[11px] text-muted-foreground">
      <span className="uppercase tracking-[0.14em]">{label}</span>
      <span className="flex gap-1">
        {values.map((v, i) => (
          <input
            key={i}
            type="number"
            step={step}
            value={Number(v.toFixed(2))}
            onChange={(e) => {
              const next: [number, number, number] = [values[0], values[1], values[2]];
              next[i] = Number(e.target.value);
              onChange(next);
            }}
            className="studio-input w-14 text-right font-mono"
          />
        ))}
      </span>
    </label>
  );
}

export default function SceneObjectsPanel() {
  const { t } = useI18n();
  const {
    project,
    selectedClipId,
    selectedScene,
    selectedSceneBudget,
    selectedSceneWarnings,
    selectedSceneObjectId,
    selectSceneObject,
    patchSceneObject,
    patchSceneObjectTransform,
    duplicateSceneObject,
    removeSceneObject,
    mirrorSceneObject,
    alignSceneObjects,
  } = useStudio();

  if (!selectedClipId || !selectedScene) {
    return (
      <section className="panel-card">
        <h2 className="panel-title flex items-center gap-1.5">
          <Layers className="size-3" /> {t("scene.title")}
        </h2>
        <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
          {t("scene.noClip")}
        </p>
      </section>
    );
  }

  const clipId = selectedClipId;
  const budget = selectedSceneBudget;
  const selected =
    selectedScene.objects.find((o) => o.id === selectedSceneObjectId) ??
    selectedScene.objects[0] ??
    null;

  return (
    <section className="panel-card">
      <h2 className="panel-title flex items-center gap-1.5">
        <Layers className="size-3" /> {t("scene.title")}
      </h2>

      {budget && (
        <div className="space-y-1">
          <p className="font-mono text-[10px] text-muted-foreground">
            {t("scene.budget", {
              active: budget.active,
              fleet: project.droneCount,
              available: Math.max(0, budget.availableDrones),
            })}
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded bg-surface-sunken">
            <div
              className={budget.overCapacity ? "h-full bg-destructive" : "h-full bg-accent"}
              style={{
                width: `${Math.min(100, (budget.active / Math.max(1, project.droneCount)) * 100)}%`,
              }}
            />
          </div>
          {budget.overCapacity && (
            <p className="font-mono text-[10px] leading-relaxed text-destructive">
              {t("scene.overCapacity", { over: budget.over })}
            </p>
          )}
        </div>
      )}

      <ul className="mt-2 space-y-1">
        {selectedScene.objects.map((object) => {
          const count = budget?.objects.find((o) => o.instanceId === object.id)?.count ?? 0;
          const active = object.id === selected?.id;
          return (
            <li key={object.id}>
              <div
                className={`flex items-center gap-1 rounded border px-1.5 py-1 ${
                  active ? "border-accent bg-accent/10" : "border-border bg-surface-sunken"
                }`}
              >
                <button
                  type="button"
                  onClick={() => selectSceneObject(object.id)}
                  className="min-w-0 flex-1 truncate text-left font-mono text-[10px] text-foreground"
                >
                  {object.name}
                  <span className="ml-1 text-muted-foreground">
                    {t("scene.objectDrones", { count })}
                  </span>
                </button>
                <button
                  type="button"
                  title={t("scene.mirror")}
                  onClick={() => mirrorSceneObject(clipId, object.id)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <FlipHorizontal2 className="size-3" />
                </button>
                <button
                  type="button"
                  title={t("scene.duplicate")}
                  onClick={() => duplicateSceneObject(clipId, object.id)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Copy className="size-3" />
                </button>
                <button
                  type="button"
                  title={t("common.delete")}
                  disabled={selectedScene.objects.length <= 1}
                  onClick={() => removeSceneObject(clipId, object.id)}
                  className="text-muted-foreground hover:text-destructive disabled:opacity-40"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {selectedScene.objects.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {ALIGNMENTS.map((alignment) => (
            <Button
              key={alignment}
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-1.5 font-mono text-[9px] uppercase tracking-[0.14em]"
              onClick={() => alignSceneObjects(clipId, alignment)}
            >
              {t(`scene.align.${alignment}`)}
            </Button>
          ))}
        </div>
      )}

      {selected && (
        <div className="mt-3 space-y-1.5 border-t border-border pt-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
            {selected.name}
          </p>
          <AxisRow
            label={t("scene.position")}
            values={selected.transform.position}
            step={1}
            onChange={(position) => patchSceneObjectTransform(clipId, selected.id, { position })}
          />
          <AxisRow
            label={t("scene.rotation")}
            values={selected.transform.rotationDeg}
            step={5}
            onChange={(rotationDeg) => patchSceneObjectTransform(clipId, selected.id, { rotationDeg })}
          />
          <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-[0.14em]">{t("scene.scale")}</span>
            <input
              type="number"
              min={0.05}
              step={0.05}
              value={Number(selected.transform.scale.toFixed(2))}
              onChange={(e) =>
                patchSceneObjectTransform(clipId, selected.id, {
                  scale: Math.max(0.05, Number(e.target.value)),
                })
              }
              className="studio-input w-20 text-right font-mono"
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-[0.14em]">{t("scene.droneBudget")}</span>
            <input
              type="number"
              min={1}
              step={1}
              value={selected.requestedDroneCount ?? ""}
              placeholder="auto"
              onChange={(e) => {
                const raw = e.target.value.trim();
                patchSceneObject(clipId, selected.id, {
                  requestedDroneCount: raw === "" ? null : Math.max(1, Number(raw)),
                });
              }}
              className="studio-input w-20 text-right font-mono"
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-[0.14em]">{t("scene.name")}</span>
            <input
              value={selected.name}
              onChange={(e) => patchSceneObject(clipId, selected.id, { name: e.target.value })}
              className="studio-input w-32 font-mono"
            />
          </label>
        </div>
      )}

      {selectedClipBinding && (
        <div className="mt-3 space-y-1.5 border-t border-border pt-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
            {t("scene.reference.title")}
          </p>
          <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-[0.14em]">{t("scene.reference.show")}</span>
            <input
              type="checkbox"
              checked={sceneReferenceGhost}
              onChange={(e) => setSceneReferenceGhost(e.target.checked)}
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-[0.14em]">{t("scene.reference.frame")}</span>
            <select
              value={sceneComparisonFrame}
              onChange={(e) => setSceneComparisonFrame(e.target.value as SceneComparisonFrame)}
              className="studio-input w-36 font-mono"
            >
              <option value="EXTRACTED">{t("scene.reference.frame.EXTRACTED")}</option>
              <option value="CURRENT">{t("scene.reference.frame.CURRENT")}</option>
            </select>
          </label>
          {sceneDeviation && (
            <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
              {t("scene.reference.rms", {
                rms: sceneDeviation.rmsMeters.toFixed(2),
                max: sceneDeviation.maxMeters.toFixed(2),
                count: sceneDeviation.comparedCount,
              })}
            </p>
          )}
          {objectDeviation && (
            <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
              {t("scene.reference.objectRms", {
                rms: objectDeviation.rmsMeters.toFixed(2),
                max: objectDeviation.maxMeters.toFixed(2),
                centroid: objectDeviation.centroidShiftMeters.toFixed(2),
                scale: objectDeviation.scaleChange.toFixed(2),
              })}
              {objectDeviation.rotationDeg !== null
                ? ` · ${t("scene.reference.rotation", {
                    deg: objectDeviation.rotationDeg.toFixed(1),
                  })}`
                : ""}
            </p>
          )}
          {objectDeviation && !objectDeviation.membershipKnown && (
            <p className="font-mono text-[9px] leading-relaxed text-warning">
              {t("scene.reference.membershipUnknown")}
            </p>
          )}
          <div className="flex flex-col gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canResetSelectedSceneObject || !selected}
              className="h-6 justify-start px-1.5 font-mono text-[9px] uppercase tracking-[0.14em]"
              onClick={() => selected && resetSceneObject(clipId, selected.id)}
            >
              <RotateCcw className="mr-1 size-3" /> {t("scene.reference.reset")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 justify-start px-1.5 font-mono text-[9px] uppercase tracking-[0.14em]"
              onClick={() => duplicateSceneAsEditable(clipId)}
            >
              <CopyPlus className="mr-1 size-3" /> {t("scene.reference.duplicate")}
            </Button>
          </div>
          <p className="font-mono text-[9px] leading-relaxed text-muted-foreground">
            {t("scene.reference.note")}
          </p>
        </div>
      )}

      {selectedSceneWarnings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {selectedSceneWarnings.map((w) => (
            <li key={`${w.a}-${w.b}`} className="font-mono text-[9px] leading-relaxed text-warning">
              {t("scene.proximity", { a: w.aName, b: w.bName, gap: w.gap.toFixed(1) })}
            </li>
          ))}
        </ul>
      )}


      <p className="mt-2 font-mono text-[9px] leading-relaxed text-muted-foreground">
        {t("scene.disclaimer")}
      </p>
    </section>
  );
}
