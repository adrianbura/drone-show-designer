// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import SceneComposerPanel from "@/components/studio/SceneComposerPanel";
import EffectStackPanel from "@/components/studio/EffectStackPanel";
import { projectFileToJson, serializeProject } from "@/lib/project/serialize";
import { createDefaultProject } from "@/lib/show/defaultProject";
import { addObject, emptyScene, sceneBudget, upsertScene } from "@/lib/show/scene";
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

function projectFile(project: ShowProject): File {
  return new File([projectFileToJson(serializeProject(project, {}))], "composer.dsp.json", {
    type: "application/json",
  });
}

function projectWithReserve(): { project: ShowProject; clipId: string } {
  const base = createDefaultProject(150);
  const clip = {
    id: "composer-clip",
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
  const added = addObject(withClip, emptyScene(clip.id, "Composer"), {
    source: { kind: "STATIC", formationId: clip.formationId },
    name: "Main visual",
    requestedDroneCount: 100,
  });
  return { project: upsertScene(withClip, added.scene), clipId: clip.id };
}

async function mount(project: ShowProject, clipId: string) {
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
}

afterEach(cleanup);

describe("scene composer drone budget DOM", () => {
  it("prevents over-allocation, commits the exact reserve, and undoes as one revision", async () => {
    const { project, clipId } = projectWithReserve();
    await mount(project, clipId);
    const historyBefore = api.timelineHistoryDepth.past;

    fireEvent.click(screen.getByTestId("composer-add-visual"));
    const drones = screen.getByTestId("line-drones");
    const commit = screen.getByTestId("composer-add-line-commit") as HTMLButtonElement;

    fireEvent.change(drones, { target: { value: "51" } });
    expect(commit.disabled).toBe(true);
    expect(screen.getByTestId("line-reserve").className).toContain("text-destructive");

    fireEvent.change(drones, { target: { value: "50" } });
    expect(commit.disabled).toBe(false);
    fireEvent.click(commit);

    await waitFor(() =>
      expect(screen.getByTestId("composer-budget").textContent).toContain("0 reserve"),
    );
    const scene = api.project.scenes!.find((candidate) => candidate.id === clipId)!;
    expect(sceneBudget(api.project, scene, api.project.droneCount).active).toBe(150);
    expect(api.timelineHistoryDepth.past).toBe(historyBefore + 1);

    act(() => api.undoTimeline());
    await waitFor(() =>
      expect(screen.getByTestId("composer-budget").textContent).toContain("50 reserve"),
    );
  });

  it("saves a reusable drone group and applies a point-targeted colour at the playhead", async () => {
    const { project, clipId } = projectWithReserve();
    await mount(project, clipId);

    act(() => {
      api.setSceneSelectionMode("POINT");
      api.selectScenePointForDrone(0, false);
      api.setTime(4.25);
    });
    await waitFor(() =>
      expect(screen.getByTestId("composer-point-count").textContent).toContain("1 drone point"),
    );

    fireEvent.change(screen.getByLabelText("Drone group name"), { target: { value: "Diamond" } });
    fireEvent.click(screen.getByTestId("composer-save-point-group"));
    await waitFor(() => expect(api.project.scenes?.[0]?.pointGroups?.[0]?.name).toBe("Diamond"));

    fireEvent.click(screen.getByTestId("effect-stack-add-SOLID_COLOUR"));
    await waitFor(() => expect(api.project.lighting?.effects).toHaveLength(1));
    const effect = api.project.lighting!.effects[0]!;
    expect(effect.anchor).toBe("ABSOLUTE");
    expect(effect.start).toBe(4.25);
    expect(effect.target.kind).toBe("POINT_GROUP");
    if (effect.target.kind === "POINT_GROUP") expect(effect.target.pointIds).toHaveLength(1);

    act(() => api.undoTimeline());
    expect(api.project.lighting?.effects ?? []).toHaveLength(0);
    act(() => api.redoTimeline());
    expect(api.project.lighting?.effects).toHaveLength(1);

    const saved = projectFile(api.project);
    await act(async () => {
      await api.openProjectFile(saved);
    });
    expect(api.project.scenes?.[0]?.pointGroups?.[0]?.name).toBe("Diamond");
    expect(api.project.lighting?.effects[0]?.target.kind).toBe("POINT_GROUP");
  });
});

describe("drone group lighting authoring UX", () => {
  it("explains modes, renames inline, confirms reusable deletion and authors at the playhead", async () => {
    const { project, clipId } = projectWithReserve();
    await mount(project, clipId);

    expect(screen.getByTestId("composer-mode-hint").textContent).toContain("whole SVG");
    fireEvent.click(screen.getByTestId("composer-mode-point"));
    expect(screen.getByTestId("composer-selection-mode").getAttribute("data-mode")).toBe("POINT");
    expect(screen.getByTestId("composer-mode-hint").textContent).toContain("points inside");
    expect(screen.getByTestId("composer-point-groups-empty")).toBeTruthy();

    fireEvent.click(screen.getByTestId("composer-point-tool-box"));
    expect(api.scenePointSelectionTool).toBe("BOX");
    expect(screen.getByTestId("composer-point-tool-box").getAttribute("aria-pressed")).toBe("true");

    act(() => api.selectScenePointsForDrones([0, 1, 2], "REPLACE"));
    act(() => api.selectScenePointsForDrones([1], "SUBTRACT"));
    act(() => api.setTime(4.25));
    await waitFor(() =>
      expect(screen.getByTestId("composer-selection-summary").textContent).toContain(
        "2 drone points",
      ),
    );

    fireEvent.change(screen.getByLabelText("Drone group name"), {
      target: { value: "Diamond sparkle" },
    });
    fireEvent.click(screen.getByTestId("composer-save-point-group"));
    await waitFor(() => expect(api.project.scenes?.[0]?.pointGroups).toHaveLength(1));
    const groupId = api.project.scenes![0]!.pointGroups![0]!.id;
    expect(screen.getByTestId(`composer-group-count-${groupId}`).textContent).toBe("2");

    // Inline rename (no window.prompt).
    fireEvent.click(screen.getByTestId(`composer-group-rename-${groupId}`));
    const renameInput = screen.getByTestId(`composer-group-rename-input-${groupId}`);
    fireEvent.change(renameInput, { target: { value: "Diamond sparkle B" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });
    await waitFor(() =>
      expect(api.project.scenes?.[0]?.pointGroups?.[0]?.name).toBe("Diamond sparkle B"),
    );

    // Reusable group deletion asks for confirmation and can be cancelled.
    fireEvent.click(screen.getByTestId(`composer-group-delete-${groupId}`));
    expect(screen.getByTestId(`composer-group-delete-confirm-${groupId}`)).toBeTruthy();

    // Reselect the group and author lighting at the playhead.
    fireEvent.click(screen.getByTestId(`composer-group-select-${groupId}`));
    await waitFor(() => expect(api.selectedScenePointIds).toHaveLength(2));

    expect(screen.getByTestId("effect-target-summary").getAttribute("data-target")).toBe("DRONES");
    expect(screen.getByTestId("effect-start-readout").getAttribute("data-start")).toBe("4.25");

    fireEvent.click(screen.getByTestId("effect-stack-add-SOLID_COLOUR"));
    await waitFor(() => expect(api.project.lighting?.effects).toHaveLength(1));
    expect(api.project.lighting!.effects[0]!.start).toBe(4.25);

    act(() => api.setTime(6.5));
    fireEvent.click(screen.getByTestId("effect-stack-add-FADE_IN"));
    await waitFor(() => expect(api.project.lighting?.effects).toHaveLength(2));
    expect(api.project.lighting!.effects[1]!.start).toBe(6.5);

    fireEvent.change(screen.getByTestId("effect-stack-gradient-axis"), { target: { value: "Y" } });
    fireEvent.click(screen.getByTestId("effect-stack-add-GRADIENT_SWEEP"));
    await waitFor(() => expect(api.project.lighting?.effects).toHaveLength(3));
    const gradient = api.project.lighting!.effects[2]!;
    expect(gradient.parameters.stops).toHaveLength(2);
    expect(gradient.parameters.direction).toEqual([0, 1, 0]);

    // Selecting a row focuses the canonical effect.
    fireEvent.click(screen.getByTestId(`effect-stack-select-${gradient.id}`));
    await waitFor(() => expect(api.selectedLightingEffectId).toBe(gradient.id));

    act(() => api.undoTimeline());
    expect(api.project.lighting?.effects).toHaveLength(2);
    act(() => api.redoTimeline());
    expect(api.project.lighting?.effects).toHaveLength(3);

    const saved = projectFile(api.project);
    await act(async () => {
      await api.openProjectFile(saved);
    });
    expect(api.project.scenes?.[0]?.pointGroups?.[0]?.name).toBe("Diamond sparkle B");
    expect(api.project.lighting?.effects).toHaveLength(3);
  });
});
