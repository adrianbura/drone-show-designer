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
import {
  resolveParticipationSettings,
  type ClipParticipationSettings,
  type ParticipationSettings,
} from "../show/participation";
import { buildBeatGrid, decodeAudioFile, type BeatGrid, type WaveformPeaks } from "../show/audio";
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
  createMarker,
  createSection,
  markerTimes,
  sortMarkers,
  sortSections,
  type MusicSection,
  type MusicSectionType,
  type TimelineMarker,
  type TimelineMarkerType,
} from "../show/markers";
import {
  clampZoom,
  computeTimelineView,
  scrollToCenter,
  zoomAtTime,
  type SnapMode,
  type TimelineView,
} from "./timelineEdit";
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
  createProjectFromSetup,
  preShowConfigFromSetup,
  setupDraftFromProject,
  type ProjectSetupDraft,
} from "../show/setup";
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
import { useAudioPlayback } from "./audioPlayback";
import { resolveShortcut } from "./shortcuts";
import { createBrowserKeyValueStore, type KeyValueStore } from "../library/repository";
import {
  addObject,
  alignObjects,
  duplicateObject,
  mirrorObjectX,
  objectProximityWarnings,
  patchObject,
  patchObjectTransform,
  removeObject,
  resolveSceneAt,
  sceneBudget,
  sceneForClip,
  upsertScene,
  type FormationScene,
  type InstanceTransform,
  type ObjectProximityWarning,
  type SceneAlignment,
  type SceneBudget,
  type SceneFormationInstance,
  type SceneObjectSource,
} from "../show/scene";
import {
  AUTOSAVE_DEBOUNCE_MS,
  clearAutosave,
  ensureProjectExtension,
  parseProjectFile,
  projectFileToJson,
  readAutosave,
  serializeProject,
  suggestedProjectFileName,
  toProjectFileError,
  writeAutosave,
  type ProjectAutosaveSnapshot,
} from "../project";
import {
  buildProposalContent,
  mockChoreographyProvider,
  validateProposal,
  type AIChoreographyProposalV1,
  type ChoreographyAIProvider,
} from "../ai";


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
  /**
   * Last time visible in the editor: the show, extended to cover an attached
   * audio track so music can be auditioned before any clip exists. Presentation
   * only — never an input to flight computation.
   */
  viewEnd: number;
  /** Visual peak envelope of the attached local track (display only). */
  audioPeaks: WaveformPeaks | null;
  // ---- Timeline editor state (Sprint 7.2) --------------------------------
  // EDITOR STATE, never project state: zoom / scroll / follow / snap mode never
  // mark the project dirty and never invalidate a validation report.
  /** Visible time window shared by the clip track, waveform and overlays. */
  timelineView: TimelineView;
  timelineZoom: number;
  timelineScroll: number;
  snapMode: SnapMode;
  followPlayhead: boolean;
  setSnapMode: (mode: SnapMode) => void;
  setFollowPlayhead: (on: boolean) => void;
  setTimelineZoom: (zoom: number, anchorTime?: number) => void;
  setTimelineScroll: (scroll: number) => void;
  /** Commits ONE pointer gesture as a single undoable canonical mutation. */
  commitClipTiming: (id: string, patch: Partial<TimelineClip>) => void;
  /** Gesture-level undo/redo of committed timeline edits. */
  undoTimeline: () => void;
  redoTimeline: () => void;
  timelineHistoryDepth: { past: number; future: number };
  // Project-owned authoring annotations.
  markers: TimelineMarker[];
  musicSections: MusicSection[];
  addMarker: (time: number, label?: string, type?: TimelineMarkerType) => void;
  patchMarker: (id: string, patch: Partial<Omit<TimelineMarker, "id">>) => void;
  removeMarker: (id: string) => void;
  addMusicSection: (start: number, end: number, label?: string, type?: MusicSectionType) => void;
  patchMusicSection: (id: string, patch: Partial<Omit<MusicSection, "id">>) => void;
  removeMusicSection: (id: string) => void;
  audioAttached: boolean;
  audioBusy: boolean;
  audioError: string | null;
  audioVolume: number;
  audioMuted: boolean;
  /** Decodes a LOCAL file: bytes never leave the machine, never persisted. */
  attachAudioFile: (file: File) => Promise<void>;
  detachAudioFile: () => void;
  setAudioVolume: (v: number) => void;
  setAudioMuted: (muted: boolean) => void;
  /** Show time at which the audio file starts (seconds, may be negative). */
  setAudioOffset: (offset: number) => void;
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

  // ---- Fleet participation (Sprint 7.3) -----------------------------------
  /** Project-wide participation settings, always fully resolved. */
  participationSettings: ParticipationSettings;
  /** Merges a partial patch onto the project participation settings. */
  patchParticipation: (patch: Partial<ParticipationSettings>) => void;
  /** Sets (or clears with null) the participation override of one clip. */
  setClipParticipation: (clipId: string, override: ClipParticipationSettings | null) => void;

  // ---- Simultaneous multi-formation scenes (Sprint 7.3.5) -----------------
  /** Scene of the selected clip (synthesised for legacy single-formation clips). */
  selectedScene: FormationScene | null;
  /** Live drone budget of the selected scene against the fleet. */
  selectedSceneBudget: SceneBudget | null;
  /** Advisory footprint proximity warnings of the selected scene. */
  selectedSceneWarnings: ObjectProximityWarning[];
  selectedSceneObjectId: string | null;
  selectSceneObject: (objectId: string | null) => void;
  /** Adds one formation instance to a clip's scene and selects it. */
  addSceneObject: (
    clipId: string,
    input: {
      source: SceneObjectSource;
      name: string;
      assetId?: string;
      requestedDroneCount?: number | null;
    },
  ) => string | null;
  patchSceneObject: (
    clipId: string,
    objectId: string,
    patch: Partial<SceneFormationInstance>,
  ) => void;
  patchSceneObjectTransform: (
    clipId: string,
    objectId: string,
    patch: Partial<InstanceTransform>,
  ) => void;
  duplicateSceneObject: (clipId: string, objectId: string) => void;
  removeSceneObject: (clipId: string, objectId: string) => void;
  mirrorSceneObject: (clipId: string, objectId: string) => void;
  alignSceneObjects: (clipId: string, alignment: SceneAlignment) => void;
  patchSceneTransform: (clipId: string, patch: Partial<InstanceTransform>) => void;

  // ---- Project setup wizard + asset library (Sprint 6B.6) -----------------
  /** Replaces the whole project with a new one built from the wizard draft. */
  createProjectFromDraft: (draft: ProjectSetupDraft) => void;
  /** Applies wizard edits (name / fleet / launch geometry) to the open project. */
  applySetupDraft: (draft: ProjectSetupDraft) => void;
  /** Current project expressed as an editable wizard draft. */
  currentSetupDraft: ProjectSetupDraft;
  /** Inserts a library formation as a NEW project formation (fresh id). */
  addLibraryFormation: (formation: Formation) => Formation;
  /** Inserts a library dynamic formation as a NEW dynamic formation (fresh id). */
  addLibraryDynamicFormation: (formation: DynamicFormation) => DynamicFormation;
  setDroneCount: (n: number) => void;
  setLimits: (patch: Partial<SafetyLimits>) => void;
  addFormation: (kind: FormationKind, params?: Record<string, number | string>) => Formation;
  updateFormation: (id: string, params: Record<string, number | string>) => void;
  addClip: (formationId: string, timing?: { transition?: number; hold?: number }) => void;
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
  addDynamicClip: (
    dynamicFormationId: string,
    timing?: { transition?: number; hold?: number },
  ) => void;
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

  // ---- Project persistence (Sprint 7) ------------------------------------
  /** Current file name of the editable project (`*.droneshow.json`). */
  projectFileName: string;
  setProjectFileName: (name: string) => void;
  /** True when the open project differs from the last saved/opened state. */
  projectDirty: boolean;
  /** ISO timestamp of the last explicit save, or null. */
  projectSavedAt: string | null;
  /** ISO timestamp of the last local autosave, or null. */
  projectAutosavedAt: string | null;
  projectFileError: { code: string; message: string } | null;
  clearProjectFileError: () => void;
  /** Writes the project file to disk (browser download). */
  saveProjectFile: () => void;
  /** Loads a project file, replacing the open show only when it is valid. */
  openProjectFile: (file: File) => Promise<void>;
  /** Autosaved snapshot found at startup and not yet accepted or dismissed. */
  autosaveRecovery: ProjectAutosaveSnapshot | null;
  restoreAutosave: () => void;
  dismissAutosave: () => void;

  // ---- AI choreography assistant (Sprint 7) ------------------------------
  aiProvider: { id: string; label: string; deterministic: boolean };
  aiBusy: boolean;
  aiError: { code: string; message: string } | null;
  /** Draft proposal. NOT project content until it is applied by a human. */
  aiProposal: AIChoreographyProposalV1 | null;
  aiProposalErrors: readonly string[];
  /** Proposal history so a refinement can always be rolled back. */
  aiHistory: readonly AIChoreographyProposalV1[];
  /** Preview geometry of the draft at the current preview time. */
  aiPreviewPoints: readonly (readonly [number, number, number])[] | null;
  aiPreviewTime: number;
  setAiPreviewTime: (t: number) => void;
  generateAiProposal: (prompt: string) => Promise<void>;
  refineAiProposal: (instruction: string) => Promise<void>;
  revertAiProposal: () => void;
  discardAiProposal: () => void;
  /** Applies the draft as ordinary project content (undoable). */
  patchAiProposal: (patch: {
    width?: number;
    altitude?: number;
    transition?: number;
    hold?: number;
    cycles?: number;
    cycleDuration?: number;
  }) => void;
  applyAiProposal: (options?: { addToTimeline?: boolean }) => DynamicFormation | Formation | null;
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
  // Clean startup: nothing is selected because nothing is authored yet.
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedSceneObjectId, setSelectedSceneObjectId] = useState<string | null>(null);
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

  // ---- Timeline editor state (Sprint 7.2) --------------------------------
  const [snapMode, setSnapMode] = useState<SnapMode>("S050");
  const [followPlayhead, setFollowPlayhead] = useState(true);
  const [timelineZoom, setTimelineZoomState] = useState(1);
  const [timelineScroll, setTimelineScrollState] = useState(0);
  // One gesture = one snapshot of the canonical choreography data.
  const timelineHistory = useRef<{ past: ShowProject[]; future: ShowProject[] }>({ past: [], future: [] });
  const [timelineHistoryDepth, setTimelineHistoryDepth] = useState({ past: 0, future: 0 });

  // ---- Audio session (Sprint 7.1) ---------------------------------------
  // The decoded buffer lives ONLY in memory for this session: project files stay
  // pure JSON and never embed audio bytes.
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const [audioPeaks, setAudioPeaks] = useState<WaveformPeaks | null>(null);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioVolume, setAudioVolume] = useState(0.8);
  const [audioMuted, setAudioMuted] = useState(false);

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
  // Editor range: an attached track is auditionable even with an empty timeline.
  const viewEnd = useMemo(() => {
    if (referencePlayback && referenceShow) return duration;
    const audioEnd = project.audio.attached ? project.audio.offset + project.audio.duration : 0;
    return Math.max(duration, audioEnd, 1);
  }, [duration, project.audio, referencePlayback, referenceShow]);
  // PRE-SHOW extends playback into negative show time; SHOW TIME ZERO is fixed.
  const clock = useShowClock(viewEnd, referencePlayback && referenceShow ? 0 : plan.startTime);

  const timelineFullStart = referencePlayback && referenceShow ? 0 : plan.startTime;
  const timelineView = useMemo(
    () =>
      computeTimelineView({
        start: timelineFullStart,
        end: viewEnd,
        zoom: timelineZoom,
        scroll: timelineScroll,
      }),
    [timelineFullStart, viewEnd, timelineZoom, timelineScroll],
  );

  const setTimelineZoom = useCallback(
    (zoom: number, anchorTime?: number) => {
      const input = {
        start: timelineFullStart,
        end: viewEnd,
        zoom: timelineZoom,
        scroll: timelineScroll,
      };
      if (typeof anchorTime === "number") {
        const next = zoomAtTime(anchorTime, zoom, input);
        setTimelineZoomState(next.zoom);
        setTimelineScrollState(next.scroll);
        return;
      }
      setTimelineZoomState(clampZoom(zoom));
    },
    [timelineFullStart, viewEnd, timelineZoom, timelineScroll],
  );

  const setTimelineScroll = useCallback((scroll: number) => {
    setTimelineScrollState(Math.min(1, Math.max(0, Number.isFinite(scroll) ? scroll : 0)));
  }, []);

  // The clock stays the master; audio only follows it.
  useAudioPlayback({
    buffer: audioBufferRef.current,
    playing: clock.playing && !referencePlayback,
    time: clock.time,
    speed: clock.speed,
    offset: project.audio.offset,
    volume: audioVolume,
    muted: audioMuted,
  });

  const attachAudioFile = useCallback(async (file: File) => {
    setAudioBusy(true);
    setAudioError(null);
    try {
      const decoded = await decodeAudioFile(file);
      audioBufferRef.current = decoded.buffer;
      setAudioPeaks(decoded.peaks);
      setProject((p) => ({
        ...p,
        audio: { ...p.audio, name: decoded.name, duration: decoded.duration, attached: true },
      }));
    } catch (err) {
      audioBufferRef.current = null;
      setAudioPeaks(null);
      setAudioError(err instanceof Error ? err.message : String(err));
    } finally {
      setAudioBusy(false);
    }
  }, []);

  const detachAudioFile = useCallback(() => {
    audioBufferRef.current = null;
    setAudioPeaks(null);
    setAudioError(null);
    setProject((p) => ({ ...p, audio: { ...p.audio, name: "", duration: 0, attached: false } }));
  }, []);

  const setAudioOffset = useCallback((offset: number) => {
    const value = Number.isFinite(offset) ? Number(offset.toFixed(3)) : 0;
    setProject((p) => ({ ...p, audio: { ...p.audio, offset: value } }));
  }, []);

  const samplesAtTime = useCallback((t: number) => samplesAt(plan, t), [plan]);

  const patchProject = useCallback((patch: Partial<ShowProject>) => {
    setProject((p) => ({ ...p, ...patch }));
  }, []);

  // ---- Fleet participation (Sprint 7.3) -----------------------------------
  const participationSettings = useMemo(
    () => resolveParticipationSettings(project.participation),
    [project.participation],
  );
  const patchParticipation = useCallback((patch: Partial<ParticipationSettings>) => {
    setProject((p) => ({
      ...p,
      participation: resolveParticipationSettings({ ...resolveParticipationSettings(p.participation), ...patch }),
    }));
  }, []);
  const setClipParticipation = useCallback(
    (clipId: string, override: ClipParticipationSettings | null) => {
      setProject((p) => {
        const current = resolveParticipationSettings(p.participation);
        const clips = { ...(current.clips ?? {}) };
        if (override) clips[clipId] = override;
        else delete clips[clipId];
        return { ...p, participation: resolveParticipationSettings({ ...current, clips }) };
      });
    },
    [],
  );

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

  const currentSetupDraft = useMemo(() => setupDraftFromProject(project), [project]);

  const createProjectFromDraft = useCallback((draft: ProjectSetupDraft) => {
    const created = createProjectFromSetup(draft);
    setProject(created);
    setSelectedClipId(created.timeline[0]?.id ?? null);
    setExplicitDynamicId(null);
    setTransitionOverrides({});
    setTransitionAnalysis(null);
    setAssignmentComparison(null);
    setOptimization(null);
    setFullShow(null);
    setPreShowPreview(null);
    setHighlightedDrones([]);
    setSelectedLaunchGroupId(null);
    setSvgDraft(null);
    setSvgError(null);
    timelineHistory.current = { past: [], future: [] };
    setTimelineHistoryDepth({ past: 0, future: 0 });
  }, []);

  const applySetupDraft = useCallback(
    (draft: ProjectSetupDraft) => {
      const count = Math.round(draft.droneCount);
      setProject((p) => ({
        ...p,
        name: draft.name.trim() || p.name,
        preShow: preShowConfigFromSetup(draft, p.preShow),
      }));
      // Fleet size flows through the canonical resampling path so SVG and
      // procedural formations stay exact-N.
      if (count !== project.droneCount) setDroneCount(count);
    },
    [project.droneCount, setDroneCount],
  );

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

  const addClip = useCallback((formationId: string, timing?: { transition?: number; hold?: number }) => {
    const id = nextId("c");
    setProject((p) => {
      const landing = p.timeline.filter((c) => c.phase === "LANDING");
      const body = p.timeline.filter((c) => c.phase !== "LANDING");
      const end = body.reduce((m, c) => Math.max(m, c.start + c.transition + c.hold), 0);
      const clip: TimelineClip = {
        id,
        formationId,
        start: end,
        transition: Math.max(0.5, timing?.transition ?? 8),
        hold: Math.max(0, timing?.hold ?? 6),
        easing: "minJerk",
        color: [120, 220, 255],
        effect: "solid",
        phase: "SHOW",
      };
      const shift = clip.transition + clip.hold;
      return {
        ...p,
        timeline: [...body, clip, ...landing.map((c) => ({ ...c, start: c.start + shift }))],
      };
    });
    setSelectedClipId(id);
  }, []);


  const patchClip = useCallback((id: string, patch: Partial<TimelineClip>) => {
    setProject((p) => ({
      ...p,
      timeline: p.timeline.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  }, []);

  /**
   * GESTURE COMMIT (Sprint 7.2).
   *
   * pointermove may draft freely in the component; exactly one call here lands
   * the canonical mutation, pushes one undo entry, marks the project dirty and
   * lets the existing revision engine mark derived reports stale.
   */
  const commitClipTiming = useCallback((id: string, patch: Partial<TimelineClip>) => {
    setProject((p) => {
      const clip = p.timeline.find((c) => c.id === id);
      if (!clip) return p;
      const next = { ...clip, ...patch };
      if (next.start === clip.start && next.transition === clip.transition && next.hold === clip.hold) {
        return p;
      }
      timelineHistory.current.past.push(p);
      timelineHistory.current.future = [];
      setTimelineHistoryDepth({
        past: timelineHistory.current.past.length,
        future: 0,
      });
      return { ...p, timeline: p.timeline.map((c) => (c.id === id ? next : c)) };
    });
  }, []);

  /** Snapshot helper for annotation edits — same one-entry-per-action rule. */
  const pushTimelineHistory = useCallback(() => {
    setProject((p) => {
      timelineHistory.current.past.push(p);
      timelineHistory.current.future = [];
      setTimelineHistoryDepth({ past: timelineHistory.current.past.length, future: 0 });
      return p;
    });
  }, []);

  const undoTimeline = useCallback(() => {
    const previous = timelineHistory.current.past.pop();
    if (!previous) return;
    setProject((p) => {
      timelineHistory.current.future.push(p);
      setTimelineHistoryDepth({
        past: timelineHistory.current.past.length,
        future: timelineHistory.current.future.length,
      });
      return previous;
    });
  }, []);

  const redoTimeline = useCallback(() => {
    const next = timelineHistory.current.future.pop();
    if (!next) return;
    setProject((p) => {
      timelineHistory.current.past.push(p);
      setTimelineHistoryDepth({
        past: timelineHistory.current.past.length,
        future: timelineHistory.current.future.length,
      });
      return next;
    });
  }, []);

  // ---- Markers / music sections (project-owned authoring metadata) --------
  const addMarker = useCallback(
    (time: number, label?: string, type?: TimelineMarkerType) => {
      pushTimelineHistory();
      const marker = createMarker({ id: nextId("mk"), time, label: label ?? "Marker", type: type ?? "GENERAL" });
      setProject((p) => ({ ...p, markers: sortMarkers([...(p.markers ?? []), marker]) }));
    },
    [pushTimelineHistory],
  );

  const patchMarker = useCallback(
    (id: string, patch: Partial<Omit<TimelineMarker, "id">>) => {
      pushTimelineHistory();
      setProject((p) => ({
        ...p,
        markers: sortMarkers(
          (p.markers ?? []).map((m) => (m.id === id ? createMarker({ ...m, ...patch, id: m.id }) : m)),
        ),
      }));
    },
    [pushTimelineHistory],
  );

  const removeMarker = useCallback(
    (id: string) => {
      pushTimelineHistory();
      setProject((p) => ({ ...p, markers: (p.markers ?? []).filter((m) => m.id !== id) }));
    },
    [pushTimelineHistory],
  );

  const addMusicSection = useCallback(
    (start: number, end: number, label?: string, type?: MusicSectionType) => {
      pushTimelineHistory();
      const section = createSection({
        id: nextId("ms"),
        start,
        end,
        label: label ?? "Section",
        type: type ?? "CUSTOM",
      });
      setProject((p) => ({ ...p, musicSections: sortSections([...(p.musicSections ?? []), section]) }));
    },
    [pushTimelineHistory],
  );

  const patchMusicSection = useCallback(
    (id: string, patch: Partial<Omit<MusicSection, "id">>) => {
      pushTimelineHistory();
      setProject((p) => ({
        ...p,
        musicSections: sortSections(
          (p.musicSections ?? []).map((s) => (s.id === id ? createSection({ ...s, ...patch, id: s.id }) : s)),
        ),
      }));
    },
    [pushTimelineHistory],
  );

  const removeMusicSection = useCallback(
    (id: string) => {
      pushTimelineHistory();
      setProject((p) => ({ ...p, musicSections: (p.musicSections ?? []).filter((s) => s.id !== id) }));
    },
    [pushTimelineHistory],
  );

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
  const selectedScene = useMemo<FormationScene | null>(() => {
    const clip = project.timeline.find((c) => c.id === selectedClipId);
    return clip ? sceneForClip(project, clip) : null;
  }, [project, selectedClipId]);

  const selectedSceneBudget = useMemo<SceneBudget | null>(
    () => (selectedScene ? sceneBudget(project, selectedScene, project.droneCount) : null),
    [project, selectedScene],
  );

  const selectedSceneWarnings = useMemo<ObjectProximityWarning[]>(() => {
    if (!selectedScene || selectedScene.objects.length < 2) return [];
    try {
      return objectProximityWarnings(resolveSceneAt(project, selectedScene, 0), project.limits);
    } catch {
      return [];
    }
  }, [project, selectedScene]);

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

  // ---- multi-formation scenes ---------------------------------------------
  /**
   * Every scene edit resolves the clip's scene INSIDE the updater, so a library
   * insert that adds a formation and composes it in the same tick still sees it.
   */
  const editScene = useCallback(
    (clipId: string, fn: (scene: FormationScene, p: ShowProject) => FormationScene) => {
      setProject((p) => {
        const clip = p.timeline.find((c) => c.id === clipId);
        if (!clip) return p;
        return upsertScene(p, fn(sceneForClip(p, clip), p));
      });
    },
    [],
  );

  const addSceneObject = useCallback(
    (
      clipId: string,
      input: {
        source: SceneObjectSource;
        name: string;
        assetId?: string;
        requestedDroneCount?: number | null;
      },
    ) => {
      let createdId: string | null = null;
      editScene(clipId, (scene, p) => {
        const result = addObject(p, scene, input);
        createdId = result.objectId;
        return result.scene;
      });
      if (createdId) setSelectedSceneObjectId(createdId);
      return createdId;
    },
    [editScene],
  );

  const patchSceneObject = useCallback(
    (clipId: string, objectId: string, patch: Partial<SceneFormationInstance>) => {
      editScene(clipId, (scene) => patchObject(scene, objectId, patch));
    },
    [editScene],
  );

  const patchSceneObjectTransform = useCallback(
    (clipId: string, objectId: string, patch: Partial<InstanceTransform>) => {
      editScene(clipId, (scene) => patchObjectTransform(scene, objectId, patch));
    },
    [editScene],
  );

  const duplicateSceneObject = useCallback(
    (clipId: string, objectId: string) => {
      let createdId: string | null = null;
      editScene(clipId, (scene) => {
        const result = duplicateObject(scene, objectId);
        createdId = result.objectId;
        return result.scene;
      });
      if (createdId) setSelectedSceneObjectId(createdId);
    },
    [editScene],
  );

  const removeSceneObject = useCallback(
    (clipId: string, objectId: string) => {
      editScene(clipId, (scene) => removeObject(scene, objectId));
      setSelectedSceneObjectId((current) => (current === objectId ? null : current));
    },
    [editScene],
  );

  const mirrorSceneObject = useCallback(
    (clipId: string, objectId: string) => {
      editScene(clipId, (scene) => mirrorObjectX(scene, objectId));
    },
    [editScene],
  );

  const alignSceneObjects = useCallback(
    (clipId: string, alignment: SceneAlignment) => {
      editScene(clipId, (scene, p) => alignObjects(p, scene, alignment));
    },
    [editScene],
  );

  const patchSceneTransform = useCallback(
    (clipId: string, patch: Partial<InstanceTransform>) => {
      editScene(clipId, (scene) => ({
        ...scene,
        transform: { ...scene.transform, ...patch },
      }));
    },
    [editScene],
  );

  const addLibraryFormation = useCallback((formation: Formation) => {
    // A library asset is a template: the project always gets a fresh id so the
    // stored asset and the project copy can diverge independently.
    const created: Formation = { ...formation, id: nextId("f") };
    setProject((p) => ({ ...p, formations: [...p.formations, created] }));
    return created;
  }, []);

  const addLibraryDynamicFormation = useCallback(
    (formation: DynamicFormation) => {
      const created: DynamicFormation = { ...formation, id: nextId("dyn") };
      commitDynamic((list) => [...list, created]);
      return created;
    },
    [commitDynamic],
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
    (dynamicFormationId: string, timing?: { transition?: number; hold?: number }) => {
      const id = nextId("c");
      // Resolve the dynamic formation INSIDE the updater: a library insert adds
      // the formation and the clip in the same tick, so the closure snapshot of
      // project.dynamicFormations would still be empty here.
      setProject((p) => {
        const dynamic = (p.dynamicFormations ?? []).find((d) => d.id === dynamicFormationId);
        if (!dynamic) return p;
        const landing = p.timeline.filter((c) => c.phase === "LANDING");
        const body = p.timeline.filter((c) => c.phase !== "LANDING");
        const end = body.reduce((m, c) => Math.max(m, c.start + c.transition + c.hold), 0);
        const sourceId =
          dynamic.sourceFormationId && p.formations.some((f) => f.id === dynamic.sourceFormationId)
            ? dynamic.sourceFormationId
            : (p.formations[0]?.id ?? "");
        const clip: TimelineClip = {
          id,
          formationId: sourceId,
          start: end,
          transition: Math.max(0.5, timing?.transition ?? 10),
          // A dynamic clip holds for at least one full animation cycle.
          hold: Math.max(timing?.hold ?? 0, dynamic.duration, 4),
          easing: "minJerk",
          color: [140, 210, 255],
          effect: "solid",
          phase: "SHOW",
          dynamicFormationId: dynamic.id,
          playbackRate: 1,
          dynamicStartOffset: 0,
        };
        const shift = clip.transition + clip.hold;
        return {
          ...p,
          timeline: [...body, clip, ...landing.map((c) => ({ ...c, start: c.start + shift }))],
        };
      });

      setSelectedClipId(id);
      setExplicitDynamicId(dynamicFormationId);
    },
    [],
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

  // ---- Project persistence (Sprint 7) --------------------------------------
  // Saving is pure serialization of the editable project; autosave stores the
  // SAME envelope locally so a crash recovery is just a reopened project.
  const [projectFileName, setProjectFileNameState] = useState<string>(() =>
    suggestedProjectFileName(project.name),
  );
  const [projectDirty, setProjectDirty] = useState(false);
  const [projectSavedAt, setProjectSavedAt] = useState<string | null>(null);
  const [projectAutosavedAt, setProjectAutosavedAt] = useState<string | null>(null);
  const [projectFileError, setProjectFileError] = useState<{ code: string; message: string } | null>(
    null,
  );
  const [autosaveRecovery, setAutosaveRecovery] = useState<ProjectAutosaveSnapshot | null>(null);
  const savedSignature = useRef<string | null>(null);
  const autosaveStore = useRef<KeyValueStore | null>(null);
  const lastAutosaveAt = useRef(0);

  const getAutosaveStore = useCallback((): KeyValueStore | null => {
    if (typeof window === "undefined") return null;
    autosaveStore.current ??= createBrowserKeyValueStore();
    return autosaveStore.current;
  }, []);

  const setProjectFileName = useCallback((name: string) => {
    setProjectFileNameState(ensureProjectExtension(name));
  }, []);

  const clearProjectFileError = useCallback(() => setProjectFileError(null), []);

  // Any project change marks the file dirty; the signature makes a save -> edit
  // -> undo cycle land back on "saved" instead of staying falsely dirty.
  useEffect(() => {
    const signature = JSON.stringify(project);
    setProjectDirty(savedSignature.current !== null && savedSignature.current !== signature);
  }, [project]);

  const markSaved = useCallback((snapshotName?: string) => {
    savedSignature.current = JSON.stringify(project);
    setProjectDirty(false);
    setProjectSavedAt(new Date().toISOString());
    if (snapshotName) setProjectFileNameState(ensureProjectExtension(snapshotName));
  }, [project]);

  const saveProjectFile = useCallback(() => {
    try {
      const file = serializeProject(project, {
        editor: { selectedClipId, sampleRate, assignmentStrategy },
      });
      const name = ensureProjectExtension(projectFileName || suggestedProjectFileName(project.name));
      const blob = new Blob([projectFileToJson(file)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      URL.revokeObjectURL(url);
      setProjectFileError(null);
      markSaved(name);
    } catch (err) {
      const error = toProjectFileError(err);
      setProjectFileError({ code: error.code, message: error.message });
    }
  }, [project, selectedClipId, sampleRate, assignmentStrategy, projectFileName, markSaved]);

  /** Replaces every derived/analysis result after the project is replaced. */
  const adoptProject = useCallback((next: ShowProject, fileName: string) => {
    setProject(next);
    setSelectedClipId(next.timeline[0]?.id ?? null);
    setExplicitDynamicId(null);
    setTransitionOverrides({});
    setTransitionAnalysis(null);
    setAssignmentComparison(null);
    setOptimization(null);
    setFullShow(null);
    setPreShowPreview(null);
    setHighlightedDrones([]);
    setSelectedLaunchGroupId(null);
    setSvgDraft(null);
    setSvgError(null);
    setSelectedPointIdsState([]);
    setSelectedMotionGroupId(null);
    setDynamicEditTime(0);
    dynamicHistory.current = { past: [], future: [] };
    setDynamicHistoryDepth({ past: 0, future: 0 });
    timelineHistory.current = { past: [], future: [] };
    setTimelineHistoryDepth({ past: 0, future: 0 });
    savedSignature.current = JSON.stringify(next);
    setProjectDirty(false);
    setProjectFileNameState(ensureProjectExtension(fileName || suggestedProjectFileName(next.name)));
  }, []);

  const openProjectFile = useCallback(
    async (file: File) => {
      try {
        const parsed = parseProjectFile(await file.text());
        adoptProject(parsed.project, file.name);
        if (typeof parsed.editor?.sampleRate === "number") setSampleRate(parsed.editor.sampleRate);
        setProjectSavedAt(parsed.savedAt);
        setProjectFileError(null);
      } catch (err) {
        // The open project is left completely untouched on any failure.
        const error = toProjectFileError(err);
        setProjectFileError({ code: error.code, message: error.message });
      }
    },
    [adoptProject],
  );

  // Startup recovery offer — never applied automatically.
  useEffect(() => {
    const store = getAutosaveStore();
    if (!store) return;
    let active = true;
    void readAutosave(store).then((snapshot) => {
      if (active && snapshot) setAutosaveRecovery(snapshot);
    });
    return () => {
      active = false;
    };
  }, [getAutosaveStore]);

  // Debounced autosave. Never runs on an animation frame: it only reacts to
  // project mutations, and at most once per debounce window.
  useEffect(() => {
    const store = getAutosaveStore();
    if (!store) return;
    const delay = Math.max(0, AUTOSAVE_DEBOUNCE_MS - (Date.now() - lastAutosaveAt.current));
    const timer = setTimeout(() => {
      lastAutosaveAt.current = Date.now();
      const savedAt = new Date().toISOString();
      void writeAutosave(store, {
        savedAt,
        fileName: projectFileName,
        file: serializeProject(project, { savedAt }),
      }).then(() => setProjectAutosavedAt(savedAt));
    }, delay);
    return () => clearTimeout(timer);
  }, [project, projectFileName, getAutosaveStore]);

  const restoreAutosave = useCallback(() => {
    const snapshot = autosaveRecovery;
    if (!snapshot) return;
    adoptProject(snapshot.file.project, snapshot.fileName || suggestedProjectFileName(snapshot.file.project.name));
    setProjectSavedAt(null);
    setProjectDirty(true);
    setAutosaveRecovery(null);
  }, [autosaveRecovery, adoptProject]);

  const dismissAutosave = useCallback(() => {
    setAutosaveRecovery(null);
    const store = getAutosaveStore();
    if (store) void clearAutosave(store);
  }, [getAutosaveStore]);

  // ---- AI choreography assistant (Sprint 7) -------------------------------
  // The provider only ever returns STRUCTURED DESIGN INTENT. Geometry comes from
  // the deterministic builder, and feasibility stays with the safety validator.
  const aiProvider = useRef<ChoreographyAIProvider>(mockChoreographyProvider);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<{ code: string; message: string } | null>(null);
  const [aiProposal, setAiProposal] = useState<AIChoreographyProposalV1 | null>(null);
  const [aiProposalErrors, setAiProposalErrors] = useState<readonly string[]>([]);
  const [aiHistory, setAiHistory] = useState<readonly AIChoreographyProposalV1[]>([]);
  const [aiPreviewTime, setAiPreviewTime] = useState(0);

  const aiBuilt = useMemo(() => {
    if (!aiProposal || aiProposalErrors.length > 0) return null;
    try {
      return buildProposalContent(aiProposal, { area: project.area, seed: project.seed });
    } catch {
      return null;
    }
  }, [aiProposal, aiProposalErrors, project.area, project.seed]);

  const aiPreviewPoints = useMemo(() => {
    if (!aiBuilt) return null;
    if (!aiBuilt.dynamicFormation) return aiBuilt.formation.points;
    return sampleDynamicFormation(aiBuilt.dynamicFormation, aiPreviewTime);
  }, [aiBuilt, aiPreviewTime]);

  const acceptProposal = useCallback(
    (proposal: AIChoreographyProposalV1) => {
      const validation = validateProposal(proposal, project.droneCount);
      setAiProposal(proposal);
      setAiProposalErrors(validation.errors);
      setAiPreviewTime(0);
    },
    [project.droneCount],
  );

  const generateAiProposal = useCallback(
    async (prompt: string) => {
      setAiBusy(true);
      setAiError(null);
      try {
        const proposal = await aiProvider.current.generateProposal({
          prompt,
          fleetCount: project.droneCount,
          area: project.area,
          seed: project.seed,
        });
        setAiHistory([]);
        acceptProposal(proposal);
      } catch (err) {
        setAiProposal(null);
        setAiError({
          code: (err as { code?: string }).code ?? "PROVIDER_UNAVAILABLE",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setAiBusy(false);
      }
    },
    [project.droneCount, project.area, project.seed, acceptProposal],
  );

  const refineAiProposal = useCallback(
    async (instruction: string) => {
      const base = aiProposal;
      if (!base) return;
      setAiBusy(true);
      setAiError(null);
      try {
        const next = await aiProvider.current.refineProposal({ proposal: base, instruction });
        setAiHistory((h) => [...h, base].slice(-20));
        acceptProposal(next);
      } catch (err) {
        setAiError({
          code: (err as { code?: string }).code ?? "PROVIDER_UNAVAILABLE",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setAiBusy(false);
      }
    },
    [aiProposal, acceptProposal],
  );

  const revertAiProposal = useCallback(() => {
    setAiHistory((h) => {
      const previous = h.at(-1);
      if (previous) acceptProposal(previous);
      return h.slice(0, -1);
    });
  }, [acceptProposal]);

  /**
   * Human edit of a DRAFT proposal. The proposal stays a proposal: the edit is
   * re-validated against project constraints and the deterministic builder
   * regenerates geometry, so nothing bypasses validation.
   */
  const patchAiProposal = useCallback(
    (patch: {
      width?: number;
      altitude?: number;
      transition?: number;
      hold?: number;
      cycles?: number;
      cycleDuration?: number;
    }) => {
      setAiProposal((current) => {
        if (!current) return current;
        const next: AIChoreographyProposalV1 = {
          ...current,
          formationSpec: {
            ...current.formationSpec,
            width: patch.width ?? current.formationSpec.width,
            altitude: patch.altitude ?? current.formationSpec.altitude,
          },
          animationSpec: {
            ...current.animationSpec,
            cycles: patch.cycles ?? current.animationSpec.cycles,
            cycleDuration: patch.cycleDuration ?? current.animationSpec.cycleDuration,
          },
          timing: {
            recommendedTransition: patch.transition ?? current.timing.recommendedTransition,
            hold: patch.hold ?? current.timing.hold,
          },
        };
        setAiProposalErrors(validateProposal(next, project.droneCount).errors);
        return next;
      });
    },
    [project.droneCount],
  );

  const discardAiProposal = useCallback(() => {
    setAiProposal(null);
    setAiProposalErrors([]);
    setAiHistory([]);
    setAiError(null);
  }, []);

  const applyAiProposal = useCallback(
    (options: { addToTimeline?: boolean } = {}) => {
      const built = aiBuilt;
      const proposal = aiProposal;
      if (!built || !proposal) return null;
      const formation: Formation = { ...built.formation, id: nextId("f") };
      setProject((p) => ({ ...p, formations: [...p.formations, formation] }));

      if (!built.dynamicFormation) {
        if (options.addToTimeline) {
          addClip(formation.id, {
            transition: proposal.timing.recommendedTransition,
            hold: proposal.timing.hold,
          });
        }
        discardAiProposal();
        return formation;
      }
      const dynamic: DynamicFormation = {
        ...built.dynamicFormation,
        id: nextId("dyn"),
        sourceFormationId: formation.id,
      };
      commitDynamic((list) => [...list, dynamic]);
      setExplicitDynamicId(dynamic.id);
      setSelectedPointIdsState([]);
      setSelectedMotionGroupId(null);
      setDynamicEditTime(0);
      if (options.addToTimeline) {
        addDynamicClip(dynamic.id, {
          transition: proposal.timing.recommendedTransition,
          hold: proposal.timing.hold,
        });
      }
      discardAiProposal();
      return dynamic;
    },
    [aiBuilt, aiProposal, addClip, addDynamicClip, commitDynamic, discardAiProposal],
  );

  // ---- Playback / editing keyboard shortcuts (Sprint 7) -------------------
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveShortcut({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        repeat: event.repeat,
        target: event.target as HTMLElement | null,
      });
      if (!action) return;
      event.preventDefault();
      switch (action.type) {
        case "togglePlay":
          clock.toggle();
          break;
        case "seek":
          clock.seek(clock.time + action.delta);
          break;
        case "seekStart":
          clock.seek(plan.startTime);
          break;
        case "seekEnd":
          clock.seek(duration);
          break;
        case "undo":
          // Timeline gestures are the most recent kind of edit in practice, so
          // they are unwound first; dynamic-formation history is the fallback.
          if (timelineHistory.current.past.length > 0) undoTimeline();
          else undoDynamic();
          break;
        case "redo":
          if (timelineHistory.current.future.length > 0) redoTimeline();
          else redoDynamic();
          break;
        case "clearSelection":
          setSelectedPointIdsState([]);
          setSelectedMotionGroupId(null);
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clock, duration, plan.startTime, undoDynamic, redoDynamic, undoTimeline, redoTimeline]);

  // FOLLOW PLAYHEAD — pure editor navigation: keeps the playhead visible during
  // playback without ever touching project state.
  useEffect(() => {
    if (!followPlayhead || !clock.playing || timelineZoom <= 1) return;
    if (clock.time >= timelineView.start && clock.time <= timelineView.end) return;
    setTimelineScrollState(
      scrollToCenter(clock.time, {
        start: timelineFullStart,
        end: viewEnd,
        zoom: timelineZoom,
        scroll: timelineScroll,
      }),
    );
  }, [
    followPlayhead,
    clock.playing,
    clock.time,
    timelineView,
    timelineZoom,
    timelineScroll,
    timelineFullStart,
    viewEnd,
  ]);



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
      viewEnd,
      audioPeaks,
      timelineView,
      timelineZoom,
      timelineScroll,
      snapMode,
      followPlayhead,
      setSnapMode,
      setFollowPlayhead,
      setTimelineZoom,
      setTimelineScroll,
      commitClipTiming,
      undoTimeline,
      redoTimeline,
      timelineHistoryDepth,
      markers: project.markers ?? [],
      musicSections: project.musicSections ?? [],
      addMarker,
      patchMarker,
      removeMarker,
      addMusicSection,
      patchMusicSection,
      removeMusicSection,
      audioAttached: project.audio.attached === true,
      audioBusy,
      audioError,
      audioVolume,
      audioMuted,
      attachAudioFile,
      detachAudioFile,
      setAudioVolume,
      setAudioMuted,
      setAudioOffset,
      time: clock.time,
      playing: clock.playing,
      speed: clock.speed,
      loop: clock.loop,
      selectedScene,
      selectedSceneBudget,
      selectedSceneWarnings,
      selectedSceneObjectId,
      selectSceneObject: setSelectedSceneObjectId,
      addSceneObject,
      patchSceneObject,
      patchSceneObjectTransform,
      duplicateSceneObject,
      removeSceneObject,
      mirrorSceneObject,
      alignSceneObjects,
      patchSceneTransform,
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
      participationSettings,
      patchParticipation,
      setClipParticipation,
      createProjectFromDraft,
      applySetupDraft,
      currentSetupDraft,
      addLibraryFormation,
      addLibraryDynamicFormation,
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
      projectFileName,
      setProjectFileName,
      projectDirty,
      projectSavedAt,
      projectAutosavedAt,
      projectFileError,
      clearProjectFileError,
      saveProjectFile,
      openProjectFile,
      autosaveRecovery,
      restoreAutosave,
      dismissAutosave,
      aiProvider: {
        id: aiProvider.current.id,
        label: aiProvider.current.label,
        deterministic: aiProvider.current.deterministic,
      },
      aiBusy,
      aiError,
      aiProposal,
      aiProposalErrors,
      aiHistory,
      aiPreviewPoints,
      aiPreviewTime,
      setAiPreviewTime,
      generateAiProposal,
      refineAiProposal,
      revertAiProposal,
      discardAiProposal,
      patchAiProposal,
      applyAiProposal,
    }),

    [
      project,
      plan,
      trajectorySet,
      sampleRate,
      safety,
      beatGrid,
      duration,
      viewEnd,
      audioPeaks,
      timelineView,
      timelineZoom,
      timelineScroll,
      snapMode,
      followPlayhead,
      setTimelineZoom,
      setTimelineScroll,
      commitClipTiming,
      undoTimeline,
      redoTimeline,
      timelineHistoryDepth,
      addMarker,
      patchMarker,
      removeMarker,
      addMusicSection,
      patchMusicSection,
      removeMusicSection,
      audioBusy,
      audioError,
      audioVolume,
      audioMuted,
      attachAudioFile,
      detachAudioFile,
      setAudioOffset,
      clock,
      selectedScene,
      selectedSceneBudget,
      selectedSceneWarnings,
      selectedSceneObjectId,
      addSceneObject,
      patchSceneObject,
      patchSceneObjectTransform,
      duplicateSceneObject,
      removeSceneObject,
      mirrorSceneObject,
      alignSceneObjects,
      patchSceneTransform,
      selectedClipId,
      samplesAtTime,
      patchProject,
      participationSettings,
      patchParticipation,
      setClipParticipation,
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
      projectFileName,
      setProjectFileName,
      projectDirty,
      projectSavedAt,
      projectAutosavedAt,
      projectFileError,
      clearProjectFileError,
      saveProjectFile,
      openProjectFile,
      autosaveRecovery,
      restoreAutosave,
      dismissAutosave,
      aiBusy,
      aiError,
      aiProposal,
      aiProposalErrors,
      aiHistory,
      aiPreviewPoints,
      aiPreviewTime,
      generateAiProposal,
      refineAiProposal,
      revertAiProposal,
      discardAiProposal,
      patchAiProposal,
      applyAiProposal,
    ],

  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useStudio must be used inside <StudioProvider>");
  return ctx;
}
