/**
 * EVERYDAY MOTION INSPECTOR.
 *
 * Reads the canonical motion state of the CURRENT selection
 * (`sceneMotionState`) and edits it exclusively through canonical store
 * actions, so each completed edit is one project revision / one undo entry.
 * There is no second motion model, no per-frame React state, and no per-drone
 * component: the technical `DynamicPanel` remains the advanced surface.
 */
import { AlertTriangle, Copy, Trash2 } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { validateDynamicFormation, type LoopMode } from "@/lib/show/dynamic";
import { sceneMotionState } from "@/lib/studio/sceneMotionInspector";
import { useStudio } from "@/lib/studio/store";

const LOOPS: LoopMode[] = ["NONE", "REPEAT", "PING_PONG"];

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 font-mono text-[9px]">
      <span className="uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

export default function MotionInspector() {
  const {
    project,
    selectedClipId,
    selectedScene,
    primarySceneObjectId,
    sceneSelectionMode,
    selectedScenePointIds,
    patchSceneObjectAnimation,
    patchSceneMotion,
    patchSceneMotionGroup,
    duplicateSceneObjectMotion,
    removeSceneObjectMotion,
  } = useStudio();

  const state = useMemo(
    () =>
      selectedClipId
        ? sceneMotionState({
            clipId: selectedClipId,
            scene: selectedScene,
            dynamics: project.dynamicFormations ?? [],
            formationIds: project.formations.map((formation) => formation.id),
            primaryObjectId: primarySceneObjectId,
            selectionMode: sceneSelectionMode === "POINT" ? "DRONES" : "OBJECT",
            selectedPointIds: selectedScenePointIds,
          })
        : null,
    [
      primarySceneObjectId,
      project.dynamicFormations,
      project.formations,
      sceneSelectionMode,
      selectedClipId,
      selectedScene,
      selectedScenePointIds,
    ],
  );

  const report = useMemo(
    () =>
      state
        ? validateDynamicFormation(state.dynamic, {
            limits: project.limits,
            area: project.area,
          })
        : null,
    [project.area, project.limits, state],
  );

  if (!state) {
    return (
      <p className="font-mono text-[9px] text-muted-foreground" data-testid="motion-inspector-empty">
        Select a moving visual to adjust its motion.
      </p>
    );
  }

  const errors = report?.issues.filter((issue) => issue.severity === "error").length ?? 0;
  const warnings = report?.issues.filter((issue) => issue.severity === "warning").length ?? 0;
  const status = errors > 0 ? "ERROR" : warnings > 0 ? "WARNING" : "OK";
  const clipId = state.clipId;

  return (
    <div
      className="space-y-1.5 rounded border border-border bg-surface-sunken p-1.5"
      data-testid="motion-inspector"
      data-object={state.objectId}
      data-dynamic={state.dynamic.id}
      data-scope={state.scope}
      data-status={status}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate font-mono text-[10px] text-foreground" data-testid="motion-inspector-name">
          {state.objectName}
        </p>
        <span
          className={`font-mono text-[9px] uppercase tracking-[0.14em] ${
            status === "OK" ? "text-muted-foreground" : "text-destructive"
          }`}
          data-testid="motion-inspector-status"
        >
          {status !== "OK" && <AlertTriangle className="mr-1 inline size-3" />}
          {status}
        </span>
      </div>

      <Row label="Motion" value={state.motionLabel} />
      <Row label="Drones" value={String(state.droneCount)} />
      <Row label="Scope" value={state.scope === "DRONES" ? "Selected drone group" : "Whole object"} />
      <Row label="Shared by" value={`${state.sharedBy} object${state.sharedBy === 1 ? "" : "s"}`} />

      <label className="flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
        Name
        <Input
          data-testid="motion-inspector-rename"
          aria-label="Motion name"
          defaultValue={state.dynamic.name}
          onBlur={(event) => {
            const name = event.target.value.trim();
            if (name && name !== state.dynamic.name) patchSceneMotion(state.dynamic.id, { name });
          }}
          className="h-6 w-32 font-mono text-[10px]"
        />
      </label>

      <label className="flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
        Cycle (s)
        <Input
          type="number"
          min={0.5}
          step={0.5}
          data-testid="motion-inspector-cycle"
          aria-label="Cycle duration seconds"
          defaultValue={state.cycleDuration}
          key={`cycle-${state.dynamic.id}-${state.cycleDuration}`}
          onChange={(event) => {
            const duration = Number(event.target.value);
            if (Number.isFinite(duration) && duration > 0)
              patchSceneMotion(state.dynamic.id, { duration });
          }}
          className="h-6 w-20 font-mono text-[10px]"
        />
      </label>

      <label className="flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
        Loop
        <select
          data-testid="motion-inspector-loop"
          aria-label="Loop mode"
          value={state.loop}
          onChange={(event) => patchSceneMotion(state.dynamic.id, { loop: event.target.value as LoopMode })}
          className="h-6 rounded border border-border bg-transparent px-1 font-mono text-[10px]"
        >
          {LOOPS.map((loop) => (
            <option key={loop} value={loop}>
              {loop}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
        Speed (×)
        <Input
          type="number"
          min={0.1}
          step={0.1}
          data-testid="motion-inspector-speed"
          aria-label="Playback speed"
          defaultValue={state.playbackRate}
          key={`speed-${state.objectId}-${state.playbackRate}`}
          onChange={(event) => {
            const playbackRate = Number(event.target.value);
            if (Number.isFinite(playbackRate) && playbackRate > 0)
              patchSceneObjectAnimation(clipId, state.objectId, { playbackRate });
          }}
          className="h-6 w-20 font-mono text-[10px]"
        />
      </label>

      <label className="flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
        Start offset (s)
        <Input
          type="number"
          step={0.25}
          data-testid="motion-inspector-offset"
          aria-label="Start offset seconds"
          defaultValue={state.startOffset}
          key={`offset-${state.objectId}-${state.startOffset}`}
          onChange={(event) => {
            const startOffset = Number(event.target.value);
            if (Number.isFinite(startOffset))
              patchSceneObjectAnimation(clipId, state.objectId, { startOffset });
          }}
          className="h-6 w-20 font-mono text-[10px]"
        />
      </label>

      <label className="flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
        Phase (cycles)
        <Input
          type="number"
          step={0.05}
          data-testid="motion-inspector-phase"
          aria-label="Phase cycles"
          defaultValue={state.phaseCycles}
          key={`phase-${state.objectId}-${state.phaseCycles}`}
          onChange={(event) => {
            const phaseCycles = Number(event.target.value);
            if (Number.isFinite(phaseCycles))
              patchSceneObjectAnimation(clipId, state.objectId, { phaseCycles });
          }}
          className="h-6 w-20 font-mono text-[10px]"
        />
      </label>

      {state.group && (
        <div
          className="space-y-1 rounded border border-border/70 p-1"
          data-testid="motion-inspector-group"
          data-group={state.group.id}
          data-enabled={state.group.enabled ? "1" : "0"}
        >
          <Row label="Group" value={`${state.group.name} · ${state.group.droneCount} drones`} />
          <Input
            aria-label="Drone group motion name"
            data-testid="motion-group-rename"
            defaultValue={state.group.name}
            key={`group-name-${state.group.id}-${state.group.name}`}
            onBlur={(event) => {
              const name = event.target.value.trim();
              if (name && state.group && name !== state.group.name)
                patchSceneMotionGroup(state.dynamic.id, state.group.id, { name });
            }}
            className="h-6 font-mono text-[10px]"
          />
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="motion-group-toggle"
              className="h-6 px-1.5 font-mono text-[9px] uppercase tracking-[0.14em]"
              onClick={() =>
                state.group &&
                patchSceneMotionGroup(state.dynamic.id, state.group.id, {
                  enabled: !state.group.enabled,
                })
              }
            >
              {state.group.enabled ? "Disable" : "Enable"}
            </Button>
            <label className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
              Phase
              <Input
                type="number"
                step={0.05}
                aria-label="Group phase offset"
                data-testid="motion-group-phase"
                defaultValue={state.group.phaseOffset}
                key={`group-phase-${state.group.id}-${state.group.phaseOffset}`}
                onChange={(event) => {
                  const phaseOffset = Number(event.target.value);
                  if (Number.isFinite(phaseOffset) && state.group)
                    patchSceneMotionGroup(state.dynamic.id, state.group.id, { phaseOffset });
                }}
                className="h-6 w-16 font-mono text-[10px]"
              />
            </label>
            <label className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
              Loop (s)
              <Input
                type="number"
                min={0}
                step={0.5}
                aria-label="Group loop duration"
                data-testid="motion-group-loop"
                defaultValue={state.group.loopDuration}
                key={`group-loop-${state.group.id}-${state.group.loopDuration}`}
                onChange={(event) => {
                  const loopDuration = Number(event.target.value);
                  if (Number.isFinite(loopDuration) && loopDuration >= 0 && state.group)
                    patchSceneMotionGroup(state.dynamic.id, state.group.id, { loopDuration });
                }}
                className="h-6 w-16 font-mono text-[10px]"
              />
            </label>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="motion-inspector-duplicate"
          className="h-6 px-1.5 font-mono text-[9px] uppercase tracking-[0.14em]"
          onClick={() => duplicateSceneObjectMotion(clipId, state.objectId)}
        >
          <Copy className="mr-1 size-3" /> Duplicate
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!state.canRestoreStatic}
          title={
            state.canRestoreStatic
              ? "Return this object to its static formation"
              : "No static source formation to restore"
          }
          data-testid="motion-inspector-remove"
          className="h-6 px-1.5 font-mono text-[9px] uppercase tracking-[0.14em]"
          onClick={() => removeSceneObjectMotion(clipId, state.objectId)}
        >
          <Trash2 className="mr-1 size-3" /> Remove motion
        </Button>
      </div>
    </div>
  );
}
