/**
 * SINGLE AUTHORING COMMAND AUTHORITY (pure).
 *
 * One typed registry describes every authoring action that can be invoked from
 * MORE than one surface: timeline context menu, double-click, Inspector,
 * toolbar, keyboard, and (later) a command palette. Surfaces render this model;
 * they never re-derive availability rules of their own.
 *
 * This module is deliberately NOT a framework:
 *   - no execution here (surfaces bind ids to the existing canonical store
 *     mutations / editor-focus helpers — there is no second Lighting,
 *     Transition, Validation, Reference or history authority),
 *   - no React, no DOM, no store import: it stays unit-testable and reusable.
 *
 * AVAILABILITY DOCTRINE
 *   - An action that fundamentally does not apply to the selection is ABSENT.
 *   - An action that applies but is temporarily blocked is PRESENT + disabled
 *     and always carries `unavailableReason`.
 *   - Opening a menu, submenu or editor mutates nothing. Only `execute` on the
 *     surface side mutates, through the canonical authored mutation, producing
 *     exactly one undo revision.
 */

import type { ShowPhase } from "@/lib/show/types";

export type StudioCommandId =
  // ---- primary editing
  | "EDIT_SCENE"
  | "EDIT_FORMATION"
  | "EDIT_DYNAMIC"
  | "CONVERT_TO_SCENE"
  // ---- lighting & effects
  | "EDIT_LIGHTING"
  | "SET_COLOR"
  | "VIEW_IMPORTED_RGB"
  // ---- motion & timing
  | "EDIT_MOTION"
  | "SNAP_START_TO_BEAT"
  // ---- transition
  | "EDIT_TRANSITION"
  | "TRANSITION_DESIGN"
  | "REPLAN_ASSIGNMENT"
  // ---- document
  | "DUPLICATE_CLIP"
  | "RENAME_CLIP"
  | "DELETE_CLIP"
  // ---- reference (imported ESSP)
  | "COMPARE_REFERENCE"
  | "RESTORE_REFERENCE"
  // ---- future / experimental
  | "REBUILD_AS_TEXT"
  // ---- empty timeline space
  | "ADD_CLIP_HERE"
  | "ADD_MARKER_HERE"
  | "MOVE_PLAYHEAD_HERE"
  // ---- marker
  | "RENAME_MARKER"
  | "MARKER_TO_PLAYHEAD"
  | "DELETE_MARKER"
  // ---- lighting effect instance
  | "EDIT_LIGHTING_EFFECT"
  | "DELETE_LIGHTING_EFFECT";

export interface StudioCommand {
  readonly id: StudioCommandId;
  readonly label: string;
  readonly available: boolean;
  /** Always present when `available` is false. */
  readonly unavailableReason?: string;
  readonly destructive?: boolean;
  readonly shortcut?: string;
}

export interface StudioCommandSection {
  readonly id: string;
  /** Present => rendered as a submenu. Absent => inline group. */
  readonly label?: string;
  readonly items: readonly StudioCommand[];
}

export interface StudioCommandMenu {
  readonly title: string;
  readonly subtitle?: string;
  readonly sections: readonly StudioCommandSection[];
}

/** How the selected clip's geometry is actually represented today. */
export type ClipRepresentation = "SCENE" | "DYNAMIC" | "STATIC";
/** Who owns the trajectories in the clip's time range. */
export type ClipOwnership = "REFERENCE" | "PLANNER" | "NONE";

export interface ClipCommandContext {
  readonly kind: "CLIP";
  readonly clipId: string;
  readonly label: string;
  readonly phase: ShowPhase;
  readonly representation: ClipRepresentation;
  readonly canConvertToScene: boolean;
  /** Authored lighting effects exist on this clip (NOT imported RGB). */
  readonly hasAuthoredLighting: boolean;
  /** Imported per-drone RGB is available for read-only inspection. */
  readonly hasImportedRgb: boolean;
  /** A tempo grid exists, so a start can be snapped to a musical beat. */
  readonly canSnapToBeat: boolean;
  readonly ownership: ClipOwnership;
  readonly canCompareReference: boolean;
  readonly canRestoreReference: boolean;
  /** Development-only surfaces for planned capabilities. */
  readonly experimentalEnabled: boolean;
  /**
   * Deterministic text rebuild eligibility, resolved by the SAME authority the
   * preview transaction uses (`resolveTextRebuildEligibility`). Unavailable
   * targets (dynamic clip, dynamic object, multi-object scene) carry the
   * explicit blocker reason produced there.
   */
  readonly textRebuild: { readonly available: boolean; readonly reason?: string };
}

