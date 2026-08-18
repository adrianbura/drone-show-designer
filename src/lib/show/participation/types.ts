/**
 * FLEET PARTICIPATION — domain model.
 *
 * CORE PRINCIPLE
 *   A formation owns POINTS. The fleet owns DRONES.
 *   formation point count === PARTICIPATING drone count
 *   planned trajectory count === TOTAL fleet size
 *
 * A `FleetParticipationPlan` maps EVERY drone of the fleet to exactly one role
 * for one scene (timeline clip). There is no implicit "unassigned" state: the
 * invariant `assertParticipationInvariant` is enforced by the planner itself.
 *
 * The active side of the model is expressed as a LIST of target groups
 * (`FormationTargetGroup[]`) even though this build only ever produces one
 * group per scene. That keeps the schema open for simultaneous multi-formation
 * scenes (Sprint 7.3.5) without a migration.
 *
 * Machine-readable identity (roles, policies, layouts, algorithm versions) is
 * language-neutral and is NEVER translated. Localisation is presentation only.
 *
 * Pure module: no React, no Three.js, no I/O.
 */
import type { Vector3Tuple } from "../types";

/** Bumped whenever participation results can change for identical input. */
export const PARTICIPATION_ALGORITHM_VERSION = "0.1.0";

/**
 * Exactly one role per drone per scene. Additive by design: a new role only
 * needs a target resolution rule in the planner and a label in the UI.
 */
export type DroneRole =
  | "ACTIVE_FORMATION"
  | "PREPOSITION_NEXT"
  | "HOLD_CURRENT"
  | "RESERVE_FORMATION"
  | "USER_ASSIGNED";

export const DRONE_ROLES: readonly DroneRole[] = [
  "ACTIVE_FORMATION",
  "PREPOSITION_NEXT",
  "HOLD_CURRENT",
  "RESERVE_FORMATION",
  "USER_ASSIGNED",
];

/** User-facing behaviour for the drones a formation does not use. */
export type ParticipationPolicy =
  | "SMART_PREPARE"
  | "HOLD_CURRENT"
  | "RESERVE_FORMATION"
  | "MANUAL";

export const PARTICIPATION_POLICIES: readonly ParticipationPolicy[] = [
  "SMART_PREPARE",
  "HOLD_CURRENT",
  "RESERVE_FORMATION",
  "MANUAL",
];

/**
 * Visual choreography metadata for non-participating drones. This is NOT a
 * flight-safety mechanism: reserve drones are planned, sampled, deconflicted and
 * validated exactly like active drones regardless of their lighting.
 */
export type ReserveLightingPolicy = "OFF" | "DIM" | "NORMAL";

export type ReserveLayout = "GRID";

/**
 * Airborne holding area for drones the active formation does not use.
 * `center` is in show-local metres (+Y up); `orientationDeg` rotates the layout
 * around +Y; `spacing` is the slot pitch in metres.
 */
export interface ReserveZoneConfig {
  readonly center: Vector3Tuple;
  readonly orientationDeg: number;
  readonly spacing: number;
  readonly layout: ReserveLayout;
}

/** Expert control. Ids are canonical drone ids (see drones.ts), never indices. */
export interface ManualParticipationOverride {
  readonly activeDroneIds: readonly string[];
  readonly holdDroneIds?: readonly string[];
  readonly reserveDroneIds?: readonly string[];
}

/** Per-clip deviation from the project defaults. */
export interface ClipParticipationSettings {
  readonly policy?: ParticipationPolicy;
  readonly manual?: ManualParticipationOverride;
  readonly reserveZone?: ReserveZoneConfig;
}

/**
 * USER-OWNED participation settings. Persisted with the project; the derived
 * plans are always recomputed from these inputs (never saved as truth).
 */
export interface ParticipationSettings {
  readonly defaultPolicy: ParticipationPolicy;
  readonly reserveZone: ReserveZoneConfig;
  readonly reserveLighting: ReserveLightingPolicy;
  /** Bounded look-ahead window in artistic scenes. 0 disables look-ahead. */
  readonly lookAheadScenes: number;
  readonly clips?: Readonly<Record<string, ClipParticipationSettings>>;
}

export const DEFAULT_RESERVE_ZONE: ReserveZoneConfig = {
  center: [0, 20, -40],
  orientationDeg: 0,
  spacing: 5,
  layout: "GRID",
};

/** Bounded deterministic look-ahead: the next two artistic scenes. */
export const DEFAULT_LOOK_AHEAD_SCENES = 2;

