/**
 * SCENE COMPOSER — EVERYDAY INSPECTOR (Skybrush-inspired).
 *
 * Selection-primary authoring: the operator picks a VISUAL OBJECT and edits only
 * artistic properties (name, drone budget, visibility, transform, base colour,
 * duplicate, delete). Everything technical (optimizer strategies, readiness
 * evidence, gizmo snapping, alignment maths) stays in the ADVANCED panels.
 *
 * This panel owns no physical drone identity and performs no safety maths: the
 * participation planner, assignment engine, trajectory planner and validator
 * remain the only authorities. Unused drones are handled as RESERVE by the
 * planner — the operator never places placeholders.
 */
import {
  BoxSelect,
  Brush,
  LassoSelect,
  Layers,
  Lightbulb,
  MousePointer2,
  Pencil,
  Trash2,
  Waves,
} from "lucide-react";
import { useMemo, useState } from "react";

import AddVisualWizard from "@/components/studio/AddVisualWizard";
import VisualLayerRow, { type VisualLayerView } from "@/components/studio/VisualLayerRow";
import { inferMotionLabel } from "@/lib/studio/sceneMotionInspector";
import { useStudio } from "@/lib/studio/store";
import type { RGB } from "@/lib/show/types";

/** Scrolls to an existing Selection Effects control and focuses it. Navigation only. */
function focusEffectControl(testId: string) {
  if (typeof document === "undefined") return;
  const host = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!host) return;
  host.scrollIntoView({ block: "center" });
  (host.querySelector("button") as HTMLElement | null)?.focus();
}

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

function NumberField({
  label,
  value,
  step,
  max,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  step: number;
  max?: number;
  onChange: (next: number) => void;
  testId?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
      <span className="uppercase tracking-[0.14em]">{label}</span>
      <input
        type="number"
        step={step}
        max={max}
        value={Number.isFinite(value) ? Number(value.toFixed(2)) : 0}
        data-testid={testId}
        onChange={(e) => onChange(Number(e.target.value))}
        className="studio-input w-20 text-right font-mono"
      />
    </label>
  );
}

