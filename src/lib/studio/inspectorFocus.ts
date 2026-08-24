/**
 * STUDIO SURFACE FOCUS AUTHORITY (UI navigation only).
 *
 * ONE canonical routing path from any invoking surface (timeline context menu,
 * double-click, Inspector quick actions, later Ctrl+K) to the ONE existing panel
 * that already edits that thing. Callers never call setTab / setExpandedGroup /
 * scrollIntoView themselves.
 *
 * Focusing is navigation: it never mutates the project and never creates an
 * authored history revision.
 */

export type InspectorPanelId =
  | "clip-inspector"
  | "scene-panel"
  | "dynamic-panel"
  | "lighting-panel"
  | "transition-panel"
  | "essp-panel"
  | "forensics-panel";

export type InspectorGroupId = "AUTHORING" | "VALIDATE" | "ADVANCED";

/** Which Inspector group owns each panel. */
export const INSPECTOR_PANEL_GROUP: Readonly<Record<InspectorPanelId, InspectorGroupId>> = {
  "clip-inspector": "AUTHORING",
  "scene-panel": "AUTHORING",
  "dynamic-panel": "AUTHORING",
  "lighting-panel": "AUTHORING",
  "transition-panel": "AUTHORING",
  "essp-panel": "AUTHORING",
  "forensics-panel": "ADVANCED",
};

/**
 * Domain-level surfaces a command can ask for. Command callbacks speak this
 * language; the mapping to a concrete panel lives here, in one place.
 */
export type StudioSurfaceId =
  | "CLIP"
  | "SCENE"
  | "FORMATION"
  | "DYNAMIC"
  | "LIGHTING"
  | "TRANSITION"
  | "REFERENCE"
  | "VALIDATION";

export const STUDIO_SURFACE_PANEL: Readonly<Record<StudioSurfaceId, InspectorPanelId>> = {
  CLIP: "clip-inspector",
  SCENE: "scene-panel",
  FORMATION: "clip-inspector",
  DYNAMIC: "dynamic-panel",
  LIGHTING: "lighting-panel",
  TRANSITION: "transition-panel",
  REFERENCE: "essp-panel",
  VALIDATION: "forensics-panel",
};

export interface StudioFocusRequest {
  readonly surface: StudioSurfaceId;
  readonly panel: InspectorPanelId;
  readonly group: InspectorGroupId;
  readonly clipId?: string;
  /** Monotonic — a repeated request for the same panel still re-reveals it. */
  readonly requestId: number;
}

const EVENT = "studio:focus-inspector-panel";
let counter = 0;

/** Pure resolution — usable by tests and by a future command palette. */
export function resolveStudioFocus(input: {
  surface: StudioSurfaceId;
  clipId?: string;
  requestId?: number;
}): StudioFocusRequest {
  const panel = STUDIO_SURFACE_PANEL[input.surface];
  return {
    surface: input.surface,
    panel,
    group: INSPECTOR_PANEL_GROUP[panel],
    ...(input.clipId ? { clipId: input.clipId } : {}),
    requestId: input.requestId ?? ++counter,
  };
}

export function focusStudioSurface(input: {
  surface: StudioSurfaceId;
  clipId?: string;
}): StudioFocusRequest {
  const request = resolveStudioFocus(input);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<StudioFocusRequest>(EVENT, { detail: request }));
  }
  return request;
}

export function onInspectorFocus(handler: (request: StudioFocusRequest) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => handler((e as CustomEvent<StudioFocusRequest>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
