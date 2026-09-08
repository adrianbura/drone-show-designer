/**
 * EVERYDAY WORKSPACE SECTION NAVIGATION (UI only).
 *
 * One tiny authority that lets any everyday surface ask for a collapsible
 * inspector section to be opened and one control inside it to be focused.
 * It carries no project state, mutates nothing and never creates history.
 */

export type WorkspaceSectionId = "VISUALS" | "TRANSFORM" | "COLOUR" | "MOTION" | "STATES";

/** Which section owns each everyday control test id. */
const CONTROL_SECTION: Readonly<Record<string, WorkspaceSectionId>> = {
  "transform-section": "TRANSFORM",
  "effect-stack-presets": "COLOUR",
  "motion-stack-presets": "MOTION",
  "visual-states": "STATES",
};

export function sectionForControl(controlTestId: string): WorkspaceSectionId {
  return CONTROL_SECTION[controlTestId] ?? "VISUALS";
}

export interface WorkspaceSectionRequest {
  readonly section: WorkspaceSectionId;
  readonly controlTestId?: string;
  /** Monotonic — repeating the same request still re-opens and re-focuses. */
  readonly requestId: number;
}

const EVENT = "studio:focus-workspace-section";
let counter = 0;

export function requestWorkspaceSection(controlTestId: string): WorkspaceSectionRequest {
  const request: WorkspaceSectionRequest = {
    section: sectionForControl(controlTestId),
    controlTestId,
    requestId: ++counter,
  };
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<WorkspaceSectionRequest>(EVENT, { detail: request }));
  }
  return request;
}

export function onWorkspaceSectionRequest(
  handler: (request: WorkspaceSectionRequest) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => handler((e as CustomEvent<WorkspaceSectionRequest>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
