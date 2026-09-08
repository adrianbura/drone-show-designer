// @vitest-environment jsdom
/**
 * Canonical safety feedback for Visual State cues (presentation only).
 * Proves: no report / stale report => "Needs check", a fresh canonical report
 * decides Safe vs Blocked, analysis creates no history entry, and a corrected
 * cue cannot show Safe until the show is re-analysed.
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import SceneComposerPanel from "@/components/studio/SceneComposerPanel";
import { projectFileToJson, serializeProject } from "@/lib/project/serialize";
import { createDemoProject } from "@/lib/show/defaultProject";
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

function fixture(): { project: ShowProject; clipId: string } {
  const base = createDemoProject(12);
  const clip = base.timeline.find((candidate) => candidate.phase === "SHOW")!;
  let scene = emptyScene(clip.id, "Composition");
  for (const formation of base.formations.slice(0, 2)) {
    scene = addObject(base, scene, {
      source: { kind: "STATIC", formationId: formation.id },
      name: formation.name,
      requestedDroneCount: 5,
    }).scene;
  }
  return { project: upsertScene(base, scene), clipId: clip.id };
}

/** Mounts the panel with one cue for one visual group. */
async function mountWithCue(options: { readonly far: boolean; readonly duration: number }) {
  const { project, clipId } = fixture();
  render(
    <StudioProvider>
      <Harness />
    </StudioProvider>,
  );
  await act(async () => {
    await api.openProjectFile(
      new File([projectFileToJson(serializeProject(project, {}))], "cue-safety.dsp.json", {
        type: "application/json",
      }),
    );
  });
  act(() => api.selectClip(clipId));
  await waitFor(() => expect(api.selectedScene).toBeTruthy());
  const ids = api.selectedScene!.objects.map((object) => object.id);
  act(() => api.setSelectedSceneObjectIds(ids, ids[0]!));
  act(() => api.createSceneVisualGroup("Logo"));
  await waitFor(() => expect(api.selectedScene!.visualGroups ?? []).toHaveLength(1));
  const groupId = api.selectedScene!.visualGroups![0]!.id;

  if (options.far) {
    // Move the group far away, capture that as the saved state, then restore the
    // original geometry so the CUE has to fly the whole distance.
    act(() => api.transformSceneObjects(clipId, ids, { position: [80, 0, 0] }));
  }
  act(() => api.captureSceneVisualGroupState(groupId, "Target state"));
  await waitFor(() => expect(api.selectedScene!.visualStates ?? []).toHaveLength(1));
  if (options.far) {
    act(() => api.transformSceneObjects(clipId, ids, { position: [-80, 0, 0] }));
  }
  const stateId = api.selectedScene!.visualStates![0]!.id;

  const clip = api.project.timeline.find((candidate) => candidate.id === clipId)!;
  act(() => api.setTime(clip.start + clip.transition + Math.min(2, clip.hold)));
  act(() => {
    api.addSceneVisualStateCueAtPlayhead(stateId, options.duration);
  });
  await waitFor(() => expect(api.selectedScene!.visualStateCues ?? []).toHaveLength(1));
  const cueId = api.selectedScene!.visualStateCues![0]!.id;
  act(() => setSelectedVisualStateCueId(cueId));
  await waitFor(() => expect(screen.getByTestId("visual-state-cue-editor")).toBeTruthy());
  return cueId;
}

async function runCheck() {
  await act(async () => {
    api.analyzeFullShow();
  });
  await waitFor(() => expect(api.fullShowReport).toBeTruthy(), { timeout: 20000 });
  await waitFor(() => expect(api.fullShowBusy).toBe(false));
}

afterEach(() => {
  cleanup();
  setSelectedVisualStateCueId(null);
});

describe("visual state cue safety", () => {
  it("shows Needs check while no analysis result exists", async () => {
    const cueId = await mountWithCue({ far: false, duration: 3 });
    expect(screen.getByTestId(`cue-safety-badge-${cueId}`).dataset["status"]).toBe("NEEDS_CHECK");
    expect(screen.getByTestId("cue-safety-details").dataset["status"]).toBe("NEEDS_CHECK");
    expect(screen.getByTestId("cue-safety-details").textContent).toContain("Needs check");
    expect(screen.getByTestId("cue-safety-check-state").textContent).toContain(
      "No safety result yet",
    );
  });

  it("reports Safe from the canonical report without creating a history entry", async () => {
    const cueId = await mountWithCue({ far: false, duration: 4 });
    const before = api.timelineHistoryDepth.past;
    await runCheck();
    expect(api.timelineHistoryDepth.past).toBe(before);
    await waitFor(() =>
      expect(screen.getByTestId(`cue-safety-badge-${cueId}`).dataset["status"]).toBe("SAFE"),
    );
    expect(screen.getByTestId("cue-safety-details").textContent).toContain("Safe");
  });

  it("reports Blocked for an unflyable cue and offers duration guidance", async () => {
    const cueId = await mountWithCue({ far: true, duration: 0.25 });
    await runCheck();
    await waitFor(() =>
      expect(screen.getByTestId(`cue-safety-badge-${cueId}`).dataset["status"]).toBe("BLOCKED"),
    );
    const details = screen.getByTestId("cue-safety-details");
    expect(details.textContent).toContain("Blocked");
    expect(screen.getByTestId("cue-safety-guidance").textContent).toContain(
      "Increase the transition duration",
    );
  });

  it("falls back to Needs check once the cue timing changes the show revision", async () => {
    const cueId = await mountWithCue({ far: false, duration: 4 });
    await runCheck();
    await waitFor(() =>
      expect(screen.getByTestId(`cue-safety-badge-${cueId}`).dataset["status"]).toBe("SAFE"),
    );
    const previous = api.selectedScene!.visualStateCues![0]!.transitionDuration;
    act(() => api.patchSceneVisualStateCueById(cueId, { transitionDuration: previous / 2 }));
    await waitFor(() =>
      expect(api.selectedScene!.visualStateCues![0]!.transitionDuration).toBe(previous / 2),
    );
    // The canonical revision mechanism invalidates the previous result: the cue
    // can never keep showing "Safe" after its timing changed.
    await waitFor(() =>
      expect(screen.getByTestId(`cue-safety-badge-${cueId}`).dataset["status"]).toBe("NEEDS_CHECK"),
    );
    expect(screen.getByTestId("cue-safety-details").textContent).toContain("Needs check");
  });
});
