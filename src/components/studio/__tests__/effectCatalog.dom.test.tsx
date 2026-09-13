// @vitest-environment jsdom
/**
 * EFFECT CATALOG INTEGRATION — proves the catalog has exactly ONE home, that
 * navigating to it mutates nothing, and that preview → Apply/Cancel keeps the
 * canonical history contract (Apply == one entry, Cancel == none).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import EffectStackPanel from "@/components/studio/EffectStackPanel";
import Inspector from "@/components/studio/Inspector";
import { I18nProvider } from "@/i18n/provider";
import { LibraryProvider } from "@/lib/library/provider";
import { projectFileToJson, serializeProject } from "@/lib/project/serialize";
import { createDefaultProject } from "@/lib/show/defaultProject";
import { addObject, emptyScene, upsertScene } from "@/lib/show/scene";
import type { ShowProject } from "@/lib/show/types";
import { StudioProvider, useStudio } from "@/lib/studio/store";
import { useTimelineCommands } from "@/lib/studio/useTimelineCommands";

type Studio = ReturnType<typeof useStudio>;
let api: Studio;
let execute: ReturnType<typeof useTimelineCommands>["execute"];

function fixture(): { project: ShowProject; clipId: string } {
  const base = createDefaultProject(150);
  const clip = {
    id: "catalog-clip",
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
  const added = addObject(withClip, emptyScene(clip.id, "Composition"), {
    source: { kind: "STATIC", formationId: clip.formationId },
    name: "Catalog target",
    requestedDroneCount: 60,
  });
  return { project: upsertScene(withClip, added.scene), clipId: clip.id };
}

function PanelHarness({ view }: { view: "COLOR" | "MOTION" | "CATALOG" }) {
  api = useStudio();
  return <EffectStackPanel view={view} />;
}

function InspectorHarness() {
  api = useStudio();
  execute = useTimelineCommands().execute;
  return <Inspector />;
}

function mount(node: React.ReactNode) {
  render(
    <I18nProvider>
      <LibraryProvider>
        <StudioProvider>{node}</StudioProvider>
      </LibraryProvider>
    </I18nProvider>,
  );
}

/** Loads the fixture and selects the object, so effects can be applied. */
async function openWithSelection() {
  const { project, clipId } = fixture();
  await act(async () => {
    await api.openProjectFile(
      new File([projectFileToJson(serializeProject(project, {}))], "catalog.dsp.json", {
        type: "application/json",
      }),
    );
  });
  act(() => api.selectClip(clipId));
  await waitFor(() => expect(api.selectedScene).toBeTruthy());
  const objectId = api.selectedScene!.objects[0]!.id;
  act(() => api.setSelectedSceneObjectIds([objectId], objectId));
  await waitFor(() => expect(api.selectedSceneObjectIds).toEqual([objectId]));
  return { clipId, objectId };
}

afterEach(cleanup);

describe("effect catalog integration", () => {
  it("renders the searchable catalog only in the dedicated CATALOG view", async () => {
    mount(<PanelHarness view="CATALOG" />);
    await openWithSelection();
    expect(screen.getByTestId("effect-catalog")).toBeTruthy();
    expect(screen.getByTestId("effect-catalog-search")).toBeTruthy();
    cleanup();

    mount(<PanelHarness view="COLOR" />);
    await openWithSelection();
    expect(screen.queryByTestId("effect-catalog")).toBeNull();
    // Colour keeps its context, its preset controls and its inspector.
    expect(screen.getByTestId("effect-selection-context")).toBeTruthy();
    expect(screen.getByTestId("effect-stack-presets")).toBeTruthy();
    cleanup();

    mount(<PanelHarness view="MOTION" />);
    await openWithSelection();
    expect(screen.queryByTestId("effect-catalog")).toBeNull();
    expect(screen.getByTestId("effect-selection-context")).toBeTruthy();
    expect(screen.getByTestId("motion-stack-presets")).toBeTruthy();
  });

  it("opens and focuses the catalog from the clip command without mutating anything", async () => {
    mount(<InspectorHarness />);
    const { clipId } = await openWithSelection();

    const before = api.project;
    const depth = api.timelineHistoryDepth.past;
    act(() => execute("OPEN_EFFECT_CATALOG", { clipId }));

    await waitFor(() =>
      expect(screen.getByTestId("authoring-tool-catalog").getAttribute("aria-expanded")).toBe(
        "true",
      ),
    );
    const search = await screen.findByTestId("effect-catalog-search");
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(api.selectedClipId).toBe(clipId);
    expect(api.project).toBe(before);
    expect(api.timelineHistoryDepth.past).toBe(depth);
  });

  it("previews a colour effect and commits nothing on Cancel", async () => {
    mount(<PanelHarness view="CATALOG" />);
    await openWithSelection();

    const before = api.project;
    const depth = api.timelineHistoryDepth.past;
    fireEvent.click(screen.getByTestId("effect-catalog-apply-COLOR:SOLID"));
    await waitFor(() => expect(screen.getByTestId("effect-live-preview")).toBeTruthy());
    expect(api.project).toBe(before);
    expect(api.timelineHistoryDepth.past).toBe(depth);

    fireEvent.click(screen.getByTestId("effect-preview-cancel"));
    await waitFor(() => expect(screen.queryByTestId("effect-live-preview")).toBeNull());
    expect(api.project).toBe(before);
    expect(api.timelineHistoryDepth.past).toBe(depth);
  });

  it("commits exactly one history entry when a colour preview is applied", async () => {
    mount(<PanelHarness view="CATALOG" />);
    await openWithSelection();

    const depth = api.timelineHistoryDepth.past;
    const effects = api.lightingEffects.length;
    fireEvent.click(screen.getByTestId("effect-catalog-apply-COLOR:SOLID"));
    await waitFor(() => expect(screen.getByTestId("effect-live-preview")).toBeTruthy());

    fireEvent.click(screen.getByTestId("effect-preview-apply"));
    await waitFor(() => expect(screen.queryByTestId("effect-live-preview")).toBeNull());
    expect(api.timelineHistoryDepth.past).toBe(depth + 1);
    expect(api.lightingEffects.length).toBeGreaterThan(effects);
  });

  it("previews a motion effect and commits nothing on Cancel", async () => {
    mount(<PanelHarness view="CATALOG" />);
    await openWithSelection();

    const before = api.project;
    const depth = api.timelineHistoryDepth.past;
    fireEvent.click(screen.getByTestId("effect-catalog-apply-MOTION:ROTATE"));
    await waitFor(() => expect(screen.getByTestId("effect-live-preview")).toBeTruthy());
    expect(api.project).toBe(before);

    fireEvent.click(screen.getByTestId("effect-preview-cancel"));
    await waitFor(() => expect(screen.queryByTestId("effect-live-preview")).toBeNull());
    expect(api.project).toBe(before);
    expect(api.timelineHistoryDepth.past).toBe(depth);
  });

  it("cancels the running preview when the selection changes", async () => {
    mount(<PanelHarness view="CATALOG" />);
    const { clipId } = await openWithSelection();

    const before = api.project;
    const depth = api.timelineHistoryDepth.past;
    fireEvent.click(screen.getByTestId("effect-catalog-apply-COLOR:SOLID"));
    await waitFor(() => expect(screen.getByTestId("effect-live-preview")).toBeTruthy());

    act(() => api.setSelectedSceneObjectIds([], null));
    await waitFor(() => expect(screen.queryByTestId("effect-live-preview")).toBeNull());
    expect(api.selectedClipId).toBe(clipId);
    expect(api.project).toBe(before);
    expect(api.timelineHistoryDepth.past).toBe(depth);
  });
});
