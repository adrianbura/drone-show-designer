// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

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
  return <SceneComposerPanel />;
}

function projectFile(project: ShowProject): File {
  return new File([projectFileToJson(serializeProject(project, {}))], "ai.dsp.json", {
    type: "application/json",
  });
}

function projectWithReserve(): { project: ShowProject; clipId: string } {
  const base = createDefaultProject(150);
  const clip = {
    id: "ai-clip",
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
  const added = addObject(withClip, emptyScene(clip.id, "AI scene"), {
    source: { kind: "STATIC", formationId: clip.formationId },
    name: "Main visual",
    requestedDroneCount: 100,
  });
  return { project: upsertScene(withClip, added.scene), clipId: clip.id };
}

async function mount() {
  const { project, clipId } = projectWithReserve();
  render(
    <StudioProvider>
      <Harness />
    </StudioProvider>,
  );
  await act(async () => {
    await api.openProjectFile(projectFile(project));
  });
  act(() => api.selectClip(clipId));
  await waitFor(() =>
    expect(screen.getByTestId("composer-budget").textContent).toContain("50 reserve"),
  );
  return clipId;
}

afterEach(cleanup);

describe("Generate with AI workflow", () => {
  it("guides describe → preview → allocate → place → add without extra mutations", async () => {
    const clipId = await mount();
    const historyBefore = api.timelineHistoryDepth.past;
    const formationsBefore = api.project.formations.length;

    fireEvent.click(screen.getByTestId("composer-add-visual"));
    fireEvent.click(screen.getByTestId("composer-choice-AI"));

    // Empty state before any generation.
    expect(screen.getByTestId("wizard-ai-empty")).toBeTruthy();
    expect(screen.getByTestId("wizard-ai-steps").textContent).toContain("Describe");

    fireEvent.change(screen.getByTestId("wizard-ai-prompt"), {
      target: { value: "A sparkling engagement ring with a gentle pulse" },
    });
    fireEvent.click(screen.getByTestId("wizard-ai-generate"));

    await waitFor(() => expect(screen.getByTestId("wizard-ai-proposal")).toBeTruthy());
    expect(screen.getByTestId("wizard-ai-disclaimer").textContent).toContain("artistic preview");
    expect(api.project.formations).toHaveLength(formationsBefore);
    expect(api.timelineHistoryDepth.past).toBe(historyBefore);

    // Allocation is honest about reserve and the exact deficit.
    expect(screen.getByTestId("wizard-allocation-reserve").getAttribute("data-reserve")).toBe("50");
    fireEvent.change(screen.getByTestId("wizard-drones"), { target: { value: "62" } });
    expect(screen.getByTestId("wizard-allocation-deficit").getAttribute("data-deficit")).toBe("12");
    expect((screen.getByTestId("wizard-commit") as HTMLButtonElement).disabled).toBe(true);

    // Placement is behind progressive disclosure.
    fireEvent.click(screen.getByTestId("wizard-ai-placement-toggle"));
    fireEvent.change(screen.getByTestId("wizard-ai-y"), { target: { value: "60" } });

    fireEvent.change(screen.getByTestId("wizard-drones"), { target: { value: "37" } });
    expect((screen.getByTestId("wizard-commit") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("wizard-commit"));

    await waitFor(() => expect(api.project.formations).toHaveLength(formationsBefore + 1));
    const scene = api.project.scenes!.find((candidate) => candidate.id === clipId)!;
    expect(scene.objects).toHaveLength(2);
    expect(scene.objects[1]!.requestedDroneCount).toBe(37);
    expect(api.project.dynamicFormations).toHaveLength(1);
    expect(api.selectedSceneObjectId).toBe(scene.objects[1]!.id);
    expect(api.timelineHistoryDepth.past).toBe(historyBefore + 1);

    // Wizard closed after success and post-create guidance is visible.
    expect(screen.queryByTestId("wizard-ai")).toBeNull();
    expect(screen.getByTestId("composer-post-create-guidance").textContent).toContain(
      "Selection Effects",
    );

    // One undo removes formation + dynamic formation + scene object.
    act(() => api.undoTimeline());
    await waitFor(() => expect(api.project.formations).toHaveLength(formationsBefore));
    expect(api.project.dynamicFormations ?? []).toHaveLength(0);
    expect(api.selectedScene!.objects).toHaveLength(1);

    act(() => api.redoTimeline());
    await waitFor(() => expect(api.project.formations).toHaveLength(formationsBefore + 1));
    expect(api.project.dynamicFormations).toHaveLength(1);
    expect(api.selectedScene!.objects[1]!.requestedDroneCount).toBe(37);
  });

  it("cancelling a generated proposal mutates neither project nor history", async () => {
    await mount();
    const historyBefore = api.timelineHistoryDepth.past;
    const formationsBefore = api.project.formations.length;
    const objectsBefore = api.selectedScene!.objects.length;

    fireEvent.click(screen.getByTestId("composer-add-visual"));
    fireEvent.click(screen.getByTestId("composer-choice-AI"));
    fireEvent.change(screen.getByTestId("wizard-ai-prompt"), {
      target: { value: "A gentle heart that pulses" },
    });
    fireEvent.click(screen.getByTestId("wizard-ai-generate"));
    await waitFor(() => expect(screen.getByTestId("wizard-ai-proposal")).toBeTruthy());

    fireEvent.click(screen.getByTestId("wizard-cancel"));
    expect(screen.queryByTestId("wizard-ai-proposal")).toBeNull();
    expect(api.aiProposal).toBeNull();
    expect(api.project.formations).toHaveLength(formationsBefore);
    expect(api.selectedScene!.objects).toHaveLength(objectsBefore);
    expect(api.timelineHistoryDepth.past).toBe(historyBefore);
  });
});
