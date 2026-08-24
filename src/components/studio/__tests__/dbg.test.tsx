// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createDefaultProject, createDemoProject } from "@/lib/show/defaultProject";
import { previewTextFormation } from "@/lib/studio/textFormationPreview";
import { buildTextCandidateProject } from "@/lib/studio/textFormationApplyCommand";
import { makeTextRecipe } from "@/lib/show/text";
import { analyzeGeometryProposalConsequences, evaluateGeometryApplyReadiness, evaluateGeometryTrajectoryConsequence } from "@/lib/show/diagnostics";
import type { ShowProject } from "@/lib/show/types";

function base(): ShowProject {
  const demo = createDemoProject();
  const template = demo.timeline[1]!;
  const p = createDefaultProject(demo.droneCount);
  const clip = (id: string, formationId: string, start: number) => ({
    ...template,
    id,
    formationId,
    start,
    transition: 25,
    hold: 25,
  });
  return {
    ...p,
    timeline: [
      clip("c-takeoff", "f-launch", 0),
      clip("c-show", "f-sphere", 50),
      clip("c-land", "f-approach", 100),
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
