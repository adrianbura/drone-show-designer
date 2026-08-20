/**
 * AUDIENCE VIEW DIAGNOSTIC STATE — presentation only.
 *
 * Holds the representative viewpoint parameters plus the two viewport display
 * toggles (audience camera, depth guides). It is intentionally SEPARATE from the
 * show store: nothing here can reach project geometry, planning or export.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import {
  AUDIENCE_VIEWPOINT_DEFAULTS,
  resolveAudienceView,
  type AudiencePreviewMode,
  type AudienceViewpointParams,
} from "@/lib/show/diagnostics";
import type { AudienceView } from "@/lib/show/diagnostics/audienceProjection";

interface AudienceViewContextValue {
  params: AudienceViewpointParams;
  setParam: (key: keyof AudienceViewpointParams, value: number) => void;
  resetParams: () => void;
  /** Canonical view derived from the parameters — single source for the analyzer. */
  view: AudienceView;
  previewMode: AudiencePreviewMode;
  setPreviewMode: (mode: AudiencePreviewMode) => void;
  /** CAMERA ONLY. Never touches project coordinates or selection. */
  audienceCamera: boolean;
  setAudienceCamera: (v: boolean) => void;
  showDepth: boolean;
  setShowDepth: (v: boolean) => void;
}

const AudienceViewContext = createContext<AudienceViewContextValue | null>(null);

export function AudienceViewProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useState<AudienceViewpointParams>(AUDIENCE_VIEWPOINT_DEFAULTS);
  const [previewMode, setPreviewMode] = useState<AudiencePreviewMode>("OVERLAY");
  const [audienceCamera, setAudienceCamera] = useState(false);
  const [showDepth, setShowDepth] = useState(false);

  const value = useMemo<AudienceViewContextValue>(
    () => ({
      params,
      setParam: (key, v) =>
        setParams((prev) => ({ ...prev, [key]: Number.isFinite(v) ? v : prev[key] })),
      resetParams: () => setParams(AUDIENCE_VIEWPOINT_DEFAULTS),
      view: resolveAudienceView(params),
      previewMode,
      setPreviewMode,
      audienceCamera,
      setAudienceCamera,
      showDepth,
      setShowDepth,
    }),
    [params, previewMode, audienceCamera, showDepth],
  );

  return <AudienceViewContext.Provider value={value}>{children}</AudienceViewContext.Provider>;
}

export function useAudienceView(): AudienceViewContextValue {
  const ctx = useContext(AudienceViewContext);
  if (!ctx) throw new Error("useAudienceView must be used inside AudienceViewProvider");
  return ctx;
}
