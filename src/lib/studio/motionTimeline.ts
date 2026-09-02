import type { FormationScene } from "../show/scene";
import type { DynamicFormation } from "../show/dynamic";
import type { TimelineClip } from "../show/types";

export interface MotionTimelineBlock {
  readonly objectId: string;
  readonly dynamicFormationId: string;
  readonly label: string;
  readonly start: number;
  readonly duration: number;
  readonly cycleDuration: number;
  readonly playbackRate: number;
}

/** Canonical motion occupancy: a dynamic scene object animates during clip HOLD. */
export function motionTimelineBlocks(
  clip: TimelineClip | null,
  scene: FormationScene | null,
  dynamics: readonly DynamicFormation[],
): MotionTimelineBlock[] {
  if (!clip || !scene || clip.id !== scene.id || clip.hold <= 0) return [];
  const byId = new Map(dynamics.map((dynamic) => [dynamic.id, dynamic]));
  return scene.objects.flatMap((object) => {
    if (object.source.kind !== "DYNAMIC") return [];
    const dynamic = byId.get(object.source.dynamicFormationId);
    if (!dynamic) return [];
    return [
      {
        objectId: object.id,
        dynamicFormationId: dynamic.id,
        label: object.name,
        start: clip.start + clip.transition,
        duration: clip.hold,
        cycleDuration: dynamic.duration,
        playbackRate: object.animation?.playbackRate ?? 1,
      },
    ];
  });
}
