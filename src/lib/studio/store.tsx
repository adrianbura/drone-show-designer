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
import {
  defaultFormationName,
  generateSvgFormationPoints,
  importSvgFile,
  makeSvgFormation,
  regenerateSvgFormation,
  resolveSvgParams,
  toSvgFormationError,
  withPlacementWarnings,
  type SvgAsset,
  type SvgFormationError,
  type SvgFormationParams,
  type SvgFormationResult,
} from "../show/svg";
import { useShowClock, type PlaybackSpeed } from "./clock";

/** Draft state of an SVG import, before it is committed as a Formation. */
export interface SvgDraft {
  asset: SvgAsset;
  params: SvgFormationParams;
  /** Null while the current params fail to produce an exact-N point set. */
  result: SvgFormationResult | null;
  error: SvgFormationError | null;
}

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
  /** Imported SVG assets, keyed by asset id (reproducibility + regeneration). */
  svgAssets: Record<string, SvgAsset>;
  svgDraft: SvgDraft | null;
  svgBusy: boolean;
  svgError: SvgFormationError | null;
  importSvg: (file: File) => Promise<void>;
  updateSvgDraft: (patch: Partial<SvgFormationParams>) => void;
  cancelSvgDraft: () => void;
  /** Commits the current draft as an exact-N formation and returns it. */
  commitSvgDraft: (options?: { name?: string; addToTimeline?: boolean }) => Formation | null;
  patchClip: (id: string, patch: Partial<TimelineClip>) => void;
  removeClip: (id: string) => void;
}

const StudioContext = createContext<StudioContextValue | null>(null);

