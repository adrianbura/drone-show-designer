/**
 * TIMELINE MARKERS + MUSIC SECTIONS (project-owned editor metadata).
 *
 * These are AUTHORING annotations, not flight data: they are never exported to
 * a machine-facing format, never influence trajectory planning, safety
 * validation or the analysis revision. They are persisted with the project so a
 * reopened show keeps the operator's musical map.
 */

export const MARKER_TYPES = ["GENERAL", "MUSIC", "CHOREOGRAPHY"] as const;
export type TimelineMarkerType = (typeof MARKER_TYPES)[number];

export interface TimelineMarker {
  readonly id: string;
  /** Show time in seconds (may be negative during pre-show). */
  readonly time: number;
  readonly label: string;
  readonly type: TimelineMarkerType;
}

export const MUSIC_SECTION_TYPES = [
  "INTRO",
  "VERSE",
  "BUILD",
  "DROP",
  "BREAK",
  "FINALE",
  "CUSTOM",
] as const;
export type MusicSectionType = (typeof MUSIC_SECTION_TYPES)[number];

export interface MusicSection {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly label: string;
  readonly type: MusicSectionType;
}

function round(t: number): number {
  return Math.round((Number.isFinite(t) ? t : 0) * 1000) / 1000;
}

export function createMarker(input: {
  id: string;
  time: number;
  label?: string;
  type?: TimelineMarkerType;
}): TimelineMarker {
  return {
    id: input.id,
    time: round(input.time),
    label: (input.label ?? "").trim() || "Marker",
    type: input.type ?? "GENERAL",
  };
}

export function createSection(input: {
  id: string;
  start: number;
  end: number;
  label?: string;
  type?: MusicSectionType;
}): MusicSection {
  const a = round(input.start);
  const b = round(input.end);
  return {
    id: input.id,
    start: Math.min(a, b),
    end: Math.max(a, b),
    label: (input.label ?? "").trim() || "Section",
    type: input.type ?? "CUSTOM",
  };
}

export function sortMarkers(markers: readonly TimelineMarker[]): TimelineMarker[] {
  return [...markers].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

export function sortSections(sections: readonly MusicSection[]): MusicSection[] {
  return [...sections].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

/** Defensive normalisation of untrusted (loaded) data. */
export function sanitizeMarkers(input: unknown): TimelineMarker[] {
  if (!Array.isArray(input)) return [];
  const out: TimelineMarker[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Partial<TimelineMarker>;
    if (typeof m.id !== "string" || typeof m.time !== "number" || !Number.isFinite(m.time)) continue;
    out.push(
      createMarker({
        id: m.id,
        time: m.time,
        label: typeof m.label === "string" ? m.label : "",
        type: MARKER_TYPES.includes(m.type as TimelineMarkerType) ? (m.type as TimelineMarkerType) : "GENERAL",
      }),
    );
  }
  return sortMarkers(out);
}

export function sanitizeSections(input: unknown): MusicSection[] {
  if (!Array.isArray(input)) return [];
  const out: MusicSection[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Partial<MusicSection>;
    if (typeof s.id !== "string") continue;
    if (typeof s.start !== "number" || typeof s.end !== "number") continue;
    if (!Number.isFinite(s.start) || !Number.isFinite(s.end)) continue;
    out.push(
      createSection({
        id: s.id,
        start: s.start,
        end: s.end,
        label: typeof s.label === "string" ? s.label : "",
        type: MUSIC_SECTION_TYPES.includes(s.type as MusicSectionType)
          ? (s.type as MusicSectionType)
          : "CUSTOM",
      }),
    );
  }
  return sortSections(out);
}

export function markerTimes(markers: readonly TimelineMarker[]): number[] {
  return sortMarkers(markers).map((m) => m.time);
}
