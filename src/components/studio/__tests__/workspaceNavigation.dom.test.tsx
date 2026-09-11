// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import Inspector from "@/components/studio/Inspector";
import { I18nProvider } from "@/i18n/provider";
import { LibraryProvider } from "@/lib/library/provider";
import { projectFileToJson, serializeProject } from "@/lib/project/serialize";
import { createDefaultProject } from "@/lib/show/defaultProject";
import type { ShowProject } from "@/lib/show/types";
import { StudioProvider, useStudio } from "@/lib/studio/store";
import { requestWorkspaceSection } from "@/lib/studio/workspaceSections";

let api: ReturnType<typeof useStudio>;

function Harness() {
  api = useStudio();
  return <Inspector />;
}

function file(project: ShowProject) {
  return new File([projectFileToJson(serializeProject(project, {}))], "nav.dsp.json", {
    type: "application/json",
  });
}

function mount() {
  render(
    <I18nProvider>
      <LibraryProvider>
        <StudioProvider>
          <Harness />
        </StudioProvider>
      </LibraryProvider>
    </I18nProvider>,
  );
}

afterEach(cleanup);

describe("everyday workspace navigation", () => {
  it("shows the contextual header and keeps one section open at a time", async () => {
    const base = createDefaultProject(40);
    const project: ShowProject = {
      ...base,
      timeline: [
        {
          id: "nav-clip",
          formationId: base.formations[0]!.id,
          start: 0,
          transition: 8,
          hold: 4,
          easing: "minJerk",
          color: [255, 255, 255],
          effect: "solid",
          phase: "SHOW",
        },
      ],
    };
    mount();
    await act(async () => api.openProjectFile(file(project)));
    act(() => api.selectClip("nav-clip"));

    await waitFor(() => expect(screen.getByTestId("inspector-context-line")).toBeTruthy());
    expect(screen.getByTestId("inspector-context-drones").textContent).toContain("drones");
    expect(screen.getByTestId("inspector-context-time")).toBeTruthy();

    // Visuals is open by default; the others are collapsed.
    expect(screen.getByTestId("authoring-tool-visual").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("authoring-tool-color").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("effect-stacks")).toBeNull();

    fireEvent.click(screen.getByTestId("authoring-tool-color"));
    await waitFor(() => expect(screen.getByTestId("effect-stacks")).toBeTruthy());
    expect(screen.queryByTestId("scene-composer")).toBeNull();
    expect(screen.getByTestId("authoring-tool-visual").getAttribute("aria-expanded")).toBe("false");

    // Collapsing the open section leaves no everyday panel mounted.
    fireEvent.click(screen.getByTestId("authoring-tool-color"));
    await waitFor(() => expect(screen.queryByTestId("effect-stacks")).toBeNull());
  });

  it("opens the section that owns a requested control", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("authoring-tools")).toBeTruthy());

    act(() => void requestWorkspaceSection("motion-stack-presets"));
    await waitFor(() =>
      expect(screen.getByTestId("authoring-tool-motion").getAttribute("aria-expanded")).toBe(
        "true",
      ),
    );

    act(() => void requestWorkspaceSection("transform-section"));
    await waitFor(() =>
      expect(screen.getByTestId("authoring-tool-transform").getAttribute("aria-expanded")).toBe(
        "true",
      ),
    );
    expect(screen.getByTestId("authoring-tool-motion").getAttribute("aria-expanded")).toBe("false");
  });

  it("exposes each everyday section with an accessible collapsible header", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("workspace-section-visuals")).toBeTruthy());
    for (const tool of ["visual", "transform", "color", "motion", "states"]) {
      const header = screen.getByTestId(`authoring-tool-${tool}`);
      expect(header.tagName).toBe("BUTTON");
      expect(header.getAttribute("aria-controls")).toBeTruthy();
    }
  });

  it("keeps everyday overlays in Authoring and technical tools in Advanced", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("viewport-overlays")).toBeTruthy());

    const technical = screen.getByTestId("advanced-technical-panels");
    expect(technical.hasAttribute("hidden")).toBe(true);
    expect(screen.getByTestId("viewport-overlays").closest("[hidden]")).toBeNull();

    fireEvent.click(screen.getByTestId("inspector-tab-ADVANCED"));
    await waitFor(() => expect(technical.hasAttribute("hidden")).toBe(false));
    expect(screen.getByTestId("viewport-overlays").closest("[hidden]")).toBeTruthy();
    expect(document.getElementById("essp-panel")?.closest("[hidden]")).toBeNull();
    expect(document.getElementById("transition-panel")?.closest("[hidden]")).toBeNull();
  });
});