export interface EmptyTimelineCommandContext {
  readonly kind: "EMPTY_TIMELINE";
  readonly time: number;
  readonly canAddClip: boolean;
}

export interface MarkerCommandContext {
  readonly kind: "MARKER";
  readonly markerId: string;
  readonly label: string;
}

export interface LightingEffectCommandContext {
  readonly kind: "LIGHTING_EFFECT";
  readonly effectId: string;
  readonly label: string;
}

export type TimelineCommandContext =
  | ClipCommandContext
  | EmptyTimelineCommandContext
  | MarkerCommandContext
  | LightingEffectCommandContext;

/** Fallback reason when no target-specific blocker was resolved. */
export const REBUILD_AS_TEXT_REASON =
  "This target cannot be rebuilt as deterministic text; only a single STATIC formation or STATIC scene object is supported.";

function cmd(
  id: StudioCommandId,
  label: string,
  extra: Omit<Partial<StudioCommand>, "id" | "label"> = {},
): StudioCommand {
  return { id, label, available: extra.available ?? true, ...extra };
}

function blocked(id: StudioCommandId, label: string, reason: string, destructive = false): StudioCommand {
  return { id, label, available: false, unavailableReason: reason, destructive };
}

function section(id: string, items: readonly StudioCommand[], label?: string): StudioCommandSection | null {
  if (items.length === 0) return null;
  return label === undefined ? { id, items } : { id, label, items };
}

function clipMenu(ctx: ClipCommandContext): StudioCommandMenu {
  const isShow = ctx.phase === "SHOW";

  // EDIT — only the representation(s) that actually exist.
  const edit: StudioCommand[] = [];
  if (ctx.representation === "SCENE") edit.push(cmd("EDIT_SCENE", "Edit Scene…"));
  if (ctx.representation === "DYNAMIC") edit.push(cmd("EDIT_DYNAMIC", "Edit Dynamic Formation…"));
  if (ctx.representation === "STATIC") edit.push(cmd("EDIT_FORMATION", "Edit Formation…"));
  if (ctx.representation !== "SCENE" && ctx.canConvertToScene) {
    edit.push(cmd("CONVERT_TO_SCENE", "Edit as Scene…"));
  }

  // LIGHTING — shortcuts into the existing canonical lighting tooling.
  const lighting: StudioCommand[] = [
    cmd("EDIT_LIGHTING", "Edit Lighting…"),
    cmd("SET_COLOR", "Set Colour…"),
  ];
  if (ctx.hasImportedRgb) {
    lighting.push(cmd("VIEW_IMPORTED_RGB", "View Imported RGB · REFERENCE"));
  }

  const motion: StudioCommand[] = [
    cmd("EDIT_MOTION", "Edit Timing…"),
    ctx.canSnapToBeat
      ? cmd("SNAP_START_TO_BEAT", "Snap Start to Beat")
      : blocked("SNAP_START_TO_BEAT", "Snap Start to Beat", "No tempo grid — set the audio BPM first."),
  ];

  const transition: StudioCommand[] = isShow
    ? [
        cmd("EDIT_TRANSITION", "Edit Transition…"),
        cmd("TRANSITION_DESIGN", "Transition Design…"),
        cmd("REPLAN_ASSIGNMENT", "Replan Assignment…"),
      ]
    : [];

  const document: StudioCommand[] = [];
  if (isShow) document.push(cmd("DUPLICATE_CLIP", "Duplicate"));
  document.push(cmd("RENAME_CLIP", "Rename…"));

  const reference: StudioCommand[] =
    ctx.ownership === "NONE"
      ? []
      : [
          ctx.canCompareReference
            ? cmd("COMPARE_REFERENCE", "Compare with Original")
            : blocked("COMPARE_REFERENCE", "Compare with Original", "No comparable reference geometry for this clip."),
          // Only shown when a real restore continuation exists: production
          // menus contain working actions only.
          ...(ctx.canRestoreReference
            ? [cmd("RESTORE_REFERENCE", "Restore Reference Version")]
            : []),
        ];

  // ADVANCED — deterministic text rebuild of a single STATIC target.
  const advanced: StudioCommand[] = [
    ctx.textRebuild.available
      ? cmd("REBUILD_AS_TEXT", "Rebuild as Text…")
      : blocked(
          "REBUILD_AS_TEXT",
          "Rebuild as Text…",
          ctx.textRebuild.reason ?? REBUILD_AS_TEXT_REASON,
        ),
  ];

  const sections = [
    section("EDIT", edit),
    section("LIGHTING", lighting, "Lighting & Effects"),
    section("MOTION", motion, "Motion & Timing"),
    section("TRANSITION", transition, "Transition"),
    section("DOCUMENT", document),
    section("REFERENCE", reference, "Reference"),
    section("ADVANCED", advanced, "Advanced"),
    section("DESTRUCTIVE", [
      cmd("DELETE_CLIP", "Delete", { destructive: true, shortcut: "Delete" }),
    ]),
  ].filter((s): s is StudioCommandSection => s !== null);

  const owner = ctx.ownership === "NONE" ? "" : ` · ${ctx.ownership}`;
  return {
    title: ctx.label,
    subtitle: `${ctx.phase} · ${ctx.representation}${owner}`,
    sections,
  };
}

