/**
 * RICH SAVE / OPEN ROUND TRIP (audit section R).
 *
 * One project containing fleet setup, pre-show, a partial formation, a
 * multi-object scene, a dynamic formation, lighting, markers, sections,
 * participation policy and audio metadata — serialized and re-parsed.
 *
 * Ephemeral by design (documented, not a loss):
 *   - raw audio bytes (only `audio` metadata is persisted; the operator
 *     re-attaches the file — `audio.attached` is intentionally not truth after
 *     reload)
 *   - every derived plan (show plan, participation plan, validation result)
 */
import { describe, expect, it } from "vitest";

import { buildComplexProject } from "./fixtures";
import { participationForClip } from "./invariants";
import { parseProjectFile, projectFileToJson, serializeProject } from "@/lib/project";
import { buildShowPlan } from "../../trajectory/schedule";
import type { ShowProject } from "../../types";

function roundTrip(project: ShowProject): ShowProject {
  return parseProjectFile(projectFileToJson(serializeProject(project))).project;
}

const original: ShowProject = {
  ...buildComplexProject(200, 150).project,
  audio: { name: "audit.mp3", bpm: 128, offset: 0.25, duration: 180, attached: true },
};

describe("rich project round trip", () => {
  const reopened = roundTrip(original);

  it("preserves fleet, area, limits and altitudes", () => {
    expect(reopened.droneCount).toBe(200);
    expect(reopened.area).toEqual(original.area);
    expect(reopened.limits).toEqual(original.limits);
    expect(reopened.altitudes).toEqual(original.altitudes);
    expect(reopened.seed).toBe(original.seed);
  });

  it("preserves timeline timing and phases exactly", () => {
    expect(reopened.timeline.map((c) => [c.id, c.start, c.transition, c.hold, c.phase ?? "SHOW"])).toEqual(
      original.timeline.map((c) => [c.id, c.start, c.transition, c.hold, c.phase ?? "SHOW"]),
    );
  });

  it("preserves formation geometry including the SVG source and exact counts", () => {
    expect(reopened.formations.map((f) => [f.id, f.points.length])).toEqual(
      original.formations.map((f) => [f.id, f.points.length]),
    );
    const svg = reopened.formations.find((f) => f.id === "f-logo")!;
    expect(svg.kind).toBe("svg");
    expect(svg.svg).toBeTruthy();
    expect(reopened.formations.find((f) => f.id === "f-pigeon")!.points).toEqual(
      original.formations.find((f) => f.id === "f-pigeon")!.points,
    );
  });

  it("preserves pre-show, participation, markers and music sections", () => {
    expect(reopened.preShow?.enabled).toBe(true);
    expect(reopened.preShow).toEqual(original.preShow);
    expect(reopened.participation).toEqual(original.participation);
    expect(reopened.markers).toEqual(original.markers);
    expect(reopened.musicSections).toEqual(original.musicSections);
  });

  it("preserves multi-object scenes and dynamic formations", () => {
    expect(reopened.scenes?.length).toBe(original.scenes?.length);
    const scene2 = reopened.scenes!.find((s) => s.id === "scene-2")!;
    expect(scene2.objects).toHaveLength(2);
    expect(scene2.objects.map((o) => o.requestedDroneCount ?? null)).toEqual([80, 40]);
    expect(reopened.dynamicFormations).toEqual(original.dynamicFormations);
  });

  it("preserves the lighting program", () => {
    expect(reopened.lighting?.effects.length).toBe(original.lighting?.effects.length);
    expect(reopened.lighting).toEqual(original.lighting);
  });

  it("persists audio metadata (attachment flag survives — see BUG-A1)", () => {
    expect(reopened.audio.name).toBe("audit.mp3");
    expect(reopened.audio.bpm).toBe(128);
    expect(reopened.audio.offset).toBeCloseTo(0.25, 6);
    expect(reopened.audio.duration).toBe(180);
    // AUDIT FINDING (BUG-A1, LOW): `attached` is persisted verbatim, so a
    // reopened project claims an attached track although audio bytes are never
    // stored. Pinned to CURRENT behaviour on purpose — reported, not fixed.
    expect(reopened.audio.attached).toBe(true);
  });

  it("replans identically after reopening", () => {
    const a = buildShowPlan(original);
    const b = buildShowPlan(reopened);
    expect(b.drones.map((d) => d.id)).toEqual(a.drones.map((d) => d.id));
    expect(b.schedules.map((s) => s.segments.length)).toEqual(a.schedules.map((s) => s.segments.length));
    expect(b.errors).toEqual(a.errors);
    const pa = participationForClip(original, original.timeline[1]!);
    const pb = participationForClip(reopened, reopened.timeline[1]!);
    expect(pb.drones.map((d) => `${d.droneId}:${d.role}`)).toEqual(pa.drones.map((d) => `${d.droneId}:${d.role}`));
    expect(pb.provenance.revision).toBe(pa.provenance.revision);
  });

  it("is stable across a second round trip", () => {
    expect(roundTrip(reopened)).toEqual(reopened);
  });
});
