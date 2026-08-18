/**
 * TIMELINE ANNOTATIONS — markers + music sections (presentation layer).
 *
 * Markers and music sections are project-owned AUTHORING metadata: they are
 * persisted with the show, they mark the project dirty, and they never take part
 * in trajectory planning, safety validation or machine-facing exports.
 *
 * The lane shares the exact same visible time window as the clip track and the
 * waveform, so a marker line is pixel-aligned with the beat it was placed on.
 */
import { Trash2, X } from "lucide-react";
import { useState } from "react";

import { useI18n } from "@/i18n";
import {
  MARKER_TYPES,
  MUSIC_SECTION_TYPES,
  type MusicSection,
  type MusicSectionType,
  type TimelineMarker,
  type TimelineMarkerType,
} from "@/lib/show/markers";
import { formatShowTime } from "@/lib/studio/timelineEdit";

export interface TimelineAnnotationsProps {
  readonly markers: readonly TimelineMarker[];
  readonly sections: readonly MusicSection[];
  readonly view: { readonly start: number; readonly end: number };
  readonly onSeek: (t: number) => void;
  readonly onPatchMarker: (id: string, patch: Partial<Omit<TimelineMarker, "id">>) => void;
  readonly onRemoveMarker: (id: string) => void;
  readonly onPatchSection: (id: string, patch: Partial<Omit<MusicSection, "id">>) => void;
  readonly onRemoveSection: (id: string) => void;
}

const MARKER_TINT: Record<TimelineMarkerType, string> = {
  GENERAL: "bg-border",
  MUSIC: "bg-accent",
  CHOREOGRAPHY: "bg-primary",
};

const SECTION_TINT: Record<MusicSectionType, string> = {
  INTRO: "bg-muted",
  VERSE: "bg-secondary/50",
  BUILD: "bg-accent/25",
  DROP: "bg-primary/30",
  BREAK: "bg-muted-foreground/20",
  FINALE: "bg-warning/25",
  CUSTOM: "bg-border/60",
};

export default function TimelineAnnotations({
  markers,
  sections,
  view,
  onSeek,
  onPatchMarker,
  onRemoveMarker,
  onPatchSection,
  onRemoveSection,
}: TimelineAnnotationsProps) {
  const { t, locale } = useI18n();
  const comma = locale === "ro";
  const [editingMarker, setEditingMarker] = useState<string | null>(null);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const span = Math.max(0.001, view.end - view.start);
  const pct = (v: number) => `${((v - view.start) / span) * 100}%`;
  const marker = markers.find((m) => m.id === editingMarker);
  const section = sections.find((s) => s.id === editingSection);

  return (
    <div className="relative shrink-0">
      {/* MUSIC SECTIONS — subtle bands, never louder than the clips. */}
      <div className="relative h-4 overflow-hidden rounded-sm border border-border/60 bg-surface-sunken">
        {sections.map((s) => (
          <button
            key={s.id}
            onClick={() => setEditingSection(s.id === editingSection ? null : s.id)}
            title={`${s.label} · ${formatShowTime(s.start, comma)} – ${formatShowTime(s.end, comma)}`}
            className={`absolute top-0 h-full overflow-hidden border-r border-border/70 px-1 text-left text-[9px] uppercase tracking-[0.16em] text-muted-foreground ${
              SECTION_TINT[s.type]
            } ${s.id === editingSection ? "ring-1 ring-accent" : ""}`}
            style={{ left: pct(s.start), width: `${((s.end - s.start) / span) * 100}%` }}
          >
            <span className="truncate">{s.label}</span>
          </button>
        ))}
        {sections.length === 0 && (
          <span className="pointer-events-none absolute left-1.5 top-0.5 text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70">
            {t("timeline.sections")}
          </span>
        )}
      </div>

      {/* MARKERS — thin lines with a compact label; never over the waveform. */}
      <div className="relative mt-1 h-5">
        {markers.map((m) => (
          <div key={m.id} className="absolute top-0 h-full" style={{ left: pct(m.time) }}>
            <div className={`absolute left-0 top-0 h-full w-px ${MARKER_TINT[m.type]}`} />
            <button
              onClick={() => onSeek(m.time)}
              onDoubleClick={() => setEditingMarker(m.id === editingMarker ? null : m.id)}
              title={`${m.label} · ${formatShowTime(m.time, comma)}`}
              aria-label={`${t("timeline.marker")}: ${m.label}`}
              className={`ml-0.5 max-w-28 truncate rounded-sm border border-border bg-panel px-1 text-[9px] uppercase tracking-[0.14em] hover:border-accent ${
                m.id === editingMarker ? "border-accent text-accent" : "text-muted-foreground"
              }`}
            >
              {m.label}
            </button>
          </div>
        ))}
      </div>

      {marker && (
        <div className="absolute right-0 top-5 z-30 w-64 space-y-2 rounded-md border border-border bg-panel p-2 shadow-lg">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <span>{t("timeline.editMarker")}</span>
            <button onClick={() => setEditingMarker(null)} aria-label={t("common.close")}>
              <X className="size-3.5" />
            </button>
          </div>
          <input
            value={marker.label}
            onChange={(e) => onPatchMarker(marker.id, { label: e.target.value })}
            className="studio-input w-full text-xs"
            aria-label={t("timeline.markerLabel")}
          />
          <div className="flex items-center gap-2">
            <input
              type="number"
              step={0.1}
              value={marker.time}
              onChange={(e) => onPatchMarker(marker.id, { time: Number(e.target.value) })}
              className="studio-input w-24 font-mono text-xs"
              aria-label={t("timeline.markerTime")}
            />
            <select
              value={marker.type}
              onChange={(e) => onPatchMarker(marker.id, { type: e.target.value as TimelineMarkerType })}
              className="studio-input flex-1 text-xs"
              aria-label={t("timeline.markerType")}
            >
              {MARKER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`timeline.markerType.${type}` as "timeline.markerType.GENERAL")}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                onRemoveMarker(marker.id);
                setEditingMarker(null);
              }}
              className="control-btn text-destructive"
              aria-label={t("common.delete")}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {section && (
        <div className="absolute left-0 top-5 z-30 w-72 space-y-2 rounded-md border border-border bg-panel p-2 shadow-lg">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <span>{t("timeline.editSection")}</span>
            <button onClick={() => setEditingSection(null)} aria-label={t("common.close")}>
              <X className="size-3.5" />
            </button>
          </div>
          <input
            value={section.label}
            onChange={(e) => onPatchSection(section.id, { label: e.target.value })}
            className="studio-input w-full text-xs"
            aria-label={t("timeline.sectionLabel")}
          />
          <div className="flex items-center gap-2">
            <input
              type="number"
              step={0.5}
              value={section.start}
              onChange={(e) => onPatchSection(section.id, { start: Number(e.target.value) })}
              className="studio-input w-20 font-mono text-xs"
              aria-label={t("timeline.start")}
            />
            <input
              type="number"
              step={0.5}
              value={section.end}
              onChange={(e) => onPatchSection(section.id, { end: Number(e.target.value) })}
              className="studio-input w-20 font-mono text-xs"
              aria-label={t("timeline.end")}
            />
            <select
              value={section.type}
              onChange={(e) => onPatchSection(section.id, { type: e.target.value as MusicSectionType })}
              className="studio-input flex-1 text-xs"
              aria-label={t("timeline.sectionType")}
            >
              {MUSIC_SECTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                onRemoveSection(section.id);
                setEditingSection(null);
              }}
              className="control-btn text-destructive"
              aria-label={t("common.delete")}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
