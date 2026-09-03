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
  it("commits the latest move, rotate and scale gizmo deltas atomically", async () => {
    const { project, clipId } = projectWithReserve();
    await mount(project, clipId);
    const objectId = api.selectedScene!.objects[0]!.id;
    const historyBefore = api.timelineHistoryDepth.past;
    act(() => api.selectSceneObject(objectId, "REPLACE"));
    await waitFor(() => expect(api.selectedSceneObjectIds).toEqual([objectId]));

    act(() => {
      api.beginSceneGizmo();
      api.updateSceneGizmo({ position: [3, 4, 5] });
      api.commitSceneGizmo();
    });
    await waitFor(() =>
      expect(api.selectedScene!.objects[0]!.transform.position).toEqual([3, 4, 5]),
    );

    act(() => {
      api.beginSceneGizmo();
      api.updateSceneGizmo({ rotationDeg: [10, 20, 30] });
      api.commitSceneGizmo();
    });
    await waitFor(() =>
      expect(api.selectedScene!.objects[0]!.transform.rotationDeg).toEqual([10, 20, 30]),
    );

    act(() => {
      api.beginSceneGizmo();
      api.updateSceneGizmo({ scaleFactor: 1.5 });
      api.commitSceneGizmo();
    });
    await waitFor(() => expect(api.selectedScene!.objects[0]!.transform.scale).toBe(1.5));
    expect(api.selectedScene!.objects[0]!.id).toBe(objectId);
    expect(api.timelineHistoryDepth.past).toBe(historyBefore + 3);

    act(() => api.undoTimeline());
    await waitFor(() => expect(api.selectedScene!.objects[0]!.transform.scale).toBe(1));
    expect(api.selectedScene!.objects[0]!.transform.rotationDeg).toEqual([10, 20, 30]);
  });

  it("generates an AI draft without mutation and adds the animated visual atomically", async () => {
    const { project, clipId } = projectWithReserve();
    await mount(project, clipId);
    const historyBefore = api.timelineHistoryDepth.past;
    const formationsBefore = api.project.formations.length;

    fireEvent.click(screen.getByTestId("composer-add-visual"));
    fireEvent.click(screen.getByTestId("composer-choice-AI"));
    fireEvent.change(screen.getByTestId("wizard-ai-prompt"), {
      target: { value: "A butterfly gently flapping its wings" },
    });
    fireEvent.click(screen.getByTestId("wizard-ai-generate"));

    await waitFor(() => expect(screen.getByTestId("wizard-ai-proposal")).toBeTruthy());
    expect(api.project.formations).toHaveLength(formationsBefore);
    expect(api.timelineHistoryDepth.past).toBe(historyBefore);

    fireEvent.change(screen.getByTestId("wizard-drones"), { target: { value: "40" } });
    fireEvent.click(screen.getByTestId("wizard-commit"));

    await waitFor(() => expect(api.project.formations).toHaveLength(formationsBefore + 1));
    expect(api.project.dynamicFormations).toHaveLength(1);
    expect(api.project.formations.at(-1)!.points).toHaveLength(40);
    expect(api.project.dynamicFormations![0]!.points).toHaveLength(40);
    const scene = api.project.scenes!.find((candidate) => candidate.id === clipId)!;
    expect(scene.objects).toHaveLength(2);
    expect(scene.objects[1]!.requestedDroneCount).toBe(40);
    expect(scene.objects[1]!.source.kind).toBe("DYNAMIC");
    expect(scene.pointGroups?.map((group) => group.name)).toContain("Left wing");
    expect(scene.pointGroups?.map((group) => group.name)).toContain("Right wing");
    expect(scene.pointGroups?.every((group) => group.instanceId === scene.objects[1]!.id)).toBe(
      true,
    );
    expect(api.timelineHistoryDepth.past).toBe(historyBefore + 1);

    act(() => api.undoTimeline());
    await waitFor(() => expect(api.project.formations).toHaveLength(formationsBefore));
    expect(api.project.dynamicFormations ?? []).toHaveLength(0);
    expect(api.selectedScene!.objects).toHaveLength(1);

    act(() => api.redoTimeline());
    await waitFor(() => expect(api.project.formations).toHaveLength(formationsBefore + 1));
    expect(api.project.dynamicFormations).toHaveLength(1);
    expect(api.selectedScene!.objects[1]!.requestedDroneCount).toBe(40);
    expect(api.selectedScene!.pointGroups?.map((group) => group.name)).toEqual([
      "Body",
      "Left wing",
      "Right wing",
    ]);

    const leftWing = api.selectedScene!.pointGroups!.find((group) => group.name === "Left wing")!;
    act(() => api.selectScenePointGroup(leftWing.id));
    await waitFor(() => expect(api.selectedScenePointIds).toEqual(leftWing.pointIds));
    expect(api.sceneSelectionMode).toBe("POINT");

    const aiObject = api.selectedScene!.objects[1]!;
    const initialPosition = aiObject.transform.position;
    act(() => api.selectSceneObject(aiObject.id, "REPLACE"));
    await waitFor(() => expect(api.selectedSceneObjectIds).toEqual([aiObject.id]));
    act(() => {
      api.beginSceneGizmo();
      api.updateSceneGizmo({
        position: [2, 3, 4],
        rotationDeg: [0, 25, 0],
        scaleFactor: 1.2,
      });
      api.commitSceneGizmo();
    });
    await waitFor(() =>
      expect(api.selectedScene!.objects[1]!.transform).toMatchObject({
        position: [initialPosition[0] + 2, initialPosition[1] + 3, initialPosition[2] + 4],
        rotationDeg: [0, 25, 0],
        scale: 1.2,
      }),
    );
    act(() => api.undoTimeline());
    await waitFor(() => expect(api.selectedScene!.objects[1]!.transform.scale).toBe(1));
  });

  it("prevents over-allocation, commits the exact reserve, and undoes as one revision", async () => {
    const { project, clipId } = projectWithReserve();
    await mount(project, clipId);
    const historyBefore = api.timelineHistoryDepth.past;

    fireEvent.click(screen.getByTestId("composer-add-visual"));
    fireEvent.click(screen.getByTestId("composer-choice-LINE"));
    const drones = screen.getByTestId("line-drones");
    const commit = screen.getByTestId("composer-add-line-commit") as HTMLButtonElement;

    fireEvent.change(drones, { target: { value: "51" } });
    expect(commit.disabled).toBe(true);
    expect(screen.getByTestId("wizard-allocation-warning")).toBeTruthy();

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

    fireEvent.click(screen.getByTestId("effect-stack-add-SOLID"));
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

    fireEvent.click(screen.getByTestId("effect-stack-add-SOLID"));
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

describe("selection-scoped motion authoring", () => {
  it("applies point motion as one project revision and restores it with undo/redo", async () => {
    const { project, clipId } = projectWithReserve();
    await mount(project, clipId);
    act(() => {
      api.setSceneSelectionMode("POINT");
      api.selectScenePointsForDrones([0, 1, 2], "REPLACE");
    });
    const historyBefore = api.timelineHistoryDepth.past;

    fireEvent.click(screen.getByTestId("motion-stack-add-WAVE"));
    await waitFor(() => expect(api.project.dynamicFormations).toHaveLength(1));
    expect(api.timelineHistoryDepth.past).toBe(historyBefore + 1);
    expect(api.project.dynamicFormations![0]!.groups[0]!.pointIds).toHaveLength(3);
    expect(api.selectedScene!.objects[0]!.source.kind).toBe("DYNAMIC");

    act(() => api.undoTimeline());
    await waitFor(() => expect(api.project.dynamicFormations ?? []).toHaveLength(0));
    expect(api.selectedScene!.objects[0]!.source.kind).toBe("STATIC");

    act(() => api.redoTimeline());
    await waitFor(() => expect(api.project.dynamicFormations).toHaveLength(1));
    expect(api.selectedScene!.objects[0]!.source.kind).toBe("DYNAMIC");
  });
});
