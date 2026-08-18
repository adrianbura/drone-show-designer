import { compileVisualFormation, formationFromCompiled } from "../src/lib/visual/compiler";
import { CAR_DESIGN } from "../src/lib/visual/designs/car";
import { dynamicFromCompiled, animatableParts } from "../src/lib/visual/dynamicBridge";
import { createDynamicEvaluator } from "../src/lib/show/dynamic/sampler";

const compiled = compileVisualFormation(CAR_DESIGN, 180, {});
const f = formationFromCompiled(compiled, { id: "f", name: "Car" });
console.log("animatable parts", animatableParts(CAR_DESIGN, compiled).map(p=>p.id));
const d = dynamicFromCompiled(f, CAR_DESIGN, compiled, { id: "d" });
console.log("groups", d.groups.map(g=>({id:g.id,n:g.pointIds.length,kf:g.keyframes.length,loop:g.loop, en:g.enabled})));
const ev = createDynamicEvaluator(d, { playbackRate: 1, startOffset: 0 });
const a = ev.positionsAt(0), b = ev.positionsAt(1);
let max=0; for(let i=0;i<a.length;i++){const dx=a[i][0]-b[i][0],dy=a[i][1]-b[i][1],dz=a[i][2]-b[i][2];max=Math.max(max,Math.hypot(dx,dy,dz));}
console.log("max displacement 0->1s", max.toFixed(3));
