/**
 * SimulationPackage builder.
 *
 * Derives a versioned, immutable, single-drone simulation package from the
 * canonical studio artefacts (project + ShowPlan + composed TrajectorySet +
 * full-show validation provenance).
 *
 * The mutable UI state is NEVER sent to the bridge; only this documented
 * package. Building a package does not modify the show in any way.
 */
import { ASSIGNMENT_ALGORITHM_VERSION } from "../show/assignment";
import { CONFLICT_DETECTION_VERSION } from "../show/conflicts";
import { COORDINATE_SYSTEM } from "../show/coordinates";
import { droneIndexFromId } from "../show/drones";
import { TRANSITION_OPTIMIZER_VERSION } from "../show/transition";
import type { FullShowValidationReport } from "../show/fullshow/types";
import type { ShowPlan, TrajectorySet } from "../show/trajectory";
import type { ShowProject, Vector3Tuple } from "../show/types";
import { simulationPayloadHash } from "./hash";
import {
  SIMULATION_CLIENT_VERSION,
  SIMULATION_PACKAGE_SCHEMA,
  SIMULATION_PACKAGE_SCHEMA_VERSION,
  type PackageValidationState,
  type SimulationPackage,
  type SimulationSample,
  type SimulationValidationProvenance,
} from "./types";

export interface BuildSimulationPackageInput {
  readonly project: ShowProject;
  readonly plan: ShowPlan;
  readonly set: TrajectorySet;
  /** Stable drone id, e.g. "DRN-001". Exactly one drone per Sprint 5 run. */
  readonly droneId: string;
  readonly analysisRevision: string;
  readonly fullShow?: FullShowValidationReport | null;
  readonly fullShowStale?: boolean;
}

export class SimulationPackageError extends Error {
  readonly code: "DRONE_NOT_FOUND" | "TRAJECTORY_EMPTY";
  constructor(code: "DRONE_NOT_FOUND" | "TRAJECTORY_EMPTY", message: string) {
    super(message);
    this.name = "SimulationPackageError";
    this.code = code;
  }
}

/**
 * Maps full-show validation provenance onto the simulation validation gate.
 * Absence of a report is UNVALIDATED — never optimistically "validated".
 */
export function deriveValidationState(
  report: FullShowValidationReport | null | undefined,
  stale: boolean | undefined,
  analysisRevision: string,
): PackageValidationState {
  if (!report) return "UNVALIDATED";
  if (stale || report.analysisRevision !== analysisRevision) return "STALE_VALIDATION";
  if (report.status === "FAIL") return "FAILED_VALIDATION";
  if (report.status === "PASS_WITH_WARNINGS") return "VALIDATED_WITH_WARNINGS";
  return "VALIDATED";
}

function provenance(
  report: FullShowValidationReport | null | undefined,
  stale: boolean | undefined,
  analysisRevision: string,
): SimulationValidationProvenance {
  const state = deriveValidationState(report, stale, analysisRevision);
  return {
    state,
    fullShowStatus: report?.status ?? null,
    statement: report?.statement ?? null,
    stale: state === "STALE_VALIDATION",
    exportReadiness: report?.exportReadiness.status ?? null,
    errorCount: report?.errors.length ?? 0,
    warningCount: report?.warnings.length ?? 0,
    engineVersion: report?.engineVersion ?? null,
  };
}

export function buildSimulationPackage({
  project,
  plan,
  set,
  droneId,
  analysisRevision,
  fullShow,
  fullShowStale,
}: BuildSimulationPackageInput): SimulationPackage {
  const index = plan.drones.findIndex((d) => d.id === droneId);
  if (index < 0) {
    throw new SimulationPackageError("DRONE_NOT_FOUND", `Unknown drone id ${droneId}`);
  }
  const definition = plan.drones[index]!;
  const trajectory = set.drones.find((d) => d.droneId === droneId) ?? set.drones[index];
  const samples: SimulationSample[] = (trajectory?.samples ?? []).map((s) => ({
    t: s.t,
    p: [s.position[0], s.position[1], s.position[2]] as const,
    v: [s.velocity[0], s.velocity[1], s.velocity[2]] as const,
  }));
  if (samples.length < 2) {
    throw new SimulationPackageError(
      "TRAJECTORY_EMPTY",
      `Drone ${droneId} has no sampled trajectory — compose the show first`,
    );
  }

  const startTime = samples[0]!.t;
  const endTime = samples[samples.length - 1]!.t;
  const engineVersion = fullShow?.engineVersion ?? null;
  const showPackageId = fullShow?.showPackageId ?? `${analysisRevision}@unvalidated`;

  const pkgWithoutHash = {
    schema: SIMULATION_PACKAGE_SCHEMA,
    schemaVersion: SIMULATION_PACKAGE_SCHEMA_VERSION,
    generator: "Drone Show Studio",
    clientVersion: SIMULATION_CLIENT_VERSION,
    showPackageId,
    analysisRevision,
    projectId: project.id,
    projectName: project.name,
    coordinateSystem: {
      id: COORDINATE_SYSTEM.id,
      axes: { ...COORDINATE_SYSTEM.axes },
      handedness: COORDINATE_SYSTEM.handedness,
      altitudeAxis: "y" as const,
    },
    sampleRate: set.sampleRate,
    showTimeZero: 0 as const,
    operationalTiming: {
      firstPlayableShowTime: plan.startTime,
      showStartOperationalTime: plan.showStartOperationalTime,
      includesPreShow: startTime < 0,
    },
    algorithmVersions: fullShow
      ? { ...fullShow.algorithmVersions }
      : {
          schema: String(project.versions.schemaVersion),
          trajectory: set.algorithmVersion,
          assignment: ASSIGNMENT_ALGORITHM_VERSION,
          optimizer: TRANSITION_OPTIMIZER_VERSION,
          conflictDetection: CONFLICT_DETECTION_VERSION,
          ...(engineVersion ? { fullShowEngine: engineVersion } : {}),
        },
    validationProvenance: provenance(fullShow, fullShowStale, analysisRevision),
    trajectory: {
      droneId: definition.id,
      droneIndex: definition.index >= 0 ? definition.index : droneIndexFromId(droneId),
      homePosition: [...definition.homePosition] as Vector3Tuple,
      sampleCount: samples.length,
      startTime,
      endTime,
      duration: endTime - startTime,
      samples,
    },
  };

  return {
    ...pkgWithoutHash,
    payloadHash: simulationPayloadHash({
      schemaVersion: pkgWithoutHash.schemaVersion,
      showPackageId,
      analysisRevision,
      droneId: definition.id,
      sampleRate: set.sampleRate,
      samples,
    }),
  };
}

export function serializeSimulationPackage(pkg: SimulationPackage): string {
  return JSON.stringify(pkg, null, 2);
}
