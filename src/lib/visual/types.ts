/**
 * VISUAL FORMATION DESIGN — canonical intermediate representation.
 *
 * A `VisualFormationDesign` is the ARTISTIC description of an artwork: what the
 * silhouette is, which internal strokes matter, which areas may be filled, how
 * important every element is and which semantic part it belongs to. It contains
 * NO drone ids, NO trajectories and NO point counts.
 *
 * The deterministic Drone Art Compiler (src/lib/visual/compiler.ts) turns a
 * design plus a target point count into EXACTLY N formation points. The design
 * itself is immutable and reusable at any resolution:
 *
 *   prompt / image / built-in -> VisualFormationDesign -> compiler
 *   -> Formation / DynamicFormation -> Formation Library -> USER places it on
 *   the show timeline (never automatically).
 *
 * Design space: normalised units, X right, Y up, Z forward. The compiler maps
 * design space to show-local metres (+Y up) using the requested width and
 * altitude. Enum values, ids and schema keys are language-neutral and are never
 * translated.
 */
import type { RGB } from "../show/types";

export const VISUAL_DESIGN_SCHEMA_VERSION = 1;

/** Bumped whenever compiled geometry can change for identical inputs. */
export const DRONE_ART_COMPILER_VERSION = "1.0.0";

/**
 * How much of the artwork the design describes.
 * - CONTOUR_2D: silhouette only (logos, icons, hearts, text).
 * - SEMANTIC_2D: silhouette + named parts + internal structure.
 * - ARTICULATED_2_5D: semantic parts with depth hints and animatable groups.
 * - PARAMETRIC_3D: parametric volumes/surfaces (sphere, ring, patch).
 */
export type VisualDesignMode = "CONTOUR_2D" | "SEMANTIC_2D" | "ARTICULATED_2_5D" | "PARAMETRIC_3D";

export type VisualCoordinateSpace = "DESIGN_XY" | "DESIGN_XYZ";

export type VisualPrimitiveType =
  | "POLYLINE"
  | "CLOSED_CONTOUR"
  | "REGION"
  | "POINT_FEATURE"
  | "PARAMETRIC_CURVE"
  | "PARAMETRIC_SURFACE";

/** Language-neutral semantic part id, e.g. "BODY", "LEFT_WING", "LEFT_EYE". */
export type SemanticPartId = string;

export type VisualSymmetry = "NONE" | "MIRROR_X" | "MIRROR_Y";

/** Compilation style: how the point budget is biased across primitive types. */
export type VisualStyle = "OUTLINE" | "STRUCTURAL" | "BALANCED" | "FILLED";

/** Extra contour/fill preference carried by the design itself. */
export type FillBias = "CONTOUR_HEAVY" | "BALANCED" | "FILL_HEAVY";

export type VisualSourceType = "MANUAL" | "BUILT_IN" | "IMAGE_ANALYSIS" | "AI_GENERATED";

/** 2D point in design space. */
export type DesignPoint = readonly [number, number];

export interface VisualPrimitiveBase {
  readonly id: string;
  /** Semantic part this primitive belongs to, when the design has parts. */
  readonly part?: SemanticPartId | undefined;
  /** Visual importance in [0, 1]. 1 = must survive at low point counts. */
  readonly priority: number;
  /** Essential primitives are dropped last and keep a minimum allocation. */
  readonly essential?: boolean | undefined;
  /** Minimum useful allocation when the primitive is kept. */
  readonly minPoints?: number | undefined;
  /** Optional cap so a huge region cannot eat the whole budget. */
  readonly maxPoints?: number | undefined;
  /** Disabled primitives are ignored by the compiler (editable later). */
  readonly enabled?: boolean | undefined;
  /** Base artistic colour intent. NOT a lighting timeline effect. */
  readonly color?: RGB | undefined;
  /** 2.5D depth hint in design units (Z forward). */
  readonly depth?: number | undefined;
  /** Mirrored counterpart id — keeps symmetric allocation balanced. */
  readonly mirrorOf?: string | undefined;
}

export interface PolylinePrimitive extends VisualPrimitiveBase {
  readonly type: "POLYLINE";
  readonly path: readonly DesignPoint[];
}

