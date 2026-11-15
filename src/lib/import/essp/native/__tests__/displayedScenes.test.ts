/** "Make editable" must yield one clip per scene displayed on the timeline. */
import { describe, expect, it } from "vitest";

import { buildSyntheticEssp } from "../../codec";
import { buildReferenceShow } from "../../reference";
import { analyzeReferenceShow } from "../../forensics/report";
import { displayedSceneSegments, extractReferenceTimeline } from "../extract";

const RATE = 8;

async function show() {
  const files = Array.from({ length: 6 }, (_, i) => {
    const xyz: number[][] = [];
    const x = (i % 3) * 500;
    const y = Math.floor(i / 3) * 500;
    for (let f = 0; f < 70 * RATE; f += 1) xyz.push([x, y, 3000]);
    return {
      name: `${i + 1}.essp`,
      bytes: buildSyntheticEssp({ xyz, rgb: xyz.map(() => [200, 40, 90]) }),
    };
  });
  return buildReferenceShow(files);
}

describe("displayed scenes = editable clips", () => {
  it("keeps short scenes and matches displayed boundaries exactly", async () => {
    const s = await show();
    const report = analyzeReferenceShow(s);
    const base = report.segments.find((x) => x.classification === "STATIC_FORMATION")!;
    report.takeoffInterval = null as never;
    report.landingInterval = null as never;
    const seg = (id: string, start: number, end: number) => ({
      ...base,
      id,
      startTime: start,
      endTime: end,
      duration: end - start,
    });
    report.segments = [
      seg("a", 10, 30),
      seg("b", 29.75, 30.75), // 1 s, overlaps by 0.25 s
      { ...seg("t", 30.5, 33), classification: "FORMATION_TRANSITION" as const },
      seg("c", 33, 35.5), // 2.5 s
      seg("d", 35.25, 55),
    ];
    const displayed = displayedSceneSegments(report);
    expect(displayed.map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
    const result = extractReferenceTimeline(s, report, { decomposeScenes: false });
    const shows = result.timeline.filter((c) => c.phase === "SHOW");
    expect(shows).toHaveLength(4);
    let prevEnd = displayed[0]!.startTime;
    shows.forEach((clip, k) => {
      const d = displayed[k]!;
      const end = clip.start + clip.transition + clip.hold;
      expect(end).toBeCloseTo(d.endTime, 3);
      expect(clip.start).toBeCloseTo(k === 0 ? d.startTime : prevEnd, 3);
      expect(clip.start + clip.transition).toBeCloseTo(Math.max(d.startTime, clip.start + 0.001), 3);
      prevEnd = end;
    });
  });
});
