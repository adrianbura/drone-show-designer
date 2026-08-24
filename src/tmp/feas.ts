import { evaluateTextFeasibility, generateTextGeometry } from "@/lib/show/text";
import { authoredProductionProject } from "@/lib/acceptance/__tests__/support/productionFixtures";
import { defaultTextRecipe } from "@/lib/studio/textRebuild";
const p = authoredProductionProject(60);
for (const t of ["SUPER","RALLY","GO","SU","ART"]) for (const [w,h] of [[120,55],[130,60],[130,45]] as const) {
  const g = generateTextGeometry({ ...defaultTextRecipe(60,t,60), widthMeters:w, heightMeters:h });
  const f = evaluateTextFeasibility(g, p.limits);
  const xs=g.points.map(q=>q[0]), ys=g.points.map(q=>q[1]);
  console.log(t,w,h,f.status,f.minPairSeparationMeters.toFixed(2),f.violationPairCount,"x",Math.min(...xs).toFixed(0),Math.max(...xs).toFixed(0),"y",Math.min(...ys).toFixed(0),Math.max(...ys).toFixed(0));
}
