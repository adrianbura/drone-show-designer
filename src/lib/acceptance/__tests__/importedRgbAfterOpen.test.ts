/**
 * REGRESSION: IMPORTED LED AUTHORITY MUST SURVIVE SAVE -> OPEN.
 *
 * Reported as "the imported show turns WHITE after reopening a saved project".
 * The archive that produced the report is private customer material, so this
 * suite pins the SHAPE of that archive (near-white dominated LED track, black
 * blackouts, one held colour per 12 Hz frame, multi-clip extraction with scene
 * assets and dynamic formations) instead of the bytes, and asserts the LED
 * authority chain end to end:
 *
 *   referenceColorsAt -> reference light states -> generated export RGB
 *
 * A regression cannot hide behind a white-looking show: every probe compares
 * the reopened value against the pre-save value, including exact RGB transition
 * boundaries on the independent colour clock.
 */
import { describe, expect, it } from "vitest";

import { buildOriginalEsspDownload, hasEsspSourceBytes } from "@/lib/adapters/esspSourceRecovery";
import { buildEsspExportPackage } from "@/lib/adapters/esspExport";
import { parseEssp } from "@/lib/import/essp/codec";
import {
  intervalAtTime,
  reconcileReferenceLayer,
  referenceColorsAt,
  referenceLightStates,
} from "@/lib/import/essp/native";
import type { ReferenceTrajectoryLayer } from "@/lib/import/essp/native/types";
import type { ReferenceShow } from "@/lib/import/essp/types";
import {
  ACCEPTANCE_STRATEGY,
  customerShapedEsspArchive,
  importArchiveFixture,
  planFor,
  rebuildReference,
  saveAndReopen,
  validate,
  forcedReady,
  SOURCE_RGB_RATE_HZ,
} from "./support/productionFixtures";

const FLEET = 12;
const SECONDS = 40;
const PLANNING = {
  assignmentStrategy: ACCEPTANCE_STRATEGY,
  transitionOverrides: {},
  transitionDesigns: {},
} as const;

/** Early / mid / late frames plus both sides of RGB transition boundaries. */
const PROBES = [
  0,
  1 / SOURCE_RGB_RATE_HZ,
  0.999,
  1,
  1.001,
  5,
  11.999,
  12,
  20,
  30.5,
  SECONDS - 1,
] as const;

function colourFingerprint(
  show: ReferenceShow | null,
  layer: ReferenceTrajectoryLayer | null,
  fleet: number,
) {
  return PROBES.map((t) => ({
    t,
    owner: layer ? (intervalAtTime(layer, t)?.owner ?? null) : null,
    colors: referenceColorsAt(show, layer, t, fleet),
    states: show ? referenceLightStates(show, t, fleet) : null,
  }));
}

describe("imported LED authority survives save -> open (customer-shaped archive)", () => {
  it("keeps the imported RGB, ownership and export colours byte-identical", async () => {
    const archive = customerShapedEsspArchive(FLEET, SECONDS);
    const imported = await importArchiveFixture(archive);

    // The fixture must really be a white-dominated show, otherwise a lost LED
    // authority (which renders white) would be indistinguishable from success.
    const before = colourFingerprint(imported.show, imported.layer, imported.project.droneCount);
    expect(before.every((p) => p.owner === "REFERENCE")).toBe(true);
    expect(before.every((p) => p.colors !== null)).toBe(true);
    const flat = before.flatMap((p) => p.colors ?? []);
    expect(flat.some((c) => c[0] > 240 && c[1] > 240 && c[2] > 240)).toBe(true);
    expect(flat.some((c) => c[0] === 0 && c[1] === 0 && c[2] === 0)).toBe(true);
    expect(flat.some((c) => c[1] > 200 && c[0] < 40)).toBe(true);
    // Extraction shape of the real report: many clips, dynamic groups, assets.
    expect(imported.project.timeline.length).toBeGreaterThan(1);

    const saved = saveAndReopen({
      project: imported.project,
      planning: PLANNING,
      referenceLayer: imported.layer,
    });
    expect(saved.referenceLayer).not.toBeNull();
    const reopened = rebuildReference(saved.referenceLayer!);

    // No silent promotion: reopening must not change ownership of any interval.
    const reconciled = reconcileReferenceLayer(saved.project, reopened.layer, {
      assignmentStrategy: PLANNING.assignmentStrategy,
      transitionOverrides: {},
    });
    expect(reconciled.promotions).toEqual([]);
    expect(reopened.layer.showHash).toBe(imported.layer.showHash);
    expect(reopened.layer.bindings.map((b) => `${b.clipId}:${b.signature}`)).toEqual(
      imported.layer.bindings.map((b) => `${b.clipId}:${b.signature}`),
    );
    expect(reopened.layer.bindings.map((b) => b.owner)).toEqual(
      imported.layer.bindings.map((b) => b.owner),
    );
    expect(saved.project.timeline.map((c) => c.id)).toEqual(
      imported.project.timeline.map((c) => c.id),
    );

    // LED authority, field by field, at every probe (never white fallback).
    const after = colourFingerprint(
      reopened.show,
      reconciled.layer,
      saved.project.droneCount,
    );
    expect(after).toEqual(before);

    // Source recovery stays byte exact after the reopen.
    expect(hasEsspSourceBytes(reopened.layer)).toBe(true);
    const recovery = buildOriginalEsspDownload({
      projectName: saved.project.name,
      layer: reopened.layer,
    });
    expect(recovery.ok).toBe(true);
    expect(recovery.files.length).toBe(FLEET);
    recovery.files.forEach((file, i) => {
      expect(Array.from(file.bytes)).toEqual(Array.from(archive[i]!.bytes));
    });

    // Generated export writes the imported RGB, not an authored/white fallback.
    const plan = planFor(saved.project);
    const pkg = buildEsspExportPackage({
      project: saved.project,
      plan,
      reference: { show: reopened.show, layer: reconciled.layer },
      fullShow: forcedReady(
        validate(saved.project, { show: reopened.show, layer: reconciled.layer }),
      ),
      fullShowStale: false,
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(pkg.ok).toBe(true);
    expect(pkg.files.length).toBe(FLEET);
    const exported = parseEssp(pkg.files[0]!.bytes);
    const droneZero = referenceLightStates(reopened.show, 0, saved.project.droneCount)[0]!;
    expect([exported.rgb[0], exported.rgb[1], exported.rgb[2]]).toEqual([
      droneZero.r,
      droneZero.g,
      droneZero.b,
    ]);
    const frame = 5 * SOURCE_RGB_RATE_HZ;
    const at5 = referenceLightStates(reopened.show, 5, saved.project.droneCount)[0]!;
    expect([
      exported.rgb[frame * 3],
      exported.rgb[frame * 3 + 1],
      exported.rgb[frame * 3 + 2],
    ]).toEqual([at5.r, at5.g, at5.b]);
  });
});
