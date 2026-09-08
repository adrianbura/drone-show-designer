// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import EffectStackPanel from "@/components/studio/EffectStackPanel";
import SceneComposerPanel from "@/components/studio/SceneComposerPanel";
import { projectFileToJson, serializeProject } from "@/lib/project/serialize";
import { createDefaultProject } from "@/lib/show/defaultProject";
import { addObject, emptyScene, upsertScene } from "@/lib/show/scene";
import type { ShowProject } from "@/lib/show/types";
import { StudioProvider, useStudio } from "@/lib/studio/store";

type Studio = ReturnType<typeof useStudio>;
let api: Studio;

function Harness() {
  api = useStudio();
  return (
    <>
      <SceneComposerPanel />
      <EffectStackPanel />
    </>
  );
}

function fixture(): { project: ShowProject; clipId: string } {
  const base = createDefaultProject(150);
  const clip = {
    id: "group-clip",
    formationId: "f-sphere",
    start: 0,
    transition: 12,
    hold: 8,
    easing: "minJerk" as const,
    color: [255, 255, 255] as const,
    effect: "solid" as const,
    phase: "SHOW" as const,
  };
  const withClip = { ...base, timeline: [clip] };
  const added = addObject(withClip, emptyScene(clip.id, "Composition"), {
    source: { kind: "STATIC", formationId: clip.formationId },
    name: "SVG text",
    requestedDroneCount: 60,
  });
  return { project: upsertScene(withClip, added.scene), clipId: clip.id };
}

async function mountTwoObjects() {
  const { project, clipId } = fixture();
  render(
    <StudioProvider>
      <Harness />
    </StudioProvider>,
  );
  await act(async () => {
    await api.openProjectFile(
      new File([projectFileToJson(serializeProject(project, {}))], "g.dsp.json", {
        type: "application/json",
      }),
    );
  });
  act(() => api.selectClip(clipId));
  await waitFor(() => expect(screen.getByTestId("visual-layers")).toBeTruthy());
  const firstId = api.selectedScene!.objects[0]!.id;
  act(() => api.duplicateSceneObject(clipId, firstId));
  await waitFor(() => expect(api.selectedScene!.objects).toHaveLength(2));
  const secondId = api.selectedScene!.objects[1]!.id;
  act(() => api.setSelectedSceneObjectIds([firstId, secondId], secondId));
  return { clipId, firstId, secondId };
}

afterEach(cleanup);

describe("everyday visual groups UX", () => {
  it("shows an empty state, then a hierarchy with canonical counts", async () => {
    const { firstId, secondId } = await mountTwoObjects();
    expect(screen.getByTestId("visual-groups-empty")).toBeTruthy();

    fireEvent.click(screen.getByTestId("composer-create-visual-group"));
    await waitFor(() => expect(api.selectedScene!.visualGroups).toHaveLength(1));
    const group = api.selectedScene!.visualGroups![0]!;

    expect(screen.getByTestId("visual-groups")).toBeTruthy();
    expect(screen.getByTestId(`visual-group-object-count-${group.id}`).textContent).toContain("2");
    expect(screen.getByTestId(`visual-group-drone-count-${group.id}`).textContent).toContain(
      "drones",
    );
    expect(screen.getByTestId(`visual-group-child-${firstId}`)).toBeTruthy();
    expect(screen.getByTestId(`visual-group-child-${secondId}`)).toBeTruthy();

    // a child stays individually selectable
    fireEvent.click(screen.getByTestId(`visual-group-child-${firstId}`));
    await waitFor(() => expect(api.selectedSceneObjectIds).toEqual([firstId]));
  });

  it("truthfully labels the live preview target for a complete group", async () => {
    await mountTwoObjects();
    fireEvent.click(screen.getByTestId("composer-create-visual-group"));
    await waitFor(() => expect(api.selectedScene!.visualGroups).toHaveLength(1));
    const group = api.selectedScene!.visualGroups![0]!;
    fireEvent.click(screen.getByTestId(`visual-group-select-${group.id}`));

    const before = api.project;
    const depth = api.timelineHistoryDepth.past;
    act(() => api.previewLightingEffectsFromPreset("SET_COLOR"));
    await waitFor(() => expect(screen.getByTestId("effect-live-preview")).toBeTruthy());
    expect(screen.getByTestId("effect-live-preview-target").textContent).toContain(
      "Complete visual group",
    );
    expect(api.project).toBe(before);
    expect(api.timelineHistoryDepth.past).toBe(depth);

    fireEvent.click(screen.getByTestId("effect-preview-cancel"));
    await waitFor(() => expect(screen.queryByTestId("effect-live-preview")).toBeNull());
    expect(api.project).toBe(before);
    expect(api.timelineHistoryDepth.past).toBe(depth);
  });
});
