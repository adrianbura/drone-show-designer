/**
 * INSPECTOR FOCUS CHANNEL.
 *
 * A command invoked from the timeline must be able to open the ONE existing
 * panel that already edits that thing — without the timeline importing the
 * Inspector, and without duplicating any editor. The channel carries a request
 * ("focus this panel"); the Inspector remains the only component that decides
 * how to reveal it (switch group, scroll into view).
 *
 * Focusing is navigation: it never mutates the project.
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

const EVENT = "studio:focus-inspector-panel";

export function requestInspectorFocus(panel: InspectorPanelId): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<InspectorPanelId>(EVENT, { detail: panel }));
}

export function onInspectorFocus(handler: (panel: InspectorPanelId) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => handler((e as CustomEvent<InspectorPanelId>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
