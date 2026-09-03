// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import SceneComposerPanel from "@/components/studio/SceneComposerPanel";
import EffectStackPanel from "@/components/studio/EffectStackPanel";
import { projectFileToJson, serializeProject } from "@/lib/project/serialize";
import { createDefaultProject } from "@/lib/show/defaultProject";
import { addObject, emptyScene, sceneBudget, upsertScene } from "@/lib/show/scene";
import type { Formation, ShowProject } from "@/lib/show/types";
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
  return new File([projectFileToJson(serializeProject(project, {}))], "layers.dsp.json", {
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

/** SVG text + two lines + one AI-generated (custom) object = four layers. */
function composedProject(): { project: ShowProject; clipId: string } {
  const base = createDefaultProject(150);
  const clip = {
    id: "layers-clip",
    formationId: "f-text",
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
    formations: [
      ...base.formations,
      formation("f-text", "text", 40),
      formation("f-line-a", "line", 20),
      formation("f-line-b", "line", 20),
      formation("f-ai", "custom", 30),
    ],
  };
  let scene = emptyScene(clip.id, "Composed");
  for (const [formationId, name, count] of [
    ["f-text", "SUPER RALY", 40],
    ["f-line-a", "Line left", 20],
    ["f-line-b", "Line right", 20],
    ["f-ai", "AI pigeon", 30],
  ] as const) {
    const added = addObject(project, scene, {
      source: { kind: "STATIC", formationId },
      name,
      requestedDroneCount: count,
    });
    scene = added.scene;
  }
  project = upsertScene(project, scene);
  return { project, clipId: clip.id };
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
  await waitFor(() => expect(screen.getByTestId("visual-layers")).toBeTruthy());
}

afterEach(cleanup);

describe("visual layers", () => {
  it("renders one independent layer per visual object with canonical facts", async () => {
    const { project, clipId } = composedProject();
    await mount(project, clipId);

    const list = screen.getByTestId("visual-layers");
    expect(list.getAttribute("data-layer-count")).toBe("4");
    const rows = list.querySelectorAll("[data-testid^='visual-layer-']");
    expect(rows.length).toBe(4);
    expect(Array.from(rows).map((row) => row.getAttribute("data-type"))).toEqual([
      "Text",
      "Line",
      "Line",
      "AI",
    ]);
    const ids = api.selectedScene!.objects.map((o) => o.id);
    expect(screen.getByTestId(`layer-drones-${ids[0]}`).textContent).toContain("40 drones");
    expect(screen.getByTestId(`layer-status-${ids[0]}`).textContent).toContain("Static");
    expect(screen.getByTestId(`layer-lighting-count-${ids[0]}`).textContent).toContain(
      "0 lighting effects",
    );
    expect(screen.getByTestId("reserve-summary").getAttribute("data-reserve")).toBe("40");
  });

  it("clicking a layer changes the canonical primary selection only", async () => {
    const { project, clipId } = composedProject();
    await mount(project, clipId);
    const ids = api.selectedScene!.objects.map((o) => o.id);

    for (const id of ids) {
      fireEvent.click(screen.getByTestId(`composer-object-${id}`));
      await waitFor(() =>
        expect(api.selectedSceneObjectIds[api.selectedSceneObjectIds.length - 1]).toBe(id),
      );
      expect(api.selectedSceneObjectIds).toEqual([id]);
      expect(screen.getByTestId(`visual-layer-${id}`).getAttribute("data-selected")).toBe("1");
      await waitFor(() =>
        expect(screen.getByTestId("selected-object-summary").textContent).toContain(
          api.selectedScene!.objects.find((o) => o.id === id)!.name,
        ),
      );
    }
    expect(screen.getByTestId("selected-add-lighting")).toBeTruthy();
    expect(screen.getByTestId("selected-add-motion")).toBeTruthy();
  });

  it("hiding a layer keeps the object and its allocation", async () => {
    const { project, clipId } = composedProject();
    await mount(project, clipId);
    const id = api.selectedScene!.objects[1]!.id;
    const before = sceneBudget(api.project, api.selectedScene!).active;

    fireEvent.click(screen.getByTestId(`layer-visibility-${id}`));
    await waitFor(() =>
      expect(screen.getByTestId(`layer-visibility-${id}`).getAttribute("data-visible")).toBe("0"),
    );
    expect(api.selectedScene!.objects.some((o) => o.id === id)).toBe(true);
    expect(sceneBudget(api.project, api.selectedScene!).active).toBe(before);
    expect(api.selectedScene!.objects.map((o) => o.requestedDroneCount)).toEqual([40, 20, 20, 30]);
  });

  it("duplicate and delete are each exactly one Undo entry", async () => {
    const { project, clipId } = composedProject();
    await mount(project, clipId);
    const id = api.selectedScene!.objects[0]!.id;

    fireEvent.click(screen.getByTestId(`layer-duplicate-${id}`));
    await waitFor(() => expect(api.selectedScene!.objects.length).toBe(5));
    act(() => api.undoTimeline());
    await waitFor(() => expect(api.selectedScene!.objects.length).toBe(4));

    fireEvent.click(screen.getByTestId(`layer-delete-${id}`));
    await waitFor(() => expect(api.selectedScene!.objects.length).toBe(3));
    act(() => api.undoTimeline());
    await waitFor(() => expect(api.selectedScene!.objects.length).toBe(4));
    expect(api.selectedScene!.objects.map((o) => o.requestedDroneCount)).toEqual([40, 20, 20, 30]);
  });

  it("shows a canonical warning when a source asset is missing", async () => {
    const { project, clipId } = composedProject();
    const broken: ShowProject = {
      ...project,
      formations: project.formations.filter((f) => f.id !== "f-ai"),
    };
    await mount(broken, clipId);
    const ids = api.selectedScene!.objects.map((o) => o.id);
    const warning = screen.getByTestId(`layer-warning-${ids[3]}`);
    expect(warning.getAttribute("aria-label")).toContain("Missing source asset");
    expect(screen.queryByTestId(`layer-warning-${ids[0]}`)).toBeNull();
  });

  it("renaming a layer uses canonical patching", async () => {
    const { project, clipId } = composedProject();
    await mount(project, clipId);
    const id = api.selectedScene!.objects[0]!.id;

    fireEvent.click(screen.getByTestId(`layer-rename-${id}`));
    const input = screen.getByTestId(`layer-rename-input-${id}`);
    fireEvent.change(input, { target: { value: "Hero text" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(api.selectedScene!.objects.find((o) => o.id === id)!.name).toBe("Hero text"),
    );
  });
});
