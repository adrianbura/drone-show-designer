/**
 * PROJECT FILE SIZE HARDENING — COMPACT CANONICAL SERIALIZATION.
 *
 * A real 150-drone imported ESSP project saved as ~142.7 MB with pretty JSON and
 * ~52 MB compact, for an identical semantic payload. The production serializer
 * (Save + Autosave) is now compact; pretty JSON survives only as an explicitly
 * named dev helper.
 *
 * This suite pins:
 *  - compact parse result deep-equals pretty parse result (field by field)
 *  - measurable size reduction on a real-shaped imported fixture
 *  - Source Recovery byte parity after a compact Save -> Open
 *  - reference RGB / positions / ownership parity after a compact Save -> Open
 *  - byte-identical output for two compact serializations with savedAt pinned
 */
import { describe, expect, it } from "vitest";

import { buildOriginalEsspDownload, hasEsspSourceBytes } from "@/lib/adapters/esspSourceRecovery";
import {
  intervalAtTime,
  referenceColorsAt,
  referencePositionsAt,
  reconcileReferenceLayer,
} from "@/lib/import/essp/native";
import {
  parseProjectFile,
  projectFileToJson,
  projectFileToPrettyJson,
  serializeProject,
} from "@/lib/project";
import {
  ACCEPTANCE_STRATEGY,
  customerShapedEsspArchive,
  importArchiveFixture,
  rebuildReference,
  FIXED_GENERATED_AT,
} from "./support/productionFixtures";

const FLEET = 12;
const SECONDS = 40;
const PLANNING = {
  assignmentStrategy: ACCEPTANCE_STRATEGY,
  transitionOverrides: {},
  transitionDesigns: {},
} as const;
const EDITOR = { showGround: false } as const;
const PROBES = [0, 1, 5, 12, 20, 30.5, SECONDS - 1] as const;

const enc = new TextEncoder();

describe("compact canonical project serialization", () => {
  it("is semantically identical to pretty JSON, smaller, and deterministic", async () => {
    const archive = customerShapedEsspArchive(FLEET, SECONDS);
    const imported = await importArchiveFixture(archive);

    const file = serializeProject(imported.project, {
      planning: PLANNING,
      referenceLayer: imported.layer,
      editor: EDITOR as never,
      savedAt: FIXED_GENERATED_AT,
    });

    const compact = projectFileToJson(file);
    const pretty = projectFileToPrettyJson(file);

    // 3. BYTE / SEMANTIC EQUIVALENCE — whole envelope, then the pinned fields.
    expect(JSON.parse(compact)).toEqual(JSON.parse(pretty));
    const compactParsed = parseProjectFile(compact);
    const prettyParsed = parseProjectFile(pretty);
    expect(compactParsed.project).toEqual(prettyParsed.project);
    expect(compactParsed.planning).toEqual(prettyParsed.planning);
    expect(compactParsed.planning?.transitionDesigns).toEqual(
      prettyParsed.planning?.transitionDesigns,
    );
    expect(compactParsed.planning?.transitionOverrides).toEqual(
      prettyParsed.planning?.transitionOverrides,
    );
    expect(compactParsed.editor).toEqual(prettyParsed.editor);
    expect(compactParsed.referenceLayer).toEqual(prettyParsed.referenceLayer);
    expect(compactParsed.referenceLayer?.showHash).toBe(imported.layer.showHash);
    expect(compactParsed.referenceLayer!.drones.map((d) => d.fileName)).toEqual(
      imported.layer.drones.map((d) => d.fileName),
    );
    expect(compactParsed.referenceLayer!.drones.map((d) => d.fileBase64)).toEqual(
      imported.layer.drones.map((d) => d.fileBase64),
    );
    expect(compactParsed.referenceLayer!.bindings.map((b) => `${b.clipId}:${b.signature}:${b.owner}`)).toEqual(
      imported.layer.bindings.map((b) => `${b.clipId}:${b.signature}:${b.owner}`),
    );

    // 6. FILE SIZE ACCEPTANCE (reported for the real-shaped fixture).
    const compactBytes = enc.encode(compact).length;
    const prettyBytes = enc.encode(pretty).length;
    expect(compactBytes).toBeLessThan(prettyBytes);
    const reduction = 1 - compactBytes / prettyBytes;
    expect(reduction).toBeGreaterThan(0.1);
    // Source bytes are NOT dropped as part of the reduction.
    const storedBase64 = compactParsed.referenceLayer!.drones.reduce(
      (sum, d) => sum + (d.fileBase64?.length ?? 0),
      0,
    );
    expect(storedBase64).toBeGreaterThan(0);
    console.log(
      `[compact serialization] pretty=${prettyBytes}B compact=${compactBytes}B ` +
        `saved=${prettyBytes - compactBytes}B (${(reduction * 100).toFixed(1)}%)`,
    );

    // 7. DETERMINISM — savedAt pinned, two serializations are byte-identical.
    const again = projectFileToJson(
      serializeProject(imported.project, {
        planning: PLANNING,
        referenceLayer: imported.layer,
        editor: EDITOR as never,
        savedAt: FIXED_GENERATED_AT,
      }),
    );
    expect(again).toBe(compact);

    // 4/5. Compact Save -> Open keeps source bytes, RGB, positions and ownership.
    const reopened = rebuildReference(compactParsed.referenceLayer!);
    const reconciled = reconcileReferenceLayer(compactParsed.project, reopened.layer, {
      assignmentStrategy: PLANNING.assignmentStrategy,
      transitionOverrides: {},
    });
    expect(reconciled.promotions).toEqual([]);

    for (const t of PROBES) {
      expect(referenceColorsAt(reopened.show, reconciled.layer, t, FLEET)).toEqual(
        referenceColorsAt(imported.show, imported.layer, t, FLEET),
      );
      expect(referencePositionsAt(reopened.show, t, FLEET)).toEqual(
        referencePositionsAt(imported.show, t, FLEET),
      );
      expect(intervalAtTime(reconciled.layer, t)?.owner).toBe(
        intervalAtTime(imported.layer, t)?.owner,
      );
    }

    expect(hasEsspSourceBytes(reopened.layer)).toBe(true);
    const recovery = buildOriginalEsspDownload({
      projectName: compactParsed.project.name,
      layer: reopened.layer,
    });
    expect(recovery.ok).toBe(true);
    expect(recovery.files.length).toBe(FLEET);
    recovery.files.forEach((f, i) => {
      expect(Array.from(f.bytes)).toEqual(Array.from(archive[i]!.bytes));
    });
  });
});
