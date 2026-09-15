// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import LeftPanel from "@/components/studio/LeftPanel";
import Timeline from "@/components/studio/Timeline";
import TopBar from "@/components/studio/TopBar";
import { I18nProvider } from "@/i18n";
import { LibraryProvider } from "@/lib/library/provider";
import { buildSyntheticEssp } from "@/lib/import/essp/codec";
import { StudioProvider, useStudio } from "@/lib/studio/store";

let api: ReturnType<typeof useStudio>;

function Harness() {
  api = useStudio();
  return (
    <>
      <TopBar />
      <LeftPanel />
      <Timeline />
    </>
  );
}

function referenceFiles(count: number): File[] {
  return Array.from({ length: count }, (_, index) => {
    const x = (index % 15) * 210;
    const y = Math.floor(index / 15) * 210;
    const xyz = Array.from({ length: 16 }, (__, frame) => [x, y, frame * 25]);
    const rgb = Array.from({ length: 24 }, () => [255, 80, 10]);
    const bytes = buildSyntheticEssp({ xyz, rgb });
    return new File([bytes as BlobPart], `${index + 1}.essp`, {
      type: "application/octet-stream",
    });
  });
}

afterEach(cleanup);

describe("imported ESSP presentation truth", () => {
  it("shows one consistent 150-drone reference without calling the authored timeline empty", async () => {
    render(
      <I18nProvider>
        <LibraryProvider>
          <StudioProvider>
            <Harness />
          </StudioProvider>
        </LibraryProvider>
      </I18nProvider>,
    );

    expect(api.project.droneCount).toBe(48);
    await act(async () => api.importEsspFiles(referenceFiles(150)));

    await waitFor(() => expect(api.referencePlayback).toBe(true));
    expect(api.referenceShow?.drones).toHaveLength(150);
    expect(screen.getByTestId("topbar-drones-imported").textContent).toContain("150");
    expect(screen.queryByTestId("topbar-drones")).toBeNull();
    expect(screen.getByTestId("left-panel-imported-fleet").textContent).toContain("150 drones");
    expect(screen.queryByLabelText("Fleet size")).toBeNull();
    expect(screen.getByTestId("timeline-empty-message").textContent).toContain("150");
    expect(screen.getByTestId("timeline-empty-message").textContent).toContain("0:02");
  });
});
