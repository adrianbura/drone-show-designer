import { Activity, Layers2, Redo2, Trash2, Undo2 } from "lucide-react";

import { DYNAMIC_PRESETS, neutralGroupKeyframe, neutralTransformKeyframe } from "@/lib/show/dynamic";
import type { LoopMode } from "@/lib/show/dynamic";
import { useStudio } from "@/lib/studio/store";

const LOOPS: LoopMode[] = ["REPEAT", "PING_PONG", "NONE"];

function Num({
  label,
  value,
  step = 0.5,
  onChange,
  unit,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
  unit?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
      <span className="uppercase tracking-[0.14em]">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          value={Number(value.toFixed(3))}
          step={step}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(v);
          }}
          className="w-20 rounded border border-border/70 bg-background px-1.5 py-0.5 text-right font-mono text-[11px] text-foreground"
        />
        {unit && <span className="w-6 text-[10px]">{unit}</span>}
      </span>
    </label>
  );
}

/**
 * Dynamic formation editor. Purely a view over the pure engine: every control
 * maps a DynamicFormation to a new DynamicFormation through store actions, so
 * nothing here can invent flight data or bypass validation.
 */
export default function DynamicPanel() {
  const {
    project,
    dynamicFormations,
    selectedDynamicFormation: formation,
    selectDynamicFormation,
    dynamicReport,
    createDynamicFromFormation,
    removeDynamicFormation,
    patchDynamicFormation,
    addDynamicClip,
    applyDynamicPreset,
    mirrorDynamicGroups,
    selectedPointIds,
    clearPointSelection,
    selectPointSide,
    selectedMotionGroupId,
    selectMotionGroup,
    createMotionGroupFromSelection,
    deleteMotionGroup,
    patchMotionGroupState,
    assignSelectionToGroup,
    upsertGlobalKeyframe,
    deleteGlobalKeyframe,
    upsertDeformationKeyframe,
    deleteDeformationKeyframe,
    dynamicEditTime,
    setDynamicEditTime,
    undoDynamic,
    redoDynamic,
    canUndoDynamic,
    canRedoDynamic,
  } = useStudio();

  const group = formation?.groups.find((g) => g.id === selectedMotionGroupId) ?? null;
  const globalKey =
    formation?.transform.find((k) => Math.abs(k.t - dynamicEditTime) < 1e-3) ??
    neutralTransformKeyframe(dynamicEditTime);
  const groupKey =
    group?.keyframes.find((k) => Math.abs(k.t - dynamicEditTime) < 1e-3) ??
    neutralGroupKeyframe(dynamicEditTime);

  return (
    <section className="panel-card">
      <h2 className="panel-title">
        <Activity className="size-3.5" /> Dynamic formations
      </h2>

      <div className="flex flex-wrap items-center gap-1">
        <select
          value={formation?.id ?? ""}
          onChange={(e) => selectDynamicFormation(e.target.value || null)}
          className="min-w-0 flex-1 rounded border border-border/70 bg-background px-1.5 py-1 text-[11px]"
        >
          <option value="">— none selected —</option>
          {dynamicFormations.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <button
          onClick={undoDynamic}
          disabled={!canUndoDynamic}
          title="Undo dynamic edit"
          className="chip-btn disabled:opacity-40"
        >
          <Undo2 className="size-3" />
        </button>
        <button
          onClick={redoDynamic}
          disabled={!canRedoDynamic}
          title="Redo dynamic edit"
          className="chip-btn disabled:opacity-40"
        >
          <Redo2 className="size-3" />
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {project.formations.map((f) => (
          <button
            key={f.id}
            onClick={() => createDynamicFromFormation(f.id)}
            className="chip-btn"
            title={`Create a living formation from ${f.name}`}
          >
            + {f.name}
          </button>
        ))}
      </div>

      {!formation ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Convert a static formation into a living one to animate global motion (translate, rotate,
          scale) and internal deformation per motion group. Sampling always returns exactly{" "}
          {project.droneCount} points; planning, conflict detection and safety validation are
          unchanged.
        </p>
      ) : (
        <>
          <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-[0.14em]">name</span>
            <input
              value={formation.name}
              onChange={(e) => patchDynamicFormation(formation.id, { name: e.target.value })}
              className="w-40 rounded border border-border/70 bg-background px-1.5 py-0.5 text-[11px] text-foreground"
            />
          </label>
          <Num
            label="cycle"
            unit="s"
            value={formation.duration}
            onChange={(v) =>
              patchDynamicFormation(formation.id, { duration: Math.max(0.5, v) })
            }
          />
          <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-[0.14em]">loop</span>
            <select
              value={formation.loop}
              onChange={(e) =>
                patchDynamicFormation(formation.id, { loop: e.target.value as LoopMode })
              }
              className="rounded border border-border/70 bg-background px-1.5 py-0.5 text-[11px]"
            >
              {LOOPS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-1 pt-1">
            {DYNAMIC_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => applyDynamicPreset(formation.id, p.id)}
                className="chip-btn"
                title={p.description}
              >
                {p.label}
              </button>
            ))}
            <button onClick={() => mirrorDynamicGroups(formation.id)} className="chip-btn">
              Mirror X
            </button>
            <button onClick={() => addDynamicClip(formation.id)} className="chip-btn">
              Add clip
            </button>
            <button
              onClick={() => removeDynamicFormation(formation.id)}
              className="chip-btn text-destructive"
            >
              <Trash2 className="size-3" /> Delete
            </button>
          </div>

          {/* ---- selection + motion groups ---- */}
          <div className="space-y-1 border-t border-border/60 pt-2">
            <p className="flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <Layers2 className="size-3" /> selection ({selectedPointIds.length} points)
            </p>
            <div className="flex flex-wrap gap-1">
              <button onClick={() => selectPointSide("left")} className="chip-btn">
                Left
              </button>
              <button onClick={() => selectPointSide("right")} className="chip-btn">
                Right
              </button>
              <button onClick={() => selectPointSide("centre")} className="chip-btn">
                Centre
              </button>
              <button onClick={() => selectPointSide("all")} className="chip-btn">
                All
              </button>
              <button onClick={clearPointSelection} className="chip-btn">
                Clear
              </button>
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Click a drone in the viewport to select the base point it flies; hold Shift to add.
            </p>
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => createMotionGroupFromSelection(`Group ${formation.groups.length + 1}`)}
                disabled={selectedPointIds.length === 0}
                className="chip-btn disabled:opacity-40"
              >
                New group from selection
              </button>
              {group && (
                <button
                  onClick={() => assignSelectionToGroup(group.id)}
                  disabled={selectedPointIds.length === 0}
                  className="chip-btn disabled:opacity-40"
                >
                  Assign to {group.name}
                </button>
              )}
            </div>
            <ul className="space-y-1">
              {formation.groups.map((g) => (
                <li
                  key={g.id}
                  className={`rounded border p-1.5 ${
                    g.id === selectedMotionGroupId ? "border-primary/70" : "border-border/70"
                  }`}
                >
                  <div className="flex items-center gap-1">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: `rgb(${g.color[0]},${g.color[1]},${g.color[2]})` }}
                    />
                    <button
                      onClick={() => selectMotionGroup(g.id === selectedMotionGroupId ? null : g.id)}
                      className="min-w-0 flex-1 truncate text-left text-[11px] text-foreground"
                    >
                      {g.name}
                    </button>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {g.pointIds.length}
                    </span>
                    <button
                      onClick={() => patchMotionGroupState(g.id, { enabled: !g.enabled })}
                      className="chip-btn"
                    >
                      {g.enabled ? "on" : "off"}
                    </button>
                    <button
                      onClick={() => deleteMotionGroup(g.id)}
                      className="chip-btn text-destructive"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                  {g.id === selectedMotionGroupId && (
                    <div className="space-y-1 pt-1">
                      <Num
                        label="phase"
                        unit="s"
                        step={0.1}
                        value={g.phaseOffset}
                        onChange={(v) => patchMotionGroupState(g.id, { phaseOffset: v })}
                      />
                      <Num
                        label="period"
                        unit="s"
                        step={0.1}
                        value={g.loopDuration ?? formation.duration}
                        onChange={(v) =>
                          patchMotionGroupState(g.id, { loopDuration: Math.max(0.1, v) })
                        }
                      />
                      <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span className="uppercase tracking-[0.14em]">loop</span>
                        <select
                          value={g.loop}
                          onChange={(e) =>
                            patchMotionGroupState(g.id, { loop: e.target.value as LoopMode })
                          }
                          className="rounded border border-border/70 bg-background px-1.5 py-0.5 text-[11px]"
                        >
                          {LOOPS.map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* ---- keyframes at the local edit time ---- */}
          <div className="space-y-1 border-t border-border/60 pt-2">
            <Num
              label="edit time"
              unit="s"
              step={0.1}
              value={dynamicEditTime}
              onChange={(v) => setDynamicEditTime(Math.min(formation.duration, Math.max(0, v)))}
            />
            <input
              type="range"
              min={0}
              max={formation.duration}
              step={0.05}
              value={dynamicEditTime}
              onChange={(e) => setDynamicEditTime(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              global track ({formation.transform.length} keys)
            </p>
            {(["translation", "rotation", "scale"] as const).map((field) =>
              (["x", "y", "z"] as const).map((axis, axisIndex) => (
                <Num
                  key={`${field}-${axis}`}
                  label={`${field.slice(0, 3)} ${axis}`}
                  step={field === "rotation" ? 5 : field === "scale" ? 0.05 : 0.5}
                  value={globalKey[field][axisIndex] ?? 0}
                  onChange={(v) => {
                    const next = [...globalKey[field]] as [number, number, number];
                    next[axisIndex] = v;
                    upsertGlobalKeyframe({ ...globalKey, t: dynamicEditTime, [field]: next });
                  }}
                />
              )),
            )}
            <div className="flex gap-1">
              <button
                onClick={() => upsertGlobalKeyframe({ ...globalKey, t: dynamicEditTime })}
                className="chip-btn"
              >
                Set key
              </button>
              <button
                onClick={() => deleteGlobalKeyframe(dynamicEditTime)}
                className="chip-btn text-destructive"
              >
                Remove key
              </button>
            </div>

            {group && (
              <>
                <p className="pt-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {group.name} deformation ({group.keyframes.length} keys)
                </p>
                {(["offset", "rotation"] as const).map((field) =>
                  (["x", "y", "z"] as const).map((axis, axisIndex) => (
                    <Num
                      key={`g-${field}-${axis}`}
                      label={`${field.slice(0, 3)} ${axis}`}
                      step={field === "rotation" ? 5 : 0.5}
                      value={groupKey[field][axisIndex] ?? 0}
                      onChange={(v) => {
                        const next = [...groupKey[field]] as [number, number, number];
                        next[axisIndex] = v;
                        upsertDeformationKeyframe(group.id, {
                          ...groupKey,
                          t: dynamicEditTime,
                          [field]: next,
                        });
                      }}
                    />
                  )),
                )}
                <Num
                  label="scale"
                  step={0.05}
                  value={groupKey.scale}
                  onChange={(v) =>
                    upsertDeformationKeyframe(group.id, {
                      ...groupKey,
                      t: dynamicEditTime,
                      scale: v,
                    })
                  }
                />
                <div className="flex gap-1">
                  <button
                    onClick={() =>
                      upsertDeformationKeyframe(group.id, { ...groupKey, t: dynamicEditTime })
                    }
                    className="chip-btn"
                  >
                    Set key
                  </button>
                  <button
                    onClick={() => deleteDeformationKeyframe(group.id, dynamicEditTime)}
                    className="chip-btn text-destructive"
                  >
                    Remove key
                  </button>
                </div>
              </>
            )}
          </div>

          {/* ---- design-time report ---- */}
          {dynamicReport && (
            <div className="space-y-1 border-t border-border/60 pt-2">
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                animation report — {dynamicReport.status}
              </p>
              <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
                <dt>min spacing</dt>
                <dd className="text-right text-foreground">
                  {dynamicReport.metrics.minSpacing.toFixed(2)} m
                </dd>
                <dt>max speed</dt>
                <dd className="text-right text-foreground">
                  {dynamicReport.metrics.maxPointSpeed.toFixed(2)} m/s
                </dd>
                <dt>max accel</dt>
                <dd className="text-right text-foreground">
                  {dynamicReport.metrics.maxPointAcceleration.toFixed(2)} m/s²
                </dd>
                <dt>altitude</dt>
                <dd className="text-right text-foreground">
                  {dynamicReport.metrics.minAltitude.toFixed(1)}–
                  {dynamicReport.metrics.maxAltitude.toFixed(1)} m
                </dd>
                <dt>loop seam</dt>
                <dd className="text-right text-foreground">
                  {dynamicReport.metrics.loopSeamGap.toFixed(2)} m
                </dd>
              </dl>
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {dynamicReport.issues.length === 0 && (
                  <li className="text-[11px] text-safe">
                    No design-time issues. Flight limits remain the SafetyValidator&apos;s call.
                  </li>
                )}
                {dynamicReport.issues.slice(0, 30).map((issue) => (
                  <li key={issue.id}>
                    <button
                      onClick={() => issue.time !== undefined && setDynamicEditTime(issue.time)}
                      className={`issue-row ${issue.severity === "error" ? "issue-row-critical" : ""}`}
                    >
                      <span className="font-mono text-[10px]">
                        {issue.time !== undefined ? `${issue.time.toFixed(1)}s` : "—"}
                      </span>
                      <span className="truncate">{issue.message}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
