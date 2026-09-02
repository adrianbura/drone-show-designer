// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import EffectStackPanel from "@/components/studio/EffectStackPanel";
import { projectFileToJson, serializeProject } from "@/lib/project/serialize";
import { createDefaultProject } from "@/lib/show/defaultProject";
import { addObject, emptyScene, upsertScene } from "@/lib/show/scene";
import type { ShowProject } from "@/lib/show/types";
import { StudioProvider, useStudio } from "@/lib/studio/store";

type Studio = ReturnType<typeof useStudio>;
let api: Studio;

function Harness() {
  api = useStudio();
  return <EffectStackPanel />;
}

function projectWithTwoVisuals(): { project: ShowProject; clipId: string } {
  const base = createDefaultProject(150);
  const clip = {
    id: "clip",
    formationId: "f-sphere",
    start: 0,
    transition: 10,
    hold: 10,
    easing: "minJerk" as const,
    color: [255, 255, 255] as const,
    effect: "solid" as const,
    phase: "SHOW" as const,
  };
  const withClip = { ...base, timeline: [clip] };
  const first = addObject(withClip, emptyScene(clip.id, "Scene"), {
    source: { kind: "STATIC", formationId: clip.formationId },
    name: "SUPER RALY",
    requestedDroneCount: 100,
  });
  const second = addObject(withClip, first.scene, {
    source: { kind: "STATIC", formationId: clip.formationId },
    name: "Underline 1",
    requestedDroneCount: 40,
  });
  return { project: upsertScene(withClip, second.scene), clipId: clip.id };
}

async function mount() {
  const { project, clipId } = projectWithTwoVisuals();
  render(
    <StudioProvider>
      <Harness />
    </StudioProvider>,
  );
  await act(async () => {
    await api.openProjectFile(
      new File([projectFileToJson(serializeProject(project, {}))], "motion.dsp.json", {
        type: "application/json",
      }),
    );
  });
  act(() => api.selectClip(clipId));
  await waitFor(() => expect(api.selectedScene?.objects).toHaveLength(2));
  return clipId;
}

afterEach(cleanup);

describe("everyday motion inspector DOM", () => {
  it("browsing mutates nothing and each edit is exactly one undo entry", async () => {
    await mount();
    const objects = api.selectedScene!.objects;
    const before = api.project;

    act(() => api.selectSceneObject(objects[0]!.id, "REPLACE"));
    expect(api.project).toBe(before);
    expect(screen.getByTestId("motion-inspector-empty")).toBeTruthy();

    fireEvent.click(screen.getByTestId("motion-stack-add-WAVE"));
    await waitFor(() => expect(screen.getByTestId("motion-inspector")).toBeTruthy());
    const depth = api.timelineHistoryDepth.past;
    const baseCycle = api.project.dynamicFormations![0]!.duration;

    fireEvent.change(screen.getByTestId("motion-inspector-speed"), { target: { value: "1.5" } });
    await waitFor(() =>
      expect(api.selectedScene!.objects[0]!.animation?.playbackRate).toBeCloseTo(1.5),
    );
    expect(api.timelineHistoryDepth.past).toBe(depth + 1);

    fireEvent.change(screen.getByTestId("motion-inspector-cycle"), { target: { value: "6" } });
    await waitFor(() => expect(api.project.dynamicFormations![0]!.duration).toBe(6));
    expect(api.timelineHistoryDepth.past).toBe(depth + 2);

    act(() => api.undoTimeline());
    await waitFor(() => expect(api.project.dynamicFormations![0]!.duration).toBe(baseCycle));
    act(() => api.redoTimeline());
    await waitFor(() => expect(api.project.dynamicFormations![0]!.duration).toBe(6));
  }, 30000);

  it("duplicates independently and removes motion from one object only", async () => {
    const clipId = await mount();
    const objects = api.selectedScene!.objects;

    act(() => api.selectSceneObject(objects[0]!.id, "REPLACE"));
    fireEvent.click(screen.getByTestId("motion-stack-add-WAVE"));
    await waitFor(() => expect(api.project.dynamicFormations).toHaveLength(1));
    act(() => api.selectSceneObject(objects[1]!.id, "REPLACE"));
    fireEvent.click(screen.getByTestId("motion-stack-add-PULSE_SCALE"));
    await waitFor(() => expect(api.project.dynamicFormations).toHaveLength(2));

    fireEvent.click(screen.getByTestId("motion-inspector-duplicate"));
    await waitFor(() => expect(api.project.dynamicFormations).toHaveLength(3));
    const duplicated = api.selectedScene!.objects[1]!.source;
    expect(duplicated.kind).toBe("DYNAMIC");

    fireEvent.change(screen.getByTestId("motion-inspector-cycle"), { target: { value: "9" } });
    await waitFor(() => {
      const copyId =
        api.selectedScene!.objects[1]!.source.kind === "DYNAMIC"
          ? api.selectedScene!.objects[1]!.source.dynamicFormationId
          : "";
      expect(api.project.dynamicFormations!.find((d) => d.id === copyId)!.duration).toBe(9);
    });
    // Original asset untouched.
    expect(api.project.dynamicFormations!.filter((d) => d.duration === 9)).toHaveLength(1);

    fireEvent.click(screen.getByTestId("motion-inspector-remove"));
    await waitFor(() => expect(api.selectedScene!.objects[1]!.source.kind).toBe("STATIC"));
    expect(api.selectedScene!.objects[0]!.source.kind).toBe("DYNAMIC");

    // Save/Open preserves the surviving motion.
    const saved = new File(
      [projectFileToJson(serializeProject(api.project, {}))],
      "motion-saved.dsp.json",
      { type: "application/json" },
    );
    await act(async () => {
      await api.openProjectFile(saved);
    });
    act(() => api.selectClip(clipId));
    await waitFor(() => expect(api.selectedScene!.objects[0]!.source.kind).toBe("DYNAMIC"));
  }, 30000);
});
