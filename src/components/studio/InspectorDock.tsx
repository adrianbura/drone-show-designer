/**
 * NARROW-WINDOW INSPECTOR DOCK (presentation only).
 *
 * Below the xl breakpoint the docked Inspector aside is not rendered visibly, so
 * a focus request had no visible destination: the stacked fallback copy sat in a
 * few-pixel-tall scroll area below the timeline and `scrollIntoView` there was
 * invisible to the operator.
 *
 * This dock registers itself with the ONE focus authority as a visible host for
 * narrow layouts. When a command asks for a surface it opens as a sheet and
 * hands the request straight to the Inspector inside it, so the same command id
 * completes visibly at 1366, 1024 and 900 px. It contains no command logic and
 * mutates nothing.
 */
import { useEffect, useState } from "react";

import Inspector from "@/components/studio/Inspector";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { registerInspectorHost, type StudioFocusRequest } from "@/lib/studio/inspectorFocus";

/** The docked Inspector aside becomes visible at Tailwind's xl breakpoint. */
export const XL = 1280;

/** Priorities of the two command continuations — docked aside always wins. */
export const DOCKED_INSPECTOR_PRIORITY = 20;
export const INSPECTOR_DOCK_PRIORITY = 0;

/** Pure: this dock is a valid visible continuation only below xl. */
export function isNarrowLayout(width: number): boolean {
  return width < XL;
}

export default function InspectorDock() {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<StudioFocusRequest | null>(null);

  useEffect(
    () =>
      registerInspectorHost({
        priority: INSPECTOR_DOCK_PRIORITY, // the docked desktop Inspector wins whenever it is visible
        isVisible: () => typeof window !== "undefined" && isNarrowLayout(window.innerWidth),
        reveal: (r) => {
          setRequest(r);
          setOpen(true);
        },
      }),
    [],
  );


  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        data-testid="inspector-dock"
        className="flex w-full max-w-[380px] flex-col gap-0 overflow-y-auto bg-panel p-0 sm:max-w-[380px]"
      >
        <SheetHeader className="border-b border-border px-4 py-3 text-left">
          <SheetTitle className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Inspector
          </SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1">{open ? <Inspector focusRequest={request} /> : null}</div>
      </SheetContent>
    </Sheet>
  );
}
