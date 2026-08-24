import { authoredProductionProject, validateAuthored } from "@/lib/acceptance/__tests__/support/productionFixtures";
import { previewTextFormation } from "@/lib/studio/textFormationPreview";
import { buildTextCandidateProject } from "@/lib/studio/textFormationApplyCommand";
import { analyzeGeometryProposalConsequences, evaluateGeometryApplyReadiness, evaluateGeometryTrajectoryConsequence } from "@/lib/show/diagnostics";
import { defaultTextRecipe, textFormationIdFor } from "@/lib/studio/textRebuild";
const base = authoredProductionProject(60);
for (const [t,w,h] of [["GO",130,60],["GO",120,50],["SU",130,60]] as const) {
 for (const extra of [0, 20, 40]) {
  const p = { ...base, timeline: base.timeline.map(c => c.id==="c-prod-wide" ? { ...c, transition: c.transition+extra } : (c.start > 38 ? { ...c, start: c.start+extra } : c)) };
  const recipe = { ...defaultTextRecipe(60, t, 60), widthMeters: w, heightMeters: h };
  const pv = previewTextFormation(p as never, { clipId: "c-prod-wide", recipe });
  if (!pv.ok) { console.log(t,extra,"preview blocked", pv.blockers); continue; }
  const rep = p.formations.find(f=>f.id===pv.replacedFormationId)!;
  const pre = analyzeGeometryProposalConsequences({ before: rep.points, after: pv.points.map(q=>[q[0],q[1],q[2]] as [number,number,number]), area: p.area, limits: p.limits });
  const cand = buildTextCandidateProject({ project: p as never, preview: pv, formationId: textFormationIdFor("c-prod-wide", pv.geometry.recipeHash) });
  const traj = evaluateGeometryTrajectoryConsequence(p as never, cand.project, { sampleRate: 8, assignmentStrategy: "optimalDistance" });
  const r = evaluateGeometryApplyReadiness({ staticPreflight: pre, trajectory: traj, importedPromotionAcknowledged: false });
  console.log(t,w,h,"+"+extra, "base", validateAuthored(p as never, 8).exportReadiness.status, "->", traj.after.exportReadiness, r.status, r.blockers.length);
 }
}
