Warning: truncated output (original token count: 67331)
Total output lines: 7213

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
import { invalidateDerivedAnalysis, type DerivedAnalysisSetters } from "./derivedAnalysis";
import {
  ADOPTED_TIMELINE_VIEW,
  boundHistory,
  reconcileAdoptedEditorSession,
} from "./editorSession";
import { documentDirty } from "./unsavedWorkGuard";
import { documentFeedback, saveAsFileName, type DocumentFeedback } from "./documentLifecycle";

import { setGeometryProposalPreview } from "./geometryProposalPreview";

import {
  createAsyncJobAuthority,
  createProjectSessionAuthority,
  invalidateProjectSessionJobs,
} from "./asyncJobAuthority";
import { resetProjectSessionState, type ProjectSessionResetSetters } from "./projectLifecycle";
import { isAutosaveWriteAuthorized, isRecoveryOfferable } from "./autosaveAuthority";
import { projectPersistenceOptions } from "./projectPersistence";
import { createAnalysisRunAuthority } from "./analysisRunAuthority";
import { findSampleShow } from "../show/stories/samples";
import { generatePoints, makeFormation, makeSceneLocalFormation } from "../show/formations";
import {
  buildShowPlan,
  samplesAt,
  sampleTrajectorySet,
  DEFAULT_SAMPLE_RATE,
} from "../show/trajectory";
import type {
  ClipTransitionOverride,
  ShowPlan,
  TrajectorySample,
  TrajectorySet,
} from "../show/trajectory";
import { validateShow, type SafetyReport } from "../show/safety";
import {
  resolveParticipationSettings,
  type ClipParticipationSettings,
  type ParticipationSettings,
} from "../show/participation";
import { buildBeatGrid, decodeAudioFile, type BeatGrid, type WaveformPeaks } from "../show/audio";
import {
  LIGHTING_SCHEMA_VERSION,
  createEffectFromPreset,
  effectsForClip,
  findLightingPreset,
  newLightingEffectId,
  projectLightingAt,
  validateLightingProgram,
  type DroneLightState,
  type LightingEffectInstance,
  type LightingEffectParameters,
  type LightingTarget,
  type LightingValidationReport,
} from "../show/lighting";
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
  buildDesignOverride,
  DEFAULT_TRANSITION_DESIGN,
  deriveTransitionMode,
  normalizeTransitionDesign,
  applyTransitionDesignToShow,
  type BulkTransitionDesignResult,
  type TransitionDesignState,
  type TransitionAnalysis,
  type TransitionOptimizationResult,
} from "../show/transition";
import {
  analyzeFullShow as analyzeFullShowCore,
  type AnalyzeFullShowOptions,
  computeAnalysisRevision,
  FullShowError,
  type FullShowIssue,
  type FullShowPlan,
  type FullShowProgress,
  sampleEffectiveTrajectorySet,
  type EffectiveTrajectoryAuthority,
  type FullShowValidationReport,
} from "../show/fullshow";
import type {
  Formation,
  FormationKind,
  RGB,
  SafetyLimits,
  ShowProject,
  TimelineClip,
  Vector3Tuple,
} from "../show/types";
import { showDuration } from "../show/types";
import { nextSelectedClipId, removeTimelineClipReferences } from "../show/timeline";
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
import { timelineContentRange } from "./timelineLayout";
import { insertClipBeforeLanding } from "./clipInsertion";
import { canConvertClipToScene, convertClipToScene, duplicateShowClip } from "./clipDesign";
import {
  applyPointSelection,
  type ScenePointSelectionOperation,
  type ScenePointSelectionTool,
} from "./scenePointSelection";
import { authorSceneMotion } from "./sceneMotionAuthoring";
import { duplicateObjectMotion, removeObjectMotion } from "./sceneMotionInspector";
import { insertLibraryAsset, type AssetInsertionTiming } from "./assetInsertion";
import { reconcileEditorSelection, type EditorClipSelectionState } from "./clipSelection";
import {
  computeOverrideBasis,
  pruneTransitionOverrides,
  type OverrideBasisMap,
  type TimelineHistorySnapshot,
} from "./planningIntegrity";
import {
  prepareGeometryApplyCommand,
  type GeometryApplyPreparationSuccess,
} from "./geometryApplyCommand";
import {
  prepareTextFormationApply,
  type PromotedTextInterval,
  type TextApplyBlocker,
} from "./textFormationApplyCommand";
import type { TextPreviewRequest } from "./textFormationPreview";

/** Result of a deterministic text apply command. */
export type TextApplyCommitResult =
  | {
      readonly ok: true;
      readonly formationId: string;
      readonly newlyPlannedIntervals: readonly PromotedTextInterval[];
      readonly invalidatedTransitionOverrideClipIds: readonly string[];
      readonly promotedReferenceClipIds: readonly string[];
      readonly note: string;
    }
  | { readonly ok: false; readonly blockers: readonly TextApplyBlocker[]; readonly note: string };
