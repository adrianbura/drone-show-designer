// @vitest-environment jsdom
/**
 * LIVE PREVIEW BAR — everyday preview UX acceptance.
 *
 * Proves that browsing colour/motion presets mutates nothing, that transport
 * only moves the canonical playhead, and that Apply is exactly one canonical
 * mutation and one undo entry.
 */
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

function projectFile(project: ShowProject): File {
  return new File([projectFileToJson(serializeProject(project, {}))], "preview.dsp.json", {
    type: "application/json",
  });
}

function baseProject(): { project: ShowProject; clipId: string } {
  const base = createDefaultProject(150);
  const clip = {
    id: "preview-clip",
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
  const added = addObject(withClip, emptyScene(clip.id, "Preview"), {
    source: { kind: "STATIC", formationId: clip.formationId },
    name: "Main visual",
    requestedDroneCount: 100,
  });
  return { project: upsertScene(withClip, added.scene), clipId: clip.id };
}

async function mount() {
  const { project, clipId } = baseProject();
  render(
    <StudioProvider>
      <Harness />
    </StudioProvider>,
  );
  await act(async () => {
    await api.openProjectFile(projectFile(project));
  });
  act(() => api.selectClip(clipId));
  await waitFor(() => expect(api.selectedScene?.objects.length).toBe(1));
  const objectId = api.selectedScene!.objects[0]!.id;
  act(() => api.selectSceneObject(objectId, "REPLACE"));
  await waitFor(() => expect(api.selectedSceneObjectIds).toEqual([objectId]));
  return objectId;
}

afterEach(cleanup);

describe("unified live preview bar", () => {
  it("previews a colour preset without mutating the project", async () => {
    await mount();
    const project = api.project;
    const history = api.timelineHistoryDepth.past;

    fireEvent.click(screen.getByTestId("effect-stack-add-SOLID"));

    await waitFor(() => expect(screen.getAllByTestId("effect-live-preview")).toHaveLength(1));
    expect(screen.getByTestId("effect-live-preview-badge").textContent).toMatch(/preview/i);
    expect(screen.getByTestId("effect-live-preview-name").textContent).toBe("Solid colour");
    expect(screen.getByTestId("effect-live-preview-target").textContent).toContain("Main visual");
    expect(screen.getByTestId("effect-live-preview-drone-count").getAttribute("data-drones")).toBe(
      "100",
    );
    expect(screen.getByTestId("effect-live-preview").textContent).toContain(
      "Project unchanged until Apply",
    );
    expect(screen.getByTestId("effect-stack-add-SOLID").getAttribute("data-previewing")).toBe("1");
    expect(api.project).toBe(project);
    expect(api.timelineHistoryDepth.past).toBe(history);
  });

  it("previews a motion preset without mutating the project", async () => {
    await mount();
    const project = api.project;
    const history = api.timelineHistoryDepth.past;

    fireEvent.click(screen.getByTestId("motion-stack-add-WAVE"));

    await waitFor(() => expect(api.motionEffectPreviewIds.length).toBeGreaterThan(0));
    expect(screen.getAllByTestId("effect-live-preview")).toHaveLength(1);
    expect(screen.getByTestId("effect-live-preview").getAttribute("data-preview-kind")).toBe(
      "MOTION",
    );
    expect(api.project).toBe(project);
    expect(api.timelineHistoryDepth.past).toBe(history);
  });

  it("moves only the canonical playhead when playing, scrubbing or restarting", async () => {
    await mount();
    act(() => api.setTime(2));
    fireEvent.click(screen.getByTestId("effect-stack-add-FADE_IN"));
    await waitFor(() => expect(api.lightingEffectPreview.length).toBeGreaterThan(0));
    const project = api.project;

    fireEvent.click(screen.getByTestId("effect-preview-play-pause"));
    await waitFor(() => expect(api.playing).toBe(true));
    fireEvent.click(screen.getByTestId("effect-preview-play-pause"));
    await waitFor(() => expect(api.playing).toBe(false));

    fireEvent.change(screen.getByTestId("effect-preview-seek"), { target: { value: "2.5" } });
    await waitFor(() => expect(api.time).toBeCloseTo(2.5, 2));

    fireEvent.click(screen.getByTestId("effect-preview-restart"));
    await waitFor(() => expect(api.time).toBeCloseTo(2, 2));

    expect(api.project).toBe(project);
    expect(api.lightingEffectPreview.length).toBeGreaterThan(0);
  });

  it("cancels without touching the project or undo depth", async () => {
    await mount();
    const project = api.project;
    const history = api.timelineHistoryDepth.past;
    fireEvent.click(screen.getByTestId("effect-stack-add-SOLID"));
    await waitFor(() => expect(screen.getByTestId("effect-preview-cancel")).toBeTruthy());

    fireEvent.click(screen.getByTestId("effect-preview-cancel"));

    await waitFor(() => expect(screen.queryByTestId("effect-live-preview")).toBeNull());
    expect(api.lightingEffectPreview).toHaveLength(0);
    expect(api.project).toBe(project);
    expect(api.timelineHistoryDepth.past).toBe(history);
  });

  it("cancels the preview when Escape is pressed", async () => {
    await mount();
    fireEvent.click(screen.getByTestId("effect-stack-add-SOLID"));
    await waitFor(() => expect(screen.getByTestId("effect-live-preview")).toBeTruthy());

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.queryByTestId("effect-live-preview")).toBeNull());
    expect(api.lightingEffectPreview).toHaveLength(0);
  });

  it("cancels the preview when the selection changes", async () => {
    await mount();
    fireEvent.click(screen.getByTestId("effect-stack-add-SOLID"));
    await waitFor(() => expect(screen.getByTestId("effect-live-preview")).toBeTruthy());

    act(() => api.selectSceneObject(null, "REPLACE"));

    await waitFor(() => expect(screen.queryByTestId("effect-live-preview")).toBeNull());
    expect(api.lightingEffectPreview).toHaveLength(0);
  });

  it("applies exactly one project mutation and one undo entry", async () => {
    await mount();
    const before = api.project;
    const history = api.timelineHistoryDepth.past;
    fireEvent.click(screen.getByTestId("effect-stack-add-SOLID"));
    await waitFor(() => expect(screen.getByTestId("effect-preview-apply")).toBeTruthy());

    fireEvent.click(screen.getByTestId("effect-preview-apply"));

    await waitFor(() => expect(api.lightingEffects.length).toBe(1));
    expect(api.project).not.toBe(before);
    expect(api.timelineHistoryDepth.past).toBe(history + 1);
    expect(screen.queryByTestId("effect-live-preview")).toBeNull();

    act(() => api.undoTimeline());
    await waitFor(() => expect(api.lightingEffects.length).toBe(0));
  });

  it("keeps Apply and Cancel in a wrapping row, not a horizontal scroller", async () => {
    await mount();
    fireEvent.click(screen.getByTestId("effect-stack-add-SOLID"));
    await waitFor(() => expect(screen.getByTestId("effect-live-preview")).toBeTruthy());

    const transport = screen.getByTestId("effect-preview-transport");
    expect(transport.className).toContain("flex-wrap");
    expect(transport.className).not.toContain("overflow-x");
    expect(screen.getByTestId("effect-preview-apply").getAttribute("aria-label")).toBe(
      "Apply preview",
    );
    expect(screen.getByTestId("effect-preview-cancel").getAttribute("aria-label")).toBe(
      "Cancel preview",
    );
    expect(screen.getByRole("status").textContent).toContain("Solid colour");
  });
});