/** Maps a loose param record (UI inputs) onto typed SVG generation params. */
function svgPatchFromRecord(record: Record<string, number | string>): Partial<SvgFormationParams> {
  const patch: Partial<SvgFormationParams> = {};
  const num = (k: keyof SvgFormationParams) => {
    const v = record[k as string];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    return undefined;
  };
  for (const key of [
    "width",
    "height",
    "positionX",
    "altitude",
    "depth",
    "rotation",
    "flattenTolerance",
    "relaxIterations",
    "seed",
    "minPointsPerContour",
    "fillDensity",
  ] as const) {
    const v = num(key);
    if (v !== undefined) patch[key] = v;
  }
  if (record["mode"] === "outline" || record["mode"] === "fill") patch.mode = record["mode"];
  if (typeof record["lockAspect"] === "number") patch.lockAspect = record["lockAspect"] !== 0;
  return patch;
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}-${Date.now().toString(36)}`;

export function StudioProvider({ children }: { children: ReactNode }) {
  // Lazy initializer: keeps module scope free of runtime work (Worker-safe).
  const [project, setProject] = useState<ShowProject>(() => createDefaultProject());
  const [selectedClipId, setSelectedClipId] = useState<string | null>("c-1");
  const [sampleRate, setSampleRate] = useState<number>(DEFAULT_SAMPLE_RATE);
  const [svgAssets, setSvgAssets] = useState<Record<string, SvgAsset>>({});
  const [svgDraft, setSvgDraft] = useState<SvgDraft | null>(null);
  const [svgBusy, setSvgBusy] = useState(false);
  const [svgError, setSvgError] = useState<SvgFormationError | null>(null);

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
      formations: p.formations.map((f) => {
        if (f.kind === "svg") {
          const asset = f.svg ? svgAssets[f.svg.assetId] : undefined;
          // Without the source asset the stored point set is kept untouched:
          // silently resampling would break exact-N reproducibility.
          return asset ? regenerateSvgFormation(f, asset, count) : f;
        }
        return { ...f, points: generatePoints(f.kind, count, p.area, f.params) };
      }),
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
      formations: p.formations.map((f) => {
        if (f.id !== id) return f;
        if (f.kind === "svg") {
          const asset = f.svg ? svgAssets[f.svg.assetId] : undefined;
          if (!asset) return f;
          return regenerateSvgFormation(f, asset, p.droneCount, svgPatchFromRecord(params));
        }
        return {
          ...f,
          params: { ...f.params, ...params },
          points: generatePoints(f.kind, p.droneCount, p.area, { ...f.params, ...params }),
        };
      }),
    }));
  }, [svgAssets]);

  // ---- SVG import workflow -------------------------------------------------

  const regenerateDraft = useCallback(
    (asset: SvgAsset, params: SvgFormationParams, currentProject: ShowProject): SvgDraft => {
      try {
        const result = withPlacementWarnings(
          generateSvgFormationPoints(asset.geometry, params),
          currentProject,
        );
        return { asset, params, result, error: null };
      } catch (err) {
        return { asset, params, result: null, error: toSvgFormationError(err) };
      }
    },
    [],
  );

  const importSvg = useCallback(
    async (file: File) => {
      setSvgBusy(true);
      setSvgError(null);
      try {
        const asset = await importSvgFile(file, { assetId: nextId("svg") });
        setSvgAssets((m) => ({ ...m, [asset.id]: asset }));
        const params = resolveSvgParams(project.droneCount, {
          altitude: Math.min(project.area.height * 0.55, 60),
          width: Math.min(project.area.width * 0.7, 90),
        });
        setSvgDraft(regenerateDraft(asset, params, project));
      } catch (err) {
        setSvgError(toSvgFormationError(err));
        setSvgDraft(null);
      } finally {
        setSvgBusy(false);
      }
    },
    [project, regenerateDraft],
  );

  const updateSvgDraft = useCallback(
    (patch: Partial<SvgFormationParams>) => {
      setSvgDraft((d) =>
        d
          ? regenerateDraft(
              d.asset,
              { ...d.params, ...patch, targetCount: patch.targetCount ?? project.droneCount },
              project,
            )
          : d,
      );
    },
    [project, regenerateDraft],
  );

  const cancelSvgDraft = useCallback(() => {
    setSvgDraft(null);
    setSvgError(null);
  }, []);

  const commitSvgDraft = useCallback(
    (options: { name?: string; addToTimeline?: boolean } = {}) => {
      if (!svgDraft?.result) return null;
      const formation = makeSvgFormation(
        nextId("f"),
        options.name?.trim() || defaultFormationName(svgDraft.asset, svgDraft.params.mode),
        svgDraft.asset,
        svgDraft.result,
      );
      const clipId = nextId("c");
      setProject((p) => {
        const next: ShowProject = { ...p, formations: [...p.formations, formation] };
        if (options.addToTimeline === false) return next;
        const landing = p.timeline.filter((c) => c.phase === "LANDING");
        const body = p.timeline.filter((c) => c.phase !== "LANDING");
        const end = body.reduce((m, c) => Math.max(m, c.start + c.transition + c.hold), 0);
        const clip: TimelineClip = {
          id: clipId,
          formationId: formation.id,
          start: end,
          transition: 10,
          hold: 8,
          easing: "minJerk",
          color: [140, 220, 255],
          effect: "solid",
          phase: "SHOW",
        };
        const shift = clip.transition + clip.hold;
        return {
          ...next,
          timeline: [...body, clip, ...landing.map((c) => ({ ...c, start: c.start + shift }))],
        };
      });
      if (options.addToTimeline !== false) setSelectedClipId(clipId);
      setSvgDraft(null);
      return formation;
    },
    [svgDraft],
  );

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
      svgAssets,
      svgDraft,
      svgBusy,
      svgError,
      importSvg,
      updateSvgDraft,
      cancelSvgDraft,
      commitSvgDraft,
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
      svgAssets,
      svgDraft,
      svgBusy,
      svgError,
      importSvg,
      updateSvgDraft,
      cancelSvgDraft,
      commitSvgDraft,
    ],
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useStudio must be used inside <StudioProvider>");
  return ctx;
}
