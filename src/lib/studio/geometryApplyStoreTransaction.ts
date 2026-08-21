import type { ReferenceTrajectoryLayer } from "../import/essp/native";
import type { ShowProject } from "../show/types";
import type { ClipTransitionOverride } from "../show/trajectory";
import type { TransitionDesignState } from "../show/transition";
import type { GeometryApplyPreparationSuccess } from "./geometryApplyCommand";
import type { TimelineHistorySnapshot } from "./planningIntegrity";

/**
 * PURE STORE-TRANSACTION INSTALLER for a PREPARED geometry apply command.
 *
 * This is deliberately React-free. It turns the atomic before/after snapshots
 * produced by `prepareGeometryApplyCommand` into the exact next canonical store
 * state and history stack. The Studio store remains responsible only for
 * installing these values together and invalidating derived analysis caches.
 */
export interface GeometryApplyHistoryState {
  readonly past: readonly TimelineHistorySnapshot[];
  readonly future: readonly TimelineHistorySnapshot[];
}

export interface InstalledGeometryApplyState {
  readonly project: ShowProject;
  readonly transitionOverrides: Readonly<Record<string, ClipTransitionOverride>>;
  readonly transitionDesigns: Readonly<Record<string, TransitionDesignState>>;
  readonly referenceLayer: ReferenceTrajectoryLayer | null;
  readonly history: GeometryApplyHistoryState;
  readonly invalidatedTransitionOverrideClipIds: readonly string[];
  readonly promotedReferenceClipIds: readonly string[];
  /**
   * Derived validation/analysis state is always stale after geometry changes.
   * The store must clear these caches in the same UI command boundary.
   */
  readonly invalidateDerivedAnalysis: true;
}

export interface InstallGeometryApplyOptions {
  /** Same bounded-history policy as other authoring commands. */
  readonly maxHistoryEntries?: number;
}

export function installPreparedGeometryApply(
  prepared: GeometryApplyPreparationSuccess,
  history: GeometryApplyHistoryState,
  options: InstallGeometryApplyOptions = {},
): InstalledGeometryApplyState {
  const maxHistoryEntries = Math.max(1, Math.floor(options.maxHistoryEntries ?? 100));
  const past = [...history.past, prepared.before];
  const boundedPast = past.length > maxHistoryEntries ? past.slice(past.length - maxHistoryEntries) : past;

  return {
    project: prepared.after.project,
    transitionOverrides: prepared.after.transitionOverrides,
    transitionDesigns: prepared.after.transitionDesigns ?? {},
    referenceLayer: prepared.after.referenceLayer ?? null,
    history: {
      past: boundedPast,
      // A new authoring command always cuts the redo branch.
      future: [],
    },
    invalidatedTransitionOverrideClipIds: prepared.invalidatedTransitionOverrideClipIds,
    promotedReferenceClipIds: prepared.promotedReferenceClipIds,
    invalidateDerivedAnalysis: true,
  };
}

/**
 * Result of the STORE command boundary: either the preparation blocker reported
 * by `prepareGeometryApplyCommand`, or the canonical consequences of the
 * installed revision. No policy is added here.
 */
export type GeometryApplyCommitResult =
  | {
      readonly ok: true;
      readonly invalidatedTransitionOverrideClipIds: readonly string[];
      readonly promotedReferenceClipIds: readonly string[];
      readonly note: string;
    }
  | {
      readonly ok: false;
      readonly blocker: import("./geometryApplyCommand").GeometryApplyPreparationBlocker;
      readonly note: string;
    };
