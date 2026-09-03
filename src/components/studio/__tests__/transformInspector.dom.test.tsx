// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import SceneComposerPanel from "@/components/studio/SceneComposerPanel";
import { projectFileToJson, serializeProject } from "@/lib/project/serialize";
import { createDefaultProject } from "@/lib/show/defaultProject";
import { addObject, emptyScene, upsertScene } from "@/lib/show/scene";
import type { Formation, ShowProject } from "@/lib/show/types";
import { StudioProvider, useStudio } from "@/lib/studio/store";

type Studio = ReturnType<typeof useStudio>;

let api: Studio;

function Harness() {
  api = useStudio();
  return <SceneComposerPanel />;
}

function projectFile(project: ShowProject): File {
  return new File([projectFileToJson(serializeProject(project, {}))], "transform.dsp.json", {
    type: "application/json",
  });
}

function formation(id: string, kind: Formation["kind"], points: number): Formation {
  return {
    id,
    name: id,
    kind,
    points: Array.from({ length: points }, (_, i) => [i, 20, 0] as [number, number, number]),
    params: {},
  };
}

function composedProject(): { project: ShowProject; clipId: string } {
  const base = createDefaultProject(150);
  const clip = {
    id: "transform-clip",
    formationId: "f-a",
    start: 0,
    transition: 12,
    hold: 8,
    easing: "minJerk" as const,
    color: [255, 255, 255] as const,
    effect: "solid" as const,
    phase: "SHOW" as const,
  };
  let project: ShowProject = {
    ...base,
    timeline: [clip],
    formations: [...base.formations, formation("f-a", "line", 30), formation("f-b", "line", 30)],
  };
  let scene = emptyScene(clip.id, "Composed");
  for (const [formationId, name] of [
    ["f-a", "Line A"],
    ["f-b", "Line B"],
  ] as const) {
    scene = addObject(project, scene, {
      source: { kind: "STATIC", formationId },
      name,
      requestedDroneCount: 30,
      position: [0, 0, 0],
    }).scene;
  }
  project = upsertScene(project, scene);
  return { project, clipId: clip.id };
}

async function mount() {
  const { project, clipId } = composedProject();
  render(
    <StudioProvider>
      <Harness />
    </StudioProvider>,
  );
  await act(async () => {
    await api.openProjectFile(projectFile(project));
  });
  act(() => api.selectClip(clipId));
  await waitFor(() => expect(screen.getByTestId("visual-layers")).toBeTruthy());
  return api.selectedScene!.objects.map((o) => o.id);
}

const select = (id: string) => fireEvent.click(screen.getByTestId(`composer-object-${id}`));

afterEach(cleanup);

