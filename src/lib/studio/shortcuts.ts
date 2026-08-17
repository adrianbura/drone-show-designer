/**
 * Playback / editing keyboard shortcuts.
 *
 * Pure resolution so it is testable without a DOM: an event descriptor maps to a
 * semantic action, and text entry ALWAYS wins — typing a space in a name field
 * must never start playback.
 */
export type ShortcutAction =
  | { readonly type: "togglePlay" }
  | { readonly type: "seek"; readonly delta: number }
  | { readonly type: "seekStart" }
  | { readonly type: "seekEnd" }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | { readonly type: "clearSelection" };

export interface ShortcutTarget {
  readonly tagName?: string;
  readonly isContentEditable?: boolean;
  readonly type?: string;
}

export interface ShortcutEventLike {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly repeat?: boolean;
  readonly target?: ShortcutTarget | null;
}

const TEXT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** True when the event originates from a field the user is typing into. */
export function isTextEntryTarget(target: ShortcutTarget | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return TEXT_TAGS.has((target.tagName ?? "").toUpperCase());
}

export function resolveShortcut(event: ShortcutEventLike): ShortcutAction | null {
  if (isTextEntryTarget(event.target)) return null;
  const mod = event.ctrlKey === true || event.metaKey === true;

  if (mod) {
    const key = event.key.toLowerCase();
    if (key === "z") return event.shiftKey ? { type: "redo" } : { type: "undo" };
    if (key === "y") return { type: "redo" };
    return null;
  }

  switch (event.key) {
    case " ":
    case "Spacebar":
      return { type: "togglePlay" };
    case "k":
    case "K":
      return { type: "togglePlay" };
    case "ArrowRight":
      return { type: "seek", delta: event.shiftKey ? 5 : 1 };
    case "ArrowLeft":
      return { type: "seek", delta: event.shiftKey ? -5 : -1 };
    case "Home":
      return { type: "seekStart" };
    case "End":
      return { type: "seekEnd" };
    case "Escape":
      return { type: "clearSelection" };
    default:
      return null;
  }
}

/** Shortcut rows for the in-app help panel; labels come from the dictionary. */
export const SHORTCUT_HELP: readonly { readonly keys: string; readonly labelKey: string }[] = [
  { keys: "Space / K", labelKey: "shortcuts.togglePlay" },
  { keys: "← / →", labelKey: "shortcuts.seek1" },
  { keys: "Shift + ← / →", labelKey: "shortcuts.seek5" },
  { keys: "Home / End", labelKey: "shortcuts.seekEnds" },
  { keys: "Ctrl/⌘ + Z", labelKey: "shortcuts.undo" },
  { keys: "Ctrl/⌘ + Shift + Z", labelKey: "shortcuts.redo" },
  { keys: "Esc", labelKey: "shortcuts.clear" },
];