import {
  installPreparedGeometryApply,
  type GeometryApplyCommitResult,
} from "./geometryApplyStoreTransaction";
import type { GeometryApplyReadinessReport } from "../show/diagnostics/geometryApplyReadiness";
import {
  clampZoom,
  defaultPhaseForNewClip,
  computeTimelineView,
  preserveScrollAcrossRange,
  scrollToCenter,
  timelineScrollGeometry as computeScrollGeometry,
  zoomAtTime,
  type SnapMode,
  type TimelineScrollGeometry,
  type TimelineView,
} from "./timelineEdit";
import { rippleClipTiming, type RippleMode } from "./timelineRipple";
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
import { makeTextFormation, type TextGeometryRecipe } from "../show/text";
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
import {
  canResetSceneObject,
  correspondenceLines,
  duplicateSceneAsEditableCopy,
  referenceGhostFrame,
  resetSceneObjectToExtracted,
  sceneDeviationReport,
  type CorrespondenceLine,
  type ReferenceClipBinding,
  type ReferenceGhostFrame,
  type SceneComparisonFrame,
  type SceneDeviationReport,
} from "../import/essp/native";
import {
  clipOutputSignature,
  extractReferenceTimeline,
  intervalAtTime,
  promoteReferenceClips,
  reconcileReferenceLayer,
  referenceColorsAt as referenceColorsAtTime,
  referenceLightStates,
  referenceOwnershipSummary,
  referenceShowFromLayer,
  reseedReferenceSignatures,
  splicedTrajectorySamples,
  verifySpliceBoundaries,
  REFERENCE_LAYER_LIMITATIONS,
  ReferenceLayerError,
  type ReferenceAssetDraft,
  type ReferenceExtractionDiagnostic,
  type ReferenceOwnershipSummary,
  type ReferenceTrajectoryLayer,
  type SpliceVerificationReport,
} from "../import/essp/native";
import { useShowClock, type PlaybackSpeed } from "./clock";
import { useAudioPlayback } from "./audioPlayback";
import { resolveShortcut } from "./shortcuts";
import { createBrowserKeyValueStore, type KeyValueStore } from "../library/repository";
import {
  collectSceneDependencies,
  instantiateSceneAsset,
  sceneAssetDuration,
  type FormationAsset,
  type SceneAssetDependencies,
} from "../library";
import {
  addObject,
  addScenePointGroup,
  addSceneVisualGroup,
  addSceneVisualStateCue,
  applySceneVisualState,
  alignObjects,
  applySceneClick,
  EMPTY_SCENE_SELECTION,
  applySceneGroupDelta,
  duplicateObject,
  duplicateSceneObjects,
  mirrorObjectX,
  mirrorSceneObjects,
  mixedTransformFlags,
  normalizeSceneSelection,
  objectProximityWarnings,
  patchObject,
  patchObjectTransform,
  patchScenePointGroup,
  patchSceneVisualStateCue,
  captureSceneVisualState,
  renameSceneVisualGroup,
  renameSceneVisualState,
  removeObject,
  removeScenePointGroup,
  removeSceneVisualGroup,
  removeSceneVisualState,
  removeSceneVisualStateCue,
  removeSceneObjects,
  resolveSceneAt,
  sceneBudget,
  sceneForClip,
  sceneGroupPivot,
  applySceneDesignAction,
  alignSceneObjectsBy,
  selectAllSceneObjects,
  projectScene,
  upsertScene,
  type FormationScene,
  type InstanceTransform,
  type MixedTransformFlags,
  type ObjectProximityWarning,
  type SceneAlignment,
  type SceneBudget,
  type SceneClickMode,
  timelineThumbnails,
  type ThumbnailPoint,
  type SceneDesignActionKind,
  type SceneAlignMode,
  type SceneFormationInstance,
  type SceneObjectAnimation,
  type ScenePointGroup,
  type SceneGizmoMode,
  type SceneSelection,
  type SceneGroupDelta,
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
  type ProjectFile,
  type ProjectPlanningState,
} from "../project";
import type { PreflightReferenceSource } from "@/lib/adapters/exportPreflight";
import { buildEsspExportPackage, type EsspExportResult } from "../adapters/esspExport";
import {
  buildOriginalEsspDownload,
  hasEsspSourceBytes,
  type EsspSourceRecoveryResult,
} from "../adapters/esspSourceRecovery";
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
  /** Which authority produced which part of `trajectorySet`. */
  effectiveAuthority: EffectiveTrajectoryAuthority;
  /**
   * Original imported RGB for a reference-owned instant, or null when the
   * authored lighting engine owns the LEDs at `t`. Export uses this so a
   * reference-owned interval keeps its source colours.
   */
  referenceColorsAt: (t: number) => RGB[] | null;
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
  /** Restores the full authored content range (zoom 1, scroll 0). */
  fitTimeline: () => void;
  /**
   * Commits ONE pointer gesture as a single undoable canonical mutation.
   * `mode` defaults to RIPPLE: following clips are translated so a resize never
   * creates an overlap. FREE commits the single clip only.
   */
  commitClipTiming: (id: string, patch: Partial<TimelineClip>, mode?: RippleMode) => void;
  /** Live scrollbar geometry (thumb size/position) for the current view. */
  timelineScrollGeometry: TimelineScrollGeometry;
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
  /** Library "Use in show": one undoable authoring action for any asset kind. */
  insertLibraryAssetIntoShow: (
    asset: FormationAsset,
    timing?: AssetInsertionTiming,
  ) => string | null;
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
  /** COMPATIBILITY value: always equals `primarySceneObjectId`. */
  selectedSceneObjectId: string | null;
  /** Canonical multi-selection of the selected scene (always reconciled). */
  selectedSceneObjectIds: string[];
  /** Primary object; always a member of a non-empty selection. */
  primarySceneObjectId: string | null;
  /** Plain click (REPLACE) or Ctrl/Shift click (TOGGLE). Null clears. */
  selectSceneObject: (objectId: string | null, mode?: SceneClickMode) => void;
  setSelectedSceneObjectIds: (ids: readonly string[], primaryId?: string | null) => void;
  /** Ctrl+A inside the Scene editor. */
  selectAllSceneObjectsInScene: () => void;
  /** Per-field mixed-value flags across the current selection. */
  sceneSelectionMixed: MixedTransformFlags;
  /** Scene object owning the resolved points a drone flies (viewport picking). */
  sceneObjectIdForDrone: (droneIndex: number) => string | null;
  /** Everyday viewport mode: select whole visuals or points inside one visual. */
  sceneSelectionMode: "OBJECT" | "POINT";
  setSceneSelectionMode: (mode: "OBJECT" | "POINT") => void;
  scenePointSelectionTool: ScenePointSelectionTool;
  setScenePointSelectionTool: (tool: ScenePointSelectionTool) => void;
  selectedScenePointIds: string[];
  selectedScenePointDroneIndices: number[];
  scenePointGroups: readonly ScenePointGroup[];
  selectScenePointForDrone: (droneIndex: number, additive: boolean) => void;
  selectScenePointsForDrones: (
    droneIndices: readonly number[],
    operation: ScenePointSelectionOperation,
  ) => void;
  clearScenePointSelection: () => void;
  createScenePointGroup: (name: string) => string | null;
  renameScenePointGroup: (groupId: string, name: string) => void;
  removeScenePointGroupById: (groupId: string) => void;
  selectScenePointGroup: (groupId: string) => void;
  /** Groups selected visual objects into one reusable composition container. */
  createSceneVisualGroup: (name: string) => string | null;
  renameSceneVisualGroupById: (groupId: string, name: string) => void;
  removeSceneVisualGroupById: (groupId: string) => void;
  selectSceneVisualGroup: (groupId: string) => void;
  captureSceneVisualGroupState: (groupId: string, name: string) => string | null;
  applySceneVisualGroupState: (stateId: string) => void;
  renameSceneVisualGroupState: (stateId: string, name: string) => void;
  removeSceneVisualGroupState: (stateId: string) => void;
  addSceneVisualStateCueAtPlayhead: (
    stateId: string,
    transitionDuration: number,
  ) => { readonly cueId: string | null; readonly reason: string | null };
  removeSceneVisualStateCueById: (cueId: string) => void;
  patchSceneVisualStateCueById: (
    cueId: string,
    patch: { readonly time?: number; readonly transitionDuration?: number },
  ) => void;
  /** Promotes and animates the current object/point selection in one undo revision. */
  applyMotionPresetToSceneSelection: (preset: DynamicPresetId) => readonly string[];
  /** Ephemeral motion audition rendered by the canonical planner; no project/history mutation. */
  previewMotionPresetToSceneSelection: (preset: DynamicPresetId) => readonly string[];
  motionEffectPreviewIds: readonly string[];
  applyMotionEffectPreview: () => readonly string[];
  cancelMotionEffectPreview: () => void;
  /** EVERYDAY MOTION INSPECTOR: per-instance playback (one revision, one undo). */
  patchSceneObjectAnimation: (
    clipId: string,
    objectId: string,
    patch: SceneObjectAnimation,
  ) => void;
  /** Canonical dynamic-asset edit committed through the TIMELINE history. */
  patchSceneMotion: (dynamicFormationId: string, patch: Partial<DynamicFormation>) => void;
  patchSceneMotionGroup: (
    dynamicFormationId: string,
    groupId: string,
    patch: Partial<MotionGroup>,
  ) => void;
  /** Independent copy of the object's motion asset. Returns the new asset id. */
  duplicateSceneObjectMotion: (clipId: string, objectId: string) => string | null;
  /** Detaches motion from ONE object, restoring its static source when valid. */
  removeSceneObjectMotion: (clipId: string, objectId: string) => void;

  // ---- Batch scene gestures (ONE mutation, ONE undo entry) ----------------
  transformSceneObjects: (
    clipId: string,
    objectIds: readonly string[],
    delta: SceneGroupDelta,
  ) => void;
  mirrorSceneObjectsBatch: (clipId: string, objectIds: readonly string[]) => void;
  duplicateSceneObjectsBatch: (clipId: string, objectIds: readonly string[]) => void;
  removeSceneObjectsBatch: (clipId: string, objectIds: readonly string[]) => void;
  /** One-click design action on the selection (ONE mutation, ONE undo entry). */
  applySceneDesign: (
    clipId: string,
    objectIds: readonly string[],
    action: SceneDesignActionKind,
    options?: { readonly altitudeStep?: number },
  ) => void;
  /** Alignment / distribution across a multi-selection. */
  alignSceneObjectsByMode: (
    clipId: string,
    objectIds: readonly string[],
    mode: SceneAlignMode,
  ) => void;
  /** "Edit as Scene" for a static SHOW clip; geometry-preserving. */
  canEditClipAsScene: (clipId: string) => boolean;
  editClipAsScene: (clipId: string) => boolean;
  /** "Duplicate clip" for design; returns the new clip id. */
  duplicateClipForDesign: (clipId: string) => string | null;
  /** Normalised front-elevation thumbnail points per clip (identification aid). */
  clipThumbnails: Record<string, ThumbnailPoint[]>;

  // ---- Viewport transform gizmo ------------------------------------------
  gizmoMode: SceneGizmoMode;
  setGizmoMode: (mode: SceneGizmoMode) => void;
  gizmoTranslateSnap: number;
  setGizmoTranslateSnap: (increment: number) => void;
  gizmoRotateSnap: number;
  setGizmoRotateSnap: (increment: number) => void;
  /** Deterministic pivot of the current selection (single or group centroid). */
  sceneGizmoPivot: Vector3Tuple | null;
  /** Live, history-free gesture preview. Null when no gesture is running. */
  sceneGizmoDraft: SceneGroupDelta | null;
  /** Preview points of the drafted scene — diagnostics only, never planned. */
  sceneGizmoPreviewPoints: Vector3Tuple[];
  beginSceneGizmo: () => void;
  updateSceneGizmo: (delta: SceneGroupDelta) => void;
  /** Commits exactly one canonical mutation (one undo entry). */
  commitSceneGizmo: () => void;
  /** Escape: restores the initial transforms, leaves no history entry. */
  cancelSceneGizmo: () => void;
  /** Adds one formation instance to a clip's scene and selects it. */
  addSceneObject: (
    clipId: string,
    input: {
      source: SceneObjectSource;
      name: string;
      assetId?: string;
      requestedDroneCount?: number | null;
      position?: Vector3Tuple;
      rotationDeg?: Vector3Tuple;
      mirrorX?: boolean;
      color?: RGB;
    },
  ) => string | null;
  /**
   * Creates a NATIVE formation asset (e.g. a line / underline bar) and places
   * one instance of it in the clip's scene — ONE undoable revision.
   */
  addNativeVisual: (
    clipId: string,
    input: {
      readonly kind: FormationKind;
      readonly name: string;
      readonly droneCount: number;
      readonly params?: Record<string, number | string>;
      readonly position?: Vector3Tuple;
      readonly color?: RGB;
      readonly mirrorX?: boolean;
      readonly rotationDeg?: Vector3Tuple;
    },
  ) => string | null;
  /**
   * Creates a DETERMINISTIC TEXT formation asset from a canonical recipe and
   * places one instance of it in the clip's scene — ONE undoable revision.
   * Returns null when the recipe cannot produce geometry (nothing is mutated).
   */
  addTextVisual: (
    clipId: string,
    input: {
      readonly recipe: TextGeometryRecipe;
      readonly name: string;
      readonly position?: Vector3Tuple;
      readonly color?: RGB;
      readonly mirrorX?: boolean;
      readonly rotationDeg?: Vector3Tuple;
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

  // ---- Reference-assisted scene editing (design aid only) -----------------
  /** Imported-reference binding of the selected clip (null when authored). */
  selectedClipBinding: ReferenceClipBinding | null;
  /** Reference ghost overlay of the selected ESSP-derived scene. */
  sceneReferenceGhost: boolean;
  setSceneReferenceGhost: (enabled: boolean) => void;
  /** Shared comparison clock for the whole scene. */
  sceneComparisonFrame: SceneComparisonFrame;
  setSceneComparisonFrame: (frame: SceneComparisonFrame) => void;
  sceneGhostFrame: ReferenceGhostFrame | null;
  /** DESIGN deviation of editable geometry vs imported geometry. */
  sceneDeviation: SceneDeviationReport | null;
  /** Correspondence lines for the selected object only. */
  sceneCorrespondence: CorrespondenceLine[];
  canResetSelectedSceneObject: boolean;
  /** Restores ONE object to the extracted state (single undo entry). */
  resetSceneObject: (clipId: string, objectId: string) => void;
  /** Planner-owned editable copy of the whole scene; returns the new clip id. */
  duplicateSceneAsEditable: (clipId: string) => string | null;
  /**
   * GEOMETRY APPLY: commits a canonically materialised hypothetical project as
   * ONE undoable authoring revision (project + overrides + designs + imported
   * ownership + history) and invalidates derived analysis.
   */
  applyGeometryProposal: (input: {
    afterProject: ShowProject;
    readiness: GeometryApplyReadinessReport;
    promotedAt: string;
  }) => GeometryApplyCommitResult;
  /**
   * Applies deterministic text geometry to one eligible STATIC target as ONE
   * undoable revision. The caller MUST pass the canonical readiness report it
   * evaluated for the exact same proposal; readiness is never synthesized.
   */
  applyTextFormation: (input: {
    request: TextPreviewRequest;
    readiness: GeometryApplyReadinessReport | null;
    formationId: string;
    formationName?: string;
    candidateTransitionOverrides?: Readonly<Record<string, ClipTransitionOverride>>;
    promotedAt: string;
  }) => TextApplyCommitResult;

  // ---- Lighting, reveal & colour effects (Sprint 7.4) ---------------------
  /** Lighting effects of the selected clip, in evaluation order. */
  lightingEffects: LightingEffectInstance[];
  /** Structural validation of the whole lighting program (never blocking). */
  lightingReport: LightingValidationReport;
  selectedLightingEffectId: string | null;
  selectedLightingEffect: LightingEffectInstance | null;
  selectLightingEffect: (id: string | null) => void;
  /** Creates one effect instance of a built-in preset on a clip. */
  addLightingEffectFromPreset: (
    clipId: string,
    presetId: string,
    target?: LightingTarget,
    parameters?: Partial<LightingEffectParameters>,
  ) => string | null;
  /**
   * Creates ONE effect per canonical target in a SINGLE undoable revision, so
   * authoring on a multi-selection is exactly one history entry.
   */
  addLightingEffectsFromPreset: (
    clipId: string,
    presetId: string,
    targets: readonly LightingTarget[],
    parameters?: Partial<LightingEffectParameters>,
    timing?: { readonly anchor: "ABSOLUTE"; readonly start: number; readonly duration?: number },
  ) => string[];
  /** Ephemeral audition: visible in the viewport, absent from project/history/export. */
  previewLightingEffectsFromPreset: (
    clipId: string,
    presetId: string,
    targets: readonly LightingTarget[],
    parameters?: Partial<LightingEffectParameters>,
    timing?: { readonly anchor: "ABSOLUTE"; readonly start: number; readonly duration?: number },
  ) => string[];
  lightingEffectPreview: readonly LightingEffectInstance[];
  applyLightingEffectPreview: () => string[];
  cancelLightingEffectPreview: () => void;

  patchLightingEffect: (id: string, patch: Partial<Omit<LightingEffectInstance, "id">>) => void;
  patchLightingParameters: (id: string, patch: Partial<LightingEffectParameters>) => void;
  removeLightingEffect: (id: string) => void;
  /**
   * Copies one canonical lighting effect (same target, same parameters) as ONE
   * undoable revision and selects the copy. No new effect type is introduced.
   */
  duplicateLightingEffect: (id: string) => string | null;

  /** One undoable commit of a timeline gesture on a lighting effect. */
  commitLightingTiming: (id: string, timing: { start?: number; duration?: number }) => void;
  /** Deterministic per-drone LED state at show time `t` (empty = no lighting). */
  lightingStatesAt: (t: number) => DroneLightState[];
  /** Viewport LED preview toggle. Off = legacy clip colours. */
  lightingPreview: boolean;
  setLightingPreview: (v: boolean) => void;

  // ---- Project setup wizard + asset library (Sprint 6B.6) -----------------
  /** Replaces the whole project with a new one built from the wizard draft. */
  createProjectFromDraft: (draft: ProjectSetupDraft) => void;
  /** Loads a registered opt-in sample/demo show by id (never automatic). */
  loadSampleShow: (sampleId: string) => boolean;
  /** Applies wizard edits (name / fleet / launch geometry) to the open project. */
  applySetupDraft: (draft: ProjectSetupDraft) => void;
  /** Current project expressed as an editable wizard draft. */
  currentSetupDraft: ProjectSetupDraft;
  /** Inserts a library formation as a NEW project formation (fresh id). */
  addLibraryFormation: (formation: Formation) => Formation;
  /** Inserts a library dynamic formation as a NEW dynamic formation (fresh id). */
  addLibraryDynamicFormation: (formation: DynamicFormation) => DynamicFormation;
  /**
   * Reuses a FORMATION_SCENE library asset: copies its dependencies and scene
   * into the project under fresh ids and appends a new timeline clip bound to
   * the copied scene. Returns the new clip id.
   */
  addSceneAssetToShow: (
    asset: FormationAsset,
    timing?: { transition?: number; hold?: number },
  ) => string | null;
  /** Save-to-library payload of a clip's authored scene (null when it has none). */
  sceneAssetPayloadForClip: (clipId: string) => {
    readonly scene: FormationScene;
    readonly dependencies: SceneAssetDependencies;
    readonly source: FormationAsset["source"];
    readonly sourceRef: FormationAsset["sourceRef"];
  } | null;
  setDroneCount: (n: number) => void;
  setLimits: (patch: Partial<SafetyLimits>) => void;
  addFormation: (kind: FormationKind, params?: Record<string, number | string>) => Formation;
  updateFormation: (id: string, params: Record<string, number | string>) => void;
  /** Renames the formation a clip shows (one undoable authored revision). */
  renameFormation: (id: string, name: string) => void;
  addClip: (formationId: string, timing?: { transition?: number; hold?: number }) => void;
  /** Imported SVG assets, keyed by asset id (reproducibility + regeneration). */
  svgAssets: Record<string, SvgAsset>;
  svgDraft: SvgDraft | null;
  svgBusy: boolean;
  svgError: SvgFormationError | null;
  importSvg: (file: File) => Promise<void>;
  updateSvgDraft: (patch: Partial<SvgFormationParams>) => void;
  cancelSvgDraft: () => void;
  /**
   * Commits the current draft as an exact-N formation. By default the instance
   * lands in the CURRENT clip's scene; a new clip is created only when the
   * caller explicitly asks for `target: "NEW_CLIP"`.
   */
  commitSvgDraft: (options?: {
    name?: string;
    target?: "SCENE" | "NEW_CLIP" | "ASSET_ONLY";
    clipId?: string;
    droneCount?: number | null;
    mirrorX?: boolean;
    color?: RGB;
  }) => Formation | null;
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
  // ---- Transition design (mode + stagger over the SAME override) ---------
  /** Authored design intent per clip; persisted with the planning state. */
  transitionDesigns: Record<string, TransitionDesignState>;
  /** Authored design of a clip, or the mode derived from its override data. */
  transitionDesignFor: (clipId: string) => TransitionDesignState;
  /** True when the authored design lost its override (semantic invalidation). */
  transitionDesignNeedsRecalculation: (clipId: string) => boolean;
  /** One designer change = one undo entry; rebuilds the canonical override. */
  setTransitionDesign: (clipId: string, patch: Partial<TransitionDesignState>) => void;
  /**
   * Applies ONE design to every eligible clip in a single undo entry. Ineligible
   * clips are reported in `bulkTransitionResult`, never silently skipped.
   */
  applyTransitionDesignToAllClips: (patch?: Partial<TransitionDesignState>) => void;
  /** Outcome of the last show-wide application (null until one runs). */
  bulkTransitionResult: BulkTransitionDesignResult | null;
  /** MANUAL mode: edits the existing per-drone start/lane offset data. */
  patchTransitionDroneOffset: (
    clipId: string,
    index: number,
    patch: { startOffset?: number; laneOffset?: number },
  ) => void;
  canAnalyzeSelectedClip: boolean;
  showPaths: boolean;
  setShowPaths: (v: boolean) => void;
  showConflicts: boolean;
  setShowConflicts: (v: boolean) => void;
  /** Draws the geofence cage, altitude floor and ceiling in the viewport. */
  showSafetyVolume: boolean;
  setShowSafetyVolume: (v: boolean) => void;
  /** Tints drones not used by any visual of the selected scene (reserve). */
  showReserveDrones: boolean;
  setShowReserveDrones: (v: boolean) => void;

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
  /** Canonical options used by full-show validation. Read-only consumers reuse these. */
  fullShowAnalysisOptions: AnalyzeFullShowOptions;
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

  // ---- Imported trajectory layer + editable extraction (A + B) -----------
  /**
   * Losslessly preserved imported ESSP payload with per-clip playback
   * ownership. While a clip is REFERENCE-owned its interval plays the imported
   * samples; a flight-output edit promotes only that interval (and the next
   * transition) to the planner.
   */
  referenceLayer: ReferenceTrajectoryLayer | null;
  /** Ownership of every spliced interval, derived from the layer. */
  referenceOwnership: ReferenceOwnershipSummary | null;
  /** True when the playhead currently sits on a reference-owned interval. */
  referenceOwnedNow: boolean;
  /** Per-clip extraction diagnostics (fidelity, classification, warnings). */
  referenceExtraction: readonly ReferenceExtractionDiagnostic[];
  /** Library asset drafts produced by the extraction, not yet saved. */
  referenceAssetDrafts: readonly ReferenceAssetDraft[];
  referenceExtractionWarnings: readonly string[];
  referenceExtractionError: { code: string; message: string } | null;
  /** Extracts TAKEOFF + scenes + LANDING into the project (replaces content). */
  extractReferenceShowToProject: () => void;
  /** Explicit operator promotion of one clip to planner ownership. */
  promoteReferenceClip: (clipId: string) => void;
  /** Drops the imported layer; playback becomes fully planner-generated. */
  clearReferenceLayer: () => void;
  /** Boundary agreement between reference and planner at ownership switches. */
  verifyReferenceSplices: () => SpliceVerificationReport | null;
  referenceLayerLimitations: readonly string[];
  /**
   * PRODUCTION ESSP PER-DRONE EXPORT (experimental target format). Reads the
   * canonical effective show + the same export gate as every computed export.
   */
  buildEsspPackage: () => EsspExportResult;
  /**
   * SOURCE RECOVERY (not an export): returns the originally imported .essp
   * files byte-for-byte. Never gated by validation.
   */
  buildOriginalEsspPackage: () => EsspSourceRecoveryResult;
  hasEsspSourceFiles: boolean;
  /**
   * Clocks + fleet size of the imported ESSP archive that owns the reference
   * intervals (null when the show is authored from scratch). Read-only input
   * for the export preflight summary.
   */
  esspPreflightSource: PreflightReferenceSource | null;

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
  /** Writes the project file to disk (browser download). Returns success. */
  saveProjectFile: () => boolean;
  /**
   * SAVE AS: writes the current project state under a NEW document identity and
   * makes that identity the active document + saved baseline. Returns success.
   */
  saveProjectFileAs: (name?: string) => boolean;
  /** False when no document is open (explicit NO SHOW OPEN state). */
  documentOpen: boolean;
  /** Closes the open document; the Studio enters NO SHOW OPEN. */
  closeShow: () => void;
  /** Compact confirmation of the last successful document action. */
  documentAction: DocumentFeedback | null;
  clearDocumentAction: () => void;
  /** Canonical project envelope (project + planning + editor prefs). */
  buildProjectFile: () => ProjectFile;
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
  applyAiProposal: (options?: {
    addToTimeline?: boolean;
    addToScene?: {
      clipId: string;
      droneCount: number;
      name?: string;
      position?: Vector3Tuple;
      rotationDeg?: Vector3Tuple;
      mirrorX?: boolean;
      color?: RGB;
    };
  }) => DynamicFormation | Formation | null;
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

/**
 * Everything a project adoption may restore. `fileState` distinguishes reopening
 * a real file (clean, saved-as-that-file) from authoring a new project or sample
 * (no file on disk yet, so it must not claim the previous file's saved state).
 */
interface AdoptProjectRestore {
  planning?: ProjectPlanningState;
  referenceLayer?: ReferenceTrajectoryLayer | null;
  selectedClipId?: string | null;
  sampleRate?: number;
  fileState?: "FILE" | "UNSAVED" | "RECOVERED";
}

/**
 * Result of the adoption boundary. A failed adoption changes NOTHING: the
 * previously open project keeps its own reference layer, export eligibility and
 * source-recovery bytes.
 */
type AdoptProjectOutcome = { ok: true } | { ok: false; error: { code: string; message: string } };

export function StudioProvider({ children }: { children: ReactNode }) {
  // Lazy initializer: keeps module scope free of runtime work (Worker-safe).
  const [project, setProject] = useState<ShowProject>(() => createDefaultProject());
  // Clean startup: nothing is selected because nothing is authored yet.
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  /**
   * SINGLE RECONCILIATION AUTHORITY. Assigned once below, referenced through a
   * ref so early commands (undo/redo restore, clip delete) can reuse exactly the
   * same editor-state reconciliation as selectClip.
   */
  /** Latest selected clip id, so callbacks stay dependency-free. */
  const selectedClipIdRef = useRef<string | null>(null);
  selectedClipIdRef.current = selectedClipId;
  const reconcileSelectionRef = useRef<
    (project: ShowProject, nextClipId: string | null, previousClipId: string | null) => void
  >(() => {});
  /**
   * CANONICAL SCENE SELECTION. Multi-selection is the normal case; the primary
   * object is the one single-object controls edit. Editor state only: selecting
   * never mutates the project and never promotes a reference-owned clip.
   */
  const [sceneSelectionState, setSceneSelectionState] =
    useState<SceneSelection>(EMPTY_SCENE_SELECTION);
  /** Reference-assisted editing (design aid only, never persisted). */
  const [sceneReferenceGhost, setSceneReferenceGhost] = useState(false);
  const [sceneComparisonFrame, setSceneComparisonFrame] =
    useState<SceneComparisonFrame>("EXTRACTED");

  const [sampleRate, setSampleRate] = useState<number>(DEFAULT_SAMPLE_RATE);
  const [svgAssets, setSvgAssets] = useState<Record<string, SvgAsset>>({});
  const [svgDraft, setSvgDraft] = useState<SvgDraft | null>(null);
  const [svgBusy, setSvgBusy] = useState(false);
  const [svgError, setSvgError] = useState<SvgFormationError | null>(null);
  const [assignmentStrategy, setAssignmentStrategy] =
    useState<AssignmentStrategyId>("nearestNeighbor");
  const [transitionOverrides, setTransitionOverrides] = useState<
    Record<string, ClipTransitionOverride>
  >({});
  /**
   * AUTHORED TRANSITION DESIGN per clip (mode + stagger pattern). Intent only:
   * the flown data always lives in `transitionOverrides`, which this state
   * produces through the existing optimizer/analyzer.
   */
  const [transitionDesigns, setTransitionDesigns] = useState<Record<string, TransitionDesignState>>(
    {},
  );
  const [transitionAnalysis, setTransitionAnalysis] = useState<{
    clipId: string;
    analysis: TransitionAnalysis;
  } | null>(null);
  const [assignmentComparison, setAssignmentComparison] = useState<{
    clipId: string;
    comparison: AssignmentComparison;
  } | null>(null);
  const [optimization, setOptimization] = useState<{
    clipId: string;
    result: TransitionOptimizationResult;
  } | null>(null);
  const [transitionBusy, setTransitionBusy] = useState(false);
  const [transitionError, setTransitionError] = useState<{ code: string; message: string } | null>(
    null,
  );
  const [showPaths, setShowPaths] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);
  const [showSafetyVolume, setShowSafetyVolume] = useState(true);
  const [showReserveDrones, setShowReserveDrones] = useState(true);
  const [fullShow, setFullShow] = useState<{
    plan: FullShowPlan;
    report: FullShowValidationReport;
  } | null>(null);
  const [fullShowBusy, setFullShowBusy] = useState(false);
  const [fullShowProgress, setFullShowProgress] = useState<FullShowProgress | null>(null);
  const [fullShowError, setFullShowError] = useState<{ code: string; message: string } | null>(
    null,
  );
  const [highlightedDrones, setHighlightedDrones] = useState<number[]>([]);
  const [preShowPreview, setPreShowPreview] = useState<{
    plan: PreShowPlan;
    report: PreShowValidationReport;
    /** Project revision the preview was computed for (staleness provenance). */
    revision: string;
  } | null>(null);
  /**
   * FULL-SHOW RUN AUTHORITY. Owns the monotonic generation id used to reject
   * results that belong to a superseded project revision (see
   * ./analysisRunAuthority). Held in a ref so every check reads CURRENT state.
   */
  const fullShowRunRef = useRef(createAnalysisRunAuthority());
  /** CURRENT canonical analysis revision, readable from async callbacks. */
  const analysisRevisionRef = useRef("");
  /**
   * The ONE derived-analysis invalidation authority (see ./derivedAnalysis).
   * Stable across renders: every setState is stable, so this object is too.
   */
  const derivedAnalysisSetters = useMemo<DerivedAnalysisSetters>(
    () => ({
      setTransitionAnalysis,
      setAssignmentComparison,
      setOptimization,
      setTransitionError,
      setFullShow,
      setFullShowError,
      setHighlightedDrones,
      setPreShowPreview,
      invalidateFullShowRun: () => fullShowRunRef.current.invalidate(),
      setFullShowProgress,
      setFullShowBusy,
    }),
    [],
  );

  /**
   * SESSION RESET / ADOPTION INDIRECTION. The session setters and the canonical
   * adoption boundary are declared far apart in this store, so both are reached
   * through refs assigned during render. This keeps ONE reset list and ONE
   * project-content replacement boundary instead of partial per-command lists.
   */
  const sessionResetRef = useRef<() => void>(() => {});
  /** Presentation-session reconciliation of an adopted pro…37331 tokens truncated…      // consumed this snapshot: never resurrect the offer.
      if (!active || autosaveGeneration.current !== generation) return;
      if (isRecoveryOfferable(snapshot)) setAutosaveRecovery(snapshot);
    });
    return () => {
      active = false;
    };
  }, [getAutosaveStore]);

  // Debounced autosave. Never runs on an animation frame: it only reacts to
  // project mutations, and at most once per debounce window.
  useEffect(() => {
    // NO SHOW OPEN: the placeholder document is not the operator's work and must
    // never be snapshotted as a recoverable show.
    if (!documentOpen) return;
    const store = getAutosaveStore();
    if (!store) return;

    const delay = Math.max(0, AUTOSAVE_DEBOUNCE_MS - (Date.now() - lastAutosaveAt.current));
    const generation = autosaveGeneration.current;
    const timer = setTimeout(() => {
      // GENERATION AUTHORITY: a Save / Open / New that happened after this timer
      // was scheduled already consumed the snapshot slot for this state.
      if (!isAutosaveWriteAuthorized(generation, autosaveGeneration.current)) return;
      lastAutosaveAt.current = Date.now();
      const savedAt = new Date().toISOString();
      void writeAutosave(store, {
        savedAt,
        fileName: projectFileName,
        // SAME options as a manual save (planning incl. transition designs,
        // reference layer, editor prefs) so a recovery is a reopened project.
        file: serializeProject(project, { savedAt, ...persistenceOptions }),
      }).then(() => {
        if (!isAutosaveWriteAuthorized(generation, autosaveGeneration.current)) return;
        setProjectAutosavedAt(savedAt);
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [project, projectFileName, getAutosaveStore, persistenceOptions, documentOpen]);

  const restoreAutosave = useCallback(() => {
    const snapshot = autosaveRecovery;
    if (!snapshot) return;
    // Recovery restores planning state and editor prefs exactly like an open,
    // but the recovered content was never written to a file: it stays dirty.
    const outcome = adoptProjectFile(
      snapshot.file,
      snapshot.fileName || suggestedProjectFileName(snapshot.file.project.name),
      "RECOVERED",
    );
    if (!outcome.ok) {
      // A recovery that cannot be rehydrated leaves the open project untouched.
      setProjectFileError(outcome.error);
      return;
    }
    // Adoption already consumed the persisted snapshot on its success path; the
    // restored project stays DIRTY, so its next edit autosaves normally.
    consumeAutosaveRecovery();
  }, [autosaveRecovery, adoptProjectFile, consumeAutosaveRecovery]);

  // Idempotent by construction: consuming twice is a no-op beyond bumping the
  // generation.
  const dismissAutosave = consumeAutosaveRecovery;

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

  /**
   * THE ONE SESSION-RESET LIST (see ./projectLifecycle). Assigned during render
   * because the adoption boundary is declared before these session slots.
   */
  const sessionResetSetters = useMemo<ProjectSessionResetSetters>(
    () => ({
      setReferenceShow,
      setReferencePlayback,
      setReferenceBusy,
      setReferenceError,
      setSelectedReferenceDroneId,
      setShowReferencePaths,
      setReferenceExtraction,
      setReferenceAssetDrafts,
      setReferenceExtractionWarnings,
      setForensicsReport,
      setForensicsError,
      setForensicsBusy,
      setSelectedForensicSegmentId,
      setAiProposal,
      setAiProposalErrors,
      setAiHistory,
      setAiError,
      setAiPreviewTime,
      setAiBusy,
      setSvgDraft,
      setSvgError,
      setSvgBusy,
      clearSceneSelection: () => setSceneSelectionState(EMPTY_SCENE_SELECTION),
      setSceneGizmoDraft,
      setSceneReferenceGhost,
      setSelectedLaunchGroupId,
      setSelectedPointIds: setSelectedPointIdsState,
      setSelectedMotionGroupId,
      setDynamicEditTime,
      setExplicitDynamicId,
      clearAudioSession: () => {
        // The decoded buffer belongs to the LOCAL file of the replaced project:
        // it must not stay playable under the adopted project. Audio METADATA of
        // the adopted project is untouched (files never carry audio bytes, so a
        // reopened project reports attached = false).
        audioBufferRef.current = null;
        setAudioPeaks(null);
        setAudioError(null);
        setAudioBusy(false);
      },
    }),
    [],
  );
  sessionResetRef.current = () => resetProjectSessionState(sessionResetSetters);
  adoptedEditorSessionRef.current = () =>
    reconcileAdoptedEditorSession({
      stopPlayback: clock.pause,
      seek: clock.seek,
      resetTimelineView: fitTimeline,
      clearGeometryDiagnostics: () => setGeometryProposalPreview(null),
    });

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

  /**
   * AI SCOPE. A proposal depends on the open document AND on the design inputs
   * it was generated for (fleet count, area, seed). Revalidating an old answer
   * against different inputs and calling it current would be a lie, so those
   * inputs are part of the acceptance scope.
   */
  const aiScope = useCallback(
    () =>
      projectSession.current.scope(
        project.droneCount,
        project.area.width,
        project.area.height,
        project.seed,
      ),
    [project.droneCount, project.area.width, project.area.height, project.seed],
  );

  const generateAiProposal = useCallback(
    async (prompt: string) => {
      const token = aiJobs.current.begin(aiScope());
      setAiBusy(true);
      setAiError(null);
      try {
        const proposal = await aiProvider.current.generateProposal({
          prompt,
          fleetCount: project.droneCount,
          area: project.area,
          seed: project.seed,
        });
        if (!aiJobs.current.accepts(token, aiScope())) return;
        setAiHistory([]);
        acceptProposal(proposal);
      } catch (err) {
        if (!aiJobs.current.accepts(token, aiScope())) return;
        setAiProposal(null);
        setAiError({
          code: (err as { code?: string }).code ?? "PROVIDER_UNAVAILABLE",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (aiJobs.current.isCurrent(token)) setAiBusy(false);
      }
    },
    [project.droneCount, project.area, project.seed, acceptProposal, aiScope],
  );

  const refineAiProposal = useCallback(
    async (instruction: string) => {
      const base = aiProposal;
      if (!base) return;
      const token = aiJobs.current.begin(aiScope());
      setAiBusy(true);
      setAiError(null);
      try {
        const next = await aiProvider.current.refineProposal({ proposal: base, instruction });
        if (!aiJobs.current.accepts(token, aiScope())) return;
        setAiHistory((h) => [...h, base].slice(-20));
        acceptProposal(next);
      } catch (err) {
        if (!aiJobs.current.accepts(token, aiScope())) return;
        setAiError({
          code: (err as { code?: string }).code ?? "PROVIDER_UNAVAILABLE",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (aiJobs.current.isCurrent(token)) setAiBusy(false);
      }
    },
    [aiProposal, acceptProposal, aiScope],
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
    (
      options: {
        addToTimeline?: boolean;
        addToScene?: {
          clipId: string;
          droneCount: number;
          name?: string;
          position?: Vector3Tuple;
          rotationDeg?: Vector3Tuple;
          mirrorX?: boolean;
          color?: RGB;
        };
      } = {},
    ) => {
      const proposal = aiProposal;
      if (!aiBuilt || !proposal) return null;
      if (options.addToScene) {
        const targetClip = projectRef.current.timeline.find(
          (clip) => clip.id === options.addToScene?.clipId,
        );
        if (!targetClip) return null;
        const budget = sceneBudget(
          projectRef.current,
          sceneForClip(projectRef.current, targetClip),
          projectRef.current.droneCount,
        );
        const requested = options.addToScene.droneCount;
        if (!Number.isInteger(requested) || requested < 1 || requested > budget.availableDrones)
          return null;
      }
      // A scene object owns exactly the artistic allocation selected by the
      // operator. Materialise AI geometry at that count instead of persisting a
      // full-fleet asset and merely hiding surplus points: validation, motion
      // groups, preview and export must all describe the SAME drones.
      const appliedProposal =
        options.addToScene && options.addToScene.droneCount !== proposal.fleetCount
          ? { ...proposal, fleetCount: options.addToScene.droneCount }
          : proposal;
      const built =
        appliedProposal === proposal
          ? aiBuilt
          : buildProposalContent(appliedProposal, {
              area: projectRef.current.area,
              seed: projectRef.current.seed,
            });
      const formation: Formation = { ...built.formation, id: nextId("f") };
      const dynamic: DynamicFormation | null = built.dynamicFormation
        ? { ...built.dynamicFormation, id: nextId("dyn"), sourceFormationId: formation.id }
        : null;
      const timelineClipId = options.addToTimeline ? nextId("c") : null;
      let sceneObjectId: string | null = null;

      setProject((p) => {
        let next: ShowProject = {
          ...p,
          formations: [...p.formations, formation],
          ...(dynamic ? { dynamicFormations: [...(p.dynamicFormations ?? []), dynamic] } : {}),
        };
        if (timelineClipId) {
          const clip: TimelineClip = dynamic
            ? {
                id: timelineClipId,
                formationId: formation.id,
                start: 0,
                transition: Math.max(0.5, proposal.timing.recommendedTransition),
                hold: Math.max(proposal.timing.hold, dynamic.duration, 4),
                easing: "minJerk",
                color: [140, 210, 255],
                effect: "solid",
                phase: "SHOW",
                dynamicFormationId: dynamic.id,
                playbackRate: 1,
                dynamicStartOffset: 0,
              }
            : {
                id: timelineClipId,
                formationId: formation.id,
                start: 0,
                transition: Math.max(0.5, proposal.timing.recommendedTransition),
                hold: Math.max(0, proposal.timing.hold),
                easing: "minJerk",
                color: [120, 220, 255],
                effect: "solid",
                phase: defaultPhaseForNewClip(p.timeline),
              };
          next = { ...next, timeline: insertClipBeforeLanding(next.timeline, clip) };
        }
        if (options.addToScene) {
          const targetClip = next.timeline.find((clip) => clip.id === options.addToScene?.clipId);
          if (!targetClip) return p;
          const source: SceneObjectSource = dynamic
            ? { kind: "DYNAMIC", dynamicFormationId: dynamic.id }
            : { kind: "STATIC", formationId: formation.id };
          const added = addObject(next, sceneForClip(next, targetClip), {
            source,
            name: options.addToScene.name?.trim() || proposal.title,
            requestedDroneCount: options.addToScene.droneCount,
            ...(options.addToScene.position ? { position: options.addToScene.position } : {}),
          });
          sceneObjectId = added.objectId;
          let scene = added.scene;
          // AI motion groups already know the semantic ownership of their
          // points (for example "Hair"). Expose those same canonical point ids
          // as reusable scene selections so the operator can target lighting
          // and motion without manually lassoing a part the AI already knows.
          for (const group of dynamic?.groups ?? []) {
            if (group.pointIds.length === 0) continue;
            scene = addScenePointGroup(
              scene,
              added.objectId,
              group.name,
              group.pointIds.map((pointId) => `${added.objectId}#${pointId}`),
            ).scene;
          }
          scene = options.addToScene.mirrorX ? mirrorObjectX(scene, added.objectId) : scene;
          if (options.addToScene.rotationDeg) {
            scene = patchObjectTransform(scene, added.objectId, {
              rotationDeg: options.addToScene.rotationDeg,
            });
          }
          if (options.addToScene.color) {
            scene = patchObject(scene, added.objectId, {
              lighting: { color: options.addToScene.color },
            });
          }
          next = upsertScene(next, scene);
        }
        pushSnapshot(p);
        return next;
      });
      if (timelineClipId) setSelectedClipId(timelineClipId);
      if (sceneObjectId) setSelectedSceneObjectId(sceneObjectId);
      if (dynamic) {
        setExplicitDynamicId(dynamic.id);
        setSelectedPointIdsState([]);
        setSelectedMotionGroupId(null);
        setDynamicEditTime(0);
      }
      discardAiProposal();
      return dynamic ?? formation;
    },
    [aiBuilt, aiProposal, discardAiProposal, pushSnapshot, setSelectedSceneObjectId],
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
          // Escape aborts a running gizmo gesture and leaves NO history entry.
          cancelSceneGizmo();
          setSceneSelectionState(EMPTY_SCENE_SELECTION);
          break;
        case "gizmoMode":
          setGizmoMode(action.mode);
          break;
        case "selectAll":
          selectAllSceneObjectsInScene();
          break;
        case "duplicateSelection":
          if (selectedClipId && sceneSelection.ids.length > 0) {
            duplicateSceneObjectsBatch(selectedClipId, sceneSelection.ids);
          }
          break;
        case "deleteSelection":
          if (selectedClipId && sceneSelection.ids.length > 0) {
            removeSceneObjectsBatch(selectedClipId, sceneSelection.ids);
          }
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    clock,
    duration,
    plan.startTime,
    undoDynamic,
    redoDynamic,
    undoTimeline,
    redoTimeline,
    cancelSceneGizmo,
    selectAllSceneObjectsInScene,
    duplicateSceneObjectsBatch,
    removeSceneObjectsBatch,
    selectedClipId,
    sceneSelection,
  ]);

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

  // ---- Lighting, reveal & colour effects (Sprint 7.4) ---------------------
  // The store owns SELECTION and MUTATION only. Every colour value is produced
  // by the lighting engine, so viewport, inspector and export agree by design.
  const [selectedLightingEffectId, setSelectedLightingEffectId] = useState<string | null>(null);
  const [lightingPreview, setLightingPreview] = useState(true);
  const [lightingEffectPreview, setLightingEffectPreview] = useState<LightingEffectInstance[]>([]);
  const lightingEffectPreviewBaseRef = useRef<ShowProject | null>(null);
  const lightingEffectPreviewSelectionRef = useRef("");
  const lightingSeed = useRef(0);

  const lightingEffects = useMemo(
    () =>
      effectsForClip(project.lighting, selectedClipId ?? "")
        .slice()
        .sort((a, b) => a.priority - b.priority || a.start - b.start || a.id.localeCompare(b.id)),
    [project.lighting, selectedClipId],
  );

  const lightingReport = useMemo(() => validateLightingProgram(project), [project]);

  const selectedLightingEffect = useMemo(
    () => (project.lighting?.effects ?? []).find((e) => e.id === selectedLightingEffectId) ?? null,
    [project.lighting, selectedLightingEffectId],
  );

  /* ------------------------------ canonical clip-selection lifecycle ------ */
  /** Latest clip-scoped editor selection, read by the reconciliation authority. */
  const editorSelectionRef = useRef<EditorClipSelectionState>({
    sceneSelection: EMPTY_SCENE_SELECTION,
    selectedLightingEffectId: null,
    explicitDynamicId: null,
    selectedPointIds: [],
    selectedMotionGroupId: null,
    gizmoDraftActive: false,
  });
  editorSelectionRef.current = {
    sceneSelection: sceneSelectionState,
    selectedLightingEffectId,
    explicitDynamicId,
    selectedPointIds,
    selectedMotionGroupId,
    gizmoDraftActive: sceneGizmoDraft !== null,
  };

  /**
   * ONE reconciliation path (clip switch, clip delete, undo/redo restore).
   * Editor state only: no project mutation, no history, no ownership promotion,
   * no timeline view or playhead change.
   */
  const lastReconciledClipRef = useRef<string | null>(null);
  const applySelectionReconciliation = useCallback(
    (nextProject: ShowProject, nextClipId: string | null, previousClipId: string | null) => {
      const next = reconcileEditorSelection(
        nextProject,
        nextClipId,
        editorSelectionRef.current,
        previousClipId,
      );
      lastReconciledClipRef.current = nextClipId;
      gizmoIdsRef.current = [];
      setSceneGizmoDraft(null);
      setSceneSelectionState(next.sceneSelection);
      setSelectedLightingEffectId(next.selectedLightingEffectId);
      setExplicitDynamicId(next.explicitDynamicId);
      setSelectedPointIdsState([...next.selectedPointIds]);
      setSelectedMotionGroupId(next.selectedMotionGroupId);
    },
    [],
  );
  reconcileSelectionRef.current = applySelectionReconciliation;

  /**
   * DEFENSIVE RECONCILIATION: paths that set the selected clip as a side effect
   * of an authoring command (new clip, duplicate, jump-to-issue, project load)
   * get the identical editor-state reconciliation, so there is never a second
   * lifecycle implementation.
   */
  useEffect(() => {
    if (lastReconciledClipRef.current === selectedClipId) return;
    const previous = lastReconciledClipRef.current;
    applySelectionReconciliation(projectRef.current, selectedClipId, previous);
  }, [selectedClipId, applySelectionReconciliation]);

  /** CANONICAL SELECT CLIP COMMAND. */
  const selectClip = useCallback(
    (id: string | null) => {
      const previous = selectedClipIdRef.current;
      if (previous === id) return;
      setSelectedClipId(id);
      applySelectionReconciliation(projectRef.current, id, previous);
    },
    [applySelectionReconciliation],
  );

  /** "Duplicate clip": fresh clip/scene/object ids, inserted before LANDING. */
  const duplicateClipForDesign = useCallback(
    (clipId: string) => {
      const newClipId = nextId("clip");
      let ok = false;
      setProject((p) => {
        const result = duplicateShowClip(p, clipId, {
          clipId: newClipId,
          lightingEffectId: (index: number) => `${newClipId}-fx-${index + 1}`,
        });
        if (!result) return p;
        ok = true;
        pushSnapshot(p);
        return result.project;
      });
      if (ok) selectClip(newClipId);
      return ok ? newClipId : null;
    },
    [pushSnapshot, selectClip],
  );

  /**
   * LIBRARY "USE IN SHOW" = ONE AUTHORING ACTION.
   *
   * One snapshot, one project update: copied dependencies, the new scene, the
   * new clip and the LANDING shift are a single undo entry, and the selection is
   * made canonical for the new clip afterwards (editor state only).
   */
  const insertLibraryAssetIntoShow = useCallback(
    (asset: FormationAsset, timing?: AssetInsertionTiming) => {
      const clipId = nextId("c");
      let result;
      try {
        result = insertLibraryAsset(
          projectRef.current,
          asset,
          {
            clipId,
            formationId: (i) => `${clipId}-f-${String(i + 1).padStart(2, "0")}`,
            dynamicFormationId: (i) => `${clipId}-dyn-${String(i + 1).padStart(2, "0")}`,
          },
          timing ?? {},
        );
      } catch {
        return null;
      }
      pushSnapshot(projectRef.current);
      setProject(result.project);
      setSelectedClipId(result.clipId);
      applySelectionReconciliation(result.project, result.clipId, selectedClipIdRef.current);
      // SCENE assets select exactly their first object so the gizmo attaches.
      const first = result.sceneObjectIds[0] ?? null;
      if (first) setSceneSelectionState({ ids: [first], primaryId: first });
      return result.clipId;
    },
    [applySelectionReconciliation, pushSnapshot],
  );
  insertLibraryAssetIntoShowRef.current = insertLibraryAssetIntoShow;

  /** Single write path: one call = one undoable lighting program revision. */
  const editLighting = useCallback(
    (fn: (effects: LightingEffectInstance[]) => LightingEffectInstance[]) => {
      pushTimelineHistory();
      setProject((p) => ({
        ...p,
        lighting: {
          schemaVersion: LIGHTING_SCHEMA_VERSION,
          effects: fn([...(p.lighting?.effects ?? [])]),
        },
      }));
    },
    [pushTimelineHistory],
  );

  const addLightingEffectsFromPreset = useCallback(
    (
      clipId: string,
      presetId: string,
      targets: readonly LightingTarget[],
      parameters?: Partial<LightingEffectParameters>,
      timing?: { readonly anchor: "ABSOLUTE"; readonly start: number; readonly duration?: number },
    ): string[] => {
      const preset = findLightingPreset(presetId);
      if (!preset || targets.length === 0) return [];
      const created: LightingEffectInstance[] = targets.map((target) => ({
        ...createEffectFromPreset(preset, target, {
          ...(parameters ? { parameters } : {}),
          ...(timing ? { anchor: timing.anchor, start: timing.start } : {}),
        }),
        id: newLightingEffectId(Date.now() + lightingSeed.current++),
        ...(timing?.duration !== undefined ? { duration: timing.duration } : {}),
      }));
      // ONE revision for the whole multi-selection = ONE undo entry.
      editLighting((list) => [...list, ...created]);
      setSelectedLightingEffectId(created[0]!.id);
      return created.map((e) => e.id);
    },
    [editLighting],
  );

  const makeLightingPresetEffects = useCallback(
    (
      presetId: string,
      targets: readonly LightingTarget[],
      parameters?: Partial<LightingEffectParameters>,
      timing?: { readonly anchor: "ABSOLUTE"; readonly start: number; readonly duration?: number },
    ): LightingEffectInstance[] => {
      const preset = findLightingPreset(presetId);
      if (!preset || targets.length === 0) return [];
      return targets.map((target) => ({
        ...createEffectFromPreset(preset, target, {
          ...(parameters ? { parameters } : {}),
          ...(timing ? { anchor: timing.anchor, start: timing.start } : {}),
        }),
        id: newLightingEffectId(Date.now() + lightingSeed.current++),
        ...(timing?.duration !== undefined ? { duration: timing.duration } : {}),
      }));
    },
    [],
  );

  const previewLightingEffectsFromPreset = useCallback(
    (
      _clipId: string,
      presetId: string,
      targets: readonly LightingTarget[],
      parameters?: Partial<LightingEffectParameters>,
      timing?: { readonly anchor: "ABSOLUTE"; readonly start: number; readonly duration?: number },
    ) => {
      const created = makeLightingPresetEffects(presetId, targets, parameters, timing);
      lightingEffectPreviewBaseRef.current = created.length > 0 ? projectRef.current : null;
      lightingEffectPreviewSelectionRef.current = `${selectedClipId ?? ""}|${sceneSelectionMode}|${sceneSelection.ids.join(",")}|${selectedScenePointIds.join(",")}`;
      setLightingEffectPreview(created);
      setLightingPreview(true);
      return created.map((effect) => effect.id);
    },
    [
      makeLightingPresetEffects,
      sceneSelection.ids,
      sceneSelectionMode,
      selectedClipId,
      selectedScenePointIds,
    ],
  );

  const cancelLightingEffectPreview = useCallback(() => {
    lightingEffectPreviewBaseRef.current = null;
    lightingEffectPreviewSelectionRef.current = "";
    setLightingEffectPreview([]);
  }, []);

  const applyLightingEffectPreview = useCallback(() => {
    const created = lightingEffectPreview;
    if (created.length === 0) return [];
    if (lightingEffectPreviewBaseRef.current !== projectRef.current) {
      cancelLightingEffectPreview();
      return [];
    }
    editLighting((list) => [...list, ...created]);
    setSelectedLightingEffectId(created[0]!.id);
    cancelLightingEffectPreview();
    return created.map((effect) => effect.id);
  }, [cancelLightingEffectPreview, editLighting, lightingEffectPreview]);

  /**
   * PREVIEW INVALIDATION AUTHORITY. A preview is a proposal against one exact
   * project revision and one exact selection. Any canonical edit or selection
   * change invalidates it before Apply can install stale content.
   */
  useEffect(() => {
    if (
      motionEffectPreview &&
      (motionEffectPreview.baseProject !== project ||
        motionEffectPreview.selectionKey !==
          `${selectedClipId ?? ""}|${sceneSelectionMode}|${sceneSelection.ids.join(",")}|${selectedScenePointIds.join(",")}`)
    ) {
      setMotionEffectPreview(null);
    }
    const selectionKey = `${selectedClipId ?? ""}|${sceneSelectionMode}|${sceneSelection.ids.join(",")}|${selectedScenePointIds.join(",")}`;
    if (
      lightingEffectPreviewBaseRef.current &&
      (lightingEffectPreviewBaseRef.current !== project ||
        lightingEffectPreviewSelectionRef.current !== selectionKey)
    ) {
      cancelLightingEffectPreview();
    }
  }, [
    cancelLightingEffectPreview,
    lightingEffectPreview,
    motionEffectPreview,
    project,
    sceneSelection.ids,
    sceneSelectionMode,
    selectedClipId,
    selectedScenePointIds,
  ]);

  const addLightingEffectFromPreset = useCallback(
    (
      clipId: string,
      presetId: string,
      target?: LightingTarget,
      parameters?: Partial<LightingEffectParameters>,
    ) =>
      addLightingEffectsFromPreset(
        clipId,
        presetId,
        [target ?? { kind: "SCENE", clipId }],
        parameters,
      )[0] ?? null,
    [addLightingEffectsFromPreset],
  );

  const patchLightingEffect = useCallback(
    (id: string, patch: Partial<Omit<LightingEffectInstance, "id">>) => {
      editLighting((list) => list.map((e) => (e.id === id ? { ...e, ...patch, id } : e)));
    },
    [editLighting],
  );

  const patchLightingParameters = useCallback(
    (id: string, patch: Partial<LightingEffectParameters>) => {
      editLighting((list) =>
        list.map((e) => (e.id === id ? { ...e, parameters: { ...e.parameters, ...patch } } : e)),
      );
    },
    [editLighting],
  );

  const removeLightingEffect = useCallback(
    (id: string) => {
      editLighting((list) => list.filter((e) => e.id !== id));
      setSelectedLightingEffectId((current) => (current === id ? null : current));
    },
    [editLighting],
  );

  /**
   * DUPLICATE — a copy of the same canonical effect, one revision, and the copy
   * becomes the selected effect so the inspector follows the operator.
   */
  const duplicateLightingEffect = useCallback(
    (id: string): string | null => {
      const source = (projectRef.current.lighting?.effects ?? []).find((e) => e.id === id);
      if (!source) return null;
      const copyId = newLightingEffectId(Date.now() + lightingSeed.current++);
      editLighting((list) => {
        const index = list.findIndex((e) => e.id === id);
        if (index < 0) return list;
        const copy: LightingEffectInstance = { ...list[index]!, id: copyId };
        return [...list.slice(0, index + 1), copy, ...list.slice(index + 1)];
      });
      setSelectedLightingEffectId(copyId);
      return copyId;
    },
    [editLighting],
  );

  /**
   * ATOMIC CLIP DELETION (referential integrity).
   *
   * ONE undo entry, ONE project update: the clip, its composed scene, its
   * participation override and every lighting effect targeting it disappear
   * together. Reusable assets (formations, dynamic formations, SVG sources)
   * are never touched. Declared here so the lighting/dynamic selection setters
   * it reconciles are already in scope.
   */
  /**
   * FORMATION RENAME. Naming is authored content, so it is snapshotted like any
   * other authored edit and never regenerates geometry.
   */
  const renameFormation = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setProject((p) => {
        const target = p.formations.find((f) => f.id === id);
        if (!target || target.name === trimmed) return p;
        pushSnapshot(p);
        return {
          ...p,
          formations: p.formations.map((f) => (f.id === id ? { ...f, name: trimmed } : f)),
        };
      });
    },
    [pushSnapshot],
  );

  const removeClip = useCallback(
    (id: string) => {
      setProject((p) => {
        const removed = p.timeline.find((c) => c.id === id);
        if (!removed) return p;
        pushSnapshot(p);

        const next = removeTimelineClipReferences(p, id);
        const previous = selectedClipIdRef.current;
        const nextClip = previous === id ? nextSelectedClipId(next.timeline, removed) : previous;
        setSelectedClipId(nextClip);
        // SAME reconciliation as selectClip — no second editor-state path.
        reconcileSelectionRef.current(next, nextClip, previous);
        setTransitionOverrides((current) => {
          if (!Object.prototype.hasOwnProperty.call(current, id)) return current;
          const rest = { ...current };
          delete rest[id];
          const basis = { ...overrideBasisRef.current };
          delete basis[id];
          overrideBasisRef.current = basis;
          return rest;
        });
        setTransitionDesigns((current) => {
          if (!Object.prototype.hasOwnProperty.call(current, id)) return current;
          const rest = { ...current };
          delete rest[id];
          return rest;
        });
        return next;
      });
    },
    [pushSnapshot],
  );

  const commitLightingTiming = useCallback(
    (id: string, timing: { start?: number; duration?: number }) => {
      editLighting((list) =>
        list.map((e) => {
          if (e.id !== id) return e;
          const start = Number.isFinite(timing.start) ? Number(timing.start!.toFixed(3)) : e.start;
          const duration = Number.isFinite(timing.duration)
            ? Math.max(0.1, Number(timing.duration!.toFixed(3)))
            : e.duration;
          return { ...e, start, duration };
        }),
      );
    },
    [editLighting],
  );

  /**
   * ESSP PER-DRONE PACKAGE. Pure read of canonical state: project, canonical
   * plan, imported layer and the current full-show report (the single safety
   * authority). No UI state and no clip geometry are read here.
   */
  const buildEsspPackage = useCallback(
    (): EsspExportResult =>
      buildEsspExportPackage({
        project,
        plan,
        reference:
          referenceLayer && referenceLayerShow
            ? { show: referenceLayerShow, layer: referenceLayer }
            : null,
        fullShow: fullShow?.report ?? null,
        fullShowStale,
      }),
    [project, plan, referenceLayer, referenceLayerShow, fullShow, fullShowStale],
  );

  /**
   * ORIGINAL ESSP SOURCE RECOVERY. Returns the imported bytes verbatim; it is
   * NOT an export and is intentionally independent from the validation gate.
   */
  const buildOriginalEsspPackage = useCallback(
    (): EsspSourceRecoveryResult =>
      buildOriginalEsspDownload({ projectName: project.name, layer: referenceLayer }),
    [project.name, referenceLayer],
  );
  const hasEsspSourceFiles = hasEsspSourceBytes(referenceLayer);

  /** Canonical ESSP source clocks for the export preflight (no recomputation). */
  const esspPreflightSource = useMemo<PreflightReferenceSource | null>(
    () =>
      referenceLayer && referenceLayerShow
        ? {
            positionRateHz: referenceLayerShow.timing.positionRateHz,
            rgbRateHz: referenceLayerShow.timing.rgbRateHz,
            droneFileCount: referenceLayerShow.drones.length,
          }
        : null,
    [referenceLayer, referenceLayerShow],
  );

  /**
   * LED AUTHORITY of a reference-owned instant: the original RGB byte triplets.
   * Returns null when the authored lighting engine owns the LEDs at `t`.
   */
  const referenceColorsAt = useCallback(
    (t: number): RGB[] | null =>
      referenceColorsAtTime(referenceLayerShow, referenceLayer, t, project.droneCount),
    [referenceLayer, referenceLayerShow, project.droneCount],
  );

  const lightingStatesAtTime = useCallback(
    (t: number): DroneLightState[] => {
      // An imported reference-owned interval owns its LEDs too: the displayed
      // colour is the original RGB byte triplet, not an authored effect.
      if (
        referenceLayerShow &&
        referenceLayer &&
        intervalAtTime(referenceLayer, t)?.owner === "REFERENCE"
      ) {
        return referenceLightStates(referenceLayerShow, t, project.droneCount);
      }
      if (!lightingPreview) return [];
      if ((project.lighting?.effects.length ?? 0) === 0 && lightingEffectPreview.length === 0)
        return [];
      const previewProject =
        lightingEffectPreview.length === 0
          ? project
          : {
              ...project,
              lighting: {
                schemaVersion: LIGHTING_SCHEMA_VERSION,
                effects: [...(project.lighting?.effects ?? []), ...lightingEffectPreview],
              },
            };
      return projectLightingAt(
        {
          project: previewProject,
          participation: plan.participation,
          positions: samplesAtTime(t).map((s) => s.position),
        },
        t,
      );
    },
    [
      lightingPreview,
      lightingEffectPreview,
      project,
      plan.participation,
      samplesAtTime,
      referenceLayer,
      referenceLayerShow,
    ],
  );

  const value = useMemo<StudioContextValue>(
    () => ({
      project,
      plan,
      trajectorySet,
      effectiveAuthority,
      referenceColorsAt,
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
      timelineScrollGeometry: scrollGeometry,
      snapMode,
      followPlayhead,
      setSnapMode,
      setFollowPlayhead,
      setTimelineZoom,
      setTimelineScroll,
      fitTimeline,
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
      selectedSceneObjectId: resolvedSceneObjectId,
      selectedSceneObjectIds,
      primarySceneObjectId: resolvedSceneObjectId,
      selectSceneObject,
      setSelectedSceneObjectIds,
      selectAllSceneObjectsInScene,
      sceneSelectionMixed,
      sceneObjectIdForDrone,
      sceneSelectionMode,
      setSceneSelectionMode,
      scenePointSelectionTool,
      setScenePointSelectionTool,
      selectedScenePointIds,
      selectedScenePointDroneIndices,
      scenePointGroups,
      selectScenePointForDrone,
      selectScenePointsForDrones,
      clearScenePointSelection,
      createScenePointGroup,
      renameScenePointGroup,
      removeScenePointGroupById,
      selectScenePointGroup,
      createSceneVisualGroup,
      renameSceneVisualGroupById,
      removeSceneVisualGroupById,
      selectSceneVisualGroup,
      captureSceneVisualGroupState,
      applySceneVisualGroupState,
      renameSceneVisualGroupState,
      removeSceneVisualGroupState,
      addSceneVisualStateCueAtPlayhead,
      removeSceneVisualStateCueById,
      patchSceneVisualStateCueById,
      applyMotionPresetToSceneSelection,
      previewMotionPresetToSceneSelection,
      motionEffectPreviewIds: motionEffectPreview?.dynamicFormationIds ?? [],
      applyMotionEffectPreview,
      cancelMotionEffectPreview,
      patchSceneObjectAnimation,
      patchSceneMotion,
      patchSceneMotionGroup,
      duplicateSceneObjectMotion,
      removeSceneObjectMotion,
      transformSceneObjects,
      mirrorSceneObjectsBatch,
      duplicateSceneObjectsBatch,
      removeSceneObjectsBatch,
      applySceneDesign,
      alignSceneObjectsByMode,
      canEditClipAsScene,
      editClipAsScene,
      duplicateClipForDesign,
      clipThumbnails,
      gizmoMode,
      setGizmoMode,
      gizmoTranslateSnap,
      setGizmoTranslateSnap,
      gizmoRotateSnap,
      setGizmoRotateSnap,
      sceneGizmoPivot,
      sceneGizmoDraft,
      sceneGizmoPreviewPoints,
      beginSceneGizmo,
      updateSceneGizmo,
      commitSceneGizmo,
      cancelSceneGizmo,
      addSceneObject,
      addNativeVisual,
      addTextVisual,
      patchSceneObject,
      patchSceneObjectTransform,
      duplicateSceneObject,
      removeSceneObject,
      mirrorSceneObject,
      alignSceneObjects,
      patchSceneTransform,
      selectedClipBinding,
      sceneReferenceGhost,
      setSceneReferenceGhost,
      sceneComparisonFrame,
      setSceneComparisonFrame,
      sceneGhostFrame,
      sceneDeviation,
      sceneCorrespondence,
      canResetSelectedSceneObject,
      resetSceneObject,
      duplicateSceneAsEditable,
      applyGeometryProposal,
      applyTextFormation,

      lightingEffects,
      lightingReport,
      selectedLightingEffectId,
      selectedLightingEffect,
      selectLightingEffect: setSelectedLightingEffectId,
      addLightingEffectFromPreset,
      addLightingEffectsFromPreset,
      previewLightingEffectsFromPreset,
      lightingEffectPreview,
      applyLightingEffectPreview,
      cancelLightingEffectPreview,

      patchLightingEffect,
      patchLightingParameters,
      removeLightingEffect,
      duplicateLightingEffect,

      commitLightingTiming,
      lightingStatesAt: lightingStatesAtTime,
      lightingPreview,
      setLightingPreview,
      selectedClipId,
      samplesAtTime,
      setTime: clock.seek,
      togglePlay: clock.toggle,
      play: clock.play,
      pause: clock.pause,
      stop: clock.stop,
      setSpeed: clock.setSpeed,
      setLoop: clock.setLoop,
      selectClip,
      insertLibraryAssetIntoShow,
      patchProject,
      participationSettings,
      patchParticipation,
      setClipParticipation,
      createProjectFromDraft,
      loadSampleShow,
      applySetupDraft,
      currentSetupDraft,
      addLibraryFormation,
      addLibraryDynamicFormation,
      addSceneAssetToShow,
      sceneAssetPayloadForClip,
      setDroneCount,
      setLimits,
      addFormation,
      updateFormation,
      renameFormation,
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
      transitionDesigns,
      transitionDesignFor,
      transitionDesignNeedsRecalculation,
      setTransitionDesign,
      applyTransitionDesignToAllClips,
      bulkTransitionResult,
      patchTransitionDroneOffset,
      canAnalyzeSelectedClip,
      showPaths,
      setShowPaths,
      showConflicts,
      setShowConflicts,
      showSafetyVolume,
      setShowSafetyVolume,
      showReserveDrones,
      setShowReserveDrones,
      fullShowPlan: fullShow?.plan ?? null,
      fullShowReport: fullShow?.report ?? null,
      fullShowBusy,
      fullShowProgress,
      fullShowStale,
      fullShowError,
      analysisRevision,
      fullShowAnalysisOptions,
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
      preShowStale: preShowPreview ? preShowPreview.revision !== analysisRevision : fullShowStale,
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
      saveProjectFileAs,
      documentOpen,
      closeShow,
      documentAction,
      clearDocumentAction,
      buildProjectFile,
      referenceLayer,
      referenceOwnership,
      referenceOwnedNow,
      referenceExtraction,
      referenceAssetDrafts,
      referenceExtractionWarnings,
      referenceExtractionError,
      extractReferenceShowToProject,
      promoteReferenceClip,
      clearReferenceLayer,
      verifyReferenceSplices,
      referenceLayerLimitations: REFERENCE_LAYER_LIMITATIONS,
      buildEsspPackage,
      buildOriginalEsspPackage,
      hasEsspSourceFiles,
      esspPreflightSource,
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
      effectiveAuthority,
      referenceColorsAt,
      sampleRate,
      safety,
      beatGrid,
      duration,
      viewEnd,
      audioPeaks,
      timelineView,
      timelineZoom,
      timelineScroll,
      scrollGeometry,
      snapMode,
      followPlayhead,
      setTimelineZoom,
      setTimelineScroll,
      fitTimeline,
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
      resolvedSceneObjectId,
      selectedSceneObjectIds,
      selectSceneObject,
      setSelectedSceneObjectIds,
      selectAllSceneObjectsInScene,
      sceneSelectionMixed,
      sceneObjectIdForDrone,
      sceneSelectionMode,
      setSceneSelectionMode,
      scenePointSelectionTool,
      selectedScenePointIds,
      selectedScenePointDroneIndices,
      scenePointGroups,
      selectScenePointForDrone,
      selectScenePointsForDrones,
      clearScenePointSelection,
      createScenePointGroup,
      renameScenePointGroup,
      removeScenePointGroupById,
      selectScenePointGroup,
      createSceneVisualGroup,
      renameSceneVisualGroupById,
      removeSceneVisualGroupById,
      selectSceneVisualGroup,
      captureSceneVisualGroupState,
      applySceneVisualGroupState,
      renameSceneVisualGroupState,
      removeSceneVisualGroupState,
      addSceneVisualStateCueAtPlayhead,
      removeSceneVisualStateCueById,
      patchSceneVisualStateCueById,
      applyMotionPresetToSceneSelection,
      previewMotionPresetToSceneSelection,
      motionEffectPreview,
      applyMotionEffectPreview,
      cancelMotionEffectPreview,
      patchSceneObjectAnimation,
      patchSceneMotion,
      patchSceneMotionGroup,
      duplicateSceneObjectMotion,
      removeSceneObjectMotion,
      transformSceneObjects,
      mirrorSceneObjectsBatch,
      duplicateSceneObjectsBatch,
      removeSceneObjectsBatch,
      applySceneDesign,
      alignSceneObjectsByMode,
      canEditClipAsScene,
      editClipAsScene,
      duplicateClipForDesign,
      clipThumbnails,
      gizmoMode,
      gizmoTranslateSnap,
      gizmoRotateSnap,
      sceneGizmoPivot,
      sceneGizmoDraft,
      sceneGizmoPreviewPoints,
      beginSceneGizmo,
      updateSceneGizmo,
      commitSceneGizmo,
      cancelSceneGizmo,
      addSceneObject,
      addNativeVisual,
      addTextVisual,
      patchSceneObject,
      patchSceneObjectTransform,
      duplicateSceneObject,
      removeSceneObject,
      mirrorSceneObject,
      alignSceneObjects,
      patchSceneTransform,
      selectedClipBinding,
      sceneReferenceGhost,
      sceneComparisonFrame,
      sceneGhostFrame,
      sceneDeviation,
      sceneCorrespondence,
      canResetSelectedSceneObject,
      resetSceneObject,
      duplicateSceneAsEditable,
      applyGeometryProposal,
      applyTextFormation,

      lightingEffects,
      lightingReport,
      selectedLightingEffectId,
      selectedLightingEffect,
      addLightingEffectFromPreset,
      addLightingEffectsFromPreset,
      previewLightingEffectsFromPreset,
      lightingEffectPreview,
      applyLightingEffectPreview,
      cancelLightingEffectPreview,

      patchLightingEffect,
      patchLightingParameters,
      removeLightingEffect,
      duplicateLightingEffect,

      commitLightingTiming,
      lightingStatesAtTime,
      lightingPreview,
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
      renameFormation,
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
      transitionDesigns,
      transitionDesignFor,
      transitionDesignNeedsRecalculation,
      setTransitionDesign,
      applyTransitionDesignToAllClips,
      bulkTransitionResult,
      patchTransitionDroneOffset,
      canAnalyzeSelectedClip,
      showPaths,
      showConflicts,
      showReserveDrones,
      showSafetyVolume,
      fullShow,
      fullShowBusy,
      fullShowProgress,
      fullShowStale,
      fullShowError,
      analysisRevision,
      fullShowAnalysisOptions,
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
      buildProjectFile,
      referenceLayer,
      referenceOwnership,
      referenceOwnedNow,
      referenceExtraction,
      referenceAssetDrafts,
      referenceExtractionWarnings,
      referenceExtractionError,
      extractReferenceShowToProject,
      promoteReferenceClip,
      clearReferenceLayer,
      verifyReferenceSplices,
      buildEsspPackage,
      buildOriginalEsspPackage,
      hasEsspSourceFiles,
      esspPreflightSource,

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
