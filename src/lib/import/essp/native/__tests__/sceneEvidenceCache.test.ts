import {expect,it} from "vitest";
import {importedFixture} from "@/lib/acceptance/__tests__/support/productionFixtures";
import {sourceSceneEvidence} from "../sceneEvidence";
it("reuses immutable source evidence but updates recorded ownership without mutating source",async()=>{
 const {show,layer}=await importedFixture();const binding=layer.bindings.find(b=>b.kind==="SCENE");if(!binding)throw new Error("scene");
 const original=sourceSceneEvidence(show,binding),promoted=sourceSceneEvidence(show,{...binding,owner:"PLANNER"});
 expect(promoted.owner).toBe("PLANNER");expect(original.owner).toBe("REFERENCE");expect(promoted.lighting).toBe(original.lighting);expect(promoted.preview).toBe(original.preview);
 const changed=sourceSceneEvidence(show,{...binding,referenceEnd:binding.referenceEnd-1});expect(changed.lighting).not.toBe(original.lighting);
});