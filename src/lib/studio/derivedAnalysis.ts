/**
 * SINGLE DERIVED-ANALYSIS INVALIDATION AUTHORITY.
 *
 * Every derived analysis in the Studio store is computed FOR a specific project
 * content revision. Any command that replaces project content (geometry apply,
 * undo/redo restore, loading another project) must drop all of it in the same
 * commit, otherwise the panel can present evidence for geometry that no longer
 * exists. Authored settings (thresholds, audience view, options, selections
 * other than clip-scoped reconciliation) are NEVER touched here.
 */
export interface DerivedAnalysisSetters {
  setTransitionAnalysis: (value: null) => void;
  setAssignmentComparison: (value: null) => void;
  setOptimization: (value: null) => void;
  setTransitionError: (value: null) => void;
  setFullShow: (value: null) => void;
  setFullShowError: (value: null) => void;
  setHighlightedDrones: (value: never[]) => void;
  setPreShowPreview: (value: null) => void;
}

/** The canonical list of derived-analysis slots a content change invalidates. */
export const DERIVED_ANALYSIS_SLOTS = [
  "transitionAnalysis",
  "assignmentComparison",
  "optimization",
  "transitionError",
  "fullShow",
  "fullShowError",
  "highlightedDrones",
  "preShowPreview",
] as const;

/** Clears every geometry-dependent derived analysis slot. */
export function invalidateDerivedAnalysis(setters: DerivedAnalysisSetters): void {
  setters.setTransitionAnalysis(null);
  setters.setAssignmentComparison(null);
  setters.setOptimization(null);
  setters.setTransitionError(null);
  setters.setFullShow(null);
  setters.setFullShowError(null);
  setters.setHighlightedDrones([]);
  setters.setPreShowPreview(null);
}
