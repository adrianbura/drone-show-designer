import { describe, expect, it } from "vitest";

import { minJerkPlanner, planHold } from "../trajectory/planner";
import { withLateralLane } from "../trajectory/offsets";
import { sampleScheduleBoundaryAt, type DroneSchedule } from "../trajectory/schedule";

const plan = (startVelocity = [1, 0.5, -0.25] as const, endVelocity = [-0.5, 0, 0.75] as const) =>
  minJerkPlanner.plan({
    start: [0, 10, 0],
    end: [20, 15, 5],
    startVelocity,
    endVelocity,
    duration: 8,
    maxVelocity: 20,
    maxAcceleration: 10,
    maxJerk: 20,
    yawPolicy: { kind: "fixed", yaw: 0 },
    easing: "minJerk",
  });

describe("trajectory boundary constraints", () => {
  it("matches imposed endpoint positions and velocities", () => {
    const trajectory = plan();
    expect(trajectory.sample(0).position).toEqual([0, 10, 0]);
    expect(trajectory.sample(0).velocity).toEqual([1, 0.5, -0.25]);
    const end = trajectory.sample(8);
    end.position.forEach((value, axis) => expect(value).toBeCloseTo([20, 15, 5][axis]!, 9));
    end.velocity.forEach((value, axis) => expect(value).toBeCloseTo([-0.5, 0, 0.75][axis]!, 9));
  });

  it("selects the segment on the right at a shared schedule boundary", () => {
    const left = planHold([0, 10, 0], 5);
    const right = plan();
    const schedule: DroneSchedule = {
      droneId: "DRN-001",
      index: 0,
      segments: [
        { start: 0, end: 5, clipId: "left", phase: "SHOW", kind: "hold", planned: left },
        { start: 5, end: 13, clipId: "right", phase: "SHOW", kind: "transition", planned: right },
      ],
    };
    expect(sampleScheduleBoundaryAt(schedule, [0, 0, 0], 5, "right").velocity).toEqual([
      1, 0.5, -0.25,
    ]);
  });

  it("adds a lateral waypoint without changing either splice boundary", () => {
    const base = plan();
    const detour = withLateralLane(base, 6, [0, 10, 0], [20, 15, 5]);
    for (const time of [0, 8]) {
      const expected = base.sample(time);
      const actual = detour.sample(time);
      actual.position.forEach((value, axis) =>
        expect(value).toBeCloseTo(expected.position[axis]!, 9),
      );
      actual.velocity.forEach((value, axis) =>
        expect(value).toBeCloseTo(expected.velocity[axis]!, 9),
      );
      actual.acceleration.forEach((value, axis) =>
        expect(value).toBeCloseTo(expected.acceleration[axis]!, 9),
      );
    }
    expect(detour.sample(4).position).not.toEqual(base.sample(4).position);
  });
});
