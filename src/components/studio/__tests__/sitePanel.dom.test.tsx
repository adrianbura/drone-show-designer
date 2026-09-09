// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import SitePanel from "@/components/studio/SitePanel";
import { projectFileToJson, serializeProject } from "@/lib/project/serialize";
import { createDefaultProject } from "@/lib/show/defaultProject";
import { rectangularPerimeter } from "@/lib/show/geo";
import type { Formation, ShowProject } from "@/lib/show/types";
import { StudioProvider, useStudio } from "@/lib/studio/store";

type Studio = ReturnType<typeof useStudio>;

let api: Studio;

function Harness() {
  api = useStudio();
  return <SitePanel />;
}

function renderPanel() {
  return render(
    <StudioProvider>
      <Harness />
    </StudioProvider>,
  );
}

async function loadProject(project: ShowProject) {
  const file = new File([projectFileToJson(serializeProject(project, {}))], "site.dsp.json", {
    type: "application/json",
  });
  await act(async () => {
    await api.openProjectFile(file);
  });
}

function withOneClip(base: ShowProject, points: [number, number, number][]): ShowProject {
  const formation: Formation = {
    id: "site-f",
    name: "Boundary test",
    kind: "grid",
    points,
    params: {},
  };
  return {
    ...base,
    formations: [...base.formations, formation],
    timeline: [
      {
        id: "site-clip",
        formationId: formation.id,
        start: 0,
        transition: 4,
        hold: 10,
        easing: "smooth",
        color: [255, 255, 255],
        effect: "solid",
      },
    ],
  } as ShowProject;
}

afterEach(cleanup);

describe("SitePanel", () => {
  it("offers to set a site when the project has none", () => {
    renderPanel();
    expect(screen.getByTestId("site-create")).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByTestId("site-create"));
    });

    expect(api.project.site).toBeTruthy();
    expect(api.project.site!.perimeter.length).toBe(4);
    expect(screen.getByTestId("site-summary").textContent).toBeTruthy();
  });

  it("writes GPS origin edits through the canonical project patch", async () => {
    const project = createDefaultProject(50);
    renderPanel();
    await loadProject(project);
    act(() => {
      fireEvent.click(screen.getByTestId("site-create"));
    });

    act(() => {
      fireEvent.change(screen.getByTestId("site-origin-lat"), { target: { value: "45.5" } });
    });

    expect(api.project.site!.origin.lat).toBeCloseTo(45.5, 6);
  });

  it("reports the canonical verdict for formations inside the boundary", async () => {
    const base = createDefaultProject(50);
    const origin = { lat: 44.4, lon: 26.1 };
    const project: ShowProject = {
      ...withOneClip(base, [
        [0, 20, 0],
        [10, 25, 10],
      ]),
      site: {
        origin,
        headingDeg: 0,
        perimeter: rectangularPerimeter({ origin, headingDeg: 0 }, 400, 400),
        marginM: 5,
        ceilingM: 120,
      },
    };
    renderPanel();
    await loadProject(project);

    act(() => {
      fireEvent.click(screen.getByTestId("site-check"));
    });

    expect(screen.getByTestId("site-check-verdict").textContent).toContain(
      "Inside the authorised area",
    );
  });

  it("reports a blocking verdict when authored geometry leaves a tiny boundary", async () => {
    const base = createDefaultProject(50);
    const origin = { lat: 44.4, lon: 26.1 };
    const project: ShowProject = {
      ...withOneClip(base, [
        [0, 20, 0],
        [60, 25, 60],
      ]),
      site: {
        origin,
        headingDeg: 0,
        perimeter: rectangularPerimeter({ origin, headingDeg: 0 }, 4, 4),
        marginM: 0,
        ceilingM: 120,
      },
    };
    renderPanel();
    await loadProject(project);

    act(() => {
      fireEvent.click(screen.getByTestId("site-check"));
    });

    expect(screen.getByTestId("site-check-verdict").textContent).toContain(
      "Outside the authorised area",
    );
  });

  it("clears a stale verdict as soon as the site is edited", () => {
    renderPanel();
    act(() => {
      fireEvent.click(screen.getByTestId("site-create"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("site-check"));
    });
    expect(screen.queryByTestId("site-check-result")).toBeTruthy();

    act(() => {
      fireEvent.change(screen.getByTestId("site-ceiling"), { target: { value: "90" } });
    });

    expect(screen.queryByTestId("site-check-result")).toBeNull();
  });

  it("derives the viewing direction from the audience position", () => {
    renderPanel();
    act(() => {
      fireEvent.click(screen.getByTestId("site-create"));
    });
    expect(screen.getByTestId("site-audience-add")).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByTestId("site-audience-add"));
    });

    expect(api.project.site!.audience).toBeTruthy();
    expect(screen.getByTestId("site-audience-orientation").textContent).toContain("yaw");

    act(() => {
      fireEvent.click(screen.getByTestId("site-audience-remove"));
    });
    expect(api.project.site!.audience).toBeUndefined();
    expect(screen.getByTestId("site-audience-add")).toBeTruthy();
  });

  it("removes the site again without leaving a verdict behind", () => {
    renderPanel();
    act(() => {
      fireEvent.click(screen.getByTestId("site-create"));
    });

    act(() => {
      fireEvent.click(screen.getByTestId("site-remove"));
    });

    expect(api.project.site).toBeUndefined();
    expect(screen.getByTestId("site-create")).toBeTruthy();
  });
});
