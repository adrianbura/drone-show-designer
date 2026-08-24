/**
 * MENU SURFACE DETECTION (presentation only).
 *
 * Radix renders menu content in a portal, but that content stays a REACT child
 * of whatever wraps the trigger. React synthetic events therefore bubble from
 * menu items into the owning surface's pointer handlers. Editing surfaces that
 * take pointer capture (the timeline track) must ignore those events, otherwise
 * the capture retargets the following pointerup/click away from the menu item
 * and Radix never activates it.
 *
 * This is pure DOM inspection: no timers, no global listeners, no suppression.
 */
export function isInsideMenuSurface(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  return (
    el?.closest('[role="menu"],[role="menuitem"],[data-radix-menu-content],[data-radix-popper-content-wrapper]') !=
    null
  );
}
