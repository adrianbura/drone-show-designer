import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { createDefaultProject } from "../show/defaultProject";
import { generatePoints, makeFormation } from "../show/formations";
import { resolveShow, type ResolvedClip } from "../show/trajectory";
import { validateShow, type SafetyReport } from "../show/safety";
import { buildBeatGrid, type BeatGrid } from "../show/audio";
import type {
  Formation,
  FormationKind,
  SafetyLimits,
  ShowProject,
  TimelineClip,
} from "../show/types";
import { showDuration } from "../show/types";

interface StudioContextValue {
  project: ShowProject;
  resolved: ResolvedClip[];
  safety: SafetyReport;
  beatGrid: BeatGrid;
  duration: number;
  time: number;
  playing: boolean;
  selectedClipId: string | null;
  setTime: (t: number) => void;
  togglePlay: () => void;
  selectClip: (id: string | null) => void;
  patchProject: (patch: Partial<ShowProject>) => void;
  setDroneCount: (n: number) => void;
  setLimits: (patch: Partial<SafetyLimits>) => void;
  addFormation: (kind: FormationKind, params?: Record<string, number | string>) => Formation;
  updateFormation: (id: string, params: Record<string, number | string>) => void;
  addClip: (formationId: string) => void;
  patchClip: (id: string, patch: Partial<TimelineClip>) => void;
  removeClip: (id: string) => void;
}

const StudioContext = createContext<StudioContextValue | null>(null);

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}-${Date.now().toString(36)}`;

export function StudioProvider({ children }: { children: ReactNode }) {
  // Lazy initializer: keeps module scope free of runtime work (Worker-safe).
  const [project, setProject] = useState<ShowProject>(() => createDefaultProject());
  const [time, setTimeState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>("c-1");

  const resolved = useMemo(() => resolveShow(project), [project]);
  const duration = useMemo(() => Math.max(showDuration(project), 1), [project]);
  const safety = useMemo(() => validateShow(project, resolved, 0.25), [project, resolved]);
  const beatGrid = useMemo(() => buildBeatGrid(project.audio), [project.audio]);

  const raf = useRef<number | null>(null);
  const last = useRef<number>(0);

  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      setTimeState((t) => {
        const next = t + dt;
        return next >= duration ? 0 : next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing, duration]);

  const setTime = useCallback((t: number) => setTimeState(Math.max(0, t)), []);
  const togglePlay = useCallback(() => setPlaying((p) => !p), []);

  const patchProject = useCallback((patch: Partial<ShowProject>) => {
    setProject((p) => ({ ...p, ...patch }));
  }, []);

  const setDroneCount = useCallback((n: number) => {
    const count = Math.max(3, Math.min(500, Math.round(n)));
    setProject((p) => ({
      ...p,
      droneCount: count,
      formations: p.formations.map((f) => ({
        ...f,
        points: generatePoints(f.kind, count, p.area, f.params),
      })),
    }));
  }, []);

  const setLimits = useCallback((patch: Partial<SafetyLimits>) => {
    setProject((p) => ({ ...p, limits: { ...p.limits, ...patch } }));
  }, []);

  const addFormation = useCallback(
    (kind: FormationKind, params: Record<string, number | string> = {}) => {
      const id = nextId("f");
      const label = kind === "text" ? `Text "${params["text"] ?? "SHOW"}"` : kind;
      let created: Formation | null = null;
      setProject((p) => {
        created = makeFormation(
          id,
          label.charAt(0).toUpperCase() + label.slice(1),
          kind,
          p.droneCount,
          p.area,
          params,
        );
        return { ...p, formations: [...p.formations, created] };
      });
      return (
        created ??
        makeFormation(id, label, kind, project.droneCount, project.area, params)
      );
    },
    [project.area, project.droneCount],
  );

  const updateFormation = useCallback((id: string, params: Record<string, number | string>) => {
    setProject((p) => ({
      ...p,
      formations: p.formations.map((f) =>
        f.id === id
          ? {
              ...f,
              params: { ...f.params, ...params },
              points: generatePoints(f.kind, p.droneCount, p.area, { ...f.params, ...params }),
            }
          : f,
      ),
    }));
  }, []);

  const addClip = useCallback((formationId: string) => {
    const id = nextId("c");
    setProject((p) => {
      const end = p.timeline.reduce((m, c) => Math.max(m, c.start + c.transition + c.hold), 0);
      const clip: TimelineClip = {
        id,
        formationId,
        start: end,
        transition: 8,
        hold: 6,
        easing: "minJerk",
        color: [120, 220, 255],
        effect: "solid",
      };
      return { ...p, timeline: [...p.timeline, clip] };
    });
    setSelectedClipId(id);
  }, []);

  const patchClip = useCallback((id: string, patch: Partial<TimelineClip>) => {
    setProject((p) => ({
      ...p,
      timeline: p.timeline.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  }, []);

  const removeClip = useCallback((id: string) => {
    setProject((p) => ({ ...p, timeline: p.timeline.filter((c) => c.id !== id) }));
    setSelectedClipId(null);
  }, []);

  const value = useMemo<StudioContextValue>(
    () => ({
      project,
      resolved,
      safety,
      beatGrid,
      duration,
      time,
      playing,
      selectedClipId,
      setTime,
      togglePlay,
      selectClip: setSelectedClipId,
      patchProject,
      setDroneCount,
      setLimits,
      addFormation,
      updateFormation,
      addClip,
      patchClip,
      removeClip,
    }),
    [
      project,
      resolved,
      safety,
      beatGrid,
      duration,
      time,
      playing,
      selectedClipId,
      setTime,
      togglePlay,
      patchProject,
      setDroneCount,
      setLimits,
      addFormation,
      updateFormation,
      addClip,
      patchClip,
      removeClip,
    ],
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useStudio must be used inside <StudioProvider>");
  return ctx;
}
