/**
 * CONTEXT MENU OPENING-GESTURE SUPPRESSION (presentation logic, no time window).
 *
 * A right-click / long-press opens the menu directly under the cursor, so the
 * RELEASE of that same pointer sequence lands on whichever item ended up there.
 * Radix activates menu items on pointerup, so that release would silently invoke
 * Rename/Delete and close the menu again.
 *
 * We suppress EXACTLY ONE event: the release that belongs to the opening
 * sequence (and the click it synthesizes). Any new pointerdown — an intentional
 * left click on an item, including inside a submenu — ends the suppression
 * immediately, so nothing is ever blocked for a duration. Keyboard activation
 * produces no pointer events and is never affected.
 */

export type GesturePhase = "IDLE" | "AWAITING_RELEASE" | "AWAITING_CLICK";

export interface OpeningGestureState {
  readonly phase: GesturePhase;
}

export const IDLE_GESTURE: OpeningGestureState = { phase: "IDLE" };

/** Only a right button or a touch/pen contact can open a context menu. */
export function opensContextMenu(event: { button: number; pointerType?: string }): boolean {
  return event.button === 2 || event.pointerType === "touch" || event.pointerType === "pen";
}

export function armOpeningGesture(event: {
  button: number;
  pointerType?: string;
}): OpeningGestureState {
  return opensContextMenu(event) ? { phase: "AWAITING_RELEASE" } : IDLE_GESTURE;
}

/** Any fresh pointerdown is an intentional gesture: stop suppressing. */
export function beginNewPointer(): OpeningGestureState {
  return IDLE_GESTURE;
}

/** The release is suppressed only while it is the opening one AND lands in a menu. */
export function handlePointerUp(
  state: OpeningGestureState,
  event: { insideMenu: boolean },
): { state: OpeningGestureState; suppress: boolean } {
  if (state.phase === "AWAITING_RELEASE" && event.insideMenu) {
    return { state: { phase: "AWAITING_CLICK" }, suppress: true };
  }
  return { state: IDLE_GESTURE, suppress: false };
}

export function handleClick(state: OpeningGestureState): {
  state: OpeningGestureState;
  suppress: boolean;
} {
  return state.phase === "AWAITING_CLICK"
    ? { state: IDLE_GESTURE, suppress: true }
    : { state: IDLE_GESTURE, suppress: false };
}

/** True when the event landed inside any open Radix menu surface (incl. submenus). */
export function isInsideMenu(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  return el?.closest('[role="menu"],[role="menuitem"],[data-radix-menu-content]') != null;
}

/**
 * Installs document-level capture listeners for one opening gesture. Document
 * level is required because Radix renders submenus in separate portals, so
 * component-scoped handlers cannot observe every pointerdown reliably.
 */
export function suppressOpeningRelease(doc: Document = document): () => void {
  let state: OpeningGestureState = { phase: "AWAITING_RELEASE" };
  let disposed = false;

  const onPointerDown = () => {
    state = beginNewPointer();
    dispose();
  };
  const onPointerUp = (e: Event) => {
    const next = handlePointerUp(state, { insideMenu: isInsideMenu(e.target) });
    state = next.state;
    if (next.suppress) {
      e.preventDefault();
      e.stopPropagation();
    }
    doc.removeEventListener("pointerup", onPointerUp, true);
    if (state.phase !== "AWAITING_CLICK") dispose();
  };
  const onClick = (e: Event) => {
    const next = handleClick(state);
    state = next.state;
    if (next.suppress) {
      e.preventDefault();
      e.stopPropagation();
    }
    dispose();
  };

  function dispose() {
    if (disposed) return;
    disposed = true;
    doc.removeEventListener("pointerdown", onPointerDown, true);
    doc.removeEventListener("pointerup", onPointerUp, true);
    doc.removeEventListener("click", onClick, true);
  }

  doc.addEventListener("pointerdown", onPointerDown, true);
  doc.addEventListener("pointerup", onPointerUp, true);
  doc.addEventListener("click", onClick, true);
  return dispose;
}