export interface ClosedContourPrimitive extends VisualPrimitiveBase {
  readonly type: "CLOSED_CONTOUR";
  readonly path: readonly DesignPoint[];
}

export interface RegionPrimitive extends VisualPrimitiveBase {
  readonly type: "REGION";
  readonly outline: readonly DesignPoint[];
  readonly holes?: readonly (readonly DesignPoint[])[] | undefined;
}

export interface PointFeaturePrimitive extends VisualPrimitiveBase {
  readonly type: "POINT_FEATURE";
  readonly position: DesignPoint;
  /** Radius used when the feature receives more than one point. */
  readonly spread?: number | undefined;
}

export type ParametricCurveKind = "CIRCLE" | "ELLIPSE" | "HELIX";

export interface ParametricCurvePrimitive extends VisualPrimitiveBase {
  readonly type: "PARAMETRIC_CURVE";
  readonly curve: ParametricCurveKind;
  /** Language-neutral numeric parameters (rx, ry, turns, height, tiltDeg…). */
  readonly params: Readonly<Record<string, number>>;
  readonly center?: DesignPoint | undefined;
}

export type ParametricSurfaceKind = "SPHERE" | "ELLIPSOID" | "PLANE_PATCH";

export interface ParametricSurfacePrimitive extends VisualPrimitiveBase {
  readonly type: "PARAMETRIC_SURFACE";
  readonly surface: ParametricSurfaceKind;
  readonly params: Readonly<Record<string, number>>;
  readonly center?: DesignPoint | undefined;
}

export type VisualPrimitive =
  | PolylinePrimitive
  | ClosedContourPrimitive
  | RegionPrimitive
  | PointFeaturePrimitive
  | ParametricCurvePrimitive
  | ParametricSurfacePrimitive;

export interface SemanticPart {
  readonly id: SemanticPartId;
  /** Presentation label hint; the UI may localise per id instead. */
  readonly label?: string | undefined;
  readonly priority: number;
  /** Mirrored sibling part (LEFT_WING <-> RIGHT_WING). */
  readonly mirrorOf?: SemanticPartId | undefined;
  /** Base colour intent for the whole part. */
  readonly color?: RGB | undefined;
  /** Depth hint applied to every primitive of the part without its own depth. */
  readonly depth?: number | undefined;
  /** True when the part is a sensible DynamicFormation motion group. */
  readonly animatable?: boolean | undefined;
  /**
   * Default motion intent for the part, applied by the dynamic bridge.
   * SPIN_Z: continuous rotation about the part centre (wheels, rotors).
   */
  readonly motion?: SemanticPartMotion | undefined;
}

/** Language-neutral default motion intents a design may declare on a part. */
export type SemanticPartMotion = "NONE" | "SPIN_Z";

