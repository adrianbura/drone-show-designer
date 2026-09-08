// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import VisualStatesTrack from "@/components/studio/VisualStatesTrack";
import { projectFileToJson, serializeProject } from "@/lib/project/serialize";
import { createDefaultProject } from "@/lib/show/defaultProject";
import { addObject, emptyScene, upsertScene } from "@/lib/show/scene";
import type { ShowProject } from "@/lib/show/types";
import { StudioProvider, useStudio } from "@/lib/studio/store";
import { setSelectedVisualStateCueId } from "@/lib/studio/visualStateCueSelection";
import { onWorkspaceSectionRequest } from "@/lib/studio/workspaceSections";

type Studio = ReturnType<typeof useStudio>;
let api: Studio;

function Harness() {
  api = useStudio();
  return <VisualStatesTrack viewStart={0} viewEnd={40} />;
}

function fixture(): { project: ShowProject; clipId: string } {
  const base = createDefaultProject(60);
  const clip = {
    id: "states-clip",
    formationId: "f-sphere",
    start: 4,
    transition: 6,
    hold: 12,
    easing: "minJerk" as const,
    color: [255, 255, 255] as const,
    effect: "solid" as const,
    phase: "SHOW" as const,
  };
  const withClip = { ...base, timeline: [clip] };
  const added = addObject(withClip, emptyScene(clip.id, "Composition"), {
    source: { kind: "STATIC", formationId: clip.formationId },
    name: "Ring",
    requestedDroneCount: 30,
  });
  return { project: upsertScene(withClip, added.scene), clipId: clip.id };
}

async function mount() {
  const { project, clipId } = fixture();
  render(
    <StudioProvider>
      <Harness />
    </StudioProvider>,
  );
  await act(async () => {
    await api.openProjectFile(
      new File([projectFileToJson(serializeProject(project, {}))], "s.dsp.json", {
        type: "application/json",
      }),
    );
  });
  act(() => api.selectClip(clipId));
  await waitFor(() => expect(api.selectedScene).toBeTruthy());
  return clipId;
}

async function addCue() {
  const clipId = await mount();
  const objectId = api.selectedScene!.objects[0]!.id;
  act(() => api.duplicateSceneObject(clipId, objectId));
  await waitFor(() => expect(api.selectedScene!.objects).toHaveLength(2));
  const secondId = api.selectedScene!.objects[1]!.id;
  act(() => api.setSelectedSceneObjectIds([objectId, secondId], secondId));
  act(() => {
    api.createSceneVisualGroup("Ring group");
  });
  await waitFor(() => expect(api.selectedScene!.visualGroups ?? []).toHaveLength(1));
  const groupId = api.selectedScene!.visualGroups![0]!.id;
  act(() => {
    api.captureSceneVisualGroupState(groupId, "Wide");
  });
  await waitFor(() => expect(api.selectedScene!.visualStates ?? []).toHaveLength(1));
  const stateId = api.selectedScene!.visualStates![0]!.id;
  // Playhead 3s into the hold => canonical local cue time 3.
  act(() => api.setTime(4 + 6 + 3));
  act(() => {
    api.addSceneVisualStateCueAtPlayhead(stateId, 2);
  });
  await waitFor(() => expect(api.selectedScene!.visualStateCues).toHaveLength(1));
  return { clipId, cueId: api.selectedScene!.visualStateCues![0]!.id };
}

afterEach(() => {
  cleanup();
  setSelectedVisualStateCueId(null);
});

/** jsdom reports a zero-size lane; give it a deterministic 400px = 40s mapping. */
function stubLane() {
  const lane = document.getElementById("visual-states-track-lane")!;
  lane.getBoundingClientRect = () => ({ left: 0, width: 400, top: 0, height: 20 }) as DOMRect;
}

function dragBody(cueId: string, clientX: number, release = true) {
  const block = screen.getByTestId(`visual-state-cue-${cueId}`);
  fireEvent.pointerDown(block, { clientX: 0 });
  fireEvent.pointerMove(window, { clientX });
  if (release) fireEvent.pointerUp(window, { clientX });
}

