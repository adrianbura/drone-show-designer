import { describe, expect, it } from "vitest";

import { clipAuthoringPhaseAtOffset } from "../clipAuthoringPhase";

describe("clip authoring phase", () => {
  it("maps the incoming transition to formation and the hold to display", () => {
    expect(clipAuthoringPhaseAtOffset(8, 12, 0)).toBe("FORMATION");
    expect(clipAuthoringPhaseAtOffset(8, 12, 7.999)).toBe("FORMATION");
    expect(clipAuthoringPhaseAtOffset(8, 12, 8)).toBe("DISPLAY");
    expect(clipAuthoringPhaseAtOffset(8, 12, 20)).toBe("DISPLAY");
  });

  it("is deterministic for clamped and malformed offsets", () => {
    expect(clipAuthoringPhaseAtOffset(5, 5, -100)).toBe("FORMATION");
    expect(clipAuthoringPhaseAtOffset(5, 5, Number.NaN)).toBe("FORMATION");
    expect(clipAuthoringPhaseAtOffset(0, 5, 0)).toBe("DISPLAY");
  });
});