export interface VisualDesignBounds {
  /** Design-space extents. Width is the reference for metre scaling. */
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export interface VisualDesignMetadata {
  readonly sourceType: VisualSourceType;
  readonly tags?: readonly string[] | undefined;
  readonly notes?: string | undefined;
  /** Free provenance for a future image-analysis or AI producer. */
  readonly sourceRef?: string | undefined;
  readonly createdAt?: string | undefined;
}

export interface VisualFormationDesign {
  readonly schemaVersion: number;
  readonly id: string;
  readonly name: string;
  /** Design revision, independent of the compiler version. */
  readonly version: number;
  readonly mode: VisualDesignMode;
  readonly coordinateSpace: VisualCoordinateSpace;
  readonly primitives: readonly VisualPrimitive[];
  readonly semanticParts: readonly SemanticPart[];
  readonly symmetry: VisualSymmetry;
  readonly bounds: VisualDesignBounds;
  readonly defaultStyle?: VisualStyle | undefined;
  readonly defaultPointCount?: number | undefined;
  readonly fillBias?: FillBias | undefined;
  /** Target neighbour spacing in design units, used for spacing diagnostics. */
  readonly spacingTarget?: number | undefined;
  readonly metadata: VisualDesignMetadata;
}

/** Compiler inputs. Identical inputs always produce identical output. */
export interface CompileVisualOptions {
  readonly style?: VisualStyle | undefined;
  /** Physical width of the artwork in metres (X extent). */
  readonly width?: number | undefined;
  /** Centre altitude in metres (+Y up). */
  readonly altitude?: number | undefined;
  /** Multiplier applied to 2.5D depth hints. 0 flattens the artwork. */
  readonly depthScale?: number | undefined;
  /** Yaw of the whole artwork in degrees. */
  readonly rotationDeg?: number | undefined;
  /** Deterministic seed for low-discrepancy sequences. */
  readonly seed?: number | undefined;
  readonly fillBias?: FillBias | undefined;
}

export interface ResolvedCompileOptions {
  readonly style: VisualStyle;
  readonly width: number;
  readonly altitude: number;
  readonly depthScale: number;
  readonly rotationDeg: number;
  readonly seed: number;
  readonly fillBias: FillBias;
}

/** Where a generated point came from. Enables future motion grouping. */
export interface CompiledPointSource {
  readonly primitiveId: string;
  readonly primitiveType: VisualPrimitiveType;
  readonly part?: SemanticPartId | undefined;
}

export interface PrimitiveAllocation {
  readonly primitiveId: string;
  readonly part?: SemanticPartId | undefined;
  readonly priority: number;
  readonly points: number;
  readonly dropped: boolean;
}

export type VisualIssueSeverity = "info" | "warning";

export interface VisualCompileIssue {
  readonly code:
    | "DETAILS_OMITTED"
    | "UNDER_RESOLVED"
    | "SPACING_TIGHT"
    | "BUDGET_EXCEEDS_DESIGN"
    | "EMPTY_DESIGN"
    | "SYMMETRY_ADJUSTED";
  readonly severity: VisualIssueSeverity;
  /** Language-neutral detail payload for localisation at render time. */
  readonly detail: Readonly<Record<string, number | string>>;
}

/**
 * VISUAL-DESIGN diagnostics only. This report never claims flight safety:
 * full-show validation (src/lib/show/safety.ts, fullshow) stays authoritative.
 */
export interface VisualCompileReport {
  readonly requestedPoints: number;
  readonly producedPoints: number;
  readonly primitivesUsed: number;
  readonly primitivesTotal: number;
  /** Share of priority >= 0.8 primitives that survived, in [0, 1]. */
  readonly highPriorityPreserved: number;
  readonly droppedPrimitiveIds: readonly string[];
  readonly allocationByPart: Readonly<Record<string, number>>;
  readonly allocations: readonly PrimitiveAllocation[];
  /** Minimum pairwise distance of the compiled cloud in metres. */
  readonly minSpacing: number;
  /** Spacing the design aims for, in metres. */
  readonly spacingTarget: number;
  readonly issues: readonly VisualCompileIssue[];
  readonly compilerVersion: string;
  readonly style: VisualStyle;
}

export interface CompiledVisualFormation {
  readonly designId: string;
  readonly designVersion: number;
  readonly points: readonly (readonly [number, number, number])[];
  /** Base artistic colours, one per point. Lighting effects stay separate. */
  readonly colors: readonly RGB[];
  readonly sources: readonly CompiledPointSource[];
  /** Point indices grouped by semantic part — the DynamicFormation bridge. */
  readonly partIndices: Readonly<Record<string, readonly number[]>>;
  readonly options: ResolvedCompileOptions;
  readonly report: VisualCompileReport;
}

/** Provenance stored on a compiled Formation so it can be recompiled later. */
export interface VisualFormationProvenance {
  readonly source: "VISUAL_DESIGN";
  readonly designId: string;
  readonly designVersion: number;
  readonly compilerVersion: string;
  readonly targetPointCount: number;
  readonly style: VisualStyle;
  readonly seed: number;
}

export type VisualErrorCode = "EMPTY_DESIGN" | "INVALID_COUNT" | "UNSUPPORTED_PRIMITIVE";

export class VisualDesignError extends Error {
  readonly code: VisualErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: VisualErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "VisualDesignError";
    this.code = code;
    this.details = details;
  }
}
