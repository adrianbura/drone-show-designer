import { Boxes, Layers, Music4, Plus, Type } from "lucide-react";
import { useState } from "react";

import { probeAudioFile } from "@/lib/show/audio";
import type { FormationKind } from "@/lib/show/types";
import { useStudio } from "@/lib/studio/store";
import SvgImportPanel from "./SvgImportPanel";

const KINDS: { kind: FormationKind; label: string }[] = [
  { kind: "grid", label: "Grid" },
  { kind: "circle", label: "Circle" },
  { kind: "sphere", label: "Sphere" },
  { kind: "helix", label: "Helix" },
  { kind: "cube", label: "Cube" },
  { kind: "wave", label: "Wave" },
  { kind: "heart", label: "Heart" },
];

function clampStep(v: number, min: number, max: number, step: number) {
  const snapped = Math.round(v / step) * step;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(3))));
}

function Field({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (raw: string) => {
    const n = Number(raw);
    setDraft(null);
    if (Number.isFinite(n)) onChange(clampStep(n, min, max, step));
  };

  return (
    <div className="block space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="mini-btn px-2"
            aria-label={`Decrease ${label}`}
            onClick={() => onChange(clampStep(value - step, min, max, step))}
          >
            −
          </button>
          <input
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={step}
            value={draft ?? String(value)}
            aria-label={label}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="studio-input w-16 py-1 text-center font-mono text-xs tabular-nums"
          />
          <button
            type="button"
            className="mini-btn px-2"
            aria-label={`Increase ${label}`}
            onClick={() => onChange(clampStep(value + step, min, max, step))}
          >
            +
          </button>
          {unit ? (
            <span className="w-6 font-mono text-[10px] text-muted-foreground">{unit}</span>
          ) : null}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${label} slider`}
        className="studio-range"
      />
    </div>
  );
}

const FLEET_PRESETS = [24, 48, 100, 200, 300];


export default function LeftPanel() {
  const { project, patchProject, setDroneCount, addFormation, addClip, updateFormation } =
    useStudio();
  const [text, setText] = useState("SHOW");
  const [audioBusy, setAudioBusy] = useState(false);

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <section className="panel-card">
        <h2 className="panel-title">
          <Boxes className="size-3.5" /> Project
        </h2>
        <input
          value={project.name}
          onChange={(e) => patchProject({ name: e.target.value })}
          className="studio-input"
          aria-label="Show name"
        />
        <Field
          label="Fleet size"
          value={project.droneCount}
          onChange={setDroneCount}
          min={3}
          max={300}
        />
        <div className="flex flex-wrap gap-1.5">
          {FLEET_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setDroneCount(n)}
              className={project.droneCount === n ? "chip-btn chip-btn-active" : "chip-btn"}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3">

          <Field
            label="Width"
            value={project.area.width}
            onChange={(v) => patchProject({ area: { ...project.area, width: v } })}
            min={20}
            max={400}
            step={10}
            unit="m"
          />
          <Field
            label="Depth"
            value={project.area.depth}
            onChange={(v) => patchProject({ area: { ...project.area, depth: v } })}
            min={20}
            max={400}
            step={10}
            unit="m"
          />
          <Field
            label="Ceiling"
            value={project.area.height}
            onChange={(v) => patchProject({ area: { ...project.area, height: v } })}
            min={20}
            max={200}
            step={5}
            unit="m"
          />
        </div>
      </section>

      <section className="panel-card">
        <h2 className="panel-title">
          <Layers className="size-3.5" /> Formation library
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {KINDS.map(({ kind, label }) => (
            <button key={kind} onClick={() => addFormation(kind)} className="chip-btn">
              <Plus className="size-3" />
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 pt-1">
          <input
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 12))}
            className="studio-input flex-1"
            aria-label="Formation text"
          />
          <button onClick={() => addFormation("text", { text })} className="chip-btn shrink-0">
            <Type className="size-3" /> Text
          </button>
        </div>
      </section>

      <SvgImportPanel />

      <section className="panel-card flex-1">
        <h2 className="panel-title">
          <Layers className="size-3.5" /> Formations ({project.formations.length})
        </h2>
        <ul className="space-y-1.5">
          {project.formations.map((f) => (
            <li key={f.id} className="formation-row">
              <div className="min-w-0">
                <p className="truncate text-xs text-foreground">{f.name}</p>
                <p className="font-mono text-[10px] text-muted-foreground">
                  {f.kind} · {f.points.length} pts
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => updateFormation(f.id, { altitude: Math.min(project.area.height, Number(f.params["altitude"] ?? 30) + 5) })}
                  className="mini-btn"
                  aria-label={`Raise ${f.name}`}
                >
                  +5m
                </button>
                <button onClick={() => addClip(f.id)} className="mini-btn mini-btn-accent">
                  Add clip
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel-card">
        <h2 className="panel-title">
          <Music4 className="size-3.5" /> Music
        </h2>
        <p className="truncate font-mono text-[11px] text-muted-foreground">{project.audio.name}</p>
        <label className="chip-btn cursor-pointer justify-center">
          {audioBusy ? "Reading…" : "Import audio"}
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setAudioBusy(true);
              try {
                const meta = await probeAudioFile(file);
                patchProject({ audio: { ...project.audio, ...meta } });
              } finally {
                setAudioBusy(false);
              }
            }}
          />
        </label>
        <Field
          label="Tempo"
          value={project.audio.bpm}
          onChange={(v) => patchProject({ audio: { ...project.audio, bpm: v } })}
          min={60}
          max={200}
          unit=" bpm"
        />
      </section>
    </div>
  );
}