export function resolveTimelineCommands(ctx: TimelineCommandContext): StudioCommandMenu {
  switch (ctx.kind) {
    case "CLIP":
      return clipMenu(ctx);
    case "EMPTY_TIMELINE": {
      const items: StudioCommand[] = [
        ctx.canAddClip
          ? cmd("ADD_CLIP_HERE", "Add Formation Clip")
          : blocked("ADD_CLIP_HERE", "Add Formation Clip", "Create a formation first."),
        cmd("ADD_MARKER_HERE", "Add Marker"),
        cmd("MOVE_PLAYHEAD_HERE", "Move Playhead Here"),
      ];
      return { title: "Timeline", sections: [{ id: "EMPTY", items }] };
    }
    case "MARKER":
      return {
        title: ctx.label,
        subtitle: "Marker",
        sections: [
          { id: "MARKER", items: [cmd("RENAME_MARKER", "Rename…"), cmd("MARKER_TO_PLAYHEAD", "Move to Playhead")] },
          {
            id: "DESTRUCTIVE",
            items: [cmd("DELETE_MARKER", "Delete", { destructive: true })],
          },
        ],
      };
    case "LIGHTING_EFFECT":
      return {
        title: ctx.label,
        subtitle: "Lighting effect",
        sections: [
          { id: "EFFECT", items: [cmd("EDIT_LIGHTING_EFFECT", "Edit…")] },
          {
            id: "DESTRUCTIVE",
            items: [cmd("DELETE_LIGHTING_EFFECT", "Delete", { destructive: true })],
          },
        ],
      };
  }
}

/**
 * DOUBLE-CLICK CONTRACT. Double-click opens the PRIMARY editor of the element,
 * and nothing else. When no meaningful editor exists the surface must fall back
 * to select/focus instead of inventing behaviour, so this returns null.
 */
export function primaryCommandFor(ctx: TimelineCommandContext): StudioCommandId | null {
  switch (ctx.kind) {
    case "CLIP":
      if (ctx.representation === "SCENE") return "EDIT_SCENE";
      if (ctx.representation === "DYNAMIC") return "EDIT_DYNAMIC";
      return "EDIT_FORMATION";
    case "MARKER":
      return "RENAME_MARKER";
    case "LIGHTING_EFFECT":
      return "EDIT_LIGHTING_EFFECT";
    case "EMPTY_TIMELINE":
      return null;
  }
}

/** Flat command list — the shape a future Ctrl+K palette consumes. */
export function flattenCommands(menu: StudioCommandMenu): readonly StudioCommand[] {
  return menu.sections.flatMap((s) => s.items);
}

export function findCommand(
  menu: StudioCommandMenu,
  id: StudioCommandId,
): StudioCommand | undefined {
  return flattenCommands(menu).find((c) => c.id === id);
}
