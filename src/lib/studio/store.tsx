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
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { createDefaultProject } from "../show/defaultProject";
import { generatePoints, makeFormation } from "../show/formations";
import { buildShowPlan, samplesAt, sampleTrajectorySet, DEFAULT_SAMPLE_RATE } from "../show/trajectory";
import type { ClipTransitionOverride, ShowPlan, TrajectorySample, TrajectorySet } from "../show/trajectory";
import { validateShow, type SafetyReport } from "../show/safety";
import { buildBeatGrid, type BeatGrid } from "../show/audio";
import {
  compareAssignmentStrategies,
  type AssignmentComparison,
  type AssignmentStrategyId,
} from "../show/assignment";
import {
  analyzeTransition as analyzeTransitionCore,
  describeTransitionError,
  isOptimizableClip,
  optimizeTransition as optimizeTransitionCore,
  transitionInputForClip,
  DEFAULT_OPTIMIZATION_SETTINGS,
  type TransitionAnalysis,
  type TransitionOptimizationResult,
} from "../show/transition";
import {
  analyzeFullShow as analyzeFullShowCore,
  computeAnalysisRevision,
  FullShowError,
  type FullShowIssue,
  type FullShowPlan,
  type FullShowProgress,
  type FullShowValidationReport,
} from "../show/fullshow";
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
import {
  analyzePreShow,
  compareGroupOrders,
  patchPreShowConfig,
  resolvePreShowConfig,
  suggestGroupInterval,
  suggestLaunchSchedule,
  type GroupOrderComparison,
  type IntervalSearchResult,
  type LaunchScheduleEstimate,
  type PreShowConfig,
  type DeepPartialPreShow,
  type PreShowPlan,
  type PreShowValidationReport,
} from "../show/preshow";
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

  // ---- Transition analysis / optimisation (Sprint 3) ----------------------
  /** Assignment strategy used for SHOW clips and for analysis. */
  assignmentStrategy: AssignmentStrategyId;
  setAssignmentStrategy: (id: AssignmentStrategyId) => void;
  /** Applied optimiser results, keyed by clip id. Not part of ShowProject. */
  transitionOverrides: Record<string, ClipTransitionOverride>;
  transitionAnalysis: { clipId: string; analysis: TransitionAnalysis } | null;
  assignmentComparison: { clipId: string; comparison: AssignmentComparison } | null;
  optimization: { clipId: string; result: TransitionOptimizationResult } | null;
  transitionBusy: boolean;
  transitionError: { code: string; message: string } | null;
  /** Analyses the selected SHOW clip transition (assignment + conflicts). */
  analyzeSelectedTransition: () => void;
  /** Runs the bounded optimiser and applies the result to the preview. */
  optimizeSelectedTransition: () => void;
  clearTransitionAnalysis: () => void;
  /** Applies the estimated minimum duration to the analysed clip. */
  applySuggestedDuration: () => void;
  canAnalyzeSelectedClip: boolean;
  showPaths: boolean;
  setShowPaths: (v: boolean) => void;
  showConflicts: boolean;
  setShowConflicts: (v: boolean) => void;

  // ---- Full show simulation & validation (Sprint 4) ----------------------
  /** Composed full-show plan of the last analysis (TAKEOFF..LANDING). */
  fullShowPlan: FullShowPlan | null;
  fullShowReport: FullShowValidationReport | null;
  fullShowBusy: boolean;
  fullShowProgress: FullShowProgress | null;
  /** True when the project changed after the report was produced. */
  fullShowStale: boolean;
  fullShowError: { code: string; message: string } | null;
  /** Deterministic revision of the CURRENT project + analysis settings. */
  analysisRevision: string;
  analyzeFullShow: () => void;
  cancelFullShowAnalysis: () => void;
  clearFullShowReport: () => void;
  /** Seeks to an issue, selects its clip and highlights the drones involved. */
  focusIssue: (issue: FullShowIssue) => void;
  // ---- Pre-show: launch grid, staging, grouped take-off (Sprint 4.5) -----
  /** Resolved pre-show configuration (defaults merged with project overrides). */
  preShowConfig: PreShowConfig;
  preShowEnabled: boolean;
  setPreShowEnabled: (enabled: boolean) => void;
  patchPreShow: (patch: DeepPartialPreShow) => void;
  /** Composed pre-show plan of the CURRENT project, or null when disabled. */
  preShowPlan: PreShowPlan | null;
  /** First playable show time (negative during pre-show). */
  startTime: number;
  /** Operational time of SHOW TIME ZERO, i.e. the pre-show duration. */
  showStartOperationalTime: number;
  /** Standalone launch preview report (Preview launch), independent of the full show. */
  preShowReport: PreShowValidationReport | null;
  preShowBusy: boolean;
  preShowError: { code: string; message: string } | null;
  previewLaunch: () => void;
  clearPreShowReport: () => void;
  launchSchedule: LaunchScheduleEstimate | null;
  /** Bounded deterministic suggestions. Nothing is applied automatically. */
  intervalSuggestion: IntervalSearchResult | null;
  groupOrderComparison: GroupOrderComparison[] | null;
  suggestInterval: () => void;
  compareOrders: () => void;
  applySuggestedInterval: () => void;
  /** Drone indices highlighted in the viewport (issue navigation). */
  highlightedDrones: number[];
  setHighlightedDrones: (indices: number[]) => void;
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
  const [assignmentStrategy, setAssignmentStrategy] = useState<AssignmentStrategyId>("nearestNeighbor");
  const [transitionOverrides, setTransitionOverrides] = useState<Record<string, ClipTransitionOverride>>({});
  const [transitionAnalysis, setTransitionAnalysis] = useState<
    { clipId: string; analysis: TransitionAnalysis } | null
  >(null);
  const [assignmentComparison, setAssignmentComparison] = useState<
    { clipId: string; comparison: AssignmentComparison } | null
  >(null);
  const [optimization, setOptimization] = useState<
    { clipId: string; result: TransitionOptimizationResult } | null
  >(null);
  const [transitionBusy, setTransitionBusy] = useState(false);
  const [transitionError, setTransitionError] = useState<{ code: string; message: string } | null>(null);
  const [showPaths, setShowPaths] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);
  const [fullShow, setFullShow] = useState<{
    plan: FullShowPlan;
    report: FullShowValidationReport;
  } | null>(null);
  const [fullShowBusy, setFullShowBusy] = useState(false);
  const [fullShowProgress, setFullShowProgress] = useState<FullShowProgress | null>(null);
  const [fullShowError, setFullShowError] = useState<{ code: string; message: string } | null>(null);
  const [highlightedDrones, setHighlightedDrones] = useState<number[]>([]);
  const [preShowPreview, setPreShowPreview] = useState<{
    plan: PreShowPlan;
    report: PreShowValidationReport;
  } | null>(null);
  const [preShowBusy, setPreShowBusy] = useState(false);
  const [preShowError, setPreShowError] = useState<{ code: string; message: string } | null>(null);
  const [intervalSuggestion, setIntervalSuggestion] = useState<IntervalSearchResult | null>(null);
  const [groupOrderComparison, setGroupOrderComparison] = useState<GroupOrderComparison[] | null>(
    null,
  );
  const cancelFullShow = useRef(false);

  // Pure engine pipeline: formations -> assignment -> planning -> sampling -> safety.
  const plan = useMemo(
    () => buildShowPlan(project, { assignmentStrategy, transitionOverrides }),
    [project, assignmentStrategy, transitionOverrides],
  );
  const trajectorySet = useMemo(() => sampleTrajectorySet(plan, { sampleRate }), [plan, sampleRate]);
  const safety = useMemo(
    () => validateShow(project, trajectorySet, plan.drones),
    [project, trajectorySet, plan.drones],
  );
  const beatGrid = useMemo(() => buildBeatGrid(project.audio), [project.audio]);

  // Deterministic revision of everything the full-show analysis depends on.
  const analysisRevision = useMemo(
    () => computeAnalysisRevision(project, { sampleRate, assignmentStrategy, transitionOverrides }),
    [project, sampleRate, assignmentStrategy, transitionOverrides],
  );
  const fullShowStale = !!fullShow && fullShow.report.analysisRevision !== analysisRevision;

  // Stale-result guard: any project edit invalidates analysis AND any applied
  // optimiser override, because both were computed for the previous geometry.
  const projectGeneration = useRef(0);
  useEffect(() => {
    projectGeneration.current += 1;
    setTransitionAnalysis(null);
    setAssignmentComparison(null);
    setOptimization(null);
    setTransitionError(null);
    setTransitionOverrides({});
  }, [project.formations, project.droneCount, project.timeline, project.limits, project.area]);

  // Canonical duration — NEVER project.audio.duration.
  const duration = useMemo(() => Math.max(showDuration(project), 1), [project]);
  // PRE-SHOW extends playback into negative show time; SHOW TIME ZERO is fixed.
  const clock = useShowClock(duration, plan.startTime);

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

  // ---- Transition analysis / optimisation --------------------------------
  const canAnalyzeSelectedClip = !!selectedClipId && isOptimizableClip(project, selectedClipId);

  /** Converts an analysis into a plan override the full-show planner can apply. */
  const overrideFromAnalysis = useCallback(
    (clipId: string, analysis: TransitionAnalysis): ClipTransitionOverride | null => {
      const clip = project.timeline.find((c) => c.id === clipId);
      const points = project.formations.find((f) => f.id === clip?.formationId)?.points ?? [];
      if (points.length === 0) return null;
      return {
        targetPointIndex: analysis.dronePlans.map((p) => p.targetPointIndex % points.length),
        startOffsets: analysis.dronePlans.map((p) => p.startOffset),
        laneOffsets: analysis.dronePlans.map((p) => p.lane.offsetMetres),
        strategy: `${analysis.metrics.assignmentStrategy}+optimized`,
      };
    },
    [project],
  );

  const analyzeSelectedTransition = useCallback(() => {
    const clipId = selectedClipId;
    if (!clipId || !isOptimizableClip(project, clipId)) return;
    setTransitionBusy(true);
    setTransitionError(null);
    try {
      const input = transitionInputForClip(project, plan, clipId, {
        strategy: assignmentStrategy,
        sampleRate,
      });
      const analysis = analyzeTransitionCore(input, DEFAULT_OPTIMIZATION_SETTINGS);
      setTransitionAnalysis({ clipId, analysis });
      setAssignmentComparison({
        clipId,
        comparison: compareAssignmentStrategies({
          source: input.source,
          target: input.target,
          drones: input.drones,
        }),
      });
      setOptimization(null);
    } catch (err) {
      setTransitionAnalysis(null);
      setAssignmentComparison(null);
      setTransitionError(describeTransitionError(err));
    } finally {
      setTransitionBusy(false);
    }
  }, [project, plan, selectedClipId, assignmentStrategy, sampleRate]);

  const optimizeSelectedTransition = useCallback(() => {
    const clipId = selectedClipId;
    if (!clipId || !isOptimizableClip(project, clipId)) return;
    setTransitionBusy(true);
    setTransitionError(null);
    try {
      const input = transitionInputForClip(project, plan, clipId, {
        strategy: assignmentStrategy,
        sampleRate,
      });
      const result = optimizeTransitionCore(input, DEFAULT_OPTIMIZATION_SETTINGS);
      setOptimization({ clipId, result });
      setTransitionAnalysis({ clipId, analysis: result.final });
      const override = overrideFromAnalysis(clipId, result.final);
      // Only the preview/validation layer changes; the project stays untouched.
      if (override) setTransitionOverrides((prev) => ({ ...prev, [clipId]: override }));
    } catch (err) {
      setTransitionError(describeTransitionError(err));
    } finally {
      setTransitionBusy(false);
    }
  }, [project, plan, selectedClipId, assignmentStrategy, sampleRate, overrideFromAnalysis]);

  const clearTransitionAnalysis = useCallback(() => {
    setTransitionAnalysis(null);
    setAssignmentComparison(null);
    setOptimization(null);
    setTransitionError(null);
    setTransitionOverrides({});
  }, []);

  const applySuggestedDuration = useCallback(() => {
    if (!transitionAnalysis) return;
    const { clipId, analysis } = transitionAnalysis;
    const next = Math.ceil(analysis.feasibility.minimumEstimatedDuration * 10) / 10;
    if (!Number.isFinite(next) || next <= 0) return;
    patchClip(clipId, { transition: Math.max(0.5, next) });
  }, [transitionAnalysis, patchClip]);

  // ---- Full show simulation & validation ---------------------------------
  //
  // The analysis composes the show with EXACTLY the settings the viewport plays
  // (same project, strategy, overrides and sample rate), so a report can never
  // describe a different show than the one on screen.
  const analyzeFullShow = useCallback(() => {
    if (fullShowBusy) return;
    cancelFullShow.current = false;
    setFullShowBusy(true);
    setFullShowError(null);
    setFullShowProgress(null);
    // Deferred so the busy state and first progress label paint before the
    // synchronous engine work starts.
    const run = () => {
      try {
        const analyzedClipIds = transitionAnalysis ? [transitionAnalysis.clipId] : [];
        const unresolvedClipIds =
          transitionAnalysis &&
          transitionAnalysis.analysis.conflicts.criticalCount > 0 &&
          !transitionOverrides[transitionAnalysis.clipId]
            ? [transitionAnalysis.clipId]
            : [];
        const result = analyzeFullShowCore(project, {
          sampleRate,
          assignmentStrategy,
          transitionOverrides,
          analyzedClipIds,
          unresolvedClipIds,
          onProgress: setFullShowProgress,
          isCancelled: () => cancelFullShow.current,
        });
        setFullShow(result);
      } catch (err) {
        setFullShow(null);
        setFullShowError(
          err instanceof FullShowError
            ? { code: err.code, message: err.message }
            : { code: "UNKNOWN", message: err instanceof Error ? err.message : String(err) },
        );
      } finally {
        setFullShowBusy(false);
        setFullShowProgress(null);
      }
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => run());
    else run();
  }, [
    fullShowBusy,
    project,
    sampleRate,
    assignmentStrategy,
    transitionOverrides,
    transitionAnalysis,
  ]);

  const cancelFullShowAnalysis = useCallback(() => {
    cancelFullShow.current = true;
  }, []);

  const clearFullShowReport = useCallback(() => {
    setFullShow(null);
    setFullShowError(null);
    setHighlightedDrones([]);
  }, []);

  // ---- Pre-show (launch grid / staging / grouped take-off) ---------------
  const preShowConfig = useMemo(() => resolvePreShowConfig(project.preShow), [project.preShow]);
  const preShowEnabled = !!project.preShow?.enabled;

  const patchPreShow = useCallback((patch: DeepPartialPreShow) => {
    setProject((p) => ({ ...p, preShow: patchPreShowConfig(resolvePreShowConfig(p.preShow), patch) }));
  }, []);

  const setPreShowEnabled = useCallback(
    (enabled: boolean) => patchPreShow({ enabled }),
    [patchPreShow],
  );

  const launchSchedule = useMemo(
    () => (preShowEnabled && plan.preShow ? suggestLaunchSchedule(project, preShowConfig) : null),
    [preShowEnabled, plan.preShow, project, preShowConfig],
  );

  const previewLaunch = useCallback(() => {
    setPreShowBusy(true);
    setPreShowError(null);
    try {
      const { plan: preShowPlan, report } = analyzePreShow(project, {
        config: preShowConfig,
        sampleRate,
      });
      setPreShowPreview({ plan: preShowPlan, report });
    } catch (err) {
      setPreShowPreview(null);
      setPreShowError({
        code: "PRE_SHOW_PREVIEW_FAILED",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPreShowBusy(false);
    }
  }, [project, preShowConfig, sampleRate]);

  const clearPreShowReport = useCallback(() => {
    setPreShowPreview(null);
    setPreShowError(null);
    setIntervalSuggestion(null);
    setGroupOrderComparison(null);
  }, []);

  const suggestInterval = useCallback(() => {
    setPreShowBusy(true);
    try {
      setIntervalSuggestion(suggestGroupInterval(project, { sampleRate: 10 }));
    } finally {
      setPreShowBusy(false);
    }
  }, [project]);

  const compareOrders = useCallback(() => {
    setPreShowBusy(true);
    try {
      setGroupOrderComparison(compareGroupOrders(project));
    } finally {
      setPreShowBusy(false);
    }
  }, [project]);

  const applySuggestedInterval = useCallback(() => {
    const suggested = intervalSuggestion?.suggestedInterval;
    if (typeof suggested !== "number") return;
    patchPreShow({ grouping: { groupIntervalSeconds: suggested } });
  }, [intervalSuggestion, patchPreShow]);

  const focusIssue = useCallback(
    (issue: FullShowIssue) => {
      if (typeof issue.time === "number" && Number.isFinite(issue.time)) clock.seek(issue.time);
      if (issue.clipId) setSelectedClipId(issue.clipId);
      setHighlightedDrones(issue.droneIndices ?? []);
    },
    [clock],
  );


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
      assignmentStrategy,
      setAssignmentStrategy,
      transitionOverrides,
      transitionAnalysis,
      assignmentComparison,
      optimization,
      transitionBusy,
      transitionError,
      analyzeSelectedTransition,
      optimizeSelectedTransition,
      clearTransitionAnalysis,
      applySuggestedDuration,
      canAnalyzeSelectedClip,
      showPaths,
      setShowPaths,
      showConflicts,
      setShowConflicts,
      fullShowPlan: fullShow?.plan ?? null,
      fullShowReport: fullShow?.report ?? null,
      fullShowBusy,
      fullShowProgress,
      fullShowStale,
      fullShowError,
      analysisRevision,
      analyzeFullShow,
      cancelFullShowAnalysis,
      clearFullShowReport,
      focusIssue,
      preShowConfig,
      preShowEnabled,
      setPreShowEnabled,
      patchPreShow,
      preShowPlan: plan.preShow,
      startTime: plan.startTime,
      showStartOperationalTime: plan.showStartOperationalTime,
      preShowReport: preShowPreview?.report ?? fullShow?.report.preShow ?? null,
      preShowBusy,
      preShowError,
      previewLaunch,
      clearPreShowReport,
      launchSchedule,
      intervalSuggestion,
      groupOrderComparison,
      suggestInterval,
      compareOrders,
      applySuggestedInterval,
      highlightedDrones,
      setHighlightedDrones,
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
      assignmentStrategy,
      transitionOverrides,
      transitionAnalysis,
      assignmentComparison,
      optimization,
      transitionBusy,
      transitionError,
      analyzeSelectedTransition,
      optimizeSelectedTransition,
      clearTransitionAnalysis,
      applySuggestedDuration,
      canAnalyzeSelectedClip,
      showPaths,
      showConflicts,
      fullShow,
      fullShowBusy,
      fullShowProgress,
      fullShowStale,
      fullShowError,
      analysisRevision,
      analyzeFullShow,
      cancelFullShowAnalysis,
      clearFullShowReport,
      focusIssue,
      preShowConfig,
      preShowEnabled,
      setPreShowEnabled,
      patchPreShow,
      preShowPreview,
      preShowBusy,
      preShowError,
      previewLaunch,
      clearPreShowReport,
      launchSchedule,
      intervalSuggestion,
      groupOrderComparison,
      suggestInterval,
      compareOrders,
      applySuggestedInterval,
      highlightedDrones,
    ],
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useStudio must be used inside <StudioProvider>");
  return ctx;
}
