import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import Inspector from "@/components/studio/Inspector";
import LeftPanel from "@/components/studio/LeftPanel";
import Timeline from "@/components/studio/Timeline";
import TopBar from "@/components/studio/TopBar";
import { I18nProvider } from "@/i18n";
import { LibraryProvider } from "@/lib/library/provider";
import { StudioProvider } from "@/lib/studio/store";

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

function TimelineDock() {
  const [desired, setDesired] = useState(DOCK_MIN);
  const [manual, setManual] = useState<number | null>(null);
  const dragRef = useRef<{ y: number; height: number } | null>(null);

  const maxHeight = () =>
    typeof window === "undefined" ? 520 : Math.max(DOCK_MIN, Math.round(window.innerHeight * 0.6));
  const height = Math.min(Math.max(manual ?? desired, DOCK_MIN), maxHeight());

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
        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-[300px] shrink-0 border-r border-border bg-panel lg:block">
            <LeftPanel />
          </aside>
          <div className="relative min-w-0 flex-1 bg-surface-sunken">
            <ClientOnly fallback={<ViewportFallback />}>
              <Suspense fallback={<ViewportFallback />}>
                <Viewport3D />
              </Suspense>
            </ClientOnly>
            <div className="pointer-events-none absolute left-4 top-4 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              show frame · metres · +Y up
            </div>
          </div>
          <aside className="hidden w-[320px] shrink-0 border-l border-border bg-panel xl:block">
            <Inspector />
          </aside>
        </div>
        <TimelineDock />
        <div className="max-h-[45vh] overflow-y-auto border-t border-border lg:hidden">
          <LeftPanel />
          <Inspector />
        </div>
      </main>
    </StudioProvider>
    </LibraryProvider>
    </I18nProvider>
  );
}