export default function SceneComposerPanel() {
  const {
    project,
    selectedClipId,
    selectedScene,
    selectedSceneBudget,
    selectedSceneObjectIds,
    selectSceneObject,
    patchSceneObject,
    patchSceneObjectTransform,
    transformSceneObjects,
    duplicateSceneObject,
    removeSceneObject,
    sceneSelectionMode,
    setSceneSelectionMode,
    scenePointSelectionTool,
    setScenePointSelectionTool,
    selectedScenePointIds,
    scenePointGroups,
    clearScenePointSelection,
    createScenePointGroup,
    renameScenePointGroup,
    removeScenePointGroupById,
    selectScenePointGroup,
    lightingEffects,
  } = useStudio();
  const [groupName, setGroupName] = useState("Group");
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState<string | null>(null);
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null);
  const [layerNameDraft, setLayerNameDraft] = useState("");

  /**
   * Derived layer rows. Pure projection of canonical state: no planner, no
   * assignment, no safety and no validation engine is invoked while rendering.
   */
  const layers = useMemo<readonly VisualLayerView[]>(() => {
    if (!selectedScene) return [];
    const budget = selectedSceneBudget;
    const overCapacity = budget?.overCapacity ?? false;
    return selectedScene.objects.map((object) => {
      const source = object.source;
      const dynamic =
        source.kind === "DYNAMIC"
          ? project.dynamicFormations?.find((d) => d.id === source.dynamicFormationId)
          : undefined;
      const staticFormation =
        source.kind === "STATIC"
          ? project.formations.find((f) => f.id === source.formationId)
          : project.formations.find((f) => f.id === dynamic?.sourceFormationId);
      const sourceMissing = source.kind === "DYNAMIC" ? !dynamic : !staticFormation;
      const kind = staticFormation?.kind;
      const typeLabel =
        kind === "svg"
          ? "SVG"
          : kind === "text"
            ? "Text"
            : kind === "line"
              ? "Line"
              : object.assetId
                ? "Asset"
                : kind === "custom"
                  ? "AI"
                  : (kind ?? "Asset").toUpperCase();
      const droneCount = budget?.objects.find((o) => o.instanceId === object.id)?.count ?? 0;
      const lightingCount = lightingEffects.filter(
        (effect) => "instanceId" in effect.target && effect.target.instanceId === object.id,
      ).length;
      const motionAuthored = dynamic
        ? dynamic.groups.length > 0 || dynamic.transform.length > 1
        : false;
      const motionStatus = !dynamic
        ? "No motion"
        : motionAuthored
          ? inferMotionLabel(dynamic)
          : "Motion not authored";
      const warning = sourceMissing
        ? "Missing source asset — this visual cannot fly."
        : droneCount === 0
          ? "No drones allocated to this visual."
          : dynamic && !motionAuthored
            ? "Animated visual without authored motion."
            : overCapacity
              ? "Scene needs more drones than the fleet has."
              : null;
      return {
        id: object.id,
        name: object.name,
        typeLabel,
        droneCount,
        visible: object.visible !== false,
        animated: object.source.kind === "DYNAMIC",
        lightingCount,
        motionStatus,
        warning,
      };
    });
  }, [
    selectedScene,
    selectedSceneBudget,
    project.formations,
    project.dynamicFormations,
    lightingEffects,
  ]);

  if (!selectedClipId || !selectedScene) {
    return (
      <section className="panel-card" data-testid="scene-composer">
        <h2 className="panel-title flex items-center gap-1.5">
          <Layers className="size-3" /> Visuals
        </h2>
        <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
          Select a clip in the timeline to compose its visuals.
        </p>
      </section>
    );
  }

  const clipId = selectedClipId;
  const primaryId = selectedSceneObjectIds[selectedSceneObjectIds.length - 1] ?? null;
  const primary = selectedScene.objects.find((o) => o.id === primaryId) ?? null;
  const budget = selectedSceneBudget;
  const used = budget?.active ?? 0;
  const reserve = Math.max(0, project.droneCount - used);

  return (
    <section className="panel-card" data-testid="scene-composer">
      <h2 className="panel-title flex items-center gap-1.5">
        <Layers className="size-3" /> Visuals
      </h2>

      <p className="font-mono text-[10px] text-muted-foreground" data-testid="composer-budget">
        {used} of {project.droneCount} drones used · {reserve} reserve
      </p>

      <div
        className="mt-1 rounded border border-border bg-surface-sunken p-2"
        data-testid="reserve-summary"
        data-reserve={reserve}
      >
        <p className="font-mono text-[10px] text-muted-foreground">
          Fleet {project.droneCount} · used {used} · reserve {reserve}
        </p>
        <p className="mt-0.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
          {reserve === 0
            ? "No reserve drones left. Reduce a visual's drone count to free drones for another visual — nothing is redistributed automatically."
            : "Reducing one visual's drone count releases those drones for another visual. Allocations never change on their own."}
        </p>
      </div>

      {primary ? (
        <div
          className="mt-2 rounded border border-accent/50 bg-accent/5 p-2"
          data-testid="selected-object-summary"
        >
          <p className="font-mono text-[11px] text-foreground">
            {primary.name} · {layers.find((layer) => layer.id === primary.id)?.typeLabel ?? "Asset"}{" "}
            · {layers.find((layer) => layer.id === primary.id)?.droneCount ?? 0} drones
          </p>
          <div className="mt-1 flex gap-1">
            <button
              type="button"
              data-testid="selected-add-lighting"
              onClick={() => focusEffectControl("effect-stack-presets")}
              className="chip-btn flex-1 justify-center"
            >
              <Lightbulb className="size-3" /> Add lighting effect
            </button>
            <button
              type="button"
              data-testid="selected-add-motion"
              onClick={() => focusEffectControl("motion-stack-presets")}
              className="chip-btn flex-1 justify-center"
            >
              <Waves className="size-3" /> Add motion effect
            </button>
          </div>
        </div>
      ) : null}

      <div
        className="mt-2 grid grid-cols-2 gap-1"
        role="group"
        aria-label="Selection mode"
        data-testid="composer-selection-mode"
        data-mode={sceneSelectionMode}
      >
        {(["OBJECT", "POINT"] as const).map((mode) => {
          const active = sceneSelectionMode === mode;
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={active}
              data-active={active ? "1" : "0"}
              data-testid={`composer-mode-${mode.toLowerCase()}`}
              onClick={() => setSceneSelectionMode(mode)}
              className={`chip-btn justify-center ${
                active ? "mini-btn-accent border-accent ring-1 ring-accent" : "opacity-70"
              }`}
            >
              {mode === "OBJECT" ? "Objects" : "Drones"}
            </button>
          );
        })}
      </div>

      <p
        className="mt-1 font-mono text-[10px] leading-relaxed text-muted-foreground"
        data-testid="composer-mode-hint"
      >
        {sceneSelectionMode === "OBJECT"
          ? "Objects — edit whole SVG or line objects."
          : "Drones — select points inside one object."}
      </p>

      <p
        className="font-mono text-[10px] text-muted-foreground"
        data-testid="composer-selection-summary"
      >
        {primary ? primary.name : "No object selected"}
        {" · "}
        {selectedScenePointIds.length} drone point
        {selectedScenePointIds.length === 1 ? "" : "s"} selected
      </p>

      {sceneSelectionMode === "POINT" ? (
        <div className="mt-2 space-y-1.5 rounded border border-border bg-surface-sunken p-2">
          <div
            className="grid grid-cols-4 gap-1"
            role="group"
            aria-label="Drone selection tool"
            data-testid="composer-point-tools"
          >
            {(
              [
                ["CLICK", MousePointer2, "Click"],
                ["BOX", BoxSelect, "Box"],
                ["LASSO", LassoSelect, "Lasso"],
                ["BRUSH", Brush, "Brush"],
              ] as const
            ).map(([tool, Icon, label]) => (
              <button
                key={tool}
                type="button"
                title={`${label} selection`}
                aria-pressed={scenePointSelectionTool === tool}
                data-testid={`composer-point-tool-${tool.toLowerCase()}`}
                onClick={() => setScenePointSelectionTool(tool)}
                className={`chip-btn justify-center ${
                  scenePointSelectionTool === tool ? "mini-btn-accent border-accent" : ""
                }`}
              >
                <Icon className="size-3" /> {label}
              </button>
            ))}
          </div>
          <p
            className="font-mono text-[10px] text-muted-foreground"
            data-testid="composer-point-count"
          >
            {selectedScenePointIds.length} drone point
            {selectedScenePointIds.length === 1 ? "" : "s"} selected · Shift adds · Alt removes
          </p>
          {!primary ? (
            <p
              className="font-mono text-[10px] text-warning"
              data-testid="composer-point-no-object"
            >
              Select an object first, then pick drone points inside it.
            </p>
          ) : null}
          <div className="flex gap-1">
            <input
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              className="studio-input min-w-0 flex-1 font-mono"
              aria-label="Drone group name"
            />
            <button
              type="button"
              data-testid="composer-save-point-group"
              disabled={!primary || selectedScenePointIds.length === 0}
              onClick={() => createScenePointGroup(groupName)}
              className="chip-btn mini-btn-accent justify-center disabled:opacity-40"
            >
              Save group
            </button>
            <button type="button" onClick={clearScenePointSelection} className="chip-btn">
              Clear
            </button>
          </div>
          {scenePointGroups.length === 0 ? (
            <p
              className="font-mono text-[10px] leading-relaxed text-muted-foreground"
              data-testid="composer-point-groups-empty"
            >
              No named groups yet. Select drone points and save them to reuse the same selection
              later.
            </p>
          ) : null}
          <ul className="space-y-1" data-testid="composer-point-groups">
            {scenePointGroups.map((group) => {
              const editing = renamingGroupId === group.id;
              const confirming = confirmDeleteGroupId === group.id;
              const reusable = group.pointIds.length > 1;
              return (
                <li key={group.id} className="space-y-1">
                  <div className="flex items-center gap-1">
                    {editing ? (
                      <input
                        autoFocus
                        value={renameDraft}
                        aria-label={`Rename group ${group.name}`}
                        data-testid={`composer-group-rename-input-${group.id}`}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            if (renameDraft.trim()) renameScenePointGroup(group.id, renameDraft);
                            setRenamingGroupId(null);
                          }
                          if (event.key === "Escape") setRenamingGroupId(null);
                        }}
                        onBlur={() => {
                          if (renameDraft.trim()) renameScenePointGroup(group.id, renameDraft);
                          setRenamingGroupId(null);
                        }}
                        className="studio-input min-w-0 flex-1 font-mono"
                      />
                    ) : (
                      <button
                        type="button"
                        data-testid={`composer-group-select-${group.id}`}
                        onClick={() => selectScenePointGroup(group.id)}
                        className="chip-btn min-w-0 flex-1 justify-start"
                      >
                        <span className="truncate">{group.name}</span>
                        <span
                          className="ml-auto text-muted-foreground"
                          data-testid={`composer-group-count-${group.id}`}
                        >
                          {group.pointIds.length}
                        </span>
                      </button>
                    )}
                    <button
                      type="button"
                      title="Rename group"
                      data-testid={`composer-group-rename-${group.id}`}
                      onClick={() => {
                        setConfirmDeleteGroupId(null);
                        setRenameDraft(group.name);
                        setRenamingGroupId(group.id);
                      }}
                      className="chip-btn"
                    >
                      <Pencil className="size-3" />
                    </button>
                    <button
                      type="button"
                      title="Delete group"
                      aria-label={`Delete group ${group.name}`}
                      data-testid={`composer-group-delete-${group.id}`}
                      onClick={() => {
                        if (reusable) {
                          setConfirmDeleteGroupId(group.id);
                          return;
                        }
                        removeScenePointGroupById(group.id);
                      }}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                  {confirming ? (
                    <div
                      className="flex items-center gap-1 rounded border border-border bg-panel px-1.5 py-1"
                      data-testid={`composer-group-delete-confirm-${group.id}`}
                    >
                      <span className="min-w-0 flex-1 font-mono text-[10px] text-muted-foreground">
                        Delete “{group.name}” ({group.pointIds.length} drones)? Existing lighting
                        effects keep their own selection.
                      </span>
                      <button
                        type="button"
                        data-testid={`composer-group-delete-yes-${group.id}`}
                        onClick={() => {
                          removeScenePointGroupById(group.id);
                          setConfirmDeleteGroupId(null);
                        }}
                        className="chip-btn mini-btn-accent"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteGroupId(null)}
                        className="chip-btn"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Visual layers
      </p>
      {layers.length === 0 ? (
        <p
          className="font-mono text-[10px] leading-relaxed text-muted-foreground"
          data-testid="visual-layers-empty"
        >
          This scene has no visual objects yet. Use “Add visual” to insert an SVG, text, line,
          existing asset or an AI-generated visual.
        </p>
      ) : null}
      <ul
        className="mt-1 space-y-1"
        data-testid="visual-layers"
        data-layer-count={layers.length}
        aria-label="Visual layers"
      >
        {layers.map((layer) => (
          <li key={layer.id} data-testid={`composer-object-list-item-${layer.id}`}>
            {renamingLayerId === layer.id ? (
              <input
                autoFocus
                value={layerNameDraft}
                aria-label={`Rename layer ${layer.name}`}
                data-testid={`layer-rename-input-${layer.id}`}
                onChange={(event) => setLayerNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    if (layerNameDraft.trim())
                      patchSceneObject(clipId, layer.id, { name: layerNameDraft.trim() });
                    setRenamingLayerId(null);
                  }
                  if (event.key === "Escape") setRenamingLayerId(null);
                }}
                onBlur={() => {
                  if (layerNameDraft.trim())
                    patchSceneObject(clipId, layer.id, { name: layerNameDraft.trim() });
                  setRenamingLayerId(null);
                }}
                className="studio-input w-full font-mono"
              />
            ) : (
              <VisualLayerRow
                layer={layer}
                selected={selectedSceneObjectIds.includes(layer.id)}
                canDelete={layers.length > 1}
                onSelect={(additive) =>
                  selectSceneObject(layer.id, additive ? "TOGGLE" : "REPLACE")
                }
                onToggleVisible={() =>
                  patchSceneObject(clipId, layer.id, { visible: !layer.visible })
                }
                onRename={() => {
                  setLayerNameDraft(layer.name);
                  setRenamingLayerId(layer.id);
                }}
                onDuplicate={() => duplicateSceneObject(clipId, layer.id)}
                onDelete={() => removeSceneObject(clipId, layer.id)}
              />
            )}
          </li>
        ))}
      </ul>
      <p
        className="font-mono text-[10px] leading-relaxed text-muted-foreground"
        data-testid="visual-layers-reorder-note"
      >
        Layer order follows creation order. Reordering is not available yet.
      </p>

      <AddVisualWizard clipId={clipId} fleet={project.droneCount} used={used} />

      {primaryId ? (
        <p
          className="mt-2 rounded border border-border/70 bg-surface-sunken p-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground"
          data-testid="composer-post-create-guidance"
          data-object={primaryId}
        >
          This visual is selected — add Lighting effects, Motion effects or per-selection effects
          from Selection Effects below.
        </p>
      ) : null}

      {selectedSceneObjectIds.length > 1 && (
        <div
          className="mt-2 space-y-1.5 border-t border-border pt-2"
          data-testid="composer-group-transform"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Group · {selectedSceneObjectIds.length} objects
          </p>
          <div className="grid grid-cols-3 gap-1">
            {(["X", "Y", "Z"] as const).map((axis, i) => (
              <NumberField
                key={axis}
                label={`Move ${axis}`}
                value={0}
                step={1}
                testId={`composer-group-move-${axis}`}
                onChange={(v) => {
                  if (!v) return;
                  const position: [number, number, number] = [0, 0, 0];
                  position[i] = v;
                  transformSceneObjects(clipId, selectedSceneObjectIds, { position });
                }}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {[0.9, 1.1].map((factor) => (
              <button
                key={factor}
                type="button"
                data-testid={`composer-group-scale-${factor}`}
                onClick={() =>
                  transformSceneObjects(clipId, selectedSceneObjectIds, { scaleFactor: factor })
                }
                className="chip-btn flex-1 justify-center"
              >
                Scale {factor < 1 ? "−10%" : "+10%"}
              </button>
            ))}
            <button
              type="button"
              data-testid="composer-group-rotate"
              onClick={() =>
                transformSceneObjects(clipId, selectedSceneObjectIds, { rotationDeg: [0, 15, 0] })
              }
              className="chip-btn flex-1 justify-center"
            >
              Rotate 15°
            </button>
          </div>
        </div>
      )}

      {primary && (
        <div
          className="mt-2 space-y-1.5 border-t border-border pt-2"
          data-testid="composer-inspector"
        >
          <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-[0.14em]">Name</span>
            <input
              type="text"
              value={primary.name}
              data-testid="composer-name"
              onChange={(e) => patchSceneObject(clipId, primary.id, { name: e.target.value })}
              className="studio-input w-36 font-mono"
            />
          </label>

          <NumberField
            label="Drones"
            value={primary.requestedDroneCount ?? 0}
            step={1}
            max={
              (budget?.objects.find((object) => object.instanceId === primary.id)?.count ?? 0) +
              reserve
            }
            testId="composer-drones"
            onChange={(v) => {
              const current =
                budget?.objects.find((object) => object.instanceId === primary.id)?.count ?? 0;
              const maximum = current + reserve;
              patchSceneObject(clipId, primary.id, {
                requestedDroneCount: v > 0 ? Math.min(maximum, Math.round(v)) : null,
              });
            }}
          />

          <div className="grid grid-cols-3 gap-1">
            {(["X", "Y", "Z"] as const).map((axis, i) => (
              <NumberField
                key={axis}
                label={axis}
                value={primary.transform.position[i]!}
                step={0.5}
                testId={`composer-position-${axis}`}
                onChange={(v) => {
                  const position: [number, number, number] = [
                    primary.transform.position[0],
                    primary.transform.position[1],
                    primary.transform.position[2],
                  ];
                  position[i] = v;
                  patchSceneObjectTransform(clipId, primary.id, { position });
                }}
              />
            ))}
          </div>

          <NumberField
            label="Scale"
            value={primary.transform.scale}
            step={0.05}
            testId="composer-scale"
            onChange={(v) =>
              patchSceneObjectTransform(clipId, primary.id, { scale: Math.max(0.01, v) })
            }
          />

          <NumberField
            label="Rotation Y"
            value={primary.transform.rotationDeg[1]!}
            step={5}
            testId="composer-rotation"
            onChange={(v) =>
              patchSceneObjectTransform(clipId, primary.id, {
                rotationDeg: [
                  primary.transform.rotationDeg[0],
                  v,
                  primary.transform.rotationDeg[2],
                ],
              })
            }
          />

          <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-[0.14em]">Base colour</span>
            <input
              type="color"
              value={toHex(primary.lighting?.color ?? [255, 255, 255])}
              data-testid="composer-color"
              onChange={(e) =>
                patchSceneObject(clipId, primary.id, {
                  lighting: { ...(primary.lighting ?? {}), color: fromHex(e.target.value) },
                })
              }
              className="h-6 w-16 cursor-pointer rounded border border-border bg-transparent"
            />
          </label>
        </div>
      )}
    </section>
  );
}