export const DEFAULT_PARTICIPATION_SETTINGS: ParticipationSettings = {
  defaultPolicy: "SMART_PREPARE",
  reserveZone: DEFAULT_RESERVE_ZONE,
  reserveLighting: "OFF",
  lookAheadScenes: DEFAULT_LOOK_AHEAD_SCENES,
};

/** One drone paired with one point of one active formation target group. */
export interface ActivePointAssignment {
  readonly droneId: string;
  readonly droneIndex: number;
  /** Index into the formation's point list. */
  readonly formationPointIndex: number;
  /** Stable point id when the source asset provides one (dynamic formations). */
  readonly formationPointId?: string;
  readonly cost: number;
}

/**
 * One active formation inside a scene. A scene may contain SEVERAL groups
 * simultaneously (Sprint 7.3.5): one group per visual scene object. Legacy
 * single-formation clips still emit exactly one group (`groupId: "primary"`).
 */
export interface FormationTargetGroup {
  readonly groupId: string;
  readonly formationId: string | null;
  readonly dynamicFormationId?: string;
  /** Scene object instance this group renders, when the scene is composed. */
  readonly instanceId?: string;
  /** Author-facing object name. Presentation only; never machine identity. */
  readonly name?: string;
  /** Offset of the group's first point in the scene's combined point list. */
  readonly offset?: number;
  readonly pointCount: number;
  readonly assignments: readonly ActivePointAssignment[];
}


export interface DroneParticipation {
  readonly droneId: string;
  readonly droneIndex: number;
  readonly role: DroneRole;
  /** Set for ACTIVE_FORMATION drones: the target group they belong to. */
  readonly groupId?: string;
  readonly formationPointIndex?: number;
  readonly formationPointId?: string;
  /** Deterministic position this drone flies to during the scene. */
  readonly target: Vector3Tuple;
  readonly reserveSlotIndex?: number;
  /** Formation this drone pre-positions for (PREPOSITION_NEXT only). */
  readonly prepositionFormationId?: string;
  readonly prepositionClipId?: string;
}

export interface ParticipationCounts {
  readonly fleet: number;
  readonly active: number;
  readonly preposition: number;
  readonly reserve: number;
  readonly hold: number;
  readonly manual: number;
}

export interface ParticipationLookAheadContext {
  readonly clipIds: readonly string[];
  readonly formationIds: readonly string[];
  /** Point count of the scene the preposition targets were taken from. */
  readonly usedPointCount: number;
  readonly usedClipId: string | null;
}

export interface ParticipationProvenance {
  readonly algorithmVersion: string;
  readonly costModelVersion: string;
  readonly solver: "exact" | "bounded";
  /** Digest of every input the plan depends on, look-ahead included. */
  readonly revision: string;
}

export interface FleetParticipationPlan {
  readonly clipId: string;
  readonly fleetSize: number;
  readonly policy: ParticipationPolicy;
  readonly activeGroups: readonly FormationTargetGroup[];
  /** One entry per fleet drone, ordered by drone index. */
  readonly drones: readonly DroneParticipation[];
  readonly counts: ParticipationCounts;
  readonly reserveZone: ReserveZoneConfig;
  readonly reserveLighting: ReserveLightingPolicy;
  readonly lookAhead: ParticipationLookAheadContext;
  readonly provenance: ParticipationProvenance;
  /** Non-fatal, machine-readable planner notes. */
  readonly warnings: readonly ParticipationWarning[];
}

export type ParticipationWarningCode =
  | "NO_FUTURE_TARGET"
  | "NO_PREPOSITION_BENEFIT"
  | "MANUAL_FALLBACK"
  | "RESERVE_ZONE_CLAMPED";

export interface ParticipationWarning {
  readonly code: ParticipationWarningCode;
  readonly message: string;
}

export type ParticipationErrorCode =
  | "FORMATION_TOO_LARGE"
  | "MANUAL_ACTIVE_COUNT_MISMATCH"
  | "UNKNOWN_DRONE"
  | "DUPLICATE_DRONE"
  | "MISSING_DRONE"
  | "INVALID_FLEET";

export class ParticipationError extends Error {
  readonly code: ParticipationErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: ParticipationErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ParticipationError";
    this.code = code;
    this.details = details;
  }
}

export function participationCounts(
  drones: readonly DroneParticipation[],
  fleetSize: number,
): ParticipationCounts {
  let active = 0;
  let preposition = 0;
  let reserve = 0;
  let hold = 0;
  let manual = 0;
  for (const d of drones) {
    switch (d.role) {
      case "ACTIVE_FORMATION":
        active++;
        break;
      case "PREPOSITION_NEXT":
        preposition++;
        break;
      case "RESERVE_FORMATION":
        reserve++;
        break;
      case "HOLD_CURRENT":
        hold++;
        break;
      case "USER_ASSIGNED":
        manual++;
        break;
    }
  }
  return { fleet: fleetSize, active, preposition, reserve, hold, manual };
}

