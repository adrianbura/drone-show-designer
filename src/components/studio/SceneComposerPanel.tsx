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
  Copy,
  Eye,
  EyeOff,
  LassoSelect,
  Layers,
  MousePointer2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { useStudio } from "@/lib/studio/store";
import type { RGB } from "@/lib/show/types";

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

/**
 * ADD VISUAL — everyday creation of a NATIVE line/underline object directly in
 * the selected scene. Geometry comes from the deterministic `line` formation
 * kind; drone identity, safety and assignment stay with the existing engines.
 */
function AddNativeLine({ clipId, availableDrones }: { clipId: string; availableDrones: number }) {
  const { addNativeVisual } = useStudio();
  const [open, setOpen] = useState(false);
  const [drones, setDrones] = useState(20);
  const [length, setLength] = useState(40);
  const [rows, setRows] = useState(1);
  const [x, setX] = useState(0);
  const [y, setY] = useState(45);
  const [z, setZ] = useState(0);
  const [color, setColor] = useState("#ffffff");
  const requestedDrones = Math.max(2, Math.round(drones));
  const exceedsReserve = requestedDrones > availableDrones;

  if (!open) {
    return (
      <button
        type="button"
        data-testid="composer-add-visual"
        onClick={() => setOpen(true)}
        className="chip-btn mt-2 w-full justify-center"
      >
        <Plus className="size-3" /> Add visual
      </button>
    );
  }

  return (
    <div
      className="mt-2 space-y-1.5 rounded border border-border bg-surface-sunken p-2"
      data-testid="composer-add-line"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Native line
      </p>
      <NumberField
        label="Drones"
        value={drones}
        step={1}
        max={availableDrones}
        testId="line-drones"
        onChange={setDrones}
      />
      <p
        className={`font-mono text-[10px] ${exceedsReserve ? "text-destructive" : "text-muted-foreground"}`}
        data-testid="line-reserve"
      >
        {availableDrones} reserve drone{availableDrones === 1 ? "" : "s"} available
      </p>
      <NumberField
        label="Length m"
        value={length}
        step={1}
        testId="line-length"
        onChange={setLength}
      />
      <NumberField label="Rows" value={rows} step={1} testId="line-rows" onChange={setRows} />
      <div className="grid grid-cols-3 gap-1">
        <NumberField label="X" value={x} step={0.5} testId="line-x" onChange={setX} />
        <NumberField label="Y" value={y} step={0.5} testId="line-y" onChange={setY} />
        <NumberField label="Z" value={z} step={0.5} testId="line-z" onChange={setZ} />
      </div>
      <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="uppercase tracking-[0.14em]">Colour</span>
        <input
          type="color"
          value={color}
          data-testid="line-color"
          onChange={(e) => setColor(e.target.value)}
          className="h-6 w-16 cursor-pointer rounded border border-border bg-transparent"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="composer-add-line-commit"
          disabled={availableDrones < 2 || exceedsReserve}
          onClick={() => {
            addNativeVisual(clipId, {
              kind: "line",
              name: "Line",
              droneCount: requestedDrones,
              params: { length: Math.max(1, length), rows: Math.max(1, Math.round(rows)) },
              position: [x, y, z],
              color: fromHex(color),
            });
            setOpen(false);
          }}
          className="chip-btn mini-btn-accent flex-1 justify-center disabled:opacity-40"
        >
          Add to scene
        </button>
        <button type="button" onClick={() => setOpen(false)} className="chip-btn justify-center">
          Cancel
        </button>
      </div>
    </div>
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
  } = useStudio();
  const [groupName, setGroupName] = useState("Group");
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState<string | null>(null);

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

      <ul className="mt-2 space-y-1" data-testid="composer-object-list">
        {selectedScene.objects.map((object) => {
          const count = budget?.objects.find((o) => o.instanceId === object.id)?.count ?? 0;
          const active = selectedSceneObjectIds.includes(object.id);
          const visible = object.visible !== false;
          return (
            <li key={object.id}>
              <div
                className={`flex items-center gap-1 rounded border px-1.5 py-1 ${
                  active ? "border-accent bg-accent/10" : "border-border bg-surface-sunken"
                }`}
              >
                <button
                  type="button"
                  data-testid={`composer-object-${object.id}`}
                  onClick={(e) =>
                    selectSceneObject(
                      object.id,
                      e.ctrlKey || e.metaKey || e.shiftKey ? "TOGGLE" : "REPLACE",
                    )
                  }
                  className="min-w-0 flex-1 truncate text-left font-mono text-[10px] text-foreground"
                >
                  {object.name}
                  <span className="ml-1 text-muted-foreground">· {count} drones</span>
                </button>
                <button
                  type="button"
                  title={visible ? "Hide in editor" : "Show in editor"}
                  onClick={() => patchSceneObject(clipId, object.id, { visible: !visible })}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {visible ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                </button>
                <button
                  type="button"
                  title="Duplicate"
                  onClick={() => duplicateSceneObject(clipId, object.id)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Copy className="size-3" />
                </button>
                <button
                  type="button"
                  title="Delete"
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

      <AddNativeLine clipId={clipId} availableDrones={reserve} />

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
