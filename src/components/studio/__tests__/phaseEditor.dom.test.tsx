// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import PhaseEditorPanel from "@/components/studio/PhaseEditorPanel";
import { projectFileToJson, serializeProject } from "@/lib/project/serialize";
import { createDefaultProject } from "@/lib/show/defaultProject";
import { addObject, emptyScene, upsertScene } from "@/lib/show/scene";
import type { Formation, ShowPhase, ShowProject, TimelineClip } from "@/lib/show/types";
import { StudioProvider, useStudio } from "@/lib/studio/store";
import { requestPhaseEditor } from "@/lib/studio/phaseEditor";
import { onWorkspaceSectionRequest } from "@/lib/studio/workspaceSections";
import { onInspectorFocus } from "@/lib/studio/inspectorFocus";

type Studio = ReturnType<typeof useStudio>;

let api: Studio;

function Harness() {
  api = useStudio();
  return <PhaseEditorPanel />;
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

async function mount(phases: readonly ShowPhase[]) {
  const base = createDefaultProject(120);
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
  render(
    <StudioProvider>
      <Harness />
    </StudioProvider>,
  );
  await act(async () => {
    await api.openProjectFile(projectFile(project));
  });
  return clips.map((c) => c.id);
}

afterEach(cleanup);

describe("phase editor shell", () => {
  it("stays empty until a phase command opens it", async () => {
    await mount(["SHOW"]);
    expect(screen.getByTestId("phase-editor-empty").textContent).toContain(
      "Right-click the Formation or Display part",
    );
    expect(screen.queryByTestId("phase-editor")).toBeNull();
  });

  it("presents the FORMATION interval and transition shortcuts only", async () => {
    const clips = await mount(["SHOW"]);
    const projectBefore = api.project;
    const historyBefore = api.timelineHistoryDepth.past;

    act(() => void requestPhaseEditor(clips[0]!, "FORMATION"));

    await waitFor(() => expect(screen.getByTestId("phase-editor")).toBeTruthy());
    expect(screen.getByTestId("phase-editor-header").textContent).toBe("Formation");
    // clip 0 starts at 0, transition 10 → 0:00.00 → 0:10.00
    expect(screen.getByTestId("phase-editor-interval").textContent).toContain("0:00.00 → 0:10.00");
    expect(screen.getByTestId("phase-editor-interval-meaning").textContent).toBe(
      "Clip start to formation-ready time",
    );
    // No regular scene Motion effects and no formation colour are offered.
    expect(screen.queryByTestId("phase-editor-shortcut-MOTION")).toBeNull();
    expect(screen.queryByTestId("phase-editor-shortcut-COLOUR")).toBeNull();
    expect(screen.getByTestId("phase-editor-shortcut-TRANSITION_DESIGN")).toBeTruthy();
    expect(screen.getByTestId("phase-editor-shortcut-REPLAN_ASSIGNMENT")).toBeTruthy();
    expect(screen.getByTestId("phase-editor-shortcut-TRANSITION_DURATION")).toBeTruthy();
    expect(screen.queryByTestId("phase-editor-target")).toBeNull();
    // No Apply button exists in the shell.
    expect(screen.queryByText("Apply")).toBeNull();

    expect(api.project).toBe(projectBefore);
    expect(api.timelineHistoryDepth.past).toBe(historyBefore);
  });

  it("presents the DISPLAY interval, target and visual authoring shortcuts", async () => {
    const clips = await mount(["SHOW", "SHOW"]);
    const projectBefore = api.project;

    act(() => void requestPhaseEditor(clips[1]!, "DISPLAY"));

    await waitFor(() => expect(screen.getByTestId("phase-editor")).toBeTruthy());
    expect(screen.getByTestId("phase-editor-header").textContent).toBe("Display");
    // clip 1 starts at 20, transition 10, hold 5 → 0:30.00 → 0:35.00
    expect(screen.getByTestId("phase-editor-interval").textContent).toContain("0:30.00 → 0:35.00");
    expect(screen.getByTestId("phase-editor-interval-meaning").textContent).toBe(
      "Formation-ready time to clip end",
    );
    expect(screen.getByTestId("phase-editor-target").textContent).toContain("Target:");
    for (const id of ["VISUALS", "CATALOG", "COLOUR", "MOTION", "STATES"]) {
      expect(screen.getByTestId(`phase-editor-shortcut-${id}`)).toBeTruthy();
    }
    expect(screen.queryByTestId("phase-editor-shortcut-TRANSITION_DESIGN")).toBeNull();
    expect(api.project).toBe(projectBefore);
  });

  it("routes shortcuts to existing editors without mutating anything", async () => {
    const clips = await mount(["SHOW"]);
    act(() => void requestPhaseEditor(clips[0]!, "DISPLAY"));
    await waitFor(() => expect(screen.getByTestId("phase-editor")).toBeTruthy());

    const sections: string[] = [];
    const offSection = onWorkspaceSectionRequest((r) => sections.push(r.controlTestId ?? ""));
    const projectBefore = api.project;
    const historyBefore = api.timelineHistoryDepth.past;

    fireEvent.click(screen.getByTestId("phase-editor-shortcut-CATALOG"));
    offSection();
    expect(sections).toEqual(["effect-catalog-search"]);

    act(() => void requestPhaseEditor(clips[0]!, "FORMATION"));
    await waitFor(() =>
      expect(screen.getByTestId("phase-editor-header").textContent).toBe("Formation"),
    );
    const surfaces: string[] = [];
    const offFocus = onInspectorFocus((r) => surfaces.push(r.surface));
    fireEvent.click(screen.getByTestId("phase-editor-shortcut-TRANSITION_DESIGN"));
    offFocus();
    expect(surfaces).toEqual(["TRANSITION"]);

    expect(api.project).toBe(projectBefore);
    expect(api.timelineHistoryDepth.past).toBe(historyBefore);
  });

  it("plays and restarts the phase using the existing clock only", async () => {
    const clips = await mount(["SHOW", "SHOW"]);
    act(() => void requestPhaseEditor(clips[1]!, "DISPLAY"));
    await waitFor(() => expect(screen.getByTestId("phase-editor")).toBeTruthy());
    const projectBefore = api.project;
    const historyBefore = api.timelineHistoryDepth.past;

    fireEvent.click(screen.getByTestId("phase-editor-play"));
    await waitFor(() => expect(api.playing).toBe(true));
    expect(api.time).toBeCloseTo(30, 3);

    fireEvent.click(screen.getByTestId("phase-editor-restart"));
    await waitFor(() => expect(api.playing).toBe(false));
    expect(api.time).toBeCloseTo(30, 3);

    expect(api.project).toBe(projectBefore);
    expect(api.timelineHistoryDepth.past).toBe(historyBefore);
  });

  it("falls back to the empty notice for a flight phase clip", async () => {
    const clips = await mount(["TAKEOFF"]);
    act(() => void requestPhaseEditor(clips[0]!, "FORMATION"));
    await waitFor(() => expect(screen.getByTestId("phase-editor-empty")).toBeTruthy());
    expect(screen.queryByTestId("phase-editor")).toBeNull();
  });
});
