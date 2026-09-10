import { intervalAtTime, type ReferenceTrajectoryLayer } from "../import/essp/native";

/**
 * Editor-only ownership projection. While an object of the selected scene is
 * being edited, the viewport must show the planner candidate for that clip even
 * when the imported ESSP interval still owns export. This never promotes the
 * interval and never changes the trajectory used by validation or export.
 */
export function isPlannerSceneEditPreview(
  layer: ReferenceTrajectoryLayer | null,
  time: number,
  selectedClipId: string | null,
  selectedObjectIds: readonly string[],
): boolean {
  if (!layer || !selectedClipId || selectedObjectIds.length === 0) return false;
  const interval = intervalAtTime(layer, time);
  return interval?.clipId === selectedClipId && interval.owner === "REFERENCE";
}
