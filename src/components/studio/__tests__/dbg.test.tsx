// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import VisualStatesTrack from "@/components/studio/VisualStatesTrack";
import { projectFileToJson, serializeProject } from "@/lib/project/serialize";
import { createDefaultProject } from "@/lib/show/defaultProject";
import { addObject, emptyScene, upsertScene } from "@/lib/show/scene";
import { StudioProvider, useStudio } from "@/lib/studio/store";
let api: any;
function Harness() { api = useStudio(); return <VisualStatesTrack viewStart={0} viewEnd={40} />; }
describe("dbg", () => { it("logs", async () => {
  const base = createDefaultProject(60);
  const clip = { id: "states-clip", formationId: "f-sphere", start: 4, transition: 6, hold: 12, easing: "minJerk" as const, color: [255,255,255] as const, effect: "solid" as const, phase: "SHOW" as const };
  const withClip = { ...base, timeline: [clip] };
  const added = addObject(withClip, emptyScene(clip.id, "C"), { source: { kind: "STATIC", formationId: clip.formationId }, name: "Ring", requestedDroneCount: 30 });
  const project = upsertScene(withClip, added.scene);
  render(<StudioProvider><Harness /></StudioProvider>);
  await act(async () => { await api.openProjectFile(new File([projectFileToJson(serializeProject(project, {}))], "s.dsp.json", { type: "application/json" })); });
  act(() => api.selectClip(clip.id));
  await waitFor(() => expect(api.selectedScene).toBeTruthy());
  const objectId = api.selectedScene.objects[0].id;
  act(() => api.duplicateSceneObject(clip.id, objectId));
  await waitFor(() => expect(api.selectedScene.objects.length).toBe(2));
  const second = api.selectedScene.objects[1].id;
  act(() => api.setSelectedSceneObjectIds([objectId, second], second));
  console.log("sel", JSON.stringify(api.selectedSceneObjectIds));
  let g: any; act(() => { g = api.createSceneVisualGroup("G"); });
  console.log("group", g, JSON.stringify(api.selectedScene.visualGroups));
  let s: any; act(() => { s = api.captureSceneVisualGroupState(g, "Wide"); });
  console.log("state", s, JSON.stringify(api.selectedScene.visualStates));
  act(() => api.setTime(13));
  console.log("time", api.time);
  let r: any; act(() => { r = api.addSceneVisualStateCueAtPlayhead(s, 2); });
  console.log("cue", JSON.stringify(r), JSON.stringify(api.selectedScene.visualStateCues));
}); });