describe("visual states timeline lane", () => {
  it("renders nothing when the scene has no cues", async () => {
    await mount();
    expect(screen.queryByTestId("visual-states-track")).toBeNull();
  });

  it("renders one canonical cue block with full details", async () => {
    const { cueId } = await addCue();
    await waitFor(() => expect(screen.getByTestId("visual-states-track")).toBeTruthy());
    const block = screen.getByTestId(`visual-state-cue-${cueId}`);
    const title = block.getAttribute("title") ?? "";
    expect(title).toContain("Wide");
    expect(title).toContain("Ring group");
    expect(title).toContain("13.00s"); // target = 4 + 6 + 3
    expect(title).toContain("11.00s"); // transition start = target - 2
    expect(title).toContain("drag body to retime");
  });

  it("seeks the canonical playhead and routes to the saved states inspector", async () => {
    const { cueId } = await addCue();
    act(() => api.setTime(0));
    const seen = vi.fn();
    const off = onWorkspaceSectionRequest(seen);
    fireEvent.click(screen.getByTestId(`visual-state-cue-${cueId}`));
    await waitFor(() => expect(api.time).toBeCloseTo(13, 5));
    expect(seen).toHaveBeenCalled();
    expect(seen.mock.calls[0]![0].section).toBe("STATES");
    expect(screen.getByTestId(`visual-state-cue-${cueId}`).getAttribute("data-selected")).toBe("1");
    off();
  });

  it("deletes a cue through the canonical action with a single undo revision", async () => {
    const { cueId } = await addCue();
    fireEvent.click(screen.getByTestId(`visual-state-cue-delete-${cueId}`));
    await waitFor(() => expect(api.selectedScene!.visualStateCues ?? []).toHaveLength(0));
    act(() => api.undoTimeline());
    await waitFor(() => expect(api.selectedScene!.visualStateCues ?? []).toHaveLength(1));
  });

  it("collapses the lane without removing canonical data", async () => {
    const { cueId } = await addCue();
    fireEvent.click(screen.getByTestId("visual-states-track-toggle"));
    await waitFor(() => expect(screen.queryByTestId(`visual-state-cue-${cueId}`)).toBeNull());
    expect(api.selectedScene!.visualStateCues).toHaveLength(1);
  });

  it("does not mutate the project while the pointer moves, then commits once", async () => {
    const { cueId } = await addCue();
    const before = api.selectedScene!.visualStateCues![0]!;
    stubLane();
    const block = screen.getByTestId(`visual-state-cue-${cueId}`);
    fireEvent.pointerDown(block, { clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 160 });
    expect(api.selectedScene!.visualStateCues![0]).toEqual(before);
    await waitFor(() =>
      expect(screen.getByTestId(`visual-state-cue-${cueId}`).getAttribute("data-preview")).toBe("1"),
    );
    fireEvent.pointerUp(window, { clientX: 160 });
    await waitFor(() => expect(api.selectedScene!.visualStateCues![0]!.time).toBeCloseTo(6, 5));
    act(() => api.undoTimeline());
    await waitFor(() => expect(api.selectedScene!.visualStateCues![0]!.time).toBeCloseTo(3, 5));
    act(() => api.redoTimeline());
    await waitFor(() => expect(api.selectedScene!.visualStateCues![0]!.time).toBeCloseTo(6, 5));
  });

  it("cancels a drag on Escape without mutating the project", async () => {
    const { cueId } = await addCue();
    const before = api.selectedScene!.visualStateCues![0]!;
    stubLane();
    dragBody(cueId, 160, false);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(window, { clientX: 160 });
    await waitFor(() =>
      expect(screen.getByTestId(`visual-state-cue-${cueId}`).getAttribute("data-preview")).toBe("0"),
    );
    expect(api.selectedScene!.visualStateCues![0]).toEqual(before);
  });

  it("resizes the transition through one canonical commit", async () => {
    const { cueId } = await addCue();
    stubLane();
    const handle = screen.getByTestId(`visual-state-cue-resize-${cueId}`);
    fireEvent.pointerDown(handle, { clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 120 });
    expect(api.selectedScene!.visualStateCues![0]!.transitionDuration).toBe(2);
    fireEvent.pointerUp(window, { clientX: 120 });
    await waitFor(() =>
      expect(api.selectedScene!.visualStateCues![0]!.transitionDuration).toBeCloseTo(1, 5),
    );
    act(() => api.undoTimeline());
    await waitFor(() =>
      expect(api.selectedScene!.visualStateCues![0]!.transitionDuration).toBeCloseTo(2, 5),
    );
  });

  it("still seeks on a click without pointer movement", async () => {
    const { cueId } = await addCue();
    act(() => api.setTime(0));
    const block = screen.getByTestId(`visual-state-cue-${cueId}`);
    fireEvent.pointerDown(block, { clientX: 0 });
    fireEvent.pointerUp(block, { clientX: 0 });
    fireEvent.click(block);
    await waitFor(() => expect(api.time).toBeCloseTo(13, 5));
    expect(api.selectedScene!.visualStateCues![0]!.time).toBe(3);
  });
});
