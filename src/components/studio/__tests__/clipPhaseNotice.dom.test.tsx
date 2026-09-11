// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import SceneComposerPanel from "@/components/studio/SceneComposerPanel";
import { projectFileToJson, serializeProject } from "@/lib/project/serialize";
import { createDefaultProject } from "@/lib/show/defaultProject";
import { addObject, emptyScene, upsertScene } from "@/lib/show/scene";
import type { Formation, ShowPhase, ShowProject, TimelineClip } from "@/lib/show/types";
import { StudioProvider, useStudio } from "@/lib/studio/store";
import { onWorkspaceSectionRequest } from "@/lib/studio/workspaceSections";

type Studio = ReturnType<typeof useStudio>;

let api: Studio;

function Harness() {
  api = useStudio();
  return <SceneComposerPanel />;
}

function projectFile(project: ShowProject): File {
  return new File([projectFileToJson(serializeProject(project, {}))], "phase.dsp.json", {
    type: "application/json",
  });
}

function formation(id: string): Formation {
  return {
    id,
    name: id,
    kind: "line",
    points: Array.from({ length: 30 }, (_, i) => [i, 20, 0] as [number, number, number]),
    params: {},
  };
}

function clip(id: string, start: number, phase: ShowPhase): TimelineClip {
  return {
    id,
    formationId: "f-a",
    start,
    transition: 10,
    hold: 5,
    easing: "minJerk",
    color: [255, 255, 255],
    effect: "solid",
    phase,
  };
}

/** Timeline with an authored scene on every clip, so only phase differs. */
function phaseProject(phases: readonly ShowPhase[]): { project: ShowProject; clips: string[] } {
  const base = createDefaultProject(60);
  const clips = phases.map((phase, i) => clip(`clip-${i}`, i * 20, phase));
  let project: ShowProject = {
    ...base,
    timeline: clips,
    formations: [...base.formations, formation("f-a")],
  };
  for (const c of clips) {
    let scene = emptyScene(c.id, `Scene ${c.id}`);
    scene = addObject(project, scene, {
      source: { kind: "STATIC", formationId: "f-a" },
      name: "Line A",
      requestedDroneCount: 30,
      position: [0, 0, 0],
    }).scene;
    project = upsertScene(project, scene);
  }
  return { project, clips: clips.map((c) => c.id) };
}

async function mount(phases: readonly ShowPhase[], index: number) {
  const { project, clips } = phaseProject(phases);
  render(
    <StudioProvider>
      <Harness />
    </StudioProvider>,
  );
  await act(async () => {
    await api.openProjectFile(projectFile(project));
  });
  act(() => api.selectClip(clips[index]!));
  return clips;
}

afterEach(cleanup);

describe("clip phase notice", () => {
  it("shows editable visual authoring for a SHOW clip", async () => {
    await mount(["SHOW"], 0);
    await waitFor(() => expect(screen.getByTestId("visual-layers")).toBeTruthy());
    expect(screen.queryByTestId("clip-phase-notice")).toBeNull();
  });

  for (const phase of ["TAKEOFF", "LANDING"] as const) {
    it(`explains that ${phase} is a flight phase and hides saved states`, async () => {
      await mount([phase, "SHOW"], 0);
      await waitFor(() => expect(screen.getByTestId("clip-phase-notice")).toBeTruthy());
      expect(screen.getByTestId("clip-phase-badge").textContent).toBe(`${phase} · Flight phase`);
      expect(screen.getByTestId("clip-phase-explanation").textContent).toBe(
        "This is a flight phase. Select a SHOW clip to edit visuals.",
      );
      expect(screen.queryByTestId("visual-layers")).toBeNull();
      expect(screen.queryByTestId("visual-states")).toBeNull();
    });
  }

  it("navigates to the nearest SHOW clip without mutating the project", async () => {
    const clips = await mount(["TAKEOFF", "SHOW", "SHOW"], 0);
    await waitFor(() => expect(screen.getByTestId("clip-phase-goto-show")).toBeTruthy());
    const projectBefore = api.project;
    const historyBefore = api.timelineHistoryDepth.past;

    fireEvent.click(screen.getByTestId("clip-phase-goto-show"));

    await waitFor(() => expect(api.selectedClipId).toBe(clips[1]));
    expect(api.project).toBe(projectBefore);
    expect(api.timelineHistoryDepth.past).toBe(historyBefore);
    await waitFor(() => expect(screen.getByTestId("visual-layers")).toBeTruthy());
  });

  it("guides to the existing Add visual workflow when no SHOW clip exists", async () => {
    await mount(["TAKEOFF", "LANDING"], 0);
    await waitFor(() => expect(screen.getByTestId("clip-phase-no-show")).toBeTruthy());
    expect(screen.queryByTestId("clip-phase-goto-show")).toBeNull();
    expect(screen.getByTestId("clip-phase-no-show").textContent).toBe(
      "Add a visual to create a SHOW clip.",
    );

    const requests: string[] = [];
    const off = onWorkspaceSectionRequest((r) => requests.push(r.controlTestId ?? ""));
    const projectBefore = api.project;
    fireEvent.click(screen.getByTestId("clip-phase-focus-add-visual"));
    off();
    expect(requests).toEqual(["composer-add-visual"]);
    expect(api.project).toBe(projectBefore);
  });
});
