import { Activity } from "lucide-react";
import { useMemo } from "react";

import { validateDynamicFormation } from "@/lib/show/dynamic";
import { motionTimelineBlocks } from "@/lib/studio/motionTimeline";
import { useStudio } from "@/lib/studio/store";

export default function MotionTrack({
  viewStart,
  viewEnd,
}: {
  viewStart: number;
  viewEnd: number;
}) {
  const {
    project,
    selectedClipId,
    selectedScene,
    selectedSceneObjectIds,
    selectSceneObject,
    selectDynamicFormation,
  } = useStudio();
  const clip = project.timeline.find((candidate) => candidate.id === selectedClipId) ?? null;
  const blocks = useMemo(
    () => motionTimelineBlocks(clip, selectedScene, project.dynamicFormations ?? []),
    [clip, project.dynamicFormations, selectedScene],
  );
  // CANONICAL WARNINGS: the existing dynamic validator is the only authority;
  // the track merely mirrors it (no second safety calculation).
  const warnings = useMemo(() => {
    const flagged = new Set<string>();
    for (const dynamic of project.dynamicFormations ?? []) {
      const report = validateDynamicFormation(dynamic, {
        limits: project.limits,
        area: project.area,
      });
      if (report.issues.some((issue) => issue.severity !== "info")) flagged.add(dynamic.id);
    }
    return flagged;
  }, [project.area, project.dynamicFormations, project.limits]);
  if (blocks.length === 0) return null;
  const span = Math.max(0.001, viewEnd - viewStart);

  return (
    <div className="flex h-7 items-stretch" data-testid="motion-track">
      <div className="flex w-24 shrink-0 items-center gap-1 border-r border-border px-2 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
        <Activity className="size-3" /> Motion
      </div>
      <div className="relative min-w-0 flex-1 overflow-hidden bg-surface-sunken">
        {blocks.map((block, lane) => {
          const left = ((block.start - viewStart) / span) * 100;
          const width = (block.duration / span) * 100;
          const selected = selectedSceneObjectIds.includes(block.objectId);
          const warned = warnings.has(block.dynamicFormationId);
          return (
            <button
              key={block.objectId}
              type="button"
              data-testid={`motion-block-${block.objectId}`}
              data-selected={selected ? "1" : "0"}
              data-warning={warned ? "1" : "0"}
              title={`${warned ? "Check motion validation · " : ""}${block.label} · cycle ${block.cycleDuration.toFixed(2)}s · speed ${block.playbackRate.toFixed(2)}×`}
              onClick={() => {
                selectSceneObject(block.objectId, "REPLACE");
                selectDynamicFormation(block.dynamicFormationId);
              }}
              className={`absolute h-5 truncate rounded border px-1 text-left font-mono text-[9px] ${
                selected
                  ? "border-accent bg-accent/25 text-foreground ring-1 ring-accent"
                  : "border-border bg-primary/15 text-muted-foreground"
              }`}
              style={{ left: `${left}%`, width: `${Math.max(0.5, width)}%`, top: 3 + lane * 2 }}
            >
              {warned ? "⚠ " : ""}
              {block.label} · {block.cycleDuration.toFixed(1)}s · {block.playbackRate.toFixed(1)}×
            </button>
          );
        })}
      </div>
    </div>
  );
}
