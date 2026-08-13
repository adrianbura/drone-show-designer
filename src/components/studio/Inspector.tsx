import { AlertTriangle, CheckCircle2, Download, Plug, ShieldCheck } from "lucide-react";

import { ADAPTER_REGISTRY } from "@/lib/adapters";
import { downloadText, toSkybrushShow, toStudioProject, toTrajectoryCsv } from "@/lib/adapters/export";
import { hexToRgb, rgbToHex } from "@/lib/show/lights";
import { snapToBeat } from "@/lib/show/audio";
import type { Easing, LightEffect } from "@/lib/show/types";
import { useStudio } from "@/lib/studio/store";

const EFFECTS: LightEffect[] = ["solid", "pulse", "rainbow", "chase", "twinkle"];
const EASINGS: Easing[] = ["minJerk", "smooth", "linear"];

function NumberRow({
  label,
  value,
  onChange,
  step = 0.5,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  unit?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
      <span className="uppercase tracking-[0.14em]">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          value={Number(value.toFixed(2))}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="studio-input w-20 text-right font-mono"
        />
        {unit && <span className="font-mono text-[10px]">{unit}</span>}
      </span>
    </label>
  );
}

export default function Inspector() {
  const {
    project,
    resolved,
    safety,
    selectedClipId,
    patchClip,
    setLimits,
    beatGrid,
    setTime,
  } = useStudio();
  const clip = project.timeline.find((c) => c.id === selectedClipId);

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <section className="panel-card">
        <h2 className="panel-title">Clip inspector</h2>
        {!clip ? (
          <p className="text-xs text-muted-foreground">Select a clip on the timeline.</p>
        ) : (
          <div className="space-y-3">
            <select
              value={clip.formationId}
              onChange={(e) => patchClip(clip.id, { formationId: e.target.value })}
              className="studio-input"
              aria-label="Clip formation"
            >
              {project.formations.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <NumberRow
              label="Start"
              value={clip.start}
              unit="s"
              onChange={(v) => patchClip(clip.id, { start: Math.max(0, v) })}
            />
            <NumberRow
              label="Transition"
              value={clip.transition}
              unit="s"
              onChange={(v) => patchClip(clip.id, { transition: Math.max(0.5, v) })}
            />
            <NumberRow
              label="Hold"
              value={clip.hold}
              unit="s"
              onChange={(v) => patchClip(clip.id, { hold: Math.max(0, v) })}
            />
            <button
              onClick={() => patchClip(clip.id, { start: snapToBeat(clip.start, beatGrid) })}
              className="chip-btn w-full justify-center"
            >
              Snap start to beat
            </button>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1.5">
                <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Easing
                </span>
                <select
                  value={clip.easing}
                  onChange={(e) => patchClip(clip.id, { easing: e.target.value as Easing })}
                  className="studio-input"
                >
                  {EASINGS.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Light effect
                </span>
                <select
                  value={clip.effect}
                  onChange={(e) => patchClip(clip.id, { effect: e.target.value as LightEffect })}
                  className="studio-input"
                >
                  {EFFECTS.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Base colour
              <input
                type="color"
                value={rgbToHex(clip.color)}
                onChange={(e) => patchClip(clip.id, { color: hexToRgb(e.target.value) })}
                className="h-7 w-14 cursor-pointer rounded border border-border bg-transparent"
              />
            </label>
          </div>
        )}
      </section>

      <section className="panel-card">
        <h2 className="panel-title">
          <ShieldCheck className="size-3.5" /> Flight envelope
        </h2>
        <NumberRow
          label="Max velocity"
          value={project.limits.maxVelocity}
          unit="m/s"
          onChange={(v) => setLimits({ maxVelocity: v })}
        />
        <NumberRow
          label="Max accel"
          value={project.limits.maxAcceleration}
          unit="m/s²"
          onChange={(v) => setLimits({ maxAcceleration: v })}
        />
        <NumberRow
          label="Max yaw rate"
          value={project.limits.maxYawRate}
          unit="°/s"
          step={5}
          onChange={(v) => setLimits({ maxYawRate: v })}
        />
        <NumberRow
          label="Min separation"
          value={project.limits.minSeparation}
          unit="m"
          onChange={(v) => setLimits({ minSeparation: v })}
        />
        <NumberRow
          label="Ceiling"
          value={project.limits.maxAltitude}
          unit="m"
          step={5}
          onChange={(v) => setLimits({ maxAltitude: v })}
        />
      </section>

      <section className="panel-card">
        <h2 className="panel-title">
          {safety.status === "ok" ? (
            <CheckCircle2 className="size-3.5 text-safe" />
          ) : (
            <AlertTriangle className="size-3.5 text-warning" />
          )}
          Validation ({safety.issues.length})
        </h2>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
          <dt>peak v</dt>
          <dd className="text-right text-foreground">{safety.worst.maxVelocity.toFixed(1)} m/s</dd>
          <dt>peak a</dt>
          <dd className="text-right text-foreground">{safety.worst.maxAcceleration.toFixed(1)} m/s²</dd>
          <dt>peak yaw</dt>
          <dd className="text-right text-foreground">{safety.worst.maxYawRate.toFixed(0)} °/s</dd>
          <dt>min sep</dt>
          <dd className="text-right text-foreground">{safety.worst.minSeparation.toFixed(2)} m</dd>
          <dt>frames</dt>
          <dd className="text-right text-foreground">{safety.frames}</dd>
        </dl>
        <ul className="max-h-52 space-y-1 overflow-y-auto pt-1">
          {safety.issues.length === 0 && (
            <li className="text-xs text-safe">All checks passed within the flight envelope.</li>
          )}
          {safety.issues.slice(0, 40).map((issue) => (
            <li key={issue.id}>
              <button
                onClick={() => setTime(issue.time)}
                className={`issue-row ${issue.severity === "critical" ? "issue-row-critical" : ""}`}
              >
                <span className="font-mono text-[10px]">{issue.time.toFixed(1)}s</span>
                <span className="truncate">{issue.message}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel-card">
        <h2 className="panel-title">
          <Download className="size-3.5" /> Export
        </h2>
        <button
          onClick={() =>
            downloadText(
              `${project.name.replace(/\s+/g, "-").toLowerCase()}.show.json`,
              toSkybrushShow(project, resolved),
              "application/json",
            )
          }
          className="chip-btn w-full justify-center"
        >
          Skybrush-compatible show JSON
        </button>
        <button
          onClick={() =>
            downloadText(
              `${project.name.replace(/\s+/g, "-").toLowerCase()}.trajectories.csv`,
              toTrajectoryCsv(project, resolved),
              "text/csv",
            )
          }
          className="chip-btn w-full justify-center"
        >
          Trajectory + light CSV
        </button>
        <button
          onClick={() =>
            downloadText(
              `${project.name.replace(/\s+/g, "-").toLowerCase()}.dss.json`,
              toStudioProject(project),
              "application/json",
            )
          }
          className="chip-btn w-full justify-center"
        >
          Studio project file
        </button>
      </section>

      <section className="panel-card">
        <h2 className="panel-title">
          <Plug className="size-3.5" /> Adapters
        </h2>
        <ul className="space-y-2">
          {ADAPTER_REGISTRY.map((a) => (
            <li key={a.id} className="rounded border border-border/70 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs text-foreground">{a.name}</span>
                <span className={`status-pill status-${a.status}`}>{a.status}</span>
              </div>
              <p className="pt-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
                {a.upstream} · {a.license}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
