/*
 * SCENE OBJECTS PANEL (Sprint 7.3.5).
 *
 * Scene authoring stays instance-based: this panel changes project-owned scene
 * instances only. Multi-selection is editor state; flight identity and planning
 * remain owned by the participation / assignment / trajectory engines.
 */
import { Copy, CopyPlus, FlipHorizontal2, Layers, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import type { SceneComparisonFrame } from "@/lib/import/essp/native";
import type { SceneAlignment } from "@/lib/show/scene";
import { useStudio } from "@/lib/studio/store";

const ALIGNMENTS: SceneAlignment[] = ["CENTER_X", "CENTER_Y", "DISTRIBUTE_X", "DISTRIBUTE_Y"];

type Vec3 = readonly [number, number, number];

function AxisRow({
  label,
  values,
  step,
  onChange,
}: {
  label: string;
  values: Vec3;
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
    selectedClipBinding,
    sceneReferenceGhost,
    setSceneReferenceGhost,
    sceneComparisonFrame,
    setSceneComparisonFrame,
    sceneDeviation,
    canResetSelectedSceneObject,
    resetSceneObject,
    duplicateSceneAsEditable,
  } = useStudio();

  // Multi-selection is deliberately editor-only. The primary object continues
  // to be the store selection so the viewport/reference tools keep one focus.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!selectedScene) {
      setSelectedIds([]);
      return;
    }
    const valid = new Set(selectedScene.objects.map((o) => o.id));
    setSelectedIds((current) => {
      const kept = current.filter((id) => valid.has(id));
      if (selectedSceneObjectId && valid.has(selectedSceneObjectId)) {
        return kept.includes(selectedSceneObjectId) ? kept : [...kept, selectedSceneObjectId];
      }
      return kept;
    });
  }, [selectedClipId, selectedScene, selectedSceneObjectId]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  if (!selectedClipId || !selectedScene) {
    return (
      <section className="panel-card">
        <h2 className="panel-title flex items-center gap-1.5">
          <Layers className="size-3" /> {t("scene.title")}
        </h2>
        <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">{t("scene.noClip")}</p>
      </section>
    );
  }

  const clipId = selectedClipId;
  const budget = selectedSceneBudget;
  const selected =
    selectedScene.objects.find((o) => o.id === selectedSceneObjectId) ?? selectedScene.objects[0] ?? null;
  const activeIds = selectedIds.length > 0 ? selectedIds : selected ? [selected.id] : [];
  const objectDeviation = selected
    ? (sceneDeviation?.objects.find((o) => o.objectId === selected.id) ?? null)
    : null;

  const chooseObject = (objectId: string, additive: boolean) => {
    if (!additive) {
      setSelectedIds([objectId]);
      selectSceneObject(objectId);
      return;
    }
    setSelectedIds((current) => {
      const exists = current.includes(objectId);
      const next = exists ? current.filter((id) => id !== objectId) : [...current, objectId];
      if (!exists) selectSceneObject(objectId);
      else if (selectedSceneObjectId === objectId) selectSceneObject(next[next.length - 1] ?? null);
      return next;
    });
  };

  const applyPosition = (next: [number, number, number]) => {
    if (!selected) return;
    const delta: [number, number, number] = [
      next[0] - selected.transform.position[0],
      next[1] - selected.transform.position[1],
      next[2] - selected.transform.position[2],
    ];
    for (const id of activeIds) {
      const object = selectedScene.objects.find((o) => o.id === id);
      if (!object) continue;
      patchSceneObjectTransform(clipId, id, {
        position: [
          object.transform.position[0] + delta[0],
          object.transform.position[1] + delta[1],
          object.transform.position[2] + delta[2],
        ],
      });
    }
  };

  const applyRotation = (next: [number, number, number]) => {
    if (!selected) return;
    const delta: [number, number, number] = [
      next[0] - selected.transform.rotationDeg[0],
      next[1] - selected.transform.rotationDeg[1],
      next[2] - selected.transform.rotationDeg[2],
    ];
    for (const id of activeIds) {
      const object = selectedScene.objects.find((o) => o.id === id);
      if (!object) continue;
      patchSceneObjectTransform(clipId, id, {
        rotationDeg: [
          object.transform.rotationDeg[0] + delta[0],
          object.transform.rotationDeg[1] + delta[1],
          object.transform.rotationDeg[2] + delta[2],
        ],
      });
    }
  };

  const applyScale = (nextScale: number) => {
    if (!selected || !Number.isFinite(nextScale) || nextScale <= 0) return;
    const factor = nextScale / Math.max(0.000001, selected.transform.scale);
    for (const id of activeIds) {
      const object = selectedScene.objects.find((o) => o.id === id);
      if (!object) continue;
      patchSceneObjectTransform(clipId, id, { scale: Math.max(0.05, object.transform.scale * factor) });
    }
  };

  const mirrorSelection = () => {
    for (const id of activeIds) mirrorSceneObject(clipId, id);
  };

  const duplicateSelection = () => {
    for (const id of activeIds) duplicateSceneObject(clipId, id);
  };

  const removeSelection = () => {
    if (selectedScene.objects.length - activeIds.length < 1) return;
    for (const id of activeIds) removeSceneObject(clipId, id);
    setSelectedIds([]);
  };

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
              style={{ width: `${Math.min(100, (budget.active / Math.max(1, project.droneCount)) * 100)}%` }}
            />
          </div>
          {budget.overCapacity && (
            <p className="font-mono text-[10px] leading-relaxed text-destructive">
              {t("scene.overCapacity", { over: budget.over })}
            </p>
          )}
        </div>
      )}

      <p className="mt-2 font-mono text-[9px] leading-relaxed text-muted-foreground">
        Shift/Ctrl/Cmd + click selects multiple scene objects. Transform fields apply the primary object's delta to the whole selection.
      </p>

      <ul className="mt-2 space-y-1">
        {selectedScene.objects.map((object) => {
          const count = budget?.objects.find((o) => o.instanceId === object.id)?.count ?? 0;
          const primary = object.id === selected?.id;
          const active = selectedSet.has(object.id) || primary;
          return (
            <li key={object.id}>
              <div
                className={`flex items-center gap-1 rounded border px-1.5 py-1 ${
                  active ? "border-accent bg-accent/10" : "border-border bg-surface-sunken"
                }`}
              >
                <button
                  type="button"
                  onClick={(event) => chooseObject(object.id, event.shiftKey || event.ctrlKey || event.metaKey)}
                  className="min-w-0 flex-1 truncate text-left font-mono text-[10px] text-foreground"
                  aria-pressed={active}
                >
                  {activeIds.length > 1 && active ? "● " : ""}{object.name}
                  <span className="ml-1 text-muted-foreground">{t("scene.objectDrones", { count })}</span>
                </button>
                <button
                  type="button"
                  title={t("scene.mirror")}
                  onClick={() => (active ? mirrorSelection() : mirrorSceneObject(clipId, object.id))}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <FlipHorizontal2 className="size-3" />
                </button>
                <button
                  type="button"
                  title={t("scene.duplicate")}
                  onClick={() => (active ? duplicateSelection() : duplicateSceneObject(clipId, object.id))}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Copy className="size-3" />
                </button>
                <button
                  type="button"
                  title={t("common.delete")}
                  disabled={selectedScene.objects.length <= 1 || (active && selectedScene.objects.length - activeIds.length < 1)}
                  onClick={() => (active ? removeSelection() : removeSceneObject(clipId, object.id))}
                  className="text-muted-foreground hover:text-destructive disabled:opacity-40"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {activeIds.length > 1 && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded border border-accent/40 bg-accent/5 px-2 py-1">
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
            {activeIds.length} selected
          </span>
          <div className="flex gap-1">
            <button type="button" title={t("scene.mirror")} onClick={mirrorSelection} className="text-muted-foreground hover:text-foreground"><FlipHorizontal2 className="size-3" /></button>
            <button type="button" title={t("scene.duplicate")} onClick={duplicateSelection} className="text-muted-foreground hover:text-foreground"><Copy className="size-3" /></button>
            <button type="button" title={t("common.delete")} disabled={selectedScene.objects.length - activeIds.length < 1} onClick={removeSelection} className="text-muted-foreground hover:text-destructive disabled:opacity-40"><Trash2 className="size-3" /></button>
          </div>
        </div>
      )}

      {selectedScene.objects.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {ALIGNMENTS.map((alignment) => (
            <Button key={alignment} type="button" size="sm" variant="outline" className="h-6 px-1.5 font-mono text-[9px] uppercase tracking-[0.14em]" onClick={() => alignSceneObjects(clipId, alignment)}>
              {t(`scene.align.${alignment}`)}
            </Button>
          ))}
        </div>
      )}

      {selected && (
        <div className="mt-3 space-y-1.5 border-t border-border pt-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
            {selected.name}{activeIds.length > 1 ? ` + ${activeIds.length - 1}` : ""}
          </p>
          <AxisRow label={t("scene.position")} values={selected.transform.position} step={1} onChange={applyPosition} />
          <AxisRow label={t("scene.rotation")} values={selected.transform.rotationDeg} step={5} onChange={applyRotation} />
          <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-[0.14em]">{t("scene.scale")}</span>
            <input type="number" min={0.05} step={0.05} value={Number(selected.transform.scale.toFixed(2))} onChange={(e) => applyScale(Math.max(0.05, Number(e.target.value)))} className="studio-input w-20 text-right font-mono" />
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
                patchSceneObject(clipId, selected.id, { requestedDroneCount: raw === "" ? null : Math.max(1, Number(raw)) });
              }}
              className="studio-input w-20 text-right font-mono"
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-[0.14em]">{t("scene.name")}</span>
            <input value={selected.name} onChange={(e) => patchSceneObject(clipId, selected.id, { name: e.target.value })} className="studio-input w-32 font-mono" />
          </label>
        </div>
      )}

      {selectedClipBinding && (
        <div className="mt-3 space-y-1.5 border-t border-border pt-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{t("scene.reference.title")}</p>
          <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-[0.14em]">{t("scene.reference.show")}</span>
            <input type="checkbox" checked={sceneReferenceGhost} onChange={(e) => setSceneReferenceGhost(e.target.checked)} />
          </label>
          <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-[0.14em]">{t("scene.reference.frame")}</span>
            <select value={sceneComparisonFrame} onChange={(e) => setSceneComparisonFrame(e.target.value as SceneComparisonFrame)} className="studio-input w-36 font-mono">
              <option value="EXTRACTED">{t("scene.reference.frame.EXTRACTED")}</option>
              <option value="CURRENT">{t("scene.reference.frame.CURRENT")}</option>
            </select>
          </label>
          {sceneDeviation && (
            <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
              {t("scene.reference.rms", { rms: sceneDeviation.rmsMeters.toFixed(2), max: sceneDeviation.maxMeters.toFixed(2), count: sceneDeviation.comparedCount })}
            </p>
          )}
          {objectDeviation && (
            <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
              {t("scene.reference.objectRms", { rms: objectDeviation.rmsMeters.toFixed(2), max: objectDeviation.maxMeters.toFixed(2), centroid: objectDeviation.centroidShiftMeters.toFixed(2), scale: objectDeviation.scaleChange.toFixed(2) })}
              {objectDeviation.rotationDeg !== null ? ` · ${t("scene.reference.rotation", { deg: objectDeviation.rotationDeg.toFixed(1) })}` : ""}
            </p>
          )}
          {objectDeviation && !objectDeviation.membershipKnown && <p className="font-mono text-[9px] leading-relaxed text-warning">{t("scene.reference.membershipUnknown")}</p>}
          <div className="flex flex-col gap-1">
            <Button type="button" size="sm" variant="outline" disabled={!canResetSelectedSceneObject || !selected} className="h-6 justify-start px-1.5 font-mono text-[9px] uppercase tracking-[0.14em]" onClick={() => selected && resetSceneObject(clipId, selected.id)}>
              <RotateCcw className="mr-1 size-3" /> {t("scene.reference.reset")}
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-6 justify-start px-1.5 font-mono text-[9px] uppercase tracking-[0.14em]" onClick={() => duplicateSceneAsEditable(clipId)}>
              <CopyPlus className="mr-1 size-3" /> {t("scene.reference.duplicate")}
            </Button>
          </div>
          <p className="font-mono text-[9px] leading-relaxed text-muted-foreground">{t("scene.reference.note")}</p>
        </div>
      )}

      {selectedSceneWarnings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {selectedSceneWarnings.map((w) => (
            <li key={`${w.a}-${w.b}`} className="font-mono text-[9px] leading-relaxed text-warning">{t("scene.proximity", { a: w.aName, b: w.bName, gap: w.gap.toFixed(1) })}</li>
          ))}
        </ul>
      )}

      <p className="mt-2 font-mono text-[9px] leading-relaxed text-muted-foreground">{t("scene.disclaimer")}</p>
    </section>
  );
}
