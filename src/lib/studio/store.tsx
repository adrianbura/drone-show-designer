/**
 * Studio store — the controller layer between UI and the pure show core.
 *
 * Dependency direction: UI -> store -> show core -> pure engines. No flight
 * planning maths lives in this file or above it; everything here is delegation
 * plus memoisation of pure engine calls.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { createDefaultProject } from "../show/defaultProject";
import { generatePoints, makeFormation } from "../show/formations";
import { buildShowPlan, samplesAt, sampleTrajectorySet, DEFAULT_SAMPLE_RATE } from "../show/trajectory";
import type { ShowPlan, TrajectorySample, TrajectorySet } from "../show/trajectory";
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
import { useShowClock, type PlaybackSpeed } from "./clock";

interface StudioContextValue {
  project: ShowProject;
  plan: ShowPlan;
  trajectorySet: TrajectorySet;
  sampleRate: number;
  setSampleRate: (hz: number) => void;
  safety: SafetyReport;
  beatGrid: BeatGrid;
  /** Canonical show duration — always showDuration(project). */
  duration: number;
  time: number;
  playing: boolean;
  speed: PlaybackSpeed;
  loop: boolean;
  selectedClipId: string | null;
  /** Live sample of every drone at show time t (continuous, O(drones)). */
  samplesAtTime: (t: number) => TrajectorySample[];
  setTime: (t: number) => void;
  togglePlay: () => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  setSpeed: (s: PlaybackSpeed) => void;
  setLoop: (loop: boolean) => void;
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
  const [selectedClipId, setSelectedClipId] = useState<string | null>("c-1");
  const [sampleRate, setSampleRate] = useState<number>(DEFAULT_SAMPLE_RATE);

  // Pure engine pipeline: formations -> assignment -> planning -> sampling -> safety.
  const plan = useMemo(() => buildShowPlan(project), [project]);
  const trajectorySet = useMemo(() => sampleTrajectorySet(plan, { sampleRate }), [plan, sampleRate]);
  const safety = useMemo(
    () => validateShow(project, trajectorySet, plan.drones),
    [project, trajectorySet, plan.drones],
  );
  const beatGrid = useMemo(() => buildBeatGrid(project.audio), [project.audio]);

  // Canonical duration — NEVER project.audio.duration.
  const duration = useMemo(() => Math.max(showDuration(project), 1), [project]);
  const clock = useShowClock(duration);

  const samplesAtTime = useCallback((t: number) => samplesAt(plan, t), [plan]);

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
      const created = makeFormation(
        id,
        label.charAt(0).toUpperCase() + label.slice(1),
        kind,
        project.droneCount,
        project.area,
        params,
      );
      setProject((p) => ({ ...p, formations: [...p.formations, created] }));
      return created;
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
        phase: "SHOW",
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
      plan,
      trajectorySet,
      sampleRate,
      setSampleRate,
      safety,
      beatGrid,
      duration,
      time: clock.time,
      playing: clock.playing,
      speed: clock.speed,
      loop: clock.loop,
      selectedClipId,
      samplesAtTime,
      setTime: clock.seek,
      togglePlay: clock.toggle,
      play: clock.play,
      pause: clock.pause,
      stop: clock.stop,
      setSpeed: clock.setSpeed,
      setLoop: clock.setLoop,
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
      plan,
      trajectorySet,
      sampleRate,
      safety,
      beatGrid,
      duration,
      clock,
      selectedClipId,
      samplesAtTime,
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
