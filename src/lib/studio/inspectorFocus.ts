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
  | "text-panel"
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
  "text-panel": "AUTHORING",
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
  | "TEXT"
  | "VALIDATION";

export const STUDIO_SURFACE_PANEL: Readonly<Record<StudioSurfaceId, InspectorPanelId>> = {
  CLIP: "clip-inspector",
  SCENE: "scene-panel",
  FORMATION: "clip-inspector",
  DYNAMIC: "dynamic-panel",
  LIGHTING: "lighting-panel",
  TRANSITION: "transition-panel",
  REFERENCE: "essp-panel",
  TEXT: "text-panel",
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

/**
 * VISIBLE SURFACE REGISTRATION. Several presentations of the same semantic
 * surfaces can be mounted at once (docked Inspector at xl, narrow dock below
 * it). Each presentation registers itself with a visibility predicate; a focus
 * request is revealed by the highest-priority CURRENTLY VISIBLE host. There is
 * exactly one authority — responsive presentation only decides HOW to reveal.
 */
export interface InspectorHost {
  /** Higher wins when several hosts are visible. */
  readonly priority: number;
  isVisible(): boolean;
  reveal(request: StudioFocusRequest): void;
}

const hosts = new Set<InspectorHost>();

export function registerInspectorHost(host: InspectorHost): () => void {
  hosts.add(host);
  return () => hosts.delete(host);
}

/** Pure selection — exported for tests. */
export function selectVisibleHost(candidates: Iterable<InspectorHost>): InspectorHost | null {
  let best: InspectorHost | null = null;
  for (const h of candidates) {
    if (!h.isVisible()) continue;
    if (!best || h.priority > best.priority) best = h;
  }
  return best;
}

export function focusStudioSurface(input: {
  surface: StudioSurfaceId;
  clipId?: string;
}): StudioFocusRequest {
  const request = resolveStudioFocus(input);
  const host = selectVisibleHost(hosts);
  if (host) host.reveal(request);
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

