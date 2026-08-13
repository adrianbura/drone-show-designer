import { Activity, Radio } from "lucide-react";

import { useStudio } from "@/lib/studio/store";

export default function TopBar() {
  const { project, safety, duration, fullShowReport, fullShowStale, fullShowBusy } = useStudio();
  const status =
    safety.status === "ok" ? "nominal" : safety.status === "warning" ? "review" : "unsafe";

  return (
    <header className="flex items-center gap-4 border-b border-border bg-panel px-4 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-sm font-semibold tracking-[0.22em] text-foreground">
          DRONE SHOW
        </span>
        <span className="font-display text-sm tracking-[0.22em] text-accent">STUDIO</span>
      </div>
      <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:inline">
        internal build · virtual fleet
      </span>
      <div className="ml-auto flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em]">
        <span className="hidden text-muted-foreground md:inline">{project.name}</span>
        <span className="metric-pill">
          <Radio className="size-3" /> {project.droneCount} drones
        </span>
        <span className="metric-pill">{duration.toFixed(0)}s</span>
        <span className={`metric-pill status-${status}`}>
          <Activity className="size-3" /> {status}
        </span>
        {fullShowBusy ? (
          <span className="metric-pill">validating…</span>
        ) : fullShowReport ? (
          <span
            className={`metric-pill status-${
              fullShowReport.status === "FAIL"
                ? "unsafe"
                : fullShowReport.status === "PASS_WITH_WARNINGS"
                  ? "review"
                  : "nominal"
            }`}
            title={fullShowReport.statement}
          >
            full show {fullShowReport.status === "FAIL" ? "fail" : "pass"}
            {fullShowStale ? " · stale" : ""}
          </span>
        ) : null}
      </div>
    </header>
  );
}
