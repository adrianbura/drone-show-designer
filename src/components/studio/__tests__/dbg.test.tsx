// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { importedFixture } from "@/lib/studio/__tests__/support/geometryApplyHarness";
import { previewTextFormation } from "@/lib/studio/textFormationPreview";
import { buildTextCandidateProject } from "@/lib/studio/textFormationApplyCommand";
import { makeTextRecipe } from "@/lib/show/text";
import { analyzeGeometryProposalConsequences, evaluateGeometryApplyReadiness, evaluateGeometryTrajectoryConsequence } from "@/lib/show/diagnostics";

describe("dbg", () => {
  it("readiness", async () => {
    const { project } = await importedFixture();
    const clip = project.timeline[Math.floor(project.timeline.length / 2)]!;
    const f = project.formations.find((x) => x.id === clip.formationId)!;
    const recipe = makeTextRecipe({ text: "RALLY", weight: "REGULAR", style: "UPRIGHT", widthMeters: 140, heightMeters: 40, centerAltitudeMeters: 50, letterSpacingEm: 0.8, alignment: "CENTER", participation: f.points.length, outlineRatio: 0.7, bandOffsetEm: 0.35, seed: 1 });
    const p = previewTextFormation(project, { clipId: clip.id, recipe });
    if (!p.ok) throw new Error(JSON.stringify(p));
    const pre = analyzeGeometryProposalConsequences({ before: f.points, after: p.points.map((q) => [q[0], q[1], q[2]] as [number,number,number]), area: project.area, limits: project.limits });
    const cand = buildTextCandidateProject({ project, preview: p, formationId: "f-dbg" });
    const traj = evaluateGeometryTrajectoryConsequence(project, cand.project, {});
    const r = evaluateGeometryApplyReadiness({ staticPreflight: pre, trajectory: traj, importedPromotionAcknowledged: true });
    console.log(JSON.stringify({ beforeBlocking: traj.before, status: r.status, blockers: r.blockers, warnings: r.warnings, promoted: traj.newlyPromotedClipIds }, null, 1));
    expect(true).toBe(true);
  });
});
