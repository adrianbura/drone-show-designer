/**
 * SINGLE PROJECT-SESSION RESET AUTHORITY.
 *
 * Derived analysis has its own invalidation authority (`invalidateDerivedAnalysis`).
 * This module owns the OTHER half of a project replacement: state that belongs
 * to the session of the project being replaced — imported reference/forensics
 * evidence, AI proposal session, SVG drafts, scene/dynamic editor selections and
 * the decoded audio buffer of the previous local track.
 *
 * Leaking any of it into the newly adopted project would let the Studio present
 * evidence, playback or authority that belongs to a project that is no longer
 * open. Authored settings (thresholds, presets, comparison frames, global user
 * preferences) are NEVER touched here.
 */

export interface ProjectSessionResetSetters {
  // Reference / forensics session (project-scoped authority + evidence).
  setReferenceShow: (value: null) => void;
  setReferencePlayback: (value: false) => void;
  setReferenceBusy: (value: false) => void;
  setReferenceError: (value: null) => void;
  setSelectedReferenceDroneId: (value: null) => void;
  setShowReferencePaths: (value: false) => void;
  setReferenceExtraction: (value: never[]) => void;
  setReferenceAssetDrafts: (value: never[]) => void;
  setReferenceExtractionWarnings: (value: never[]) => void;
  setForensicsReport: (value: null) => void;
  setForensicsError: (value: null) => void;
  setForensicsBusy: (value: false) => void;
  setSelectedForensicSegmentId: (value: null) => void;
  // AI choreography session.
  setAiProposal: (value: null) => void;
  setAiProposalErrors: (value: never[]) => void;
  setAiHistory: (value: never[]) => void;
  setAiError: (value: null) => void;
  setAiPreviewTime: (value: 0) => void;
  setAiBusy: (value: false) => void;
  // SVG drafts.
  setSvgDraft: (value: null) => void;
  setSvgError: (value: null) => void;
  setSvgBusy: (value: false) => void;
  // Scene / dynamic editor session.
  clearSceneSelection: () => void;
  setSceneGizmoDraft: (value: null) => void;
  setSceneReferenceGhost: (value: false) => void;
  setSelectedLaunchGroupId: (value: null) => void;
  setSelectedPointIds: (value: never[]) => void;
  setSelectedMotionGroupId: (value: null) => void;
  setDynamicEditTime: (value: 0) => void;
  setExplicitDynamicId: (value: null) => void;
  // Audio SESSION only. Project audio METADATA belongs to the adopted project
  // and is never touched here; the decoded buffer of the previous local file
  // must not stay playable under the new project.
  clearAudioSession: () => void;
}

/** Canonical list of session slots a project replacement clears. */
export const PROJECT_SESSION_RESET_SLOTS = [
  "referenceShow",
  "referencePlayback",
  "referenceBusy",
  "referenceError",
  "selectedReferenceDroneId",
  "showReferencePaths",
  "referenceExtraction",
  "referenceAssetDrafts",
  "referenceExtractionWarnings",
  "forensicsReport",
  "forensicsError",
  "forensicsBusy",
  "selectedForensicSegmentId",
  "aiProposal",
  "aiProposalErrors",
  "aiHistory",
  "aiError",
  "aiPreviewTime",
  "aiBusy",
  "svgDraft",
  "svgError",
  "svgBusy",
  "sceneSelection",
  "sceneGizmoDraft",
  "sceneReferenceGhost",
  "selectedLaunchGroupId",
  "selectedPointIds",
  "selectedMotionGroupId",
  "dynamicEditTime",
  "explicitDynamicId",
  "audioSession",
] as const;

/** Clears every session slot owned by the project being replaced. */
export function resetProjectSessionState(setters: ProjectSessionResetSetters): void {
  setters.setReferenceShow(null);
  setters.setReferencePlayback(false);
  setters.setReferenceBusy(false);
  setters.setReferenceError(null);
  setters.setSelectedReferenceDroneId(null);
  setters.setShowReferencePaths(false);
  setters.setReferenceExtraction([]);
  setters.setReferenceAssetDrafts([]);
  setters.setReferenceExtractionWarnings([]);
  setters.setForensicsReport(null);
  setters.setForensicsError(null);
  setters.setForensicsBusy(false);
  setters.setSelectedForensicSegmentId(null);

  setters.setAiProposal(null);
  setters.setAiProposalErrors([]);
  setters.setAiHistory([]);
  setters.setAiError(null);
  setters.setAiPreviewTime(0);
  setters.setAiBusy(false);

  setters.setSvgDraft(null);
  setters.setSvgError(null);
  setters.setSvgBusy(false);

  setters.clearSceneSelection();
  setters.setSceneGizmoDraft(null);
  setters.setSceneReferenceGhost(false);
  setters.setSelectedLaunchGroupId(null);
  setters.setSelectedPointIds([]);
  setters.setSelectedMotionGroupId(null);
  setters.setDynamicEditTime(0);
  setters.setExplicitDynamicId(null);

  setters.clearAudioSession();
}
