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
import {
  documentFeedback,
  saveAsFileName,
  type DocumentFeedback,
} from "./documentLifecycle";

import { setGeometryProposalPreview } from "./geometryProposalPreview";

import {
  createAsyncJobAuthority,
  createProjectSessionAuthority,
  invalidateProjectSessionJobs,
} from "./asyncJobAuthority";
import {
  resetProjectSessionState,
  type ProjectSessionResetSetters,
} from "./projectLifecycle";
import { isAutosaveWriteAuthorized, isRecoveryOfferable } from "./autosaveAuthority";
import { projectPersistenceOptions } from "./projectPersistence";
import { createAnalysisRunAuthority } from "./analysisRunAuthority";
import { findSampleShow } from "../show/stories/samples";
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
import { insertLibraryAsset, type AssetInsertionTiming } from "./assetInsertion";
import {
  reconcileEditorSelection,
  type EditorClipSelectionState,
} from "./clipSelection";
import {
  computeOverrideBasis,
  pruneTransitionOverrides,
  type OverrideBasisMap,
  type TimelineHistorySnapshot,
} from "./planningIntegrity";
import { prepareGeometryApplyCommand, type GeometryApplyPreparationSuccess } from "./geometryApplyCommand";
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
  removeObject,
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
  insertLibraryAssetIntoShow: (asset: FormationAsset, timing?: AssetInsertionTiming) => string | null;
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

  // ---- Batch scene gestures (ONE mutation, ONE undo entry) ----------------
  transformSceneObjects: (clipId: string, objectIds: readonly string[], delta: SceneGroupDelta) => void;
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
  ) => string[];

  patchLightingEffect: (id: string, patch: Partial<Omit<LightingEffectInstance, "id">>) => void;
  patchLightingParameters: (id: string, patch: Partial<LightingEffectParameters>) => void;
  removeLightingEffect: (id: string) => void;
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
  // ---- Transition design (mode + stagger over the SAME override) ---------
  /** Authored design intent per clip; persisted with the planning state. */
  transitionDesigns: Record<string, TransitionDesignState>;
  /** Authored design of a clip, or the mode derived from its override data. */
  transitionDesignFor: (clipId: string) => TransitionDesignState;
  /** True when the authored design lost its override (semantic invalidation). */
  transitionDesignNeedsRecalculation: (clipId: string) => boolean;
  /** One designer change = one undo entry; rebuilds the canonical override. */
  setTransitionDesign: (clipId: string, patch: Partial<TransitionDesignState>) => void;
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
type AdoptProjectOutcome =
  | { ok: true }
  | { ok: false; error: { code: string; message: string } };

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
  const [sceneSelectionState, setSceneSelectionState] = useState<SceneSelection>(
    EMPTY_SCENE_SELECTION,
  );
  /** Reference-assisted editing (design aid only, never persisted). */
  const [sceneReferenceGhost, setSceneReferenceGhost] = useState(false);
  const [sceneComparisonFrame, setSceneComparisonFrame] = useState<SceneComparisonFrame>("EXTRACTED");

  const [sampleRate, setSampleRate] = useState<number>(DEFAULT_SAMPLE_RATE);
  const [svgAssets, setSvgAssets] = useState<Record<string, SvgAsset>>({});
  const [svgDraft, setSvgDraft] = useState<SvgDraft | null>(null);
  const [svgBusy, setSvgBusy] = useState(false);
  const [svgError, setSvgError] = useState<SvgFormationError | null>(null);
  const [assignmentStrategy, setAssignmentStrategy] = useState<AssignmentStrategyId>("nearestNeighbor");
  const [transitionOverrides, setTransitionOverrides] = useState<Record<string, ClipTransitionOverride>>({});
  /**
   * AUTHORED TRANSITION DESIGN per clip (mode + stagger pattern). Intent only:
   * the flown data always lives in `transitionOverrides`, which this state
   * produces through the existing optimizer/analyzer.
   */
  const [transitionDesigns, setTransitionDesigns] = useState<Record<string, TransitionDesignState>>({});
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
  /** Presentation-session reconciliation of an adopted project (see ./editorSession). */
  const adoptedEditorSessionRef = useRef<() => void>(() => {});

  const adoptProjectRef = useRef<
    (next: ShowProject, fileName: string, restore?: AdoptProjectRestore) => AdoptProjectOutcome
  >(() => ({ ok: true }));

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
  const [referenceLayer, setReferenceLayer] = useState<ReferenceTrajectoryLayer | null>(null);
  /** Rehydrated payload of the layer — the playback authority for its intervals. */
  const [referenceLayerShow, setReferenceLayerShow] = useState<ReferenceShow | null>(null);
  const [referenceExtraction, setReferenceExtraction] = useState<
    readonly ReferenceExtractionDiagnostic[]
  >([]);
  const [referenceAssetDrafts, setReferenceAssetDrafts] = useState<readonly ReferenceAssetDraft[]>([]);
  const [referenceExtractionWarnings, setReferenceExtractionWarnings] = useState<readonly string[]>(
    [],
  );
  const [referenceExtractionError, setReferenceExtractionError] = useState<
    { code: string; message: string } | null
  >(null);
  const [forensicsReport, setForensicsReport] = useState<ReferenceForensicsReport | null>(null);
  const [forensicsBusy, setForensicsBusy] = useState(false);
  const [forensicsError, setForensicsError] = useState<string | null>(null);
  const [forensicsPreset, setForensicsPresetState] = useState<ForensicsPresetName>("BALANCED");
  const [forensicsThresholds, setForensicsThresholds] = useState<ReferenceForensicsThresholds>(
    FORENSICS_PRESETS.BALANCED,
  );
  const [selectedForensicSegmentId, setSelectedForensicSegmentId] = useState<string | null>(null);
  const [showForensicActiveDrones, setShowForensicActiveDrones] = useState(true);
  /**
   * PROJECT-SESSION ASYNC AUTHORITY (see ./asyncJobAuthority).
   *
   * One session generation for the whole Studio, advanced ONLY by a successful
   * project adoption, plus one authority per async subsystem so "newest request
   * wins" and "still the current document" are decided in one place. Refs, not
   * state: no rerender is caused by async bookkeeping.
   */
  const projectSession = useRef(createProjectSessionAuthority());
  const forensicsJobs = useRef(createAsyncJobAuthority());
  const audioJobs = useRef(createAsyncJobAuthority());
  const svgJobs = useRef(createAsyncJobAuthority());
  const esspJobs = useRef(createAsyncJobAuthority());
  const aiJobs = useRef(createAsyncJobAuthority());
  /** Session-only scope (identity of the open document, nothing else). */
  const sessionScope = useCallback(() => projectSession.current.scope(), []);

  // Pure engine pipeline: formations -> assignment -> planning -> sampling -> safety.
  const plan = useMemo(
    () => buildShowPlan(project, { assignmentStrategy, transitionOverrides }),
    [project, assignmentStrategy, transitionOverrides],
  );
  /**
   * EFFECTIVE TRAJECTORY AUTHORITY. When an imported ESSP layer is present the
   * canonical set is SPLICED (imported samples on reference-owned intervals,
   * planner output elsewhere), so safety, simulation and export all judge what
   * actually flies rather than a planner-only approximation.
   */
  const effective = useMemo(
    () =>
      sampleEffectiveTrajectorySet(plan, {
        sampleRate,
        startTime: plan.startTime ?? 0,
        endTime: plan.duration,
        reference:
          referenceLayer && referenceLayerShow
            ? { layer: referenceLayer, show: referenceLayerShow }
            : null,
      }),
    [plan, sampleRate, referenceLayer, referenceLayerShow],
  );
  const trajectorySet = effective.set;
  const effectiveAuthority = effective.authority;
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
  /**
   * TIMELINE HISTORY MODEL.
   *
   * One gesture = ONE snapshot of every canonical authoring/planning state a
   * timeline command can change: the project AND the applied transition
   * overrides (which decide the flown trajectory). Transient analysis reports
   * are deliberately NOT snapshotted — they are derived and recomputed.
   */
  const timelineHistory = useRef<{ past: TimelineHistorySnapshot[]; future: TimelineHistorySnapshot[] }>({
    past: [],
    future: [],
  });
  const [timelineHistoryDepth, setTimelineHistoryDepth] = useState({ past: 0, future: 0 });
  /** Planning basis of each applied override — see ./planningIntegrity. */
  const overrideBasisRef = useRef<OverrideBasisMap>({});
  const transitionOverridesRef = useRef<Record<string, ClipTransitionOverride>>({});
  transitionOverridesRef.current = transitionOverrides;
  const transitionDesignsRef = useRef<Record<string, TransitionDesignState>>({});
  transitionDesignsRef.current = transitionDesigns;
  const projectRef = useRef(project);
  projectRef.current = project;

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
    () =>
      computeAnalysisRevision(project, {
        sampleRate,
        assignmentStrategy,
        transitionOverrides,
        referenceLayer,
      }),
    [project, sampleRate, assignmentStrategy, transitionOverrides, referenceLayer],
  );
  analysisRevisionRef.current = analysisRevision;
  const fullShowStale = !!fullShow && fullShow.report.analysisRevision !== analysisRevision;

  /**
   * STALE-RESULT GUARD.
   *
   * Transient analysis reports are always dropped on a project edit. Applied
   * overrides are canonical planning state, so they are pruned SURGICALLY: only
   * clips whose planning basis actually changed (geometry, limits, `start`,
   * `transition`, easing, formation) lose their override. A blanket reset would
   * silently revert a saved optimized project to unoptimized planning.
   */
  const projectGeneration = useRef(0);
  useEffect(() => {
    projectGeneration.current += 1;
    setTransitionAnalysis(null);
    setAssignmentComparison(null);
    setOptimization(null);
    setTransitionError(null);
    setTransitionOverrides((current) => {
      const pruned = pruneTransitionOverrides(projectRef.current, current, overrideBasisRef.current);
      overrideBasisRef.current = pruned.basis;
      return pruned.changed ? pruned.overrides : current;
    });
  }, [project.formations, project.droneCount, project.timeline, project.limits, project.area]);


  // Canonical duration — NEVER project.audio.duration.
  const duration = useMemo(() => {
    if (referencePlayback && referenceShow) {
      return Math.max(referenceShow.timing.playbackDurationSeconds, 1);
    }
    return Math.max(showDuration(project), 1);
  }, [project, referencePlayback, referenceShow]);
  // ADAPTIVE AUTHORED RANGE — one canonical layout engine (timelineLayout.ts).
  // Reference playback keeps its dedicated reference-duration path.
  const contentRange = useMemo(
    () => timelineContentRange(project, plan.startTime),
    [project, plan.startTime],
  );
  const viewEnd = useMemo(() => {
    if (referencePlayback && referenceShow) return duration;
    return Math.max(contentRange.end, 1);
  }, [duration, contentRange, referencePlayback, referenceShow]);
  // PRE-SHOW extends playback into negative show time; SHOW TIME ZERO is fixed.
  const clock = useShowClock(viewEnd, referencePlayback && referenceShow ? 0 : plan.startTime);

  const timelineFullStart = referencePlayback && referenceShow ? 0 : contentRange.start;
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

  /** Scrollbar geometry — derived from the SAME view authority, never a second one. */
  const scrollGeometry = useMemo(
    () =>
      computeScrollGeometry({
        start: timelineFullStart,
        end: viewEnd,
        zoom: timelineZoom,
        scroll: timelineScroll,
      }),
    [timelineFullStart, viewEnd, timelineZoom, timelineScroll],
  );

  /**
   * AUTHORED RANGE CHANGE WHILE ZOOMED — adding a clip, a LANDING shift, audio
   * or markers growing the range must NOT Fit and must not jump to scroll 0:
   * zoom is kept and the previously viewed window is re-expressed in the new
   * range, clamped only when it no longer fits.
   */
  const rangeRef = useRef({ start: timelineFullStart, end: viewEnd });
  useEffect(() => {
    const previous = rangeRef.current;
    rangeRef.current = { start: timelineFullStart, end: viewEnd };
    if (previous.start === timelineFullStart && previous.end === viewEnd) return;
    if (timelineZoom <= 1) return;
    setTimelineScrollState((scroll) =>
      preserveScrollAcrossRange(
        { start: previous.start, end: previous.end, zoom: timelineZoom, scroll },
        { start: timelineFullStart, end: viewEnd },
      ),
    );
  }, [timelineFullStart, viewEnd, timelineZoom]);

  /** FIT — restore the complete authored range (editor state only). */
  const fitTimeline = useCallback(() => {
    setTimelineZoomState(ADOPTED_TIMELINE_VIEW.zoom);
    setTimelineScrollState(ADOPTED_TIMELINE_VIEW.scroll);
  }, []);


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

  /**
   * SESSION-SCOPED DECODE. The decoded buffer, peaks and audio metadata may only
   * be installed when this decode is still the newest one AND the document it
   * started under is still open. A late failure is rejected on the same terms,
   * and busy is only released by the decode that currently owns it.
   */
  const attachAudioFile = useCallback(async (file: File) => {
    const token = audioJobs.current.begin(sessionScope());
    setAudioBusy(true);
    setAudioError(null);
    try {
      const decoded = await decodeAudioFile(file);
      if (!audioJobs.current.accepts(token, sessionScope())) return;
      audioBufferRef.current = decoded.buffer;
      setAudioPeaks(decoded.peaks);
      setProject((p) => ({
        ...p,
        audio: { ...p.audio, name: decoded.name, duration: decoded.duration, attached: true },
      }));
    } catch (err) {
      if (!audioJobs.current.accepts(token, sessionScope())) return;
      audioBufferRef.current = null;
      setAudioPeaks(null);
      setAudioError(err instanceof Error ? err.message : String(err));
    } finally {
      if (audioJobs.current.isCurrent(token)) setAudioBusy(false);
    }
  }, [sessionScope]);

  const detachAudioFile = useCallback(() => {
    audioJobs.current.invalidate();
    audioBufferRef.current = null;
    setAudioPeaks(null);
    setAudioError(null);
    setProject((p) => ({ ...p, audio: { ...p.audio, name: "", duration: 0, attached: false } }));
  }, []);

  const setAudioOffset = useCallback((offset: number) => {
    const value = Number.isFinite(offset) ? Number(offset.toFixed(3)) : 0;
    setProject((p) => ({ ...p, audio: { ...p.audio, offset: value } }));
  }, []);

  /**
   * SPLICED PLAYBACK. Reference-owned intervals of an imported show play the
   * imported samples; everything else is the planner output. Exactly one
   * authority per instant — never a blend of the two.
   */
  const samplesAtTime = useCallback(
    (t: number) =>
      splicedTrajectorySamples(referenceLayerShow, referenceLayer, t, samplesAt(plan, t)).samples,
    [plan, referenceLayer, referenceLayerShow],
  );

  const referenceOwnership = useMemo(
    () => (referenceLayer ? referenceOwnershipSummary(referenceLayer) : null),
    [referenceLayer],
  );
  const referenceOwnedNow = useMemo(
    () =>
      !!referenceLayer && intervalAtTime(referenceLayer, clock.time)?.owner === "REFERENCE",
    [referenceLayer, clock.time],
  );

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

  /**
   * SINGLE fleet-size resize path. Every caller (fleet field, setup wizard)
   * goes through this so `project.droneCount` and the derived geometry can
   * never disagree. Grid capacity (rows * columns) is NEVER the fleet size.
   */
  const projectWithDroneCount = useCallback(
    (p: ShowProject, n: number): ShowProject => {
      const count = Math.max(3, Math.min(500, Math.round(n)));
      return {
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
      };
    },
    [svgAssets],
  );

  const setDroneCount = useCallback(
    (n: number) => {
      setProject((p) => projectWithDroneCount(p, n));
    },
    [projectWithDroneCount],
  );



  const currentSetupDraft = useMemo(() => setupDraftFromProject(project), [project]);

  /**
   * Replaces the whole open project with an authored one (setup wizard, sample
   * shows). It flows through the SAME adoption boundary as opening a file, so
   * there is exactly one reset list; only the file state differs: an authored
   * project has no file on disk and must not claim the previous file's save.
   */
  const loadShowProject = useCallback((created: ShowProject) => {
    adoptProjectRef.current(created, suggestedProjectFileName(created.name), {
      fileState: "UNSAVED",
    });
  }, []);

  const createProjectFromDraft = useCallback(
    (draft: ProjectSetupDraft) => {
      loadShowProject(createProjectFromSetup(draft));
    },
    [loadShowProject],
  );

  const loadSampleShow = useCallback(
    (sampleId: string) => {
      const sample = findSampleShow(sampleId);
      if (!sample) return false;
      loadShowProject(sample.create());
      return true;
    },
    [loadShowProject],
  );


  const applySetupDraft = useCallback(
    (draft: ProjectSetupDraft) => {
      // ATOMIC: fleet size, launch grid and staging are committed in ONE state
      // update, so no render can ever pair a new grid with the previous fleet
      // size (or the reverse). Fleet size still flows through the canonical
      // resampling path so SVG and procedural formations stay exact-N.
      setProject((p) => {
        const resized = projectWithDroneCount(p, draft.droneCount);
        return {
          ...resized,
          name: draft.name.trim() || p.name,
          preShow: preShowConfigFromSetup(draft, p.preShow),
        };
      });
      // Any cached analysis was computed for the previous fleet size.
      setPreShowPreview(null);
      setFullShow(null);
      setSelectedLaunchGroupId(null);
      setHighlightedDrones([]);
    },
    [projectWithDroneCount],
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
      const token = svgJobs.current.begin(sessionScope());
      setSvgBusy(true);
      setSvgError(null);
      try {
        const asset = await importSvgFile(file, { assetId: nextId("svg") });
        if (!svgJobs.current.accepts(token, sessionScope())) return;
        setSvgAssets((m) => ({ ...m, [asset.id]: asset }));
        const params = resolveSvgParams(project.droneCount, {
          altitude: Math.min(project.area.height * 0.55, 60),
          width: Math.min(project.area.width * 0.7, 90),
        });
        setSvgDraft(regenerateDraft(asset, params, project));
      } catch (err) {
        if (!svgJobs.current.accepts(token, sessionScope())) return;
        setSvgError(toSvgFormationError(err));
        setSvgDraft(null);
      } finally {
        if (svgJobs.current.isCurrent(token)) setSvgBusy(false);
      }
    },
    [project, regenerateDraft, sessionScope],
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
        const clip: TimelineClip = {
          id: clipId,
          formationId: formation.id,
          start: 0,
          transition: 10,
          hold: 8,
          easing: "minJerk",
          color: [140, 220, 255],
          effect: "solid",
          phase: "SHOW",
        };
        return { ...next, timeline: insertClipBeforeLanding(p.timeline, clip) };
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
      const clip: TimelineClip = {
        id,
        formationId,
        start: 0,
        transition: Math.max(0.5, timing?.transition ?? 8),
        hold: Math.max(0, timing?.hold ?? 6),
        easing: "minJerk",
        color: [120, 220, 255],
        effect: "solid",
        phase: defaultPhaseForNewClip(p.timeline),
      };
      return { ...p, timeline: insertClipBeforeLanding(p.timeline, clip) };
    });
    setSelectedClipId(id);
  }, []);


  const patchClip = useCallback((id: string, patch: Partial<TimelineClip>) => {
    setProject((p) => ({
      ...p,
      timeline: p.timeline.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  }, []);

  /** The canonical snapshot of everything a timeline command may change. */
  const currentSnapshot = useCallback(
    (): TimelineHistorySnapshot => ({
      project: projectRef.current,
      transitionOverrides: { ...transitionOverridesRef.current },
      transitionDesigns: { ...transitionDesignsRef.current },
      referenceLayer: referenceLayerRef.current,
    }),
    [],
  );

  /**
   * SINGLE HISTORY PRODUCER. Every timeline command (clip timing commit, clip
   * delete, marker/section and lighting edits) pushes through here, so an undo
   * entry always carries project + planning state together.
   */
  const pushSnapshot = useCallback((project: ShowProject) => {
    timelineHistory.current.past.push({
      project,
      transitionOverrides: { ...transitionOverridesRef.current },
      transitionDesigns: { ...transitionDesignsRef.current },
      // Ownership of imported intervals is canonical state of the SAME action:
      // an undone lighting edit must give the imported RGB back, so the layer
      // travels with the snapshot instead of staying promoted forever.
      referenceLayer: referenceLayerRef.current,
    });
    // BOUNDED HISTORY: a long authoring session must not accumulate snapshots
    // without limit (same bound as the dynamic-formation history).
    boundHistory(timelineHistory.current.past);
    timelineHistory.current.future = [];
    setTimelineHistoryDepth({ past: timelineHistory.current.past.length, future: 0 });
  }, []);


  /**
   * GESTURE COMMIT (Sprint 7.2, ripple since Sprint 8D).
   *
   * pointermove may draft freely in the component; exactly one call here lands
   * the canonical mutation — including the ENTIRE ripple cascade — pushes one
   * undo entry, marks the project dirty and lets the existing revision engine
   * prune exactly the transition overrides whose planning basis changed.
   * No transient overlapping canonical state is ever written.
   */
  const commitClipTiming = useCallback(
    (id: string, patch: Partial<TimelineClip>, mode: RippleMode = "RIPPLE") => {
      setProject((p) => {
        const clip = p.timeline.find((c) => c.id === id);
        if (!clip) return p;
        const timingOnly = {
          ...(patch.start === undefined ? {} : { start: patch.start }),
          ...(patch.transition === undefined ? {} : { transition: patch.transition }),
          ...(patch.hold === undefined ? {} : { hold: patch.hold }),
        };
        const nonTiming = Object.keys(patch).filter(
          (k) => k !== "start" && k !== "transition" && k !== "hold",
        );
        const result = rippleClipTiming(p.timeline, id, timingOnly, mode);
        if (result.changedClipIds.length === 0 && nonTiming.length === 0) return p;
        pushSnapshot(p);
        const timeline = result.timeline.map((c) =>
          c.id === id && nonTiming.length > 0
            ? { ...c, ...Object.fromEntries(nonTiming.map((k) => [k, (patch as Record<string, unknown>)[k]])) }
            : c,
        );
        return { ...p, timeline };
      });
    },
    [pushSnapshot],
  );

  /** Snapshot helper for annotation edits — same one-entry-per-action rule. */
  const pushTimelineHistory = useCallback(() => {
    setProject((p) => {
      pushSnapshot(p);
      return p;
    });
  }, [pushSnapshot]);

  /** Undo/redo restore project + planning state atomically. */
  const restoreSnapshot = useCallback((snapshot: TimelineHistorySnapshot) => {
    const overrides = { ...snapshot.transitionOverrides };
    // Re-seed the basis from the restored project so the invalidation guard
    // does not treat a faithfully restored override as stale.
    overrideBasisRef.current = computeOverrideBasis(snapshot.project, overrides);
    setTransitionOverrides(overrides);
    setTransitionDesigns({ ...(snapshot.transitionDesigns ?? {}) });
    // Restore ownership BEFORE the project so the promotion guard reconciles the
    // restored project against the restored signatures (no phantom promotion).
    // EXACT restore: ownership travels with the snapshot, so null -> non-null,
    // non-null -> null and non-null -> other non-null must all round-trip. It
    // must never be gated on the CURRENT layer value.
    if (snapshot.referenceLayer !== undefined) {
      referenceLayerRef.current = snapshot.referenceLayer;
      setReferenceLayer(snapshot.referenceLayer);
    }
    projectRef.current = snapshot.project;
    setProject(snapshot.project);
    // Every derived analysis was computed for the REPLACED geometry.
    invalidateDerivedAnalysis(derivedAnalysisSetters);
    const previous = selectedClipIdRef.current;
    const restoredClip =
      previous && snapshot.project.timeline.some((c) => c.id === previous)
        ? previous
        : (snapshot.project.timeline[0]?.id ?? null);
    setSelectedClipId(restoredClip);
    // Undo/redo restores project content only: transient drafts are dropped and
    // every clip-scoped selection is reconciled against the restored project.
    reconcileSelectionRef.current(snapshot.project, restoredClip, previous);
  }, [derivedAnalysisSetters]);

  const undoTimeline = useCallback(() => {
    const previous = timelineHistory.current.past.pop();
    if (!previous) return;
    timelineHistory.current.future.push(currentSnapshot());
    boundHistory(timelineHistory.current.future);
    setTimelineHistoryDepth({
      past: timelineHistory.current.past.length,
      future: timelineHistory.current.future.length,
    });
    restoreSnapshot(previous);
  }, [currentSnapshot, restoreSnapshot]);

  const redoTimeline = useCallback(() => {
    const next = timelineHistory.current.future.pop();
    if (!next) return;
    timelineHistory.current.past.push(currentSnapshot());
    boundHistory(timelineHistory.current.past);

    setTimelineHistoryDepth({
      past: timelineHistory.current.past.length,
      future: timelineHistory.current.future.length,
    });
    restoreSnapshot(next);
  }, [currentSnapshot, restoreSnapshot]);

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

  /** Latest selected scene, so selection callbacks stay dependency-free. */
  const sceneRef = useRef<FormationScene | null>(null);
  sceneRef.current = selectedScene;

  /**
   * DERIVED SELECTION SAFETY: the exposed selection is always reconciled against
   * the currently selected scene, so a clip change or an object deletion can
   * never leak stale ids, and the primary always belongs to the selection.
   */
  const sceneSelection = useMemo<SceneSelection>(
    () =>
      normalizeSceneSelection(selectedScene, sceneSelectionState.ids, sceneSelectionState.primaryId),
    [selectedScene, sceneSelectionState],
  );
  const resolvedSceneObjectId = sceneSelection.primaryId;
  const selectedSceneObjectIds = useMemo(() => [...sceneSelection.ids], [sceneSelection]);

  const setSelectedSceneObjectIds = useCallback(
    (ids: readonly string[], primaryId: string | null = null) => {
      setSceneSelectionState({ ids: [...ids], primaryId });
    },
    [],
  );
  /** Compatibility helper for the single-object call sites. */
  const setSelectedSceneObjectId = useCallback((id: string | null) => {
    setSceneSelectionState(id ? { ids: [id], primaryId: id } : EMPTY_SCENE_SELECTION);
  }, []);
  const selectSceneObject = useCallback(
    (objectId: string | null, mode: SceneClickMode = "REPLACE") => {
      if (!objectId) {
        setSceneSelectionState(EMPTY_SCENE_SELECTION);
        return;
      }
      setSceneSelectionState((current) => applySceneClick(sceneRef.current, current, objectId, mode));
    },
    [],
  );
  const selectAllSceneObjectsInScene = useCallback(() => {
    setSceneSelectionState((current) => selectAllSceneObjects(sceneRef.current, current.primaryId));
  }, []);
  const sceneSelectionMixed = useMemo<MixedTransformFlags>(
    () =>
      selectedScene
        ? mixedTransformFlags(selectedScene, sceneSelection.ids)
        : { position: false, rotationDeg: false, scale: false, mirrorX: false },
    [selectedScene, sceneSelection],
  );


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
    (
      clipId: string,
      fn: (scene: FormationScene, p: ShowProject) => FormationScene,
      options: { readonly history?: boolean } = {},
    ) => {
      const history = options.history !== false;
      setProject((p) => {
        const clip = p.timeline.find((c) => c.id === clipId);
        if (!clip) return p;
        const next = upsertScene(p, fn(sceneForClip(p, clip), p));
        if (next === p) return p;
        // ATOMIC SCENE EDIT COMMAND: exactly one project mutation, so the
        // promotion guard, the planning invalidation and undo all see ONE step,
        // however many objects the gesture touched.
        if (history) pushSnapshot(p);
        return next;
      });
    },
    [pushSnapshot],
  );

  /** ONE canonical batch gesture on N selected objects. */
  const transformSceneObjects = useCallback(
    (clipId: string, objectIds: readonly string[], delta: SceneGroupDelta) => {
      if (objectIds.length === 0) return;
      editScene(clipId, (scene, p) => applySceneGroupDelta(p, scene, objectIds, delta));
    },
    [editScene],
  );

  const mirrorSceneObjectsBatch = useCallback(
    (clipId: string, objectIds: readonly string[]) => {
      if (objectIds.length === 0) return;
      editScene(clipId, (scene) => mirrorSceneObjects(scene, objectIds));
    },
    [editScene],
  );

  const duplicateSceneObjectsBatch = useCallback(
    (clipId: string, objectIds: readonly string[]) => {
      if (objectIds.length === 0) return;
      let created: readonly string[] = [];
      editScene(clipId, (scene) => {
        const result = duplicateSceneObjects(scene, objectIds);
        created = result.objectIds;
        return result.scene;
      });
      if (created.length > 0) setSelectedSceneObjectIds(created, created[created.length - 1] ?? null);
    },
    [editScene, setSelectedSceneObjectIds],
  );

  const removeSceneObjectsBatch = useCallback(
    (clipId: string, objectIds: readonly string[]) => {
      if (objectIds.length === 0) return;
      editScene(clipId, (scene) => removeSceneObjects(scene, objectIds));
      setSceneSelectionState(EMPTY_SCENE_SELECTION);
    },
    [editScene],
  );

  /* ------------------------------------------- fast design actions -------- */
  const applySceneDesign = useCallback(
    (
      clipId: string,
      objectIds: readonly string[],
      action: SceneDesignActionKind,
      options: { readonly altitudeStep?: number } = {},
    ) => {
      if (objectIds.length === 0) return;
      editScene(clipId, (scene, p) =>
        applySceneDesignAction(p, scene, objectIds, action, options),
      );
    },
    [editScene],
  );

  const alignSceneObjectsByMode = useCallback(
    (clipId: string, objectIds: readonly string[], mode: SceneAlignMode) => {
      if (objectIds.length < 2) return;
      editScene(clipId, (scene, p) => alignSceneObjectsBy(p, scene, objectIds, mode));
    },
    [editScene],
  );

  /* ------------------------------------------- clip design commands ------- */
  const canEditClipAsScene = useCallback(
    (clipId: string) => canConvertClipToScene(projectRef.current, clipId),
    [],
  );

  /**
   * THUMBNAILS: one decimated pass per project revision. Never per frame, never
   * exported — purely an identification aid on the timeline.
   */
  const clipThumbnails = useMemo(() => timelineThumbnails(project, 48), [project]);

  /** "Edit as Scene": materialises the clip's implicit scene, one undo entry. */
  const editClipAsScene = useCallback(
    (clipId: string) => {
      let created: readonly string[] = [];
      setProject((p) => {
        const result = convertClipToScene(p, clipId);
        if (!result) return p;
        created = result.sceneObjectIds;
        pushSnapshot(p);
        return result.project;
      });
      if (created.length > 0) {
        setSelectedSceneObjectIds(created.slice(0, 1), created[0] ?? null);
      }
      return created.length > 0;
    },
    [pushSnapshot, setSelectedSceneObjectIds],
  );



  /* ------------------------------------------- viewport transform gizmo ---- */
  const [gizmoMode, setGizmoMode] = useState<SceneGizmoMode>("MOVE");
  const [gizmoTranslateSnap, setGizmoTranslateSnap] = useState(0);
  const [gizmoRotateSnap, setGizmoRotateSnap] = useState(0);
  const [sceneGizmoDraft, setSceneGizmoDraft] = useState<SceneGroupDelta | null>(null);
  /** Ids captured at pointer-down, so a mid-gesture selection change is inert. */
  const gizmoIdsRef = useRef<readonly string[]>([]);

  const sceneGizmoPivot = useMemo<Vector3Tuple | null>(() => {
    if (!selectedScene || sceneSelection.ids.length === 0) return null;
    try {
      return sceneGroupPivot(project, selectedScene, sceneSelection.ids);
    } catch {
      return null;
    }
  }, [project, selectedScene, sceneSelection]);

  /** DRAFT PREVIEW: pure scene resolution, never a plan and never persisted. */
  const sceneGizmoPreviewPoints = useMemo<Vector3Tuple[]>(() => {
    if (!sceneGizmoDraft || !selectedScene || gizmoIdsRef.current.length === 0) return [];
    try {
      const drafted = applySceneGroupDelta(
        project,
        selectedScene,
        gizmoIdsRef.current,
        sceneGizmoDraft,
      );
      const resolved = resolveSceneAt(project, drafted, 0);
      const wanted = new Set(gizmoIdsRef.current);
      const points: Vector3Tuple[] = [];
      for (const group of resolved.groups) {
        if (!wanted.has(group.instanceId)) continue;
        for (let i = 0; i < group.pointCount; i++) {
          const p = resolved.points[group.offset + i];
          if (p) points.push(p);
        }
      }
      return points;
    } catch {
      return [];
    }
  }, [project, selectedScene, sceneGizmoDraft]);

  const beginSceneGizmo = useCallback(() => {
    gizmoIdsRef.current = sceneSelection.ids;
    setSceneGizmoDraft({});
  }, [sceneSelection]);

  const updateSceneGizmo = useCallback((delta: SceneGroupDelta) => {
    if (gizmoIdsRef.current.length === 0) return;
    setSceneGizmoDraft(delta);
  }, []);

  const commitSceneGizmo = useCallback(() => {
    const ids = gizmoIdsRef.current;
    const delta = sceneGizmoDraft;
    gizmoIdsRef.current = [];
    setSceneGizmoDraft(null);
    if (!delta || ids.length === 0 || !selectedClipId) return;
    const moved =
      (delta.position && (delta.position[0] || delta.position[1] || delta.position[2])) ||
      (delta.rotationDeg &&
        (delta.rotationDeg[0] || delta.rotationDeg[1] || delta.rotationDeg[2])) ||
      (delta.scaleFactor !== undefined && delta.scaleFactor !== 1);
    if (!moved) return;
    transformSceneObjects(selectedClipId, ids, delta);
  }, [sceneGizmoDraft, selectedClipId, transformSceneObjects]);

  /** Escape: the draft is discarded, so the scene is byte-identical again. */
  const cancelSceneGizmo = useCallback(() => {
    gizmoIdsRef.current = [];
    setSceneGizmoDraft(null);
  }, []);

  /**
   * VIEWPORT PICKING: drone index -> scene object. The drone flies the target
   * point its ASSIGNMENT maps to, and `ResolvedSceneGroup` owns which object a
   * combined point index belongs to. No new identity mapping is invented, and
   * padded (non-participating) drones resolve to null.
   */
  const sceneObjectIdByDrone = useMemo<(string | null)[]>(() => {
    if (!selectedScene || !selectedClipId) return [];
    let resolved;
    try {
      resolved = resolveSceneAt(project, selectedScene, 0);
    } catch {
      return [];
    }
    const clipAssignment = plan.assignments.find((a) => a.clipId === selectedClipId);
    return Array.from({ length: project.droneCount }, (_, i) => {
      const target = clipAssignment?.assignments[i]?.targetPointIndex ?? i;
      const group = resolved.groups.find(
        (g) => target >= g.offset && target < g.offset + g.pointCount,
      );
      return group?.instanceId ?? null;
    });
  }, [plan, project, selectedClipId, selectedScene]);

  const sceneObjectIdForDrone = useCallback(
    (droneIndex: number) => sceneObjectIdByDrone[droneIndex] ?? null,
    [sceneObjectIdByDrone],
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
      setSceneSelectionState((current) =>
        current.ids.includes(objectId)
          ? {
              ids: current.ids.filter((id) => id !== objectId),
              primaryId: current.primaryId === objectId ? null : current.primaryId,
            }
          : current,
      );
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

  /* ---------------- reference-assisted scene editing (design only) --------- */
  /**
   * The comparison surface is PURELY a design aid: it reads the imported
   * reference show and the resolved editable scene, and never influences
   * ownership, promotion, planning or export.
   */
  const selectedClipBinding = useMemo<ReferenceClipBinding | null>(
    () =>
      selectedClipId
        ? (referenceLayer?.bindings.find((b) => b.clipId === selectedClipId) ?? null)
        : null,
    [referenceLayer, selectedClipId],
  );

  const sceneGhostFrame = useMemo<ReferenceGhostFrame | null>(() => {
    if (!sceneReferenceGhost) return null;
    if (!referenceLayerShow || !selectedClip || !selectedScene || !selectedClipBinding) return null;
    return referenceGhostFrame({
      show: referenceLayerShow,
      project,
      scene: selectedScene,
      clip: selectedClip,
      binding: selectedClipBinding,
      frame: sceneComparisonFrame,
      currentTime: clock.time,
    });
  }, [
    sceneReferenceGhost,
    sceneComparisonFrame,
    referenceLayerShow,
    project,
    selectedScene,
    selectedClip,
    selectedClipBinding,
    clock.time,
  ]);

  const sceneDeviation = useMemo<SceneDeviationReport | null>(() => {
    if (!referenceLayerShow || !selectedClip || !selectedScene || !selectedClipBinding) return null;
    return sceneDeviationReport({
      show: referenceLayerShow,
      project,
      scene: selectedScene,
      clip: selectedClip,
      binding: selectedClipBinding,
      frame: sceneComparisonFrame,
      currentTime: clock.time,
    });
  }, [
    sceneComparisonFrame,
    referenceLayerShow,
    project,
    selectedScene,
    selectedClip,
    selectedClipBinding,
    clock.time,
  ]);

  const sceneCorrespondence = useMemo<CorrespondenceLine[]>(() => {
    if (!sceneReferenceGhost || !resolvedSceneObjectId) return [];
    if (!referenceLayerShow || !selectedClip || !selectedScene || !selectedClipBinding) return [];
    return correspondenceLines({
      show: referenceLayerShow,
      project,
      scene: selectedScene,
      clip: selectedClip,
      binding: selectedClipBinding,
      frame: sceneComparisonFrame,
      currentTime: clock.time,
      objectId: resolvedSceneObjectId,
    });
  }, [
    sceneReferenceGhost,
    sceneComparisonFrame,
    resolvedSceneObjectId,
    referenceLayerShow,
    project,
    selectedScene,
    selectedClip,
    selectedClipBinding,
    clock.time,
  ]);

  const canResetSelectedSceneObject = useMemo(
    () =>
      !!selectedClipId &&
      !!resolvedSceneObjectId &&
      canResetSceneObject(referenceLayer, selectedClipId, resolvedSceneObjectId),
    [referenceLayer, selectedClipId, resolvedSceneObjectId],
  );

  /** ONE undo entry; restores geometry + transform of a single object. */
  const resetSceneObject = useCallback(
    (clipId: string, objectId: string) => {
      const layer = referenceLayerRef.current;
      const next = resetSceneObjectToExtracted(projectRef.current, layer, clipId, objectId);
      if (!next) return;
      pushTimelineHistory();
      setProject(next);
    },
    [pushTimelineHistory],
  );

  /** Planner-owned experiment copy; the reference-owned clip is untouched. */
  const duplicateSceneAsEditable = useCallback(
    (clipId: string) => {
      const newClipId = nextId("clip");
      const result = duplicateSceneAsEditableCopy(projectRef.current, clipId, {
        clipId: newClipId,
        formationId: () => nextId("f"),
        dynamicFormationId: () => nextId("dyn"),
      });
      if (!result) return null;
      pushTimelineHistory();
      setProject(result.project);
      setSelectedClipId(result.clipId);
      setSelectedSceneObjectId(null);
      return result.clipId;
    },
    [pushTimelineHistory],
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

  /**
   * REUSE A WHOLE COMPOSITION (scene asset).
   *
   * The library asset is an immutable snapshot, so insertion COPIES everything
   * it needs into the project under fresh ids: the formation dependencies, the
   * dynamic formation dependencies and the scene itself. The scene is bound to a
   * brand new timeline clip (`scene.id === clip.id`) inserted with the ordinary
   * timeline semantics, LANDING-last included. There is no ESSP-only path: an
   * imported scene is reused exactly like an authored one, as planner-owned
   * project content.
   */
  const addSceneAssetToShow = useCallback(
    (asset: FormationAsset, timing?: AssetInsertionTiming) => {
      if (asset.formationData.kind !== "SCENE") return null;
      return insertLibraryAssetIntoShowRef.current(asset, timing);
    },
    [],
  );

  /** Assigned below, once the selection reconciliation authority exists. */
  const insertLibraryAssetIntoShowRef = useRef<
    (asset: FormationAsset, timing?: AssetInsertionTiming) => string | null
  >(() => null);

  /**
   * SAVE THE CURRENT SCENE AS A LIBRARY ASSET (payload only — the library owns
   * persistence). Only a clip with an EXPLICIT authored scene qualifies; the
   * bundle carries exactly the dependencies that scene references.
   *
   * Provenance is inherited, never overwritten: a clip extracted from an
   * imported ESSP show stays ESSP_DERIVED even when the user saves it manually.
   * Saving is metadata only, so it never promotes the source clip.
   */
  const sceneAssetPayloadForClip = useCallback(
    (
      clipId: string,
    ): {
      readonly scene: FormationScene;
      readonly dependencies: SceneAssetDependencies;
      readonly source: FormationAsset["source"];
      readonly sourceRef: FormationAsset["sourceRef"];
    } | null => {
      const p = projectRef.current;
      const scene = projectScene(p, clipId);
      if (!scene || scene.objects.length === 0) return null;
      const dependencies = collectSceneDependencies(scene, p);
      const binding = referenceLayerRef.current?.bindings.find((b) => b.clipId === clipId) ?? null;
      if (!binding) return { scene, dependencies, source: "USER", sourceRef: undefined };
      return {
        scene,
        dependencies,
        source: "ESSP_DERIVED",
        sourceRef: {
          kind: "FILE",
          name: "imported ESSP show",
          fingerprint: referenceLayerRef.current?.showHash,
          params: {
            clipId,
            segmentId: binding.sourceSegmentId ?? "",
            classification: binding.sourceClassification ?? "",
            startTime: binding.referenceStart,
            endTime: binding.referenceEnd,
          },
        },
      };
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
    (dynamicFormationId: string, timing?: { transition?: number; hold?: number }) => {
      const id = nextId("c");
      // Resolve the dynamic formation INSIDE the updater: a library insert adds
      // the formation and the clip in the same tick, so the closure snapshot of
      // project.dynamicFormations would still be empty here.
      setProject((p) => {
        const dynamic = (p.dynamicFormations ?? []).find((d) => d.id === dynamicFormationId);
        if (!dynamic) return p;
        const sourceId =
          dynamic.sourceFormationId && p.formations.some((f) => f.id === dynamic.sourceFormationId)
            ? dynamic.sourceFormationId
            : (p.formations[0]?.id ?? "");
        const clip: TimelineClip = {
          id,
          formationId: sourceId,
          start: 0,
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
        return { ...p, timeline: insertClipBeforeLanding(p.timeline, clip) };
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
  const canAnalyzeSelectedClip =
    !!selectedClipId && isOptimizableClip(project, selectedClipId, plan);

  /**
   * Converts an analysis into a plan override the full-show planner can apply.
   * `targetPointIndex` indexes the CANONICAL fleet-indexed target list the
   * analysis was run against (see trajectory/target.ts), so no re-mapping
   * against base formation points happens here.
   */
  const overrideFromAnalysis = useCallback(
    (clipId: string, analysis: TransitionAnalysis): ClipTransitionOverride | null => {
      if (!isOptimizableClip(project, clipId, plan)) return null;
      if (analysis.dronePlans.length === 0) return null;
      return {
        targetPointIndex: analysis.dronePlans.map((p) => p.targetPointIndex),
        startOffsets: analysis.dronePlans.map((p) => p.startOffset),
        laneOffsets: analysis.dronePlans.map((p) => p.lane.offsetMetres),
        lateralOffsets: analysis.dronePlans.map((p) => p.lateralOffsetMetres ?? 0),
        strategy: `${analysis.metrics.assignmentStrategy}+optimized`,
      };
    },
    [project, plan],
  );


  const analyzeSelectedTransition = useCallback(() => {
    const clipId = selectedClipId;
    if (!clipId || !isOptimizableClip(project, clipId, plan)) return;
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
    if (!clipId || !isOptimizableClip(project, clipId, plan)) return;
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
      if (override) {
        // Record the planning basis this override was computed for, so a later
        // timing/geometry edit invalidates exactly this clip.
        overrideBasisRef.current = {
          ...overrideBasisRef.current,
          ...computeOverrideBasis(project, { [clipId]: override }),
        };
        setTransitionOverrides((prev) => ({ ...prev, [clipId]: override }));
      }
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
    overrideBasisRef.current = {};
    setTransitionOverrides({});
    setTransitionDesigns({});
  }, []);

  // ---- Transition design (designer-facing mode over the SAME override) ----
  //
  // No second scheduler and no parallel offset storage: a design is translated
  // by `buildDesignOverride` into the existing `ClipTransitionOverride`, using
  // the canonical assignment of the existing analyzer. The 3D preview, the
  // full-show analysis and the export therefore all read one authority.

  /** Design of a clip: authored, else derived from its override data. */
  const transitionDesignFor = useCallback(
    (clipId: string): TransitionDesignState =>
      transitionDesigns[clipId] ??
      normalizeTransitionDesign({
        ...DEFAULT_TRANSITION_DESIGN,
        mode: deriveTransitionMode(transitionOverrides[clipId]),
      }),
    [transitionDesigns, transitionOverrides],
  );

  /**
   * True when an authored design no longer has the override it produced —
   * exactly the semantic invalidation of `pruneTransitionOverrides` (geometry,
   * timing, fleet or limits moved). Hold-only edits keep the override, so they
   * never raise this flag.
   */
  const transitionDesignNeedsRecalculation = useCallback(
    (clipId: string): boolean => {
      const design = transitionDesigns[clipId];
      if (!design || design.mode === "AUTO") return false;
      return !transitionOverrides[clipId];
    },
    [transitionDesigns, transitionOverrides],
  );

  /** ONE designer change = ONE undo entry (project + overrides + designs). */
  const setTransitionDesign = useCallback(
    (clipId: string, patch: Partial<TransitionDesignState>) => {
      if (!isOptimizableClip(project, clipId, plan)) return;
      const current =
        transitionDesignsRef.current[clipId] ??
        normalizeTransitionDesign({
          ...DEFAULT_TRANSITION_DESIGN,
          mode: deriveTransitionMode(transitionOverridesRef.current[clipId]),
        });
      const design = normalizeTransitionDesign({ ...current, ...patch });
      setTransitionError(null);
      try {
        let nextOverride: ClipTransitionOverride | null = null;
        if (design.mode !== "AUTO") {
          const input = transitionInputForClip(project, plan, clipId, {
            strategy: assignmentStrategy,
            sampleRate,
          });
          if (design.mode === "MANUAL") {
            // MANUAL edits the CURRENT offset data; seed it from the canonical
            // analysis when the clip has no override yet.
            nextOverride =
              transitionOverridesRef.current[clipId] ??
              overrideFromAnalysis(
                clipId,
                analyzeTransitionCore(input, DEFAULT_OPTIMIZATION_SETTINGS),
              );
          } else {
            nextOverride = buildDesignOverride(
              analyzeTransitionCore(input, DEFAULT_OPTIMIZATION_SETTINGS),
              design,
              input.duration,
            );
          }
        }
        pushSnapshot(projectRef.current);
        setTransitionOverrides((prev) => {
          const next = { ...prev };
          const basis = { ...overrideBasisRef.current };
          if (nextOverride) {
            next[clipId] = nextOverride;
            Object.assign(basis, computeOverrideBasis(project, { [clipId]: nextOverride }));
          } else {
            delete next[clipId];
            delete basis[clipId];
          }
          overrideBasisRef.current = basis;
          return next;
        });
        setTransitionDesigns((prev) => ({ ...prev, [clipId]: design }));
      } catch (err) {
        setTransitionError(describeTransitionError(err));
      }
    },
    [project, plan, assignmentStrategy, sampleRate, overrideFromAnalysis, pushSnapshot],
  );

  /**
   * MANUAL per-drone editing of the EXISTING override arrays. Bounds follow the
   * scheduler contract (start offset <= transition * 0.5) and the optimiser's
   * vertical lane bound.
   */
  const patchTransitionDroneOffset = useCallback(
    (
      clipId: string,
      index: number,
      patch: { startOffset?: number; laneOffset?: number },
    ) => {
      const override = transitionOverridesRef.current[clipId];
      const clip = projectRef.current.timeline.find((c) => c.id === clipId);
      if (!override || !clip) return;
      if (index < 0 || index >= override.startOffsets.length) return;
      const startCap = Math.max(0, clip.transition * 0.5);
      const laneCap = DEFAULT_OPTIMIZATION_SETTINGS.maxVerticalOffset;
      const startOffsets = [...override.startOffsets];
      const laneOffsets = [...override.laneOffsets];
      if (patch.startOffset !== undefined && Number.isFinite(patch.startOffset)) {
        startOffsets[index] = Number(
          Math.max(0, Math.min(startCap, patch.startOffset)).toFixed(4),
        );
      }
      if (patch.laneOffset !== undefined && Number.isFinite(patch.laneOffset)) {
        laneOffsets[index] = Number(
          Math.max(-laneCap, Math.min(laneCap, patch.laneOffset)).toFixed(4),
        );
      }
      const next: ClipTransitionOverride = {
        ...override,
        targetPointIndex: [...override.targetPointIndex],
        startOffsets,
        laneOffsets,
        strategy: override.strategy.includes("+manual")
          ? override.strategy
          : `${override.strategy}+manual`,
      };
      pushSnapshot(projectRef.current);
      setTransitionOverrides((prev) => ({ ...prev, [clipId]: next }));
      setTransitionDesigns((prev) => ({
        ...prev,
        [clipId]: normalizeTransitionDesign({
          ...(prev[clipId] ?? DEFAULT_TRANSITION_DESIGN),
          mode: "MANUAL",
        }),
      }));
    },
    [pushSnapshot],
  );

  const applySuggestedDuration = useCallback(() => {
    if (!transitionAnalysis) return;
    const { clipId, analysis } = transitionAnalysis;
    const next = Math.ceil(analysis.feasibility.minimumEstimatedDuration * 10) / 10;
    if (!Number.isFinite(next) || next <= 0) return;
    patchClip(clipId, { transition: Math.max(0.5, next) });
  }, [transitionAnalysis, patchClip]);

  /**
   * CANONICAL FULL-SHOW OPTIONS (single source).
   *
   * Read-only consumers (diagnostics, consequence previews) must analyse with
   * EXACTLY these settings so they can never build a second planner path.
   */
  const fullShowAnalysisOptions = useMemo<AnalyzeFullShowOptions>(
    () => ({
      sampleRate,
      assignmentStrategy,
      transitionOverrides,
      reference:
        referenceLayer && referenceLayerShow ? { layer: referenceLayer, show: referenceLayerShow } : null,
    }),
    [sampleRate, assignmentStrategy, transitionOverrides, referenceLayer, referenceLayerShow],
  );

  // ---- Full show simulation & validation ---------------------------------
  //
  // The analysis composes the show with EXACTLY the settings the viewport plays
  // (same project, strategy, overrides and sample rate), so a report can never
  // describe a different show than the one on screen.
  const analyzeFullShow = useCallback(() => {
    if (fullShowBusy) return;
    // One run token per invocation: any later invalidation (apply, undo/redo,
    // project load, manual cancel) advances the generation and this run's
    // result — success OR error — is dropped instead of installed.
    const token = fullShowRunRef.current.begin(analysisRevisionRef.current);
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
          onProgress: (progress) => {
            if (fullShowRunRef.current.isCancelled(token)) return;
            setFullShowProgress(progress);
          },
          isCancelled: () => fullShowRunRef.current.isCancelled(token),
          reference:
            referenceLayerRef.current && referenceLayerShow
              ? { layer: referenceLayerRef.current, show: referenceLayerShow }
              : null,
        });
        // Install ONLY when this is still the newest run AND the revision it was
        // computed for is still the current one.
        if (!fullShowRunRef.current.accepts(token, analysisRevisionRef.current)) return;
        setFullShow(result);
      } catch (err) {
        // A failure that belongs to a superseded revision must not surface.
        if (!fullShowRunRef.current.accepts(token, analysisRevisionRef.current)) return;
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
    referenceLayerShow,
  ]);

  const cancelFullShowAnalysis = useCallback(() => {
    // Advancing the generation both stops the engine and rejects its result.
    fullShowRunRef.current.invalidate();
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
  /**
   * SESSION-SCOPED ESSP IMPORT. Reading bytes, unzipping and building the
   * reference show are all async, so nothing this run produces — show, playback
   * authority, forensics reset, diagnostics or the failure — may be installed
   * once another document has been adopted. The import never adopts a project
   * itself: extraction into the timeline is a separate, synchronous authored
   * action performed afterwards, so the token can never cancel valid work.
   */
  const importEsspFiles = useCallback(async (files: File[]) => {
    const token = esspJobs.current.begin(sessionScope());
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
      if (!esspJobs.current.accepts(token, sessionScope())) return;
      forensicsJobs.current.invalidate();
      setForensicsReport(null);
      setForensicsError(null);
      setSelectedForensicSegmentId(null);
      setReferenceShow(show);
      setReferencePlayback(true);
      setSelectedReferenceDroneId(show.drones[0]?.sourceId ?? null);
      // An import from the NO SHOW OPEN state IS opening a document.
      setDocumentOpen(true);

    } catch (err) {
      if (!esspJobs.current.accepts(token, sessionScope())) return;
      setReferenceShow(null);
      setReferencePlayback(false);
      setReferenceError({
        code: "ESSP_IMPORT_FAILED",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (esspJobs.current.isCurrent(token)) setReferenceBusy(false);
    }
  }, [sessionScope]);

  const clearReferenceShow = useCallback(() => {
    esspJobs.current.invalidate();
    setReferenceShow(null);
    setReferencePlayback(false);
    setReferenceError(null);
    setSelectedReferenceDroneId(null);
    forensicsJobs.current.invalidate();
    setForensicsReport(null);
    setForensicsError(null);
    setSelectedForensicSegmentId(null);
  }, []);

  // ---- Reference forensics (derived, read-only) --------------------------
  const clearForensics = useCallback(() => {
    forensicsJobs.current.invalidate();
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
    forensicsJobs.current.invalidate();
    setForensicsBusy(false);
  }, []);

  const analyzeReferenceMotion = useCallback(() => {
    const show = referenceShow;
    if (!show) return;
    const token = forensicsJobs.current.begin(sessionScope());
    setForensicsBusy(true);
    setForensicsError(null);
    // Deferred so the busy state paints before the (pure, synchronous) analysis.
    setTimeout(() => {
      try {
        const report = analyzeReferenceShow(show, {
          preset: forensicsPreset,
          thresholds: forensicsThresholds,
          shouldCancel: () => !forensicsJobs.current.isCurrent(token),
        });
        if (!forensicsJobs.current.accepts(token, sessionScope())) return;
        setForensicsReport(report);
        setSelectedForensicSegmentId(report.segments[0]?.id ?? null);
      } catch (err) {
        if (!forensicsJobs.current.accepts(token, sessionScope())) return;
        setForensicsError(err instanceof Error ? err.message : String(err));
      } finally {
        if (forensicsJobs.current.isCurrent(token)) setForensicsBusy(false);
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

  // ---- Imported trajectory layer + editable extraction (A + B) ------------
  // The layer is the PLAYBACK AUTHORITY for reference-owned intervals; the
  // extracted clips are ordinary project content. Promotion is decided by the
  // flight-output signature, never by editor activity.
  const referenceLayerRef = useRef<ReferenceTrajectoryLayer | null>(null);
  referenceLayerRef.current = referenceLayer;

  const signatureContext = useMemo(
    () => ({ assignmentStrategy, transitionOverrides }),
    [assignmentStrategy, transitionOverrides],
  );

  /** Extraction proper: needs a segmentation report for the same show. */
  const applyReferenceExtraction = useCallback(
    (show: ReferenceShow, report: ReferenceForensicsReport) => {
      try {
        const result = extractReferenceTimeline(show, report);
        const previous = projectRef.current;
        const next: ShowProject = {
          ...previous,
          droneCount: result.droneCount,
          formations: [...result.formations],
          timeline: [...result.timeline],
          dynamicFormations: [...result.dynamicFormations],
          // Multi-object compositions inferred from the imported show (one per
          // decomposed scene clip); one-object scenes stay plain clips.
          scenes: [...result.scenes],
          lighting: result.lighting,
          // The imported takeoff is authored as a clip, so the native pre-show
          // staging must not also claim the time before show zero.
          ...(previous.preShow ? { preShow: { ...previous.preShow, enabled: false } } : {}),
        };
        // Signatures are seeded against the REAL project (limits, participation,
        // strategy included), so nothing is promoted by the extraction itself.
        const layer = reseedReferenceSignatures(next, result.layer, {
          assignmentStrategy,
          transitionOverrides: {},
        });
        pushSnapshot(previous);
        overrideBasisRef.current = computeOverrideBasis(next, {});
        setTransitionOverrides({});
        setTransitionDesigns({});
        setProject(next);
        setReferenceLayer(layer);
        setReferenceLayerShow(show);
        setReferenceExtraction(result.diagnostics);
        setReferenceAssetDrafts(result.assets);
        setReferenceExtractionWarnings(result.warnings);
        setReferenceExtractionError(null);
        setSelectedClipId(result.timeline[0]?.id ?? null);
        setReferencePlayback(false);
      } catch (err) {
        setReferenceExtractionError({
          code: err instanceof ReferenceLayerError ? err.code : "EXTRACTION_FAILED",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [assignmentStrategy, pushSnapshot],
  );

  /**
   * GEOMETRY APPLY — ONE ATOMIC UNDOABLE AUTHORING REVISION.
   *
   * All policy lives in the canonical pure modules: `prepareGeometryApplyCommand`
   * decides/derives the before+after snapshots (override pruning + imported
   * ownership reconciliation) and `installPreparedGeometryApply` produces the
   * exact next store state and history stack. This function only installs those
   * values TOGETHER and invalidates derived analysis computed for the old
   * geometry. It never re-implements readiness, pruning or promotion.
   */
  /**
   * ONE atomic install path for every prepared geometry revision (proposal apply
   * and deterministic text apply). Extracted so a second authoring command can
   * never grow a second history/ownership/derived-analysis install.
   */
  const installGeometryApplyRevision = useCallback(
    (prepared: GeometryApplyPreparationSuccess) => {
      const installed = installPreparedGeometryApply(prepared, {
        past: timelineHistory.current.past,
        future: timelineHistory.current.future,
      });

      // ---- ATOMIC INSTALL (one React command boundary) --------------------
      timelineHistory.current = {
        past: [...installed.history.past],
        future: [...installed.history.future],
      };
      setTimelineHistoryDepth({
        past: installed.history.past.length,
        future: installed.history.future.length,
      });
      // Re-seed the basis from the APPLIED project so the invalidation guard
      // cannot prune the overrides the canonical preparation kept.
      overrideBasisRef.current = computeOverrideBasis(
        installed.project,
        installed.transitionOverrides,
      );
      transitionOverridesRef.current = installed.transitionOverrides;
      transitionDesignsRef.current = installed.transitionDesigns;
      setTransitionOverrides({ ...installed.transitionOverrides });
      setTransitionDesigns({ ...installed.transitionDesigns });
      if (referenceLayerRef.current) {
        referenceLayerRef.current = installed.referenceLayer;
        setReferenceLayer(installed.referenceLayer);
      }
      projectRef.current = installed.project;
      setProject(installed.project);

      // ---- DERIVED ANALYSIS INVALIDATION (authored settings untouched) ----
      invalidateDerivedAnalysis(derivedAnalysisSetters);

      // ---- SELECTION (existing authority; keep a still-valid selection) ---
      const previousClipId = selectedClipIdRef.current;
      const nextClipId =
        previousClipId && installed.project.timeline.some((c) => c.id === previousClipId)
          ? previousClipId
          : (installed.project.timeline[0]?.id ?? null);
      if (nextClipId !== previousClipId) setSelectedClipId(nextClipId);
      reconcileSelectionRef.current(installed.project, nextClipId, nextClipId);

      return {
        invalidatedTransitionOverrideClipIds: installed.invalidatedTransitionOverrideClipIds,
        promotedReferenceClipIds: installed.promotedReferenceClipIds,
        note: prepared.note,
      };
    },
    [derivedAnalysisSetters],
  );

  const applyGeometryProposal = useCallback(
    (input: {
      afterProject: ShowProject;
      readiness: GeometryApplyReadinessReport;
      promotedAt: string;
    }): GeometryApplyCommitResult => {
      const prepared = prepareGeometryApplyCommand({
        beforeProject: projectRef.current,
        afterProject: input.afterProject,
        readiness: input.readiness,
        transitionOverrides: transitionOverridesRef.current,
        transitionDesigns: transitionDesignsRef.current,
        referenceLayer: referenceLayerRef.current,
        assignmentStrategy,
        promotedAt: input.promotedAt,
      });
      if (!prepared.ok) return prepared;
      return { ok: true, ...installGeometryApplyRevision(prepared) };
    },
    [assignmentStrategy, installGeometryApplyRevision],
  );

  /**
   * DETERMINISTIC TEXT APPLY. The canonical readiness report produced by the
   * review UI is passed through UNCHANGED; this store action never constructs,
   * patches or upgrades readiness, and a blocked/missing report is refused by
   * `prepareTextFormationApply` before anything is installed.
   */
  const applyTextFormation = useCallback(
    (input: {
      request: TextPreviewRequest;
      readiness: GeometryApplyReadinessReport | null;
      formationId: string;
      formationName?: string;
      candidateTransitionOverrides?: Readonly<Record<string, ClipTransitionOverride>>;
      promotedAt: string;
    }): TextApplyCommitResult => {
      const prepared = prepareTextFormationApply({
        project: projectRef.current,
        request: input.request,
        readiness: input.readiness,
        formationId: input.formationId,
        ...(input.formationName ? { formationName: input.formationName } : {}),
        transitionOverrides: transitionOverridesRef.current,
        ...(input.candidateTransitionOverrides
          ? { candidateTransitionOverrides: input.candidateTransitionOverrides }
          : {}),
        transitionDesigns: transitionDesignsRef.current,
        referenceLayer: referenceLayerRef.current,
        assignmentStrategy,
        promotedAt: input.promotedAt,
      });
      if (!prepared.ok) return { ok: false, blockers: prepared.blockers, note: prepared.note };
      const installed = installGeometryApplyRevision(prepared.prepared);
      return {
        ok: true,
        formationId: prepared.formation.id,
        newlyPlannedIntervals: prepared.newlyPlannedIntervals,
        invalidatedTransitionOverrideClipIds: installed.invalidatedTransitionOverrideClipIds,
        promotedReferenceClipIds: installed.promotedReferenceClipIds,
        note: prepared.note,
      };
    },
    [assignmentStrategy, installGeometryApplyRevision],
  );



  /**
   * One-click extraction. The segmentation report is a DERIVED input: when it is
   * missing or stale for the loaded show, the analysis is run here first instead
   * of forcing the operator to discover a second button.
   */
  const extractReferenceShowToProject = useCallback(() => {
    const show = referenceShow;
    if (!show) {
      setReferenceExtractionError({
        code: "NO_REFERENCE_SHOW",
        message: "Import an ESSP show before extracting it.",
      });
      return;
    }
    setReferenceExtractionError(null);
    if (forensicsReport && !forensicsStale) {
      applyReferenceExtraction(show, forensicsReport);
      return;
    }
    const token = forensicsJobs.current.begin(sessionScope());
    setForensicsBusy(true);
    setForensicsError(null);
    setTimeout(() => {
      try {
        const report = analyzeReferenceShow(show, {
          preset: forensicsPreset,
          thresholds: forensicsThresholds,
          shouldCancel: () => !forensicsJobs.current.isCurrent(token),
        });
        if (!forensicsJobs.current.accepts(token, sessionScope())) return;
        setForensicsReport(report);
        setSelectedForensicSegmentId(report.segments[0]?.id ?? null);
        applyReferenceExtraction(show, report);
      } catch (err) {
        if (!forensicsJobs.current.accepts(token, sessionScope())) return;
        const message = err instanceof Error ? err.message : String(err);
        setForensicsError(message);
        setReferenceExtractionError({ code: "ANALYSIS_FAILED", message });
      } finally {
        if (forensicsJobs.current.isCurrent(token)) setForensicsBusy(false);
      }
    }, 30);
  }, [
    referenceShow,
    forensicsReport,
    forensicsStale,
    forensicsPreset,
    forensicsThresholds,
    applyReferenceExtraction,
  ]);

  const promoteReferenceClip = useCallback(
    (clipId: string) => {
      const layer = referenceLayerRef.current;
      if (!layer) return;
      const signature = clipOutputSignature(projectRef.current, clipId, {
        assignmentStrategy,
        transitionOverrides: transitionOverridesRef.current,
      });
      const result = promoteReferenceClips(layer, [
        { clipId, reason: "MANUAL", ...(signature ? { signature } : {}) },
      ]);
      if (result.changed) setReferenceLayer(result.layer);
    },
    [assignmentStrategy],
  );

  const clearReferenceLayer = useCallback(() => {
    setReferenceLayer(null);
    setReferenceLayerShow(null);
    setReferenceExtraction([]);
    setReferenceAssetDrafts([]);
    setReferenceExtractionWarnings([]);
  }, []);

  const verifyReferenceSplices = useCallback((): SpliceVerificationReport | null => {
    const layer = referenceLayerRef.current;
    if (!layer || !referenceLayerShow) return null;
    return verifySpliceBoundaries(referenceLayerShow, layer, (t) =>
      samplesAt(plan, t).map((sample) => sample.position),
    );
  }, [plan, referenceLayerShow]);

  /**
   * PROMOTION GUARD. One pass per canonical change of the project or planning
   * state: only clips whose flight/LED output signature moved are promoted, so
   * one edited clip never regenerates the rest of the show.
   */
  useEffect(() => {
    const layer = referenceLayerRef.current;
    if (!layer) return;
    const result = reconcileReferenceLayer(project, layer, signatureContext);
    if (result.changed) setReferenceLayer(result.layer);
  }, [project, signatureContext]);

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
  // DOCUMENT LIFECYCLE. `documentOpen` is the single source of truth for the
  // NO SHOW OPEN state; every editing surface is gated on it.
  const [documentOpen, setDocumentOpen] = useState(true);
  const [documentAction, setDocumentAction] = useState<DocumentFeedback | null>(null);

  const savedSignature = useRef<string | null>(null);
  const autosaveStore = useRef<KeyValueStore | null>(null);
  const lastAutosaveAt = useRef(0);
  /**
   * AUTOSAVE GENERATION. Bumped by every explicit lifecycle action that makes a
   * pending/persisted snapshot obsolete, so a debounce timer scheduled before
   * the action can never write after it (Save race, Project A -> Open B race).
   */
  const autosaveGeneration = useRef(0);

  const getAutosaveStore = useCallback((): KeyValueStore | null => {
    if (typeof window === "undefined") return null;
    autosaveStore.current ??= createBrowserKeyValueStore();
    return autosaveStore.current;
  }, []);

  /**
   * CONSUME OBSOLETE RECOVERY. Invalidates in-flight autosave timers, clears the
   * persisted snapshot and drops the UI offer. Idempotent, and it never disables
   * future autosaves: the next project mutation reschedules with the new
   * generation.
   */
  const consumeAutosaveRecovery = useCallback(() => {
    autosaveGeneration.current += 1;
    setAutosaveRecovery(null);
    setProjectAutosavedAt(null);
    const store = getAutosaveStore();
    if (store) void clearAutosave(store);
  }, [getAutosaveStore]);
  const consumeAutosaveRecoveryRef = useRef(consumeAutosaveRecovery);
  consumeAutosaveRecoveryRef.current = consumeAutosaveRecovery;

  const setProjectFileName = useCallback((name: string) => {
    setProjectFileNameState(ensureProjectExtension(name));
  }, []);

  const clearProjectFileError = useCallback(() => setProjectFileError(null), []);

  // Any project change marks the file dirty; the signature makes a save -> edit
  // -> undo cycle land back on "saved" instead of staying falsely dirty.
  // A null signature means "not anchored yet" (first mount): anchor the initial
  // document so edits to a never-saved show still count as unsaved work.
  useEffect(() => {
    const signature = JSON.stringify(project);
    if (savedSignature.current === null) {
      savedSignature.current = signature;
      setProjectDirty(false);
      return;
    }
    setProjectDirty(documentDirty(savedSignature.current, signature));
  }, [project]);


  const markSaved = useCallback((snapshotName?: string) => {
    savedSignature.current = JSON.stringify(project);
    setProjectDirty(false);
    setProjectSavedAt(new Date().toISOString());
    if (snapshotName) setProjectFileNameState(ensureProjectExtension(snapshotName));
  }, [project]);

  /**
   * CANONICAL PERSISTENCE OPTIONS. Manual save and autosave map the SAME
   * planning / reference / editor authority through `projectPersistenceOptions`,
   * so no writer can silently drop authoring intent (transition designs were
   * previously missing from autosave). The mapping lives in ONE place.
   */
  const persistenceOptions = useMemo(
    () =>
      projectPersistenceOptions({
        assignmentStrategy,
        transitionOverrides,
        transitionDesigns,
        // LOSSLESS: the imported payload is written verbatim, so reopening the
        // saved project reproduces the imported playback exactly.
        referenceLayer,
        selectedClipId,
        sampleRate,
      }),
    [
      assignmentStrategy,
      transitionOverrides,
      transitionDesigns,
      referenceLayer,
      selectedClipId,
      sampleRate,
    ],
  );

  // CANONICAL PROJECT ENVELOPE. Every writer (TopBar save, autosave, Inspector
  // "Studio project file") goes through this so they cannot drift apart.
  const buildProjectFile = useCallback(
    (): ProjectFile => serializeProject(project, persistenceOptions),
    [project, persistenceOptions],
  );

  /**
   * ONE DOCUMENT WRITER. Save and Save As differ ONLY in the document identity
   * they write under; serialization, dirty baseline, autosave consumption and
   * error handling are shared, so the two can never diverge.
   */
  const writeProjectDocument = useCallback(
    (name: string, kind: "SAVED" | "SAVED_AS"): boolean => {
      try {
        const file = buildProjectFile();
        const blob = new Blob([projectFileToJson(file)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = name;
        anchor.click();
        URL.revokeObjectURL(url);
        setProjectFileError(null);
        // The written identity becomes the ACTIVE document and the new baseline.
        markSaved(name);
        setDocumentAction(documentFeedback(kind, name));
        // SUCCESS BOUNDARY ONLY: the bytes reached the download, so any autosave
        // snapshot (and any pending debounce timer) is now obsolete work — for
        // Save As this also detaches the old identity's recovery snapshot.
        consumeAutosaveRecoveryRef.current();
        return true;
      } catch (err) {
        const error = toProjectFileError(err);
        setProjectFileError({ code: error.code, message: error.message });
        return false;
      }
    },
    [buildProjectFile, markSaved],
  );

  const saveProjectFile = useCallback(
    (): boolean =>
      writeProjectDocument(
        ensureProjectExtension(projectFileName || suggestedProjectFileName(project.name)),
        "SAVED",
      ),
    [writeProjectDocument, projectFileName, project.name],
  );

  /**
   * SAVE AS. Same canonical envelope and the same writer: nothing about the
   * project, planning, reference layer, source bytes or ownership is touched —
   * only the document identity the bytes are written under.
   */
  const saveProjectFileAs = useCallback(
    (name?: string): boolean =>
      writeProjectDocument(saveAsFileName(name ?? "", project.name), "SAVED_AS"),
    [writeProjectDocument, project.name],
  );


  /**
   * THE ONE PROJECT-CONTENT ADOPTION BOUNDARY (new, sample, open, recovery).
   * Session state of the replaced project is cleared through the canonical
   * session-reset authority and derived analysis through the derived-analysis
   * authority, so no caller keeps a partial reset list of its own.
   */
  const adoptProject = useCallback((
    next: ShowProject,
    fileName: string,
    restore?: AdoptProjectRestore,
  ): AdoptProjectOutcome => {
    // ATOMICITY: the imported layer is rehydrated BEFORE any state is touched.
    // A payload that cannot be rehydrated aborts the whole adoption, so the
    // currently open project (and its export/recovery authority) stays intact
    // instead of being half-replaced.
    const restoredLayer = restore?.referenceLayer ?? null;
    let restoredShow: ReturnType<typeof referenceShowFromLayer> | null = null;
    if (restoredLayer) {
      try {
        restoredShow = referenceShowFromLayer(restoredLayer);
      } catch (err) {
        return {
          ok: false,
          error: {
            code: err instanceof ReferenceLayerError ? err.code : "MALFORMED_LAYER",
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
    }
    // ONE PLACE: the successful adoption advances the project-session generation
    // and cancels every subsystem authority, so no in-flight audio decode, SVG
    // import, ESSP import, forensics run or AI request from the replaced
    // document can install state (or an error) into the new one.
    invalidateProjectSessionJobs(projectSession.current, [
      audioJobs.current,
      svgJobs.current,
      esspJobs.current,
      forensicsJobs.current,
      aiJobs.current,
    ]);
    setProject(next);
    sessionResetRef.current();
    // PRESENTATION SESSION: transport, timeline viewport and the ephemeral
    // geometry ghost belong to the replaced document (see ./editorSession).
    adoptedEditorSessionRef.current();

    setReferenceExtractionError(null);
    setReferenceExtraction([]);
    setReferenceAssetDrafts([]);
    setReferenceExtractionWarnings([]);
    // IMPORTED LAYER: always travels with the adopted project, including null,
    // so no source-recovery bytes of the replaced project can survive.
    setReferenceLayerShow(restoredShow);
    setReferenceLayer(restoredShow ? restoredLayer : null);
    // selectedClipId is only restored when that clip still exists; otherwise the
    // deterministic fallback is the first clip of the reopened timeline.
    const requested = restore?.selectedClipId;
    const restoredClipId =
      typeof requested === "string" && next.timeline.some((c) => c.id === requested)
        ? requested
        : (next.timeline[0]?.id ?? null);
    setSelectedClipId(restoredClipId);
    setExplicitDynamicId(null);
    // PLANNING AUTHORITY: applied transition overrides and the assignment
    // strategy are canonical planning inputs, so a reopened project must not
    // silently revert to unoptimized planning.
    setAssignmentStrategy(restore?.planning?.assignmentStrategy ?? "nearestNeighbor");
    {
      const restored = restore?.planning?.transitionOverrides ?? {};
      overrideBasisRef.current = computeOverrideBasis(next, restored);
      setTransitionOverrides({ ...restored });
      // Legacy files (v1/v2/v3 without designs) derive the mode from the
      // override data itself, so a reopened project never claims a mode it
      // cannot support.
      const restoredDesigns: Record<string, TransitionDesignState> = {};
      for (const clipId of Object.keys(restored)) {
        restoredDesigns[clipId] = normalizeTransitionDesign({
          ...DEFAULT_TRANSITION_DESIGN,
          mode: deriveTransitionMode(restored[clipId]),
        });
      }
      for (const [clipId, design] of Object.entries(restore?.planning?.transitionDesigns ?? {})) {
        restoredDesigns[clipId] = normalizeTransitionDesign(design);
      }
      setTransitionDesigns(restoredDesigns);
    }
    if (typeof restore?.sampleRate === "number" && Number.isFinite(restore.sampleRate)) {
      setSampleRate(restore.sampleRate);
    }
    invalidateDerivedAnalysis(derivedAnalysisSetters);
    dynamicHistory.current = { past: [], future: [] };
    setDynamicHistoryDepth({ past: 0, future: 0 });
    timelineHistory.current = { past: [], future: [] };
    setTimelineHistoryDepth({ past: 0, future: 0 });
    // FILE SEMANTICS. Reopening a file lands clean and saved-as-that-file; an
    // authored project/sample has no file yet (never "saved as the previous
    // file"); a recovered autosave is dirty by construction — the empty
    // signature never equals a project signature, so it stays dirty.
    const fileState = restore?.fileState ?? "FILE";
    if (fileState === "FILE") {
      savedSignature.current = JSON.stringify(next);
      setProjectDirty(false);
    } else if (fileState === "RECOVERED") {
      savedSignature.current = "";
      setProjectDirty(true);
      setProjectSavedAt(null);
    } else {
      // AUTHORED / SAMPLE: no file yet, but the adopted document IS the baseline.
      // Anchoring here is what makes later edits count as unsaved work, so the
      // unsaved-work guard can protect a never-saved show from silent loss.
      savedSignature.current = JSON.stringify(next);
      setProjectDirty(false);
      setProjectSavedAt(null);
    }

    setProjectFileNameState(ensureProjectExtension(fileName || suggestedProjectFileName(next.name)));
    // Adopting a document ALWAYS leaves the NO SHOW OPEN state.
    setDocumentOpen(true);
    setDocumentAction(null);
    // RECOVERY PRECEDENCE: a successful, deliberate replacement (Open, New,
    // Sample, consumed Restore) makes the previous session's snapshot obsolete.
    // Runs only on the success path, so a failed adoption keeps recovery intact.
    consumeAutosaveRecoveryRef.current();
    return { ok: true };
  }, [derivedAnalysisSetters]);
  adoptProjectRef.current = adoptProject;

  /**
   * CLOSE SHOW. Reuses the single adoption boundary with a blank placeholder so
   * every subsystem (playback, validation, forensics, reference layer, source
   * bytes, histories, in-flight jobs, autosave snapshot) is cleared by exactly
   * the same authority as a project switch — then marks the document closed.
   * The placeholder is NEVER presented as an editable show: `documentOpen` is
   * false, so the Studio renders the explicit NO SHOW OPEN state instead.
   */
  const closeShow = useCallback(() => {
    const closedName = projectFileName || project.name;
    adoptProject(createDefaultProject(), "", { fileState: "UNSAVED" });
    setDocumentOpen(false);
    setProjectDirty(false);
    setProjectSavedAt(null);
    setProjectAutosavedAt(null);
    setProjectFileError(null);
    setDocumentAction(documentFeedback("CLOSED", closedName));
  }, [adoptProject, projectFileName, project.name]);

  const clearDocumentAction = useCallback(() => setDocumentAction(null), []);



  /** Adopts a parsed/migrated envelope with its planning state and editor prefs. */
  const adoptProjectFile = useCallback(
    (
      file: ProjectFile,
      fileName: string,
      fileState: "FILE" | "RECOVERED" = "FILE",
    ): AdoptProjectOutcome =>
      adoptProject(file.project, fileName, {
        ...(file.planning ? { planning: file.planning } : {}),
        // EXACT REFERENCE AUTHORITY: the adopted file owns it. A file without a
        // layer installs null, so no imported authority of the previous project
        // can survive the adoption.
        referenceLayer: file.referenceLayer ?? null,
        selectedClipId: file.editor?.selectedClipId ?? null,
        ...(typeof file.editor?.sampleRate === "number"
          ? { sampleRate: file.editor.sampleRate }
          : {}),
        fileState,
      }),
    [adoptProject],
  );

  const openProjectFile = useCallback(
    async (file: File) => {
      try {
        const parsed = parseProjectFile(await file.text());
        const outcome = adoptProjectFile(parsed, file.name);
        if (!outcome.ok) {
          // Nothing was adopted: report the failure and keep project A intact.
          setProjectFileError(outcome.error);
          return;
        }
        setProjectSavedAt(parsed.savedAt);
        setProjectFileError(null);
      } catch (err) {
        // The open project is left completely untouched on any failure.
        const error = toProjectFileError(err);
        setProjectFileError({ code: error.code, message: error.message });
      }
    },
    [adoptProjectFile],
  );

  // Startup recovery offer — never applied automatically.
  useEffect(() => {
    const store = getAutosaveStore();
    if (!store) return;
    let active = true;
    const generation = autosaveGeneration.current;
    void readAutosave(store).then((snapshot) => {
      // A lifecycle action that landed while the read was in flight already
      // consumed this snapshot: never resurrect the offer.
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
    ): string[] => {
      const preset = findLightingPreset(presetId);
      if (!preset || targets.length === 0) return [];
      const created: LightingEffectInstance[] = targets.map((target) => ({
        ...createEffectFromPreset(preset, target, parameters ? { parameters } : {}),
        id: newLightingEffectId(Date.now() + lightingSeed.current++),
      }));
      // ONE revision for the whole multi-selection = ONE undo entry.
      editLighting((list) => [...list, ...created]);
      setSelectedLightingEffectId(created[0]!.id);
      return created.map((e) => e.id);
    },
    [editLighting],
  );

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
        const nextClip =
          previous === id ? nextSelectedClipId(next.timeline, removed) : previous;
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
      if (referenceLayerShow && referenceLayer && intervalAtTime(referenceLayer, t)?.owner === "REFERENCE") {
        return referenceLightStates(referenceLayerShow, t, project.droneCount);
      }
      if (!lightingPreview) return [];
      if ((project.lighting?.effects.length ?? 0) === 0) return [];
      return projectLightingAt(
        {
          project,
          participation: plan.participation,
          positions: samplesAtTime(t).map((s) => s.position),
        },
        t,
      );
    },
    [lightingPreview, project, plan.participation, samplesAtTime, referenceLayer, referenceLayerShow],
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

      patchLightingEffect,
      patchLightingParameters,
      removeLightingEffect,
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
      patchTransitionDroneOffset,
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

      patchLightingEffect,
      patchLightingParameters,
      removeLightingEffect,
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
      patchTransitionDroneOffset,
      canAnalyzeSelectedClip,
      showPaths,
      showConflicts,
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
