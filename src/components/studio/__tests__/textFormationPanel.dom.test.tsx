// @vitest-environment jsdom
/**
 * FOCUSED TEXT FORMATION EDITOR — REAL DOM CONTRACT.
 *
 * These tests drive the panel through the REAL store (a project is opened via
 * the canonical `openProjectFile` path, exactly like a user opening a saved
 * document), so nothing here can pass against a mocked apply path.
 *
 * Pinned contract:
 *   - Cancel mutates nothing (project, history, reference layer untouched).
 *   - Apply is disabled until canonical evidence exists for THIS proposal.
 *   - Changing the recipe after Evaluate makes the evidence stale and disables
 *     Apply again; stale evidence can never be applied.
 *   - Blocked canonical analysis keeps Apply disabled.
 *   - A successful Apply creates EXACTLY ONE history entry.
 *
 * Fixture honesty: this suite uses the SYNTHETIC imported ESSP fixture from the
 * shared geometry-apply harness. The real 150-drone customer Scene 31 archive is
 * NOT exercised here.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import TextFormationPanel from "@/components/studio/TextFormationPanel";
import { projectFileToJson, serializeProject } from "@/lib/project/serialize";
import type { ShowProject } from "@/lib/show/types";
import { StudioProvider, useStudio } from "@/lib/studio/store";
import { importedFixture } from "@/lib/studio/__tests__/support/geometryApplyHarness";

type Studio = ReturnType<typeof useStudio>;

let api: Studio;

function Harness() {
  api = useStudio();
  return <TextFormationPanel />;
}

function projectFile(project: ShowProject): File {
  return new File([projectFileToJson(serializeProject(project, {}))], "text-dom.dsp.json", {
    type: "application/json",
  });
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
  await waitFor(() => expect(screen.queryByTestId("text-open-editor")).not.toBeNull());
}

function click(testId: string) {
  act(() => {
    screen.getByTestId(testId).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function typeText(value: string) {
  fireEvent.change(screen.getByTestId("text-input"), { target: { value } });
}

/** Middle static clip: it has real neighbours on both sides. */
async function scenario() {
  const { project } = await importedFixture();
  const clip = project.timeline[Math.floor(project.timeline.length / 2)]!;
  return { project, clipId: clip.id };
}

afterEach(cleanup);

describe("text formation editor DOM", () => {
  it("cancel is a true no-op", async () => {
    const { project, clipId } = await scenario();
    await mount(project, clipId);
    const before = JSON.stringify(api.project);
    const historyBefore = { ...api.timelineHistoryDepth };

    click("text-open-editor");
    typeText("RALLY");
    await waitFor(() => expect(screen.queryByTestId("text-preview-info")).not.toBeNull());
    click("text-cancel");

    expect(JSON.stringify(api.project)).toBe(before);
    expect(api.timelineHistoryDepth).toEqual(historyBefore);
    expect(screen.queryByTestId("text-open-editor")).not.toBeNull();
  });

  it("shows transition optimization evidence after Evaluate, without mutating the project", async () => {
    const { project, clipId } = await scenario();
    await mount(project, clipId);
    const before = JSON.stringify(api.project);

    click("text-open-editor");
    typeText("RALLY");
    await waitFor(() => expect(screen.queryByTestId("text-preview-info")).not.toBeNull());

    // No evaluation yet -> no optimization evidence.
    expect(screen.queryByTestId("text-transition-optimization")).toBeNull();

    click("text-evaluate");
    await waitFor(() => expect(screen.queryByTestId("text-readiness")).not.toBeNull());

    expect(screen.queryByTestId("text-evidence-error")).toBeNull();
    expect(screen.queryByTestId("text-transition-optimization")).not.toBeNull();
    expect(screen.queryByTestId("text-fullshow-before-after")).not.toBeNull();
    expect(screen.queryByTestId(`text-transition-row-${clipId}`)).not.toBeNull();
    expect(JSON.stringify(api.project)).toBe(before);

    // A recipe change invalidates the evidence exactly like the existing flow.
    typeText("RALLYX");
    await waitFor(() => expect(screen.queryByTestId("text-evidence-stale")).not.toBeNull());
  });

  it("requires canonical evidence, discards it when the recipe changes, and applies once", async () => {
    const { project, clipId } = await scenario();
    await mount(project, clipId);
    const historyBefore = api.timelineHistoryDepth.past;

    click("text-open-editor");
    typeText("RALLY");
    await waitFor(() => expect(screen.queryByTestId("text-preview-info")).not.toBeNull());

    // No analysis yet -> Apply must be impossible.
    expect((screen.getByTestId("text-apply") as HTMLButtonElement).disabled).toBe(true);

    click("text-evaluate");
    await waitFor(() => expect(screen.queryByTestId("text-readiness")).not.toBeNull());

    // A recipe change invalidates the previous canonical analysis.
    typeText("RALLYX");
    await waitFor(() => expect(screen.queryByTestId("text-evidence-stale")).not.toBeNull());
    expect((screen.getByTestId("text-apply") as HTMLButtonElement).disabled).toBe(true);

    click("text-evaluate");
    await waitFor(() => expect(screen.queryByTestId("text-evidence-stale")).toBeNull());

    const applyBtn = screen.getByTestId("text-apply") as HTMLButtonElement;
    if (applyBtn.disabled) {
      // Blocked canonical analysis: Apply stays impossible and nothing changed.
      expect(screen.queryByTestId("text-blockers")).not.toBeNull();
      expect(api.timelineHistoryDepth.past).toBe(historyBefore);
      return;
    }

    click("text-apply");
    await waitFor(() => expect(screen.queryByTestId("text-applied")).not.toBeNull());
    // EXACTLY one revision.
    expect(api.timelineHistoryDepth.past).toBe(historyBefore + 1);

    act(() => api.undoTimeline());
    expect(api.timelineHistoryDepth.past).toBe(historyBefore);
  });
});
