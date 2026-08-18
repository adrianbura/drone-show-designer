import { describe, expect, it } from "vitest";

import { defaultPhaseForNewClip } from "@/lib/show/timeline";
import { suggestedProjectFileName } from "@/lib/project";
import type { TimelineClip } from "@/lib/show/types";

function clip(id: string, phase: TimelineClip["phase"], start: number): TimelineClip {
  return {
    id,
    formationId: "f1",
    start,
    transition: 8,
    hold: 6,
    easing: "minJerk",
    color: [120, 220, 255],
    effect: "solid",
    phase,
  };
}

describe("canonical new-clip phase", () => {
  it("returns TAKEOFF for an empty timeline (addClip / SVG commit / dynamic clip)", () => {
    expect(defaultPhaseForNewClip([])).toBe("TAKEOFF");
  });

  it("returns SHOW once the timeline has content", () => {
    expect(defaultPhaseForNewClip([clip("c1", "TAKEOFF", 0)])).toBe("SHOW");
    expect(defaultPhaseForNewClip([clip("c1", "TAKEOFF", 0), clip("c2", "SHOW", 14)])).toBe("SHOW");
  });

  it("still returns SHOW when only a LANDING clip exists, so LANDING stays final", () => {
    const timeline = [clip("c1", "TAKEOFF", 0), clip("cL", "LANDING", 20)];
    expect(defaultPhaseForNewClip(timeline)).toBe("SHOW");
    const body = timeline.filter((c) => c.phase !== "LANDING");
    const landing = timeline.filter((c) => c.phase === "LANDING");
    const inserted = clip("c9", defaultPhaseForNewClip(timeline), 14);
    const next = [...body, inserted, ...landing.map((c) => ({ ...c, start: c.start + 14 }))];
    expect(next[next.length - 1]!.phase).toBe("LANDING");
  });

  it("uses the canonical project file extension", () => {
    expect(suggestedProjectFileName("Sprint Show")).toBe("sprint-show.droneshow.json");
    expect(suggestedProjectFileName("Sprint Show").endsWith(".droneshow.json")).toBe(true);
  });
});