describe("transform inspector", () => {
  it("appears when a layer is selected and switches the canonical gizmo mode", async () => {
    const ids = await mount();
    select(ids[0]!);
    await waitFor(() => expect(screen.getByTestId("transform-section")).toBeTruthy());
    expect(screen.getByTestId("transform-selection-label").textContent).toContain(
      "1 visual selected",
    );

    for (const mode of ["ROTATE", "SCALE", "MOVE"] as const) {
      fireEvent.click(screen.getByTestId(`transform-mode-${mode.toLowerCase()}`));
      await waitFor(() => expect(api.gizmoMode).toBe(mode));
      expect(screen.getByTestId("transform-mode-group").getAttribute("data-active-mode")).toBe(
        mode,
      );
      expect(
        screen.getByTestId(`transform-mode-${mode.toLowerCase()}`).getAttribute("data-active"),
      ).toBe("1");
    }
  });

  it("edits exact single-object values and resets identity in one undo step", async () => {
    const ids = await mount();
    select(ids[0]!);
    await waitFor(() => expect(screen.getByTestId("transform-single")).toBeTruthy());

    fireEvent.change(screen.getByTestId("transform-position-Y"), { target: { value: "35" } });
    await waitFor(() =>
      expect(api.selectedScene!.objects[0]!.transform.position[1]).toBeCloseTo(35),
    );
    fireEvent.change(screen.getByTestId("transform-rotation-Z"), { target: { value: "45" } });
    await waitFor(() =>
      expect(api.selectedScene!.objects[0]!.transform.rotationDeg[2]).toBeCloseTo(45),
    );
    fireEvent.change(screen.getByTestId("transform-scale"), { target: { value: "1.5" } });
    await waitFor(() => expect(api.selectedScene!.objects[0]!.transform.scale).toBeCloseTo(1.5));
    expect(screen.getByTestId("transform-position-Y").getAttribute("value") ?? "").not.toBe("0");

    const mirrorBefore = api.selectedScene!.objects[0]!.transform.mirrorX;

    fireEvent.click(screen.getByTestId("transform-reset"));
    await waitFor(() => expect(api.selectedScene!.objects[0]!.transform.scale).toBe(1));
    const t = api.selectedScene!.objects[0]!.transform;
    expect(t.position).toEqual([0, 0, 0]);
    expect(t.rotationDeg).toEqual([0, 0, 0]);
    expect(t.mirrorX).toBe(mirrorBefore);

    act(() => api.undoTimeline());
    await waitFor(() => expect(api.selectedScene!.objects[0]!.transform.scale).toBeCloseTo(1.5));
  });

  it("shows the newly selected object's canonical values when selection changes", async () => {
    const ids = await mount();
    select(ids[0]!);
    await waitFor(() => expect(screen.getByTestId("transform-single")).toBeTruthy());
    fireEvent.change(screen.getByTestId("transform-position-X"), { target: { value: "12" } });
    await waitFor(() =>
      expect(api.selectedScene!.objects[0]!.transform.position[0]).toBeCloseTo(12),
    );

    select(ids[1]!);
    await waitFor(() =>
      expect(api.selectedSceneObjectIds[api.selectedSceneObjectIds.length - 1]).toBe(ids[1]),
    );
    await waitFor(() =>
      expect(
        (screen.getByTestId("transform-position-X") as HTMLInputElement).valueAsNumber,
      ).toBeCloseTo(api.selectedScene!.objects[1]!.transform.position[0]),
    );
  });

  it("group actions affect every selected object in one undo step", async () => {
    const ids = await mount();
    select(ids[0]!);
    fireEvent.click(screen.getByTestId(`composer-object-${ids[1]}`), { shiftKey: true });
    await waitFor(() => expect(api.selectedSceneObjectIds.length).toBe(2));
    expect(screen.getByTestId("transform-selection-label").textContent).toContain(
      "2 visuals selected",
    );
    expect(screen.getByTestId("transform-group")).toBeTruthy();

    fireEvent.change(screen.getByTestId("transform-group-move-Y"), { target: { value: "10" } });
    await waitFor(() =>
      expect(
        api.selectedScene!.objects.every((o) => Math.abs(o.transform.position[1] - 10) < 1e-6),
      ).toBe(true),
    );
    act(() => api.undoTimeline());
    await waitFor(() =>
      expect(
        api.selectedScene!.objects.every((o) => Math.abs(o.transform.position[1]) < 1e-6),
      ).toBe(true),
    );

    const scalesBefore = api.selectedScene!.objects.map((o) => o.transform.scale);
    fireEvent.click(screen.getByTestId("transform-group-scale-up"));
    await waitFor(() =>
      expect(api.selectedScene!.objects.map((o) => o.transform.scale)).not.toEqual(scalesBefore),
    );
    expect(api.selectedScene!.objects.every((o, i) => o.transform.scale > scalesBefore[i]!)).toBe(
      true,
    );
    act(() => api.undoTimeline());
    await waitFor(() =>
      expect(api.selectedScene!.objects.map((o) => o.transform.scale)).toEqual(scalesBefore),
    );
  });
});
