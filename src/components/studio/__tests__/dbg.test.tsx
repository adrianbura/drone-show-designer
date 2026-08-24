// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createDefaultProject } from "@/lib/show/defaultProject";
import { previewTextFormation } from "@/lib/studio/textFormationPreview";
import { buildTextCandidateProject } from "@/lib/studio/textFormationApplyCommand";
import { makeTextRecipe } from "@/lib/show/text";
import { analyzeGeometryProposalConsequences, evaluateGeometryApplyReadiness, evaluateGeometryTrajectoryConsequence } from "@/lib/show/diagnostics";
import type { ShowProject } from "@/lib/show/types";

function base(): ShowProject {
  const p = createDefaultProject(24);
  return {
    ...p,
    timeline: [
      { id: "c-takeoff", formationId: "f-launch", start: 0, transition: 20, hold: 20, easing: "easeInOut", color: [255, 255, 255] },
      { id: "c-show", formationId: "f-sphere", start: 40, transition: 30, hold: 30, easing: "easeInOut", color: [255, 255, 255] },
      { id: "c-land", formationId: "f-approach", start: 100, transition: 30, hold: 20, easing: "easeInOut", color: [255, 255, 255] },
    ] as ShowProject["timeline"],
  };
}

describe("dbg", () => {
  it("readiness", () => {
    const project = base();
    const f = project.formations.find((x) => x.id === "f-sphere")!;
    const recipe = makeTextRecipe({ text: "GO", weight: "REGULAR", style: "UPRIGHT", widthMeters: 60, heightMeters: 30, centerAltitudeMeters: 50, letterSpacingEm: 0.8, alignment: "CENTER", participation: f.points.length, outlineRatio: 0.7, bandOffsetEm: 0.35, seed: 1 });
    const p = previewTextFormation(project, { clipId: "c-show", recipe });
    if (!p.ok) throw new Error(JSON.stringify(p));
    const pre = analyzeGeometryProposalConsequences({ before: f.points, after: p.points.map((q) => [q[0], q[1], q[2]] as [number,number,number]), area: project.area, limits: project.limits });
    const cand = buildTextCandidateProject({ project, preview: p, formationId: "f-dbg" });
    const traj = evaluateGeometryTrajectoryConsequence(project, cand.project, {});
    const r = evaluateGeometryApplyReadiness({ staticPreflight: pre, trajectory: traj, importedPromotionAcknowledged: true });
    console.log(JSON.stringify({ before: traj.before.status, beforeBlocking: traj.before.blockingIssueCount, status: r.status, blockers: r.blockers }, null, 1));
    expect(true).toBe(true);
  });
});
