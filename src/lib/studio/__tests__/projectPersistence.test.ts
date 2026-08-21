import { describe, expect, it } from "vitest";

import { projectPersistenceOptions } from "../projectPersistence";

const override = {
  targetPointIndex: [0, 1],
  startOffsets: [0, 0],
  laneOffsets: [0, 0],
  strategy: "nearestNeighbor",
};

describe("project persistence authority", () => {
  it("preserves planning intent identically for every writer", () => {
    const options = projectPersistenceOptions({
      assignmentStrategy: "nearestNeighbor",
      transitionOverrides: { clipA: override },
      transitionDesigns: {
        clipA: {
          mode: "MANUAL",
          autoRecalculate: false,
          stagger: { enabled: true, amount: 0.2 },
        },
      } as never,
      referenceLayer: null,
      selectedClipId: "clipA",
      sampleRate: 12,
    });

    expect(options.planning.assignmentStrategy).toBe("nearestNeighbor");
    expect(options.planning.transitionOverrides).toEqual({ clipA: override });
    expect(options.planning.transitionDesigns).toHaveProperty("clipA");
    expect(options.editor).toEqual({ selectedClipId: "clipA", sampleRate: 12 });
    expect(options.referenceLayer).toBeNull();
  });

  it("copies mutable planning maps so persistence preparation is non-mutating", () => {
    const overrides = { clipA: override };
    const designs = {};
    const options = projectPersistenceOptions({
      assignmentStrategy: "nearestNeighbor",
      transitionOverrides: overrides,
      transitionDesigns: designs,
      referenceLayer: null,
      selectedClipId: null,
      sampleRate: 10,
    });

    expect(options.planning.transitionOverrides).not.toBe(overrides);
    expect(options.planning.transitionDesigns).not.toBe(designs);
    expect(overrides).toEqual({ clipA: override });
    expect(designs).toEqual({});
  });
});
