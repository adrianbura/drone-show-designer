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

let api: ReturnType<typeof useStudio>;

function Harness() {
  api = useStudio();
  return <Inspector />;
}

function file(project: ShowProject) {
  return new File([projectFileToJson(serializeProject(project, {}))], "authoring.dsp.json", {
    type: "application/json",
  });
}

afterEach(cleanup);

describe("everyday authoring tools", () => {
  it("shows exactly one contextual tool and switches without horizontal navigation", async () => {
    const base = createDefaultProject(50);
    const project: ShowProject = {
      ...base,
      timeline: [
        {
          id: "authoring-clip",
          formationId: base.formations[0]!.id,
          start: 0,
          transition: 10,
          hold: 5,
          easing: "minJerk",
          color: [255, 255, 255],
          effect: "solid",
          phase: "SHOW",
        },
      ],
    };
    render(
      <I18nProvider>
        <LibraryProvider>
          <StudioProvider>
            <Harness />
          </StudioProvider>
        </LibraryProvider>
      </I18nProvider>,
    );
    await act(async () => api.openProjectFile(file(project)));
    act(() => api.selectClip(project.timeline[0]!.id));

    await waitFor(() => expect(screen.getByTestId("authoring-tools")).toBeTruthy());
    expect(screen.getByTestId("scene-composer")).toBeTruthy();
    expect(screen.queryByTestId("effect-stacks")).toBeNull();

    fireEvent.click(screen.getByTestId("authoring-tool-transform"));
    await waitFor(() => expect(screen.getByTestId("scene-composer-transform")).toBeTruthy());
    expect(screen.queryByTestId("scene-composer")).toBeNull();

    fireEvent.click(screen.getByTestId("authoring-tool-color"));
    await waitFor(() => expect(screen.getByTestId("effect-stacks")).toBeTruthy());
    expect(screen.queryByTestId("motion-stack-presets")).toBeNull();
    expect(screen.getByTestId("effect-stack-presets")).toBeTruthy();

    fireEvent.click(screen.getByTestId("authoring-tool-motion"));
    await waitFor(() => expect(screen.getByTestId("motion-stack-presets")).toBeTruthy());
    expect(screen.queryByTestId("effect-stack-presets")).toBeNull();
  });
});
