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
  buildPreShowOverlay,
  type PreShowOverlayModel,
  type GroupOrderComparison,
  type IntervalSearchResult,
  type LaunchScheduleEstimate,
  type PreShowConfig,
  type DeepPartialPreShow,
  type PreShowPlan,
  type PreShowValidationReport,
} from "../show/preshow";
import {
  buildReferenceShow,
  isZipName,
  readZip,
  sampleReferenceShow,
  type ReferenceSample,
  type ReferenceShow,
} from "../import/essp";
import {
  analyzeReferenceShow,
  forensicsReportToJson,
  referenceShowHash,
  FORENSICS_PRESETS,
  ESSP_FORENSICS_ALGORITHM_VERSION,
  type ForensicsPresetName,
  type ReferenceForensicsReport,
  type ReferenceForensicsThresholds,
  type ReferenceSceneSegment,
} from "../import/essp/forensics";
import {
  applyPreset,
  addMotionGroup,
  dynamicFromFormation,
  mirrorGroupsX,
  neutralGroupKeyframe,
  neutralTransformKeyframe,
  patchMotionGroup,
  pointId as dynamicPointId,
  rebasePoints,
  removeGroupKeyframe,
  removeMotionGroup,
  removeTransformKeyframe,
  sampleDynamicFormation,
  splitLeftRight,
  upsertGroupKeyframe,
  upsertTransformKeyframe,
  validateDynamicFormation,
  type DynamicFormation,
  type DynamicFormationReport,
  type DynamicPresetId,
  type GroupDeformationKeyframe,
  type MotionGroup,
  type TransformKeyframe,
} from "../show/dynamic";
import {
  comparisonFrameAt,
  convertReferenceSegmentToDynamicFormation,
  dynamicFormationSignature,
  evaluateDynamicFormationFidelity,
  fidelitySourceFromProposal,
  segmentEligibility,
  CONVERSION_TOLERANCE_PRESETS,
  REFERENCE_DYNAMIC_CONVERTER_VERSION,
  type ComparisonFrame,
  type ComparisonMode,
  type ConversionMode,
  type DynamicFormationConversionProposal,
  type DynamicFormationFidelityReport,
  type RotationFitMode,
} from "../import/essp/conversion";
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
  /** Read-only launch/staging visualization model of the current plan. */
  preShowOverlay: PreShowOverlayModel | null;
  /** True when the pre-show report describes a different project revision. */
  preShowStale: boolean;
  showLaunchPads: boolean;
  setShowLaunchPads: (v: boolean) => void;
  showStaging: boolean;
  setShowStaging: (v: boolean) => void;
  showLaunchGroups: boolean;
  setShowLaunchGroups: (v: boolean) => void;
  selectedLaunchGroupId: string | null;
  selectLaunchGroup: (id: string | null) => void;
  /** Drone indices highlighted in the viewport (issue navigation). */
  highlightedDrones: number[];
  setHighlightedDrones: (indices: number[]) => void;

  // ---- ESSP reference show (read-only import, Sprint 6A) -----------------
  /**
   * Imported reference show. READ-ONLY: it is never planned, optimised or
   * validated against the Studio limits, and it never touches `project`.
   */
  referenceShow: ReferenceShow | null;
  /** True while the viewport plays the imported reference instead of the design. */
  referencePlayback: boolean;
  setReferencePlayback: (v: boolean) => void;
  referenceBusy: boolean;
  referenceError: { code: string; message: string } | null;
  /** Parses .essp files (or a .zip archive of them) into a reference show. */
  importEsspFiles: (files: File[]) => Promise<void>;
  clearReferenceShow: () => void;
  /** Exact-playback sample of every reference drone at reference time t. */
  referenceSamplesAt: (t: number) => ReferenceSample[];
  selectedReferenceDroneId: string | null;
  selectReferenceDrone: (id: string | null) => void;
  showReferencePaths: boolean;
  setShowReferencePaths: (v: boolean) => void;

  // ---- Reference forensics (Sprint 6A.5, analysis only) ------------------
  /** Derived motion analysis of the imported reference show. Never mutates it. */
  forensicsReport: ReferenceForensicsReport | null;
  forensicsBusy: boolean;
  forensicsError: string | null;
  forensicsPreset: ForensicsPresetName;
  setForensicsPreset: (preset: ForensicsPresetName) => void;
  forensicsThresholds: ReferenceForensicsThresholds;
  patchForensicsThresholds: (patch: Partial<ReferenceForensicsThresholds>) => void;
  /** True when the report no longer matches the show / version / thresholds. */
  forensicsStale: boolean;
  analyzeReferenceMotion: () => void;
  cancelReferenceAnalysis: () => void;
  clearForensics: () => void;
  selectedForensicSegmentId: string | null;
  /** Selects a segment and seeks playback to its start. */
  selectForensicSegment: (id: string | null) => void;
  selectedForensicSegment: ReferenceSceneSegment | null;
  showForensicActiveDrones: boolean;
  setShowForensicActiveDrones: (v: boolean) => void;
  /** Source IDs highlighted for the selected dynamic segment. */
  forensicActiveDroneIds: string[];
  /** Renames a segment (metadata only — classification is unchanged). */
  labelForensicSegment: (id: string, label: string) => void;
  exportForensicsReport: () => void;

  // ---- Reference segment -> dynamic conversion (Sprint 6B.5) -------------
  /**
   * Controlled conversion of a forensic segment into a NEW editable
   * DynamicFormation. The reference show is only read, never modified.
   */
  conversionMode: ConversionMode;
  setConversionMode: (mode: ConversionMode) => void;
  conversionTolerance: number;
  setConversionTolerance: (metres: number) => void;
  conversionRotationFit: RotationFitMode;
  setConversionRotationFit: (fit: RotationFitMode) => void;
  conversionSuggestGroups: boolean;
  setConversionSuggestGroups: (v: boolean) => void;
  conversionBusy: boolean;
  conversionError: string | null;
  /** Not-yet-applied proposal with its measured fidelity report. */
  conversionProposal: DynamicFormationConversionProposal | null;
  /** True when the selected forensic segment can be offered for conversion. */
  canConvertSelectedSegment: boolean;
  analyzeSegmentConversion: () => void;
  discardConversionProposal: () => void;
  /** Applies the proposal as an independent editable asset (undoable). */
  applyConversionProposal: (options?: { addToTimeline?: boolean }) => DynamicFormation | null;
  comparisonMode: ComparisonMode;
  setComparisonMode: (mode: ComparisonMode) => void;
  /** Diagnostic exaggeration factor for drawn error vectors. */
  errorVectorScale: number;
  setErrorVectorScale: (scale: number) => void;
  /** Original vs reconstructed cloud at the current playhead (diagnostic only). */
  conversionComparisonFrame: ComparisonFrame | null;
  /** Seeks to the worst reconstruction frame and highlights the worst drone. */
  seekToConversionWorstFrame: () => void;
  /** Fidelity report of the APPLIED conversion, and whether it is stale. */
  appliedConversionFidelity: DynamicFormationFidelityReport | null;
  appliedConversionFormationId: string | null;
  conversionFidelityStale: boolean;
  /** True while the source reference show still matches the conversion hash. */
  conversionSourceAvailable: boolean;
  recompareConversionToSource: () => void;
  conversionTolerancePresets: typeof CONVERSION_TOLERANCE_PRESETS;
  conversionAlgorithmVersion: string;

  // ---- Dynamic formations (Sprint 6B) ------------------------------------
  /** Living formations owned by the project. */
  dynamicFormations: DynamicFormation[];
  /** Dynamic formation being edited (explicit selection or via selected clip). */
  selectedDynamicFormation: DynamicFormation | null;
  selectDynamicFormation: (id: string | null) => void;
  /** Design-time animation report for the selected formation (never a safety claim). */
  dynamicReport: DynamicFormationReport | null;
  /** Converts a static formation into an editable living formation. */
  createDynamicFromFormation: (formationId: string) => DynamicFormation | null;
  removeDynamicFormation: (id: string) => void;
  patchDynamicFormation: (id: string, patch: Partial<DynamicFormation>) => void;
  /** Appends a timeline clip whose hold plays the given dynamic formation. */
  addDynamicClip: (dynamicFormationId: string) => void;
  /** Attaches / detaches a dynamic formation on the selected clip. */
  setClipDynamicFormation: (clipId: string, dynamicFormationId: string | null) => void;
  applyDynamicPreset: (id: string, preset: DynamicPresetId, amount?: number) => void;
  mirrorDynamicGroups: (id: string) => void;

  // Motion groups + point selection
  selectedPointIds: string[];
  togglePointSelection: (pointId: string) => void;
  setSelectedPointIds: (ids: string[]) => void;
  clearPointSelection: () => void;
  /** Selects one side of the formation (quick wing selection). */
  selectPointSide: (side: "left" | "right" | "centre" | "all") => void;
  /** Viewport click support: drone index -> base point id for the dynamic clip. */
  pointIdForDrone: (droneIndex: number) => string | null;
  /** Drone indices whose assigned point is currently selected. */
  selectedDroneIndices: number[];
  /** Group tint per drone index while a dynamic clip is being edited. */
  dynamicGroupRgbByDrone: Map<number, [number, number, number]>;
  selectedMotionGroupId: string | null;
  selectMotionGroup: (id: string | null) => void;
  createMotionGroupFromSelection: (name: string) => void;
  deleteMotionGroup: (groupId: string) => void;
  patchMotionGroupState: (groupId: string, patch: Partial<MotionGroup>) => void;
  /** Replaces a group's membership with the current point selection. */
  assignSelectionToGroup: (groupId: string) => void;

  // Keyframes (local animation time)
  upsertGlobalKeyframe: (key: TransformKeyframe) => void;
  deleteGlobalKeyframe: (t: number) => void;
  upsertDeformationKeyframe: (groupId: string, key: GroupDeformationKeyframe) => void;
  deleteDeformationKeyframe: (groupId: string, t: number) => void;
  /** Local animation time being edited (0 .. duration). */
  dynamicEditTime: number;
  setDynamicEditTime: (t: number) => void;
  /** Sampled positions of the selected formation at `dynamicEditTime`. */
  dynamicPreviewPoints: readonly (readonly [number, number, number])[] | null;
  /** Undo / redo of dynamic formation edits only. */
  undoDynamic: () => void;
  redoDynamic: () => void;
  canUndoDynamic: boolean;
  canRedoDynamic: boolean;
}


