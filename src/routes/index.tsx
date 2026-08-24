import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import Inspector from "@/components/studio/Inspector";
import InspectorDock from "@/components/studio/InspectorDock";
import LeftPanel from "@/components/studio/LeftPanel";
import Timeline from "@/components/studio/Timeline";
import TopBar from "@/components/studio/TopBar";
import NoShowOpen from "@/components/studio/NoShowOpen";
import { I18nProvider } from "@/i18n";
import { LibraryProvider } from "@/lib/library/provider";
import { StudioProvider, useStudio } from "@/lib/studio/store";

// three.js touches browser APIs at import time — keep it out of the SSR graph.
const Viewport3D = lazy(() => import("@/components/studio/Viewport3D"));

const TITLE = "Drone Show Studio — Design, Simulate & Validate Drone Light Shows";
const DESCRIPTION =
  "Professional studio for designing synchronized drone light shows: formations, choreography timeline, real-time 3D preview, safety validation and Skybrush/PX4-ready export.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
    ],
  }),
  component: StudioPage,
});

/**
 * TIMELINE DOCK — presentation-only vertical sizing. The timeline reports the
 * height its current content needs (header wrap + clip lanes + tracks) and the
 * dock grows to it, clamped to the window. Dragging the top edge overrides the
 * automatic height until the operator double-clicks the handle to release it.
 */
const DOCK_MIN = 176;
const VIEWPORT_MIN = 200;


function TimelineDock() {
  const [desired, setDesired] = useState(DOCK_MIN);
  const [manual, setManual] = useState<number | null>(null);
  const dragRef = useRef<{ y: number; height: number } | null>(null);

  // The 3D viewport must never be squeezed out: cap the dock so at least
  // VIEWPORT_MIN px of viewport (plus the top bar) always remain visible.
  const maxHeight = () => {
    if (typeof window === "undefined") return 520;
    const h = window.innerHeight;
    const narrow = window.innerWidth < 1024;
    // The stacked panels below live in their own scrollable region, so only the
    // top bar and the 3D viewport need a vertical reserve here.
    const reserve = 64 + VIEWPORT_MIN;
    return Math.max(DOCK_MIN, Math.min(Math.round(h * (narrow ? 0.45 : 0.6)), h - reserve));
  };

  const height = Math.min(Math.max(manual ?? desired, DOCK_MIN), maxHeight());


  // Re-clamp when the window (or preview pane) is resized.
  const [, bumpResize] = useState(0);
  useEffect(() => {
    const onResize = () => bumpResize((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {

    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      setManual(Math.min(Math.max(drag.height + (drag.y - e.clientY), DOCK_MIN), maxHeight()));
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  return (
    <div className="shrink-0 border-t border-border" style={{ height }}>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize timeline"
        title="Drag to resize · double-click to auto-fit"
        onPointerDown={(e) => {
          e.preventDefault();
          dragRef.current = { y: e.clientY, height };
        }}
        onDoubleClick={() => setManual(null)}
        className="h-1.5 w-full cursor-row-resize bg-border/40 hover:bg-accent/60"
      />
      <div className="h-[calc(100%-0.375rem)]">
        <Timeline onDesiredHeightChange={setDesired} />
      </div>
    </div>
  );
}

function ViewportFallback() {
  return (
    <div className="flex h-full items-center justify-center bg-surface-sunken">
      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
        initializing 3D viewport…
      </p>
    </div>
  );
}

function StudioPage() {
  return (
    <I18nProvider>
    <LibraryProvider>
    <StudioProvider>
      <main className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
        <h1 className="sr-only">Drone Show Studio — drone light show design and simulation</h1>
        <TopBar />
        <StudioWorkspace />
      </main>
    </StudioProvider>
    </LibraryProvider>
    </I18nProvider>
  );
}

/**
 * DOCUMENT-GATED WORKSPACE. With no document open the editing surfaces are not
 * rendered at all — no viewport, no timeline, no panels — so nothing from a
 * closed show can be seen, played or acted on.
 */
function StudioWorkspace() {
  const { documentOpen } = useStudio();
  if (!documentOpen) return <NoShowOpen />;
  return (
    <>
        <div className="flex min-h-[200px] flex-1">
          <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-r border-border bg-panel lg:block">
            <LeftPanel />
          </aside>
          <div className="relative min-h-[200px] min-w-0 flex-1 bg-surface-sunken">
            <ClientOnly fallback={<ViewportFallback />}>
              <Suspense fallback={<ViewportFallback />}>
                <Viewport3D />
              </Suspense>
            </ClientOnly>
            <div className="pointer-events-none absolute left-4 top-4 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              show frame · metres · +Y up
            </div>
          </div>
          <aside className="hidden w-[320px] shrink-0 overflow-y-auto border-l border-border bg-panel xl:block">
            <Inspector />
          </aside>
        </div>
        <TimelineDock />
        {/*
          NARROW-WINDOW PANEL FALLBACK. The Inspector (which owns the Lighting
          panel) only docks at xl, so it must stay reachable below that width —
          the left panel only needs the fallback below lg. Internally scrollable
          so the 3D viewport and timeline never lose height. Command-driven
          reveals below xl open `InspectorDock` instead, which is visible.
        */}
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border xl:hidden">
          <div className="lg:hidden">
            <LeftPanel />
          </div>
          <Inspector />
        </div>
        <InspectorDock />
    </>

  );
}
