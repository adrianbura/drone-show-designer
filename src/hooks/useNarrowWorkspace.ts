import { useEffect, useState } from "react";

/** Tailwind `xl` — the width at which the docked Inspector column appears. */
const XL_BREAKPOINT = 1280;
/** Tailwind `lg` — the width at which the left panel column appears. */
const LG_BREAKPOINT = 1024;

function useUnder(breakpoint: number): boolean {
  // Starts false so server render and first paint agree, and so the stacked
  // fallback copies are never mounted alongside the docked columns.
  const [under, setUnder] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const sync = () => setUnder(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, [breakpoint]);
  return under;
}

/** True when the docked Inspector column is not shown (below `xl`). */
export function useInspectorStacked(): boolean {
  return useUnder(XL_BREAKPOINT);
}

/** True when the docked left panel column is not shown (below `lg`). */
export function useLeftPanelStacked(): boolean {
  return useUnder(LG_BREAKPOINT);
}