/**
 * Single context instance per browser realm. During dev hot-reloads a second
 * copy of this module can briefly coexist with the first; keying the context on
 * globalThis keeps provider and consumers on the same instance instead of
 * throwing "useStudio must be used inside <StudioProvider>".
 */
const CONTEXT_KEY = "__droneShowStudioContext__";
const globalScope = globalThis as typeof globalThis & {
  [CONTEXT_KEY]?: React.Context<StudioContextValue | null>;
};
const StudioContext: React.Context<StudioContextValue | null> =
  globalScope[CONTEXT_KEY] ?? createContext<StudioContextValue | null>(null);
globalScope[CONTEXT_KEY] = StudioContext;

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
    /** Project revision the preview was computed for (staleness provenance). */
    revision: string;
  } | null>(null);
  const [preShowBusy, setPreShowBusy] = useState(false);
  const [showLaunchPads, setShowLaunchPads] = useState(false);
  const [showStaging, setShowStaging] = useState(false);
  const [showLaunchGroups, setShowLaunchGroups] = useState(false);
  const [selectedLaunchGroupId, setSelectedLaunchGroupId] = useState<string | null>(null);
  const [preShowError, setPreShowError] = useState<{ code: string; message: string } | null>(null);
  const [intervalSuggestion, setIntervalSuggestion] = useState<IntervalSearchResult | null>(null);
  const [groupOrderComparison, setGroupOrderComparison] = useState<GroupOrderComparison[] | null>(
    null,
  );
  const [referenceShow, setReferenceShow] = useState<ReferenceShow | null>(null);
  const [referencePlayback, setReferencePlayback] = useState(false);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [referenceError, setReferenceError] = useState<{ code: string; message: string } | null>(
    null,
  );
  const [selectedReferenceDroneId, setSelectedReferenceDroneId] = useState<string | null>(null);
  const [showReferencePaths, setShowReferencePaths] = useState(false);
  const [forensicsReport, setForensicsReport] = useState<ReferenceForensicsReport | null>(null);
  const [forensicsBusy, setForensicsBusy] = useState(false);
  const [forensicsError, setForensicsError] = useState<string | null>(null);
  const [forensicsPreset, setForensicsPresetState] = useState<ForensicsPresetName>("BALANCED");
  const [forensicsThresholds, setForensicsThresholds] = useState<ReferenceForensicsThresholds>(
    FORENSICS_PRESETS.BALANCED,
  );
  const [selectedForensicSegmentId, setSelectedForensicSegmentId] = useState<string | null>(null);
  const [showForensicActiveDrones, setShowForensicActiveDrones] = useState(true);
  const forensicsRunRef = useRef(0);
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
  const duration = useMemo(() => {
    if (referencePlayback && referenceShow) {
      return Math.max(referenceShow.timing.playbackDurationSeconds, 1);
    }
    return Math.max(showDuration(project), 1);
  }, [project, referencePlayback, referenceShow]);
  // PRE-SHOW extends playback into negative show time; SHOW TIME ZERO is fixed.
  const clock = useShowClock(duration, referencePlayback && referenceShow ? 0 : plan.startTime);

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

  // ---- Dynamic formations (Sprint 6B) ------------------------------------
  // All editing is delegation to the pure engine: every action maps a
  // DynamicFormation to a NEW DynamicFormation, which makes undo trivial.
  const dynamicHistory = useRef<{ past: DynamicFormation[][]; future: DynamicFormation[][] }>({
    past: [],
    future: [],
  });
  const [dynamicHistoryDepth, setDynamicHistoryDepth] = useState({ past: 0, future: 0 });
  const [explicitDynamicId, setExplicitDynamicId] = useState<string | null>(null);
  const [selectedPointIds, setSelectedPointIdsState] = useState<string[]>([]);
  const [selectedMotionGroupId, setSelectedMotionGroupId] = useState<string | null>(null);
  const [dynamicEditTime, setDynamicEditTime] = useState(0);

  const dynamicFormations = useMemo(() => project.dynamicFormations ?? [], [project.dynamicFormations]);
  const selectedClip = useMemo(
    () => project.timeline.find((c) => c.id === selectedClipId) ?? null,
    [project.timeline, selectedClipId],
  );
  const selectedDynamicFormation = useMemo(() => {
    const byClip = selectedClip?.dynamicFormationId;
    return (
      dynamicFormations.find((d) => d.id === explicitDynamicId) ??
      dynamicFormations.find((d) => d.id === byClip) ??
      null
    );
  }, [dynamicFormations, explicitDynamicId, selectedClip]);

  /** Commits a dynamic-formation edit and pushes the previous state on the undo stack. */
  const commitDynamic = useCallback(
    (updater: (list: DynamicFormation[]) => DynamicFormation[]) => {
      setProject((p) => {
        const before = p.dynamicFormations ?? [];
        const next = updater(before);
        dynamicHistory.current.past.push(before);
        if (dynamicHistory.current.past.length > 50) dynamicHistory.current.past.shift();
        dynamicHistory.current.future = [];
        setDynamicHistoryDepth({ past: dynamicHistory.current.past.length, future: 0 });
        return { ...p, dynamicFormations: next };
      });
    },
    [],
  );

  const editDynamic = useCallback(
    (id: string, fn: (formation: DynamicFormation) => DynamicFormation) => {
      commitDynamic((list) => list.map((d) => (d.id === id ? fn(d) : d)));
    },
    [commitDynamic],
  );

  const undoDynamic = useCallback(() => {
    const previous = dynamicHistory.current.past.pop();
    if (!previous) return;
    setProject((p) => {
      dynamicHistory.current.future.push(p.dynamicFormations ?? []);
      setDynamicHistoryDepth({
        past: dynamicHistory.current.past.length,
        future: dynamicHistory.current.future.length,
      });
      return { ...p, dynamicFormations: previous };
    });
  }, []);

  const redoDynamic = useCallback(() => {
    const next = dynamicHistory.current.future.pop();
    if (!next) return;
    setProject((p) => {
      dynamicHistory.current.past.push(p.dynamicFormations ?? []);
      setDynamicHistoryDepth({
        past: dynamicHistory.current.past.length,
        future: dynamicHistory.current.future.length,
      });
      return { ...p, dynamicFormations: next };
    });
  }, []);

  const createDynamicFromFormation = useCallback(
    (formationId: string) => {
      const formation = project.formations.find((f) => f.id === formationId);
      if (!formation) return null;
      const created = dynamicFromFormation(formation, {
        id: nextId("dyn"),
        duration: 8,
        seed: project.seed,
      });
      commitDynamic((list) => [...list, created]);
      setExplicitDynamicId(created.id);
      setSelectedPointIdsState([]);
      setSelectedMotionGroupId(null);
      setDynamicEditTime(0);
      return created;
    },
    [commitDynamic, project.formations, project.seed],
  );

  const removeDynamicFormation = useCallback(
    (id: string) => {
      commitDynamic((list) => list.filter((d) => d.id !== id));
      setProject((p) => ({
        ...p,
        timeline: p.timeline.map((c) => {
          if (c.dynamicFormationId !== id) return c;
          const { dynamicFormationId: _detached, ...rest } = c;
          return rest;
        }),
      }));

      setExplicitDynamicId((current) => (current === id ? null : current));
    },
    [commitDynamic],
  );

  const patchDynamicFormation = useCallback(
    (id: string, patch: Partial<DynamicFormation>) => {
      editDynamic(id, (d) => ({ ...d, ...patch }));
    },
    [editDynamic],
  );

  const setClipDynamicFormation = useCallback(
    (clipId: string, dynamicFormationId: string | null) => {
      setProject((p) => ({
        ...p,
        timeline: p.timeline.map((c) => {
          if (c.id !== clipId) return c;
          if (dynamicFormationId) return { ...c, dynamicFormationId };
          const { dynamicFormationId: _detached, ...rest } = c;
          return rest;
        }),
      }));

    },
    [],
  );

  const addDynamicClip = useCallback(
    (dynamicFormationId: string) => {
      const dynamic = (project.dynamicFormations ?? []).find((d) => d.id === dynamicFormationId);
      if (!dynamic) return;
      const id = nextId("c");
      setProject((p) => {
        const end = p.timeline.reduce((m, c) => Math.max(m, c.start + c.transition + c.hold), 0);
        const clip: TimelineClip = {
          id,
          formationId: dynamic.sourceFormationId ?? p.formations[0]?.id ?? "",
          start: end,
          transition: 10,
          // A dynamic clip holds for at least one full animation cycle.
          hold: Math.max(dynamic.duration, 4),
          easing: "minJerk",
          color: [140, 210, 255],
          effect: "solid",
          phase: "SHOW",
          dynamicFormationId: dynamic.id,
          playbackRate: 1,
          dynamicStartOffset: 0,
        };
        return { ...p, timeline: [...p.timeline, clip] };
      });
      setSelectedClipId(id);
      setExplicitDynamicId(dynamic.id);
    },
    [project.dynamicFormations],
  );

  const applyDynamicPreset = useCallback(
    (id: string, preset: DynamicPresetId, amount = 1) => {
      editDynamic(id, (d) => applyPreset(d, preset, amount));
      setSelectedMotionGroupId(null);
    },
    [editDynamic],
  );

  const mirrorDynamicGroups = useCallback(
    (id: string) => editDynamic(id, mirrorGroupsX),
    [editDynamic],
  );

  // ---- point selection ----------------------------------------------------
  const setSelectedPointIds = useCallback((ids: string[]) => {
    setSelectedPointIdsState([...new Set(ids)]);
  }, []);

  const togglePointSelection = useCallback((id: string) => {
    setSelectedPointIdsState((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }, []);

  const clearPointSelection = useCallback(() => setSelectedPointIdsState([]), []);

  const selectPointSide = useCallback(
    (side: "left" | "right" | "centre" | "all") => {
      const formation = selectedDynamicFormation;
      if (!formation) return;
      if (side === "all") {
        setSelectedPointIdsState(formation.points.map((p) => p.id));
        return;
      }
      const split = splitLeftRight(formation);
      setSelectedPointIdsState(split[side]);
    },
    [selectedDynamicFormation],
  );

  /**
   * Viewport bridge: a drone in a dynamic clip is flying ONE base point, given by
   * that clip's assignment. Selection is therefore stored per point id, not per
   * drone, and survives re-assignment.
   */
  const dynamicClipForFormation = useMemo(() => {
    const formation = selectedDynamicFormation;
    if (!formation) return null;
    if (selectedClip?.dynamicFormationId === formation.id) return selectedClip;
    return project.timeline.find((c) => c.dynamicFormationId === formation.id) ?? null;
  }, [project.timeline, selectedClip, selectedDynamicFormation]);

  const pointIdByDrone = useMemo(() => {
    const formation = selectedDynamicFormation;
    if (!formation || formation.points.length === 0) return [] as string[];
    const clipAssignment = dynamicClipForFormation
      ? plan.assignments.find((a) => a.clipId === dynamicClipForFormation.id)
      : undefined;
    return Array.from({ length: project.droneCount }, (_, i) => {
      const target = clipAssignment?.assignments[i]?.targetPointIndex ?? i;
      return formation.points[target % formation.points.length]?.id ?? dynamicPointId(target % formation.points.length);
    });
  }, [dynamicClipForFormation, plan.assignments, project.droneCount, selectedDynamicFormation]);

  const pointIdForDrone = useCallback(
    (droneIndex: number) => pointIdByDrone[droneIndex] ?? null,
    [pointIdByDrone],
  );

  const selectedDroneIndices = useMemo(() => {
    if (selectedPointIds.length === 0) return [];
    const wanted = new Set(selectedPointIds);
    return pointIdByDrone.reduce<number[]>((acc, id, i) => {
      if (wanted.has(id)) acc.push(i);
      return acc;
    }, []);
  }, [pointIdByDrone, selectedPointIds]);

  const dynamicGroupRgbByDrone = useMemo(() => {
    const map = new Map<number, [number, number, number]>();
    const formation = selectedDynamicFormation;
    if (!formation) return map;
    const colorByPoint = new Map<string, [number, number, number]>();
    for (const group of formation.groups) {
      const rgb: [number, number, number] = [
        group.color[0] / 255,
        group.color[1] / 255,
        group.color[2] / 255,
      ];
      for (const id of group.pointIds) colorByPoint.set(id, rgb);
    }
    pointIdByDrone.forEach((id, i) => {
      const rgb = colorByPoint.get(id);
      if (rgb) map.set(i, rgb);
    });
    return map;
  }, [pointIdByDrone, selectedDynamicFormation]);

  // ---- motion groups -----------------------------------------------------
  const createMotionGroupFromSelection = useCallback(
    (name: string) => {
      const formation = selectedDynamicFormation;
      if (!formation || selectedPointIds.length === 0) return;
      const groupId = nextId("mg");
      editDynamic(formation.id, (d) => addMotionGroup(d, name, selectedPointIds, groupId));
      setSelectedMotionGroupId(groupId);
    },
    [editDynamic, selectedDynamicFormation, selectedPointIds],
  );

  const deleteMotionGroup = useCallback(
    (groupId: string) => {
      const formation = selectedDynamicFormation;
      if (!formation) return;
      editDynamic(formation.id, (d) => removeMotionGroup(d, groupId));
      setSelectedMotionGroupId((current) => (current === groupId ? null : current));
    },
    [editDynamic, selectedDynamicFormation],
  );

  const patchMotionGroupState = useCallback(
    (groupId: string, patch: Partial<MotionGroup>) => {
      const formation = selectedDynamicFormation;
      if (!formation) return;
      editDynamic(formation.id, (d) => patchMotionGroup(d, groupId, patch));
    },
    [editDynamic, selectedDynamicFormation],
  );

  const assignSelectionToGroup = useCallback(
    (groupId: string) => {
      const formation = selectedDynamicFormation;
      if (!formation) return;
      editDynamic(formation.id, (d) => patchMotionGroup(d, groupId, { pointIds: selectedPointIds }));
    },
    [editDynamic, selectedDynamicFormation, selectedPointIds],
  );

  // ---- keyframes ---------------------------------------------------------
  const upsertGlobalKeyframe = useCallback(
    (key: TransformKeyframe) => {
      const formation = selectedDynamicFormation;
      if (!formation) return;
      editDynamic(formation.id, (d) => upsertTransformKeyframe(d, key));
    },
    [editDynamic, selectedDynamicFormation],
  );

  const deleteGlobalKeyframe = useCallback(
    (t: number) => {
      const formation = selectedDynamicFormation;
      if (!formation) return;
      editDynamic(formation.id, (d) => removeTransformKeyframe(d, t));
    },
    [editDynamic, selectedDynamicFormation],
  );

  const upsertDeformationKeyframe = useCallback(
    (groupId: string, key: GroupDeformationKeyframe) => {
      const formation = selectedDynamicFormation;
      if (!formation) return;
      editDynamic(formation.id, (d) => upsertGroupKeyframe(d, groupId, key));
    },
    [editDynamic, selectedDynamicFormation],
  );

  const deleteDeformationKeyframe = useCallback(
    (groupId: string, t: number) => {
      const formation = selectedDynamicFormation;
      if (!formation) return;
      editDynamic(formation.id, (d) => removeGroupKeyframe(d, groupId, t));
    },
    [editDynamic, selectedDynamicFormation],
  );

  const dynamicPreviewPoints = useMemo(() => {
    if (!selectedDynamicFormation) return null;
    try {
      return sampleDynamicFormation(selectedDynamicFormation, dynamicEditTime);
    } catch {
      return null;
    }
  }, [dynamicEditTime, selectedDynamicFormation]);

  const dynamicReport = useMemo(() => {
    if (!selectedDynamicFormation) return null;
    return validateDynamicFormation(selectedDynamicFormation, {
      limits: project.limits,
      area: project.area,
      expectedPointCount: project.droneCount,
    });
  }, [project.area, project.droneCount, project.limits, selectedDynamicFormation]);

  const selectDynamicFormation = useCallback((id: string | null) => {
    setExplicitDynamicId(id);
    setSelectedPointIdsState([]);
    setSelectedMotionGroupId(null);
    setDynamicEditTime(0);
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

  const preShowOverlay = useMemo(
    () => (plan.preShow ? buildPreShowOverlay(plan.preShow) : null),
    [plan.preShow],
  );

  const previewLaunch = useCallback(() => {
    setPreShowBusy(true);
    setPreShowError(null);
    try {
      const { plan: preShowPlan, report } = analyzePreShow(project, {
        config: preShowConfig,
        sampleRate,
      });
      setPreShowPreview({ plan: preShowPlan, report, revision: analysisRevision });
    } catch (err) {
      setPreShowPreview(null);
      setPreShowError({
        code: "PRE_SHOW_PREVIEW_FAILED",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPreShowBusy(false);
    }
  }, [project, preShowConfig, sampleRate, analysisRevision]);

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


  // ---- ESSP reference import (read-only) --------------------------------
  const importEsspFiles = useCallback(async (files: File[]) => {
    setReferenceBusy(true);
    setReferenceError(null);
    try {
      const sources: { name: string; bytes: Uint8Array }[] = [];
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (isZipName(file.name)) {
          const entries = await readZip(bytes.buffer as ArrayBuffer);
          entries.forEach((e) => sources.push({ name: e.name, bytes: e.bytes }));
        } else {
          sources.push({ name: file.name, bytes });
        }
      }
      const show = await buildReferenceShow(sources);
      forensicsRunRef.current += 1;
      setForensicsReport(null);
      setForensicsError(null);
      setSelectedForensicSegmentId(null);
      setReferenceShow(show);
      setReferencePlayback(true);
      setSelectedReferenceDroneId(show.drones[0]?.sourceId ?? null);
    } catch (err) {
      setReferenceShow(null);
      setReferencePlayback(false);
      setReferenceError({
        code: "ESSP_IMPORT_FAILED",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setReferenceBusy(false);
    }
  }, []);

  const clearReferenceShow = useCallback(() => {
    setReferenceShow(null);
    setReferencePlayback(false);
    setReferenceError(null);
    setSelectedReferenceDroneId(null);
    forensicsRunRef.current += 1;
    setForensicsReport(null);
    setForensicsError(null);
    setSelectedForensicSegmentId(null);
  }, []);

  // ---- Reference forensics (derived, read-only) --------------------------
  const clearForensics = useCallback(() => {
    forensicsRunRef.current += 1;
    setForensicsReport(null);
    setForensicsError(null);
    setForensicsBusy(false);
    setSelectedForensicSegmentId(null);
  }, []);

  const setForensicsPreset = useCallback((preset: ForensicsPresetName) => {
    setForensicsPresetState(preset);
    setForensicsThresholds(FORENSICS_PRESETS[preset]);
  }, []);

  const patchForensicsThresholds = useCallback(
    (patch: Partial<ReferenceForensicsThresholds>) =>
      setForensicsThresholds((prev) => ({ ...prev, ...patch })),
    [],
  );

  const cancelReferenceAnalysis = useCallback(() => {
    forensicsRunRef.current += 1;
    setForensicsBusy(false);
  }, []);

  const analyzeReferenceMotion = useCallback(() => {
    const show = referenceShow;
    if (!show) return;
    const run = ++forensicsRunRef.current;
    setForensicsBusy(true);
    setForensicsError(null);
    // Deferred so the busy state paints before the (pure, synchronous) analysis.
    setTimeout(() => {
      try {
        const report = analyzeReferenceShow(show, {
          preset: forensicsPreset,
          thresholds: forensicsThresholds,
          shouldCancel: () => forensicsRunRef.current !== run,
        });
        if (forensicsRunRef.current !== run) return;
        setForensicsReport(report);
        setSelectedForensicSegmentId(report.segments[0]?.id ?? null);
      } catch (err) {
        if (forensicsRunRef.current !== run) return;
        setForensicsError(err instanceof Error ? err.message : String(err));
      } finally {
        if (forensicsRunRef.current === run) setForensicsBusy(false);
      }
    }, 30);
  }, [referenceShow, forensicsPreset, forensicsThresholds]);

  const forensicsStale = useMemo(() => {
    if (!forensicsReport || !referenceShow) return false;
    return (
      forensicsReport.source.showHash !== referenceShowHash(referenceShow) ||
      forensicsReport.algorithmVersion !== ESSP_FORENSICS_ALGORITHM_VERSION ||
      JSON.stringify(forensicsReport.thresholds) !== JSON.stringify(forensicsThresholds)
    );
  }, [forensicsReport, referenceShow, forensicsThresholds]);

  const selectedForensicSegment = useMemo(
    () => forensicsReport?.segments.find((s) => s.id === selectedForensicSegmentId) ?? null,
    [forensicsReport, selectedForensicSegmentId],
  );

  const selectForensicSegment = useCallback(
    (id: string | null) => {
      setSelectedForensicSegmentId(id);
      const seg = forensicsReport?.segments.find((s) => s.id === id);
      if (seg) clock.seek(seg.startTime);
    },
    [forensicsReport, clock],
  );

  const forensicActiveDroneIds = useMemo(() => {
    if (!showForensicActiveDrones || !selectedForensicSegment) return [];
    return selectedForensicSegment.activeDroneIds;
  }, [showForensicActiveDrones, selectedForensicSegment]);

  const labelForensicSegment = useCallback((id: string, label: string) => {
    setForensicsReport((prev) =>
      prev
        ? {
            ...prev,
            segments: prev.segments.map((s) => (s.id === id ? { ...s, label } : s)),
          }
        : prev,
    );
  }, []);

  const exportForensicsReport = useCallback(() => {
    if (!forensicsReport) return;
    const blob = new Blob([forensicsReportToJson(forensicsReport)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ESSPReferenceForensicsReport.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [forensicsReport]);

  // ---- Reference segment -> dynamic conversion (Sprint 6B.5) -------------
  // The reference show is READ ONLY here: conversion produces a proposal made of
  // brand-new project objects and only `applyConversionProposal` touches the
  // project (through the normal undoable dynamic-formation history).
  const [conversionMode, setConversionMode] = useState<ConversionMode>("EXACT_SAMPLED");
  const [conversionTolerance, setConversionTolerance] = useState<number>(
    CONVERSION_TOLERANCE_PRESETS.BALANCED,
  );
  const [conversionRotationFit, setConversionRotationFit] = useState<RotationFitMode>("KABSCH");
  const [conversionSuggestGroups, setConversionSuggestGroups] = useState(true);
  const [conversionBusy, setConversionBusy] = useState(false);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [conversionProposal, setConversionProposal] =
    useState<DynamicFormationConversionProposal | null>(null);
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>("OVERLAY");
  const [errorVectorScale, setErrorVectorScale] = useState(1);
  const [appliedConversion, setAppliedConversion] = useState<{
    formationId: string;
    proposal: DynamicFormationConversionProposal;
    signature: string;
    fidelity: DynamicFormationFidelityReport;
  } | null>(null);

  const canConvertSelectedSegment =
    !!referenceShow &&
    !!selectedForensicSegment &&
    segmentEligibility(selectedForensicSegment.classification) !== "UNSUPPORTED";

  const analyzeSegmentConversion = useCallback(() => {
    const segment = selectedForensicSegment;
    if (!referenceShow || !segment) return;
    setConversionBusy(true);
    setConversionError(null);
    try {
      const proposal = convertReferenceSegmentToDynamicFormation(referenceShow, segment, {
        mode: conversionMode,
        toleranceMeters: conversionTolerance,
        rotationFit: conversionRotationFit,
        suggestMotionGroups: conversionSuggestGroups,
        formationId: nextId("dyn"),
      });
      setConversionProposal(proposal);
    } catch (err) {
      setConversionProposal(null);
      setConversionError(err instanceof Error ? err.message : String(err));
    } finally {
      setConversionBusy(false);
    }
  }, [
    referenceShow,
    selectedForensicSegment,
    conversionMode,
    conversionTolerance,
    conversionRotationFit,
    conversionSuggestGroups,
  ]);

  const discardConversionProposal = useCallback(() => {
    setConversionProposal(null);
    setConversionError(null);
  }, []);

  const applyConversionProposal = useCallback(
    (options: { addToTimeline?: boolean } = {}) => {
      const proposal = conversionProposal;
      if (!proposal) return null;
      const created = proposal.formation;
      commitDynamic((list) => [...list, created]);
      setAppliedConversion({
        formationId: created.id,
        proposal,
        signature: dynamicFormationSignature(created),
        fidelity: proposal.fidelityReport,
      });
      setExplicitDynamicId(created.id);
      setSelectedPointIdsState([]);
      setSelectedMotionGroupId(null);
      setDynamicEditTime(0);
      setConversionProposal(null);
      if (options.addToTimeline) setComparisonMode("RECONSTRUCTED");
      return created;
    },
    [commitDynamic, conversionProposal],
  );

  const conversionComparisonFrame = useMemo(() => {
    const proposal = conversionProposal;
    if (!proposal || comparisonMode === "ORIGINAL") return null;
    const local = Math.min(
      proposal.formation.duration,
      Math.max(0, clock.time - proposal.sourceStartTime),
    );
    try {
      return comparisonFrameAt(proposal, proposal.sourceWorld, local);
    } catch {
      return null;
    }
  }, [conversionProposal, comparisonMode, clock.time]);

  const seekToConversionWorstFrame = useCallback(() => {
    const proposal = conversionProposal ?? appliedConversion?.proposal ?? null;
    const fidelity = conversionProposal
      ? conversionProposal.fidelityReport
      : (appliedConversion?.fidelity ?? null);
    if (!proposal || !fidelity) return;
    clock.seek(proposal.sourceStartTime + fidelity.maxErrorTime);
    const index = proposal.provenance.sourceDroneIds.indexOf(fidelity.maxErrorDroneId);
    setHighlightedDrones(index >= 0 ? [index] : []);
  }, [conversionProposal, appliedConversion, clock]);

  const currentReferenceHash = useMemo(
    () => (referenceShow ? referenceShowHash(referenceShow) : null),
    [referenceShow],
  );

  const conversionSourceAvailable = useMemo(() => {
    const proposal = conversionProposal ?? appliedConversion?.proposal ?? null;
    if (!proposal) return false;
    return currentReferenceHash === proposal.sourceReferenceShowHash;
  }, [conversionProposal, appliedConversion, currentReferenceHash]);

  const appliedConversionFormation = useMemo(
    () =>
      appliedConversion
        ? (dynamicFormations.find((d) => d.id === appliedConversion.formationId) ?? null)
        : null,
    [appliedConversion, dynamicFormations],
  );

  const conversionFidelityStale = useMemo(() => {
    if (!appliedConversion || !appliedConversionFormation) return false;
    return dynamicFormationSignature(appliedConversionFormation) !== appliedConversion.signature;
  }, [appliedConversion, appliedConversionFormation]);

  const recompareConversionToSource = useCallback(() => {
    if (!appliedConversion || !appliedConversionFormation) return;
    const fidelity = evaluateDynamicFormationFidelity(
      fidelitySourceFromProposal(appliedConversion.proposal),
      appliedConversionFormation,
    );
    setAppliedConversion({
      ...appliedConversion,
      fidelity,
      signature: dynamicFormationSignature(appliedConversionFormation),
    });
  }, [appliedConversion, appliedConversionFormation]);


  const referenceSamplesAt = useCallback(
    (t: number) => (referenceShow ? sampleReferenceShow(referenceShow, t) : []),
    [referenceShow],
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
      preShowOverlay,
      preShowStale: preShowPreview
        ? preShowPreview.revision !== analysisRevision
        : fullShowStale,
      showLaunchPads,
      setShowLaunchPads,
      showStaging,
      setShowStaging,
      showLaunchGroups,
      setShowLaunchGroups,
      selectedLaunchGroupId,
      selectLaunchGroup: setSelectedLaunchGroupId,
      highlightedDrones,
      setHighlightedDrones,
      referenceShow,
      referencePlayback,
      setReferencePlayback,
      referenceBusy,
      referenceError,
      importEsspFiles,
      clearReferenceShow,
      referenceSamplesAt,
      selectedReferenceDroneId,
      selectReferenceDrone: setSelectedReferenceDroneId,
      showReferencePaths,
      setShowReferencePaths,
      forensicsReport,
      forensicsBusy,
      forensicsError,
      forensicsPreset,
      setForensicsPreset,
      forensicsThresholds,
      patchForensicsThresholds,
      forensicsStale,
      analyzeReferenceMotion,
      cancelReferenceAnalysis,
      clearForensics,
      selectedForensicSegmentId,
      selectForensicSegment,
      selectedForensicSegment,
      showForensicActiveDrones,
      setShowForensicActiveDrones,
      forensicActiveDroneIds,
      labelForensicSegment,
      exportForensicsReport,
      conversionMode,
      setConversionMode,
      conversionTolerance,
      setConversionTolerance,
      conversionRotationFit,
      setConversionRotationFit,
      conversionSuggestGroups,
      setConversionSuggestGroups,
      conversionBusy,
      conversionError,
      conversionProposal,
      canConvertSelectedSegment,
      analyzeSegmentConversion,
      discardConversionProposal,
      applyConversionProposal,
      comparisonMode,
      setComparisonMode,
      errorVectorScale,
      setErrorVectorScale,
      conversionComparisonFrame,
      seekToConversionWorstFrame,
      appliedConversionFidelity: appliedConversion?.fidelity ?? null,
      appliedConversionFormationId: appliedConversion?.formationId ?? null,
      conversionFidelityStale,
      conversionSourceAvailable,
      recompareConversionToSource,
      conversionTolerancePresets: CONVERSION_TOLERANCE_PRESETS,
      conversionAlgorithmVersion: REFERENCE_DYNAMIC_CONVERTER_VERSION,
      dynamicFormations,
      selectedDynamicFormation,
      selectDynamicFormation,
      dynamicReport,
      createDynamicFromFormation,
      removeDynamicFormation,
      patchDynamicFormation,
      addDynamicClip,
      setClipDynamicFormation,
      applyDynamicPreset,
      mirrorDynamicGroups,
      selectedPointIds,
      togglePointSelection,
      setSelectedPointIds,
      clearPointSelection,
      selectPointSide,
      pointIdForDrone,
      selectedDroneIndices,
      dynamicGroupRgbByDrone,
      selectedMotionGroupId,
      selectMotionGroup: setSelectedMotionGroupId,
      createMotionGroupFromSelection,
      deleteMotionGroup,
      patchMotionGroupState,
      assignSelectionToGroup,
      upsertGlobalKeyframe,
      deleteGlobalKeyframe,
      upsertDeformationKeyframe,
      deleteDeformationKeyframe,
      dynamicEditTime,
      setDynamicEditTime,
      dynamicPreviewPoints,
      undoDynamic,
      redoDynamic,
      canUndoDynamic: dynamicHistoryDepth.past > 0,
      canRedoDynamic: dynamicHistoryDepth.future > 0,
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
      preShowOverlay,
      fullShowStale,
      showLaunchPads,
      showStaging,
      showLaunchGroups,
      selectedLaunchGroupId,
      highlightedDrones,
      referenceShow,
      referencePlayback,
      referenceBusy,
      referenceError,
      importEsspFiles,
      clearReferenceShow,
      referenceSamplesAt,
      selectedReferenceDroneId,
      showReferencePaths,
      forensicsReport,
      forensicsBusy,
      forensicsError,
      forensicsPreset,
      setForensicsPreset,
      forensicsThresholds,
      patchForensicsThresholds,
      forensicsStale,
      analyzeReferenceMotion,
      cancelReferenceAnalysis,
      clearForensics,
      selectedForensicSegmentId,
      selectForensicSegment,
      selectedForensicSegment,
      showForensicActiveDrones,
      forensicActiveDroneIds,
      labelForensicSegment,
      exportForensicsReport,
      conversionMode,
      conversionTolerance,
      conversionRotationFit,
      conversionSuggestGroups,
      conversionBusy,
      conversionError,
      conversionProposal,
      canConvertSelectedSegment,
      analyzeSegmentConversion,
      discardConversionProposal,
      applyConversionProposal,
      comparisonMode,
      errorVectorScale,
      conversionComparisonFrame,
      seekToConversionWorstFrame,
      appliedConversion,
      conversionFidelityStale,
      conversionSourceAvailable,
      recompareConversionToSource,
      dynamicFormations,
      selectedDynamicFormation,
      selectDynamicFormation,
      dynamicReport,
      createDynamicFromFormation,
      removeDynamicFormation,
      patchDynamicFormation,
      addDynamicClip,
      setClipDynamicFormation,
      applyDynamicPreset,
      mirrorDynamicGroups,
      selectedPointIds,
      togglePointSelection,
      setSelectedPointIds,
      clearPointSelection,
      selectPointSide,
      pointIdForDrone,
      selectedDroneIndices,
      dynamicGroupRgbByDrone,
      selectedMotionGroupId,
      createMotionGroupFromSelection,
      deleteMotionGroup,
      patchMotionGroupState,
      assignSelectionToGroup,
      upsertGlobalKeyframe,
      deleteGlobalKeyframe,
      upsertDeformationKeyframe,
      deleteDeformationKeyframe,
      dynamicEditTime,
      dynamicPreviewPoints,
      undoDynamic,
      redoDynamic,
      dynamicHistoryDepth,
    ],

  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useStudio must be used inside <StudioProvider>");
  return ctx;
}
