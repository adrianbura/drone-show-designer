/**
 * COMMAND BINDING (timeline surfaces).
 *
 * Builds the typed command CONTEXT from live studio state and executes command
 * ids by delegating to the EXISTING canonical actions. There is no second
 * lighting, transition, scene, reference or history authority here: every
 * mutation goes through the store action that already owns it, so one command
 * produces exactly one undo revision.
 *
 * Anything that merely reveals an editor uses the Inspector focus channel and
 * mutates nothing.
 */
import { useCallback } from "react";

import { clipPhase } from "@/lib/show/types";
import { useStudio } from "@/lib/studio/store";
import type { ClipCommandContext, ClipOwnership, StudioCommandId } from "./commands";
import { focusStudioSurface, type StudioSurfaceId } from "./inspectorFocus";
import { clipLabel, clipRepresentation } from "./selectionSummary";

export interface RenameRequest {
  readonly kind: "CLIP" | "MARKER";
  readonly id: string;
  readonly current: string;
}

/** Nearest beat to a time, or null when there is no usable tempo grid. */
export function nearestBeat(beats: readonly number[], time: number): number | null {
  if (beats.length === 0) return null;
  let best = beats[0]!;
  for (const b of beats) if (Math.abs(b - time) < Math.abs(best - time)) best = b;
  return best;
}

export function useTimelineCommands(onRename?: (request: RenameRequest) => void) {
  const {
    project,
    beatGrid,
    lightingEffects,
    referenceOwnership,
    selectClip,
    setTime,
    removeClip,
    duplicateClipForDesign,
    canEditClipAsScene,
    editClipAsScene,
    commitClipTiming,
    addClip,
    addMarker,
    removeMarker,
    markers,
    patchMarker,
    selectLightingEffect,
    removeLightingEffect,
  } = useStudio();

  /** Trajectory ownership of the clip's range, straight from the reference layer. */
  const ownershipOf = useCallback(
    (clipId: string): ClipOwnership => {
      const interval = referenceOwnership?.intervals.find((i) => i.clipId === clipId);
      if (!interval) return "NONE";
      return interval.owner === "REFERENCE" ? "REFERENCE" : "PLANNER";
    },
    [referenceOwnership],
  );

  const clipContext = useCallback(
    (clipId: string): ClipCommandContext | null => {
      const clip = project.timeline.find((c) => c.id === clipId);
      if (!clip) return null;
      const ownership = ownershipOf(clipId);
      return {
        kind: "CLIP",
        clipId,
        label: clipLabel(project, clip),
        phase: clipPhase(clip),
        representation: clipRepresentation(project, clip),
        canConvertToScene: canEditClipAsScene(clipId),
        hasAuthoredLighting: lightingEffects.some((e) => e.target.clipId === clipId),
        hasImportedRgb: ownership === "REFERENCE",
        canSnapToBeat: beatGrid.beats.length > 0,
        ownership,
        canCompareReference: ownership !== "NONE",
        // No clip-level reference restore authority exists yet; scene objects are
        // restored individually in the scene panel. Never pretend otherwise.
        canRestoreReference: false,
        experimentalEnabled: import.meta.env.DEV,
      };
    },
    [beatGrid.beats, canEditClipAsScene, lightingEffects, ownershipOf, project],
  );

  const execute = useCallback(
    (id: StudioCommandId, target: { clipId?: string; time?: number; markerId?: string; effectId?: string }) => {
      const clipId = target.clipId;
      /** ONE routing path: select the target, then reveal the owning surface. */
      const focusSurface = (surface: StudioSurfaceId, id?: string) => {
        if (id) selectClip(id);
        focusStudioSurface({ surface, ...(id ? { clipId: id } : {}) });
      };

      switch (id) {
        case "EDIT_SCENE":
          if (clipId) selectClip(clipId);
          focusSurface("SCENE", clipId);
          return;
        case "EDIT_DYNAMIC":
          if (clipId) selectClip(clipId);
          focusSurface("DYNAMIC", clipId);
          return;
        case "EDIT_FORMATION":
        case "SET_COLOR":
        case "EDIT_MOTION":
          if (clipId) selectClip(clipId);
          focusSurface("CLIP", clipId);
          return;
        case "CONVERT_TO_SCENE":
          if (clipId && editClipAsScene(clipId)) focusSurface("SCENE", clipId);
          return;
        case "EDIT_LIGHTING":
          if (clipId) selectClip(clipId);
          focusSurface("LIGHTING", clipId);
          return;
        case "VIEW_IMPORTED_RGB":
          focusSurface("REFERENCE", clipId);
          return;
        case "SNAP_START_TO_BEAT": {
          if (!clipId) return;
          const clip = project.timeline.find((c) => c.id === clipId);
          const beat = clip ? nearestBeat(beatGrid.beats, clip.start) : null;
          if (!clip || beat === null || beat === clip.start) return;
          commitClipTiming(clipId, { start: beat });
          return;
        }
        case "EDIT_TRANSITION":
        case "TRANSITION_DESIGN":
        case "REPLAN_ASSIGNMENT":
          if (clipId) selectClip(clipId);
          focusSurface("TRANSITION", clipId);
          return;
        case "DUPLICATE_CLIP":
          if (clipId) duplicateClipForDesign(clipId);
          return;
        case "RENAME_CLIP": {
          if (!clipId) return;
          const clip = project.timeline.find((c) => c.id === clipId);
          if (!clip) return;
          onRename?.({ kind: "CLIP", id: clipId, current: clipLabel(project, clip) });
          return;
        }
        case "DELETE_CLIP":
          if (clipId) removeClip(clipId);
          return;
        case "COMPARE_REFERENCE":
          focusSurface("VALIDATION", clipId);
          return;
        case "RESTORE_REFERENCE":
        case "REBUILD_AS_TEXT":
          // Presented as explicitly unavailable by the command authority.
          return;
        case "ADD_CLIP_HERE": {
          const formationId = project.formations[0]?.id;
          if (formationId) addClip(formationId);
          return;
        }
        case "ADD_MARKER_HERE":
          if (typeof target.time === "number") addMarker(target.time);
          return;
        case "MOVE_PLAYHEAD_HERE":
          if (typeof target.time === "number") setTime(target.time);
          return;
        case "RENAME_MARKER": {
          const marker = markers.find((m) => m.id === target.markerId);
          if (!marker) return;
          onRename?.({ kind: "MARKER", id: marker.id, current: marker.label ?? "" });
          return;
        }
        case "MARKER_TO_PLAYHEAD":
          if (target.markerId) patchMarker(target.markerId, { time: target.time ?? 0 });
          return;
        case "DELETE_MARKER":
          if (target.markerId) removeMarker(target.markerId);
          return;
        case "EDIT_LIGHTING_EFFECT":
          if (target.effectId) selectLightingEffect(target.effectId);
          focusSurface("LIGHTING", clipId);
          return;
        case "DELETE_LIGHTING_EFFECT":
          if (target.effectId) removeLightingEffect(target.effectId);
          return;
      }
    },
    [
      addClip,
      addMarker,
      beatGrid.beats,
      commitClipTiming,
      duplicateClipForDesign,
      editClipAsScene,
      markers,
      onRename,
      patchMarker,
      project,
      removeClip,
      removeLightingEffect,
      removeMarker,
      selectClip,
      selectLightingEffect,
      setTime,
    ],
  );

  return { clipContext, execute };
}
