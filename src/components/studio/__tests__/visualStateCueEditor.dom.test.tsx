// @vitest-environment jsdom
/**
 * Everyday numeric editing of a selected Visual State cue (presentation only).
 * Proves: keystrokes mutate nothing, one committed edit = one undo revision,
 * Escape cancels the draft, and long names stay usable in a narrow inspector.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import SceneComposerPanel from "@/components/studio/SceneComposerPanel";
import { projectFileToJson, serializeProject } from "@/lib/project/serialize";
import { createDefaultProject } from "@/lib/show/defaultProject";
import { addObject, emptyScene, upsertScene } from "@/lib/show/scene";
import type { ShowProject } from "@/lib/show/types";
import { StudioProvider, useStudio } from "@/lib/studio/store";
import { setSelectedVisualStateCueId } from "@/lib/studio/visualStateCueSelection";

type Studio = ReturnType<typeof useStudio>;
let api: Studio;

function Harness() {
  api = useStudio();
  return <SceneComposerPanel view="STATES" />;
}

const LONG_NAME =
  "Extremely long saved state name that must stay readable inside a narrow inspector column";

function fixture(): { project: ShowProject; clipId: string } {
  const base = createDefaultProject(60);
  const clip = {
    id: "cue-clip",
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

async function mountWithCue() {
  const { project, clipId } = fixture();
  render(
    <StudioProvider>
      <Harness />
    </StudioProvider>,
  );
  await act(async () => {
    await api.openProjectFile(
      new File([projectFileToJson(serializeProject(project, {}))], "cue.dsp.json", {
        type: "application/json",
      }),
    );
  });
  act(() => api.selectClip(clipId));
  await waitFor(() => expect(api.selectedScene).toBeTruthy());
  const firstId = api.selectedScene!.objects[0]!.id;
  act(() => api.duplicateSceneObject(clipId, firstId));
  await waitFor(() => expect(api.selectedScene!.objects).toHaveLength(2));
  const secondId = api.selectedScene!.objects[1]!.id;
  act(() => api.setSelectedSceneObjectIds([firstId, secondId], secondId));
  act(() => api.createSceneVisualGroup("Ring group"));
  await waitFor(() => expect(api.selectedScene!.visualGroups ?? []).toHaveLength(1));
  const groupId = api.selectedScene!.visualGroups![0]!.id;
  act(() => api.captureSceneVisualGroupState(groupId, LONG_NAME));
  await waitFor(() => expect(api.selectedScene!.visualStates ?? []).toHaveLength(1));
  const stateId = api.selectedScene!.visualStates![0]!.id;
  act(() => api.setTime(4 + 6 + 3));
  act(() => {
    api.addSceneVisualStateCueAtPlayhead(stateId, 2);
  });
  await waitFor(() => expect(api.selectedScene!.visualStateCues).toHaveLength(1));
  const cueId = api.selectedScene!.visualStateCues![0]!.id;
  act(() => setSelectedVisualStateCueId(cueId));
  await waitFor(() => expect(screen.getByTestId("visual-state-cue-editor")).toBeTruthy());
  return cueId;
}

afterEach(() => {
  cleanup();
  setSelectedVisualStateCueId(null);
});

describe("visual state cue editor", () => {
  it("shows canonical cue details including the calculated transition start", async () => {
    await mountWithCue();
    expect(screen.getByTestId("visual-state-cue-editor").textContent).toContain(LONG_NAME);
    expect(screen.getByTestId("visual-state-cue-editor-group").textContent).toContain("Ring group");
    expect(screen.getByTestId("visual-state-cue-editor-start").textContent).toContain("1.00s");
    expect((screen.getByTestId("visual-state-cue-editor-time") as HTMLInputElement).value).toBe(
      "3",
    );
    expect((screen.getByTestId("visual-state-cue-editor-duration") as HTMLInputElement).value).toBe(
      "2",
    );
  });

  it("commits target time once on Enter and once on blur", async () => {
    await mountWithCue();
    const field = screen.getByTestId("visual-state-cue-editor-time");
    const before = api.timelineHistoryDepth.past;
    fireEvent.change(field, { target: { value: "7" } });
    expect(api.selectedScene!.visualStateCues![0]!.time).toBe(3);
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(api.selectedScene!.visualStateCues![0]!.time).toBe(7));
    expect(api.timelineHistoryDepth.past).toBe(before + 1);
    act(() => api.undoTimeline());
    await waitFor(() => expect(api.selectedScene!.visualStateCues![0]!.time).toBe(3));
  });

  it("commits transition duration once on blur", async () => {
    await mountWithCue();
    const field = screen.getByTestId("visual-state-cue-editor-duration");
    const before = api.timelineHistoryDepth.past;
    fireEvent.change(field, { target: { value: "0.5" } });
    expect(api.selectedScene!.visualStateCues![0]!.transitionDuration).toBe(2);
    fireEvent.blur(field);
    await waitFor(() =>
      expect(api.selectedScene!.visualStateCues![0]!.transitionDuration).toBe(0.5),
    );
    expect(api.timelineHistoryDepth.past).toBe(before + 1);
  });

  it("cancels the draft on Escape without mutating the project", async () => {
    await mountWithCue();
    const field = screen.getByTestId("visual-state-cue-editor-time");
    fireEvent.change(field, { target: { value: "9" } });
    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() => expect((field as HTMLInputElement).value).toBe("3"));
    expect(api.selectedScene!.visualStateCues![0]!.time).toBe(3);
  });
});
