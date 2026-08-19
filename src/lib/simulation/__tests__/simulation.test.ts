import { describe, expect, it } from "vitest";

import { createDemoProject } from "@/lib/show/defaultProject";
import { buildShowPlan, sampleTrajectorySet } from "@/lib/show/trajectory";
import { simulationPayloadHash } from "../hash";
import {
  assertShowSimulationRunnable,
  buildSimulationPackage,
  deriveValidationState,
  isShowSimulationRunnable,
  SimulationPackageError,
} from "../package";
import { BRIDGE_PATHS } from "../api";

function fixture() {
  const project = createDemoProject(12);
  const plan = buildShowPlan(project);
  const set = sampleTrajectorySet(plan, { sampleRate: 10 });
  return { project, plan, set };
}

describe("simulation package", () => {
  it("extracts exactly one drone and stamps a payload hash", () => {
    const { project, plan, set } = fixture();
    const droneId = plan.drones[0]!.id;
    const pkg = buildSimulationPackage({
      project,
      plan,
      set,
      droneId,
      analysisRevision: "rev-1",
    });
    expect(pkg.trajectory.droneId).toBe(droneId);
    expect(pkg.trajectory.samples.length).toBeGreaterThan(1);
    expect(pkg.coordinateSystem.altitudeAxis).toBe("y");
    expect(pkg.payloadHash).toMatch(/^sph-[0-9a-f]{8}-[0-9a-f]{8}$/);
  });

  it("is deterministic for identical inputs", () => {
    const { project, plan, set } = fixture();
    const droneId = plan.drones[1]!.id;
    const input = { project, plan, set, droneId, analysisRevision: "rev-1" };
    expect(buildSimulationPackage(input).payloadHash).toBe(
      buildSimulationPackage(input).payloadHash,
    );
  });

  it("rejects an unknown drone id", () => {
    const { project, plan, set } = fixture();
    expect(() =>
      buildSimulationPackage({ project, plan, set, droneId: "DRN-999999", analysisRevision: "r" }),
    ).toThrow(SimulationPackageError);
  });

  it("hash changes when a sample moves", () => {
    const args = {
      schemaVersion: 1,
      showPackageId: "s",
      analysisRevision: "r",
      droneId: "DRN-001",
      sampleRate: 25,
      samples: [
        { t: 0, p: [0, 2, 0] as const },
        { t: 0.04, p: [0, 2, 0] as const },
      ],
    };
    const moved = {
      ...args,
      samples: [args.samples[0]!, { t: 0.04, p: [0, 2.5, 0] as const }],
    };
    expect(simulationPayloadHash(args)).not.toBe(simulationPayloadHash(moved));
  });
});

describe("validation gate", () => {
  it("treats a missing report as unvalidated", () => {
    expect(deriveValidationState(null, false, "rev")).toBe("UNVALIDATED");
  });

  it("treats a revision mismatch as stale", () => {
    const report = { status: "PASS", analysisRevision: "other" } as never;
    expect(deriveValidationState(report, false, "rev")).toBe("STALE_VALIDATION");
  });

  it("allows only validated show trajectories to start", () => {
    expect(isShowSimulationRunnable("VALIDATED")).toBe(true);
    expect(isShowSimulationRunnable("VALIDATED_WITH_WARNINGS")).toBe(true);
    for (const state of ["UNVALIDATED", "STALE_VALIDATION", "FAILED_VALIDATION"] as const) {
      expect(isShowSimulationRunnable(state)).toBe(false);
      expect(() => assertShowSimulationRunnable(state)).toThrowError(
        expect.objectContaining({ code: "VALIDATION_REQUIRED" }),
      );
    }
    expect(() => assertShowSimulationRunnable("VALIDATED")).not.toThrow();
    expect(() => assertShowSimulationRunnable("VALIDATED_WITH_WARNINGS")).not.toThrow();
  });
});

describe("bridge surface", () => {
  it("exposes no vehicle command endpoints", () => {
    const paths = Object.values(BRIDGE_PATHS)
      .map((p) => (typeof p === "function" ? p("x") : p))
      .join(" ");
    for (const forbidden of ["arm", "takeoff", "land", "goto", "mavlink"]) {
      expect(paths).not.toContain(forbidden);
    }
  });
});