/**
 * THE invariant: for fleet size N every drone id appears EXACTLY once — no
 * omissions, no duplicates, no implicitly unassigned drones.
 */
export function assertParticipationInvariant(plan: FleetParticipationPlan): void {
  const seen = new Set<string>();
  for (const d of plan.drones) {
    if (seen.has(d.droneId)) {
      throw new ParticipationError(
        "DUPLICATE_DRONE",
        `${d.droneId} appears more than once in the participation plan.`,
        { clipId: plan.clipId, droneId: d.droneId },
      );
    }
    seen.add(d.droneId);
  }
  if (seen.size !== plan.fleetSize) {
    throw new ParticipationError(
      "MISSING_DRONE",
      `The participation plan covers ${seen.size} of ${plan.fleetSize} drones.`,
      { clipId: plan.clipId, covered: seen.size, fleetSize: plan.fleetSize },
    );
  }
  const counts = plan.counts;
  const sum = counts.active + counts.preposition + counts.reserve + counts.hold + counts.manual;
  if (sum !== plan.fleetSize) {
    throw new ParticipationError(
      "MISSING_DRONE",
      `Role counts sum to ${sum} instead of the fleet size ${plan.fleetSize}.`,
      { clipId: plan.clipId, sum, fleetSize: plan.fleetSize },
    );
  }
}

/** Per-drone-index target positions, ready for the trajectory scheduler. */
export function participationTargets(plan: FleetParticipationPlan): Vector3Tuple[] {
  const out = new Array<Vector3Tuple>(plan.fleetSize).fill([0, 0, 0]);
  for (const d of plan.drones) out[d.droneIndex] = d.target;
  return out;
}

export function participationOf(
  plan: FleetParticipationPlan,
  droneIndex: number,
): DroneParticipation | undefined {
  return plan.drones[droneIndex]?.droneIndex === droneIndex
    ? plan.drones[droneIndex]
    : plan.drones.find((d) => d.droneIndex === droneIndex);
}

/** Brightness scale a non-active drone's choreography colour is multiplied by. */
export function reserveLightingScale(role: DroneRole, policy: ReserveLightingPolicy): number {
  if (role === "ACTIVE_FORMATION") return 1;
  switch (policy) {
    case "OFF":
      return 0;
    case "DIM":
      return 0.25;
    case "NORMAL":
    default:
      return 1;
  }
}

/** Merges partial user settings onto the canonical defaults. */
export function resolveParticipationSettings(
  settings?: Partial<ParticipationSettings> | null,
): ParticipationSettings {
  const base = DEFAULT_PARTICIPATION_SETTINGS;
  const zone = settings?.reserveZone;
  const lookAhead = settings?.lookAheadScenes;
  return {
    defaultPolicy: settings?.defaultPolicy ?? base.defaultPolicy,
    reserveLighting: settings?.reserveLighting ?? base.reserveLighting,
    lookAheadScenes:
      typeof lookAhead === "number" && Number.isFinite(lookAhead)
        ? Math.max(0, Math.min(4, Math.round(lookAhead)))
        : base.lookAheadScenes,
    reserveZone: zone
      ? {
          center: [
            Number.isFinite(zone.center?.[0]) ? zone.center[0] : base.reserveZone.center[0],
            Number.isFinite(zone.center?.[1]) ? zone.center[1] : base.reserveZone.center[1],
            Number.isFinite(zone.center?.[2]) ? zone.center[2] : base.reserveZone.center[2],
          ],
          orientationDeg: Number.isFinite(zone.orientationDeg) ? zone.orientationDeg : 0,
          spacing: Number.isFinite(zone.spacing) && zone.spacing > 0 ? zone.spacing : base.reserveZone.spacing,
          layout: zone.layout === "GRID" ? "GRID" : base.reserveZone.layout,
        }
      : base.reserveZone,
    ...(settings?.clips ? { clips: settings.clips } : {}),
  };
}

/** Effective policy and reserve zone for one clip. */
export function clipParticipation(
  settings: ParticipationSettings,
  clipId: string,
): { policy: ParticipationPolicy; reserveZone: ReserveZoneConfig; manual?: ManualParticipationOverride } {
  const clip = settings.clips?.[clipId];
  return {
    policy: clip?.policy ?? settings.defaultPolicy,
    reserveZone: clip?.reserveZone ?? settings.reserveZone,
    ...(clip?.manual ? { manual: clip.manual } : {}),
  };
}
