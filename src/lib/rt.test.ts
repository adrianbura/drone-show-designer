import { describe, it } from "vitest";
import { buildSyntheticEssp, parseEssp } from "@/lib/import/essp/codec";
import { referenceDroneFileBytes } from "@/lib/import/essp/native/layer";
import { buildReferenceShow } from "@/lib/import/essp/reference";
describe("rt", () => { it("x", async () => {
  const xyz = Array.from({length: 640}, (_,i)=>[i%100,1,2]);
  const rgb = Array.from({length: 960}, ()=>[1,2,3]);
  const bytes = buildSyntheticEssp({xyz, rgb});
  console.log("file2", "file", bytes.byteLength);
  const show = await buildReferenceShow([{name:"1.essp", bytes}]);
  const d = show.drones[0]!;
  console.log("posCount", d.positionSampleCount, "rgbCount", d.rgbSampleCount, "fileSize", d.fileSize, "posSamples", d.positionSamples.length, "rgbLen", d.rgbSamples.length);
  console.log("rebuilt", referenceDroneFileBytes(d).byteLength);
  console.log("timing", show.timing);
}); });
