import { evaluateTextFeasibility, generateTextGeometry } from "@/lib/show/text";
import { authoredProductionProject } from "@/lib/acceptance/__tests__/support/productionFixtures";
import { defaultTextRecipe } from "@/lib/studio/textRebuild";
const p = authoredProductionProject(60);
console.log("limits", p.limits, "area", p.area);
for (const [w,h] of [[150,40],[200,55],[260,70],[320,90]] as const) {
  const g = generateTextGeometry({ ...defaultTextRecipe(60,"SUPER",60), widthMeters:w, heightMeters:h });
  const f = evaluateTextFeasibility(g, p.limits);
  console.log(w,h,f.status,f.minPairSeparationMeters.toFixed(2),f.violationPairCount,f.capacityPoints,f.suggestedScale.toFixed(2),f.note);
}
