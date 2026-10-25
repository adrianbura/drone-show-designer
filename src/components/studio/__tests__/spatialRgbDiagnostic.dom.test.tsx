// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SpatialRgbDiagnostic from "../SpatialRgbDiagnostic";
import SourceScenePanel from "../SourceScenePanel";
import { buildSyntheticEssp } from "@/lib/import/essp/codec";
import { buildReferenceShow } from "@/lib/import/essp/reference";
import { buildReferenceLayer } from "@/lib/import/essp/native/layer";
import { analyzeSpatialRgb } from "@/lib/import/essp/native/spatialRgb";
import type { ReferenceClipBinding } from "@/lib/import/essp/native/types";

const state = vi.hoisted(() => ({ studio: {} }));
vi.mock("@/lib/studio/store", () => ({ useStudio: () => state.studio }));
vi.mock("@/i18n", () => ({ useI18n: () => ({ language: "ro" }) }));
const binding: ReferenceClipBinding = {
  clipId: "scene", order: 1, kind: "SCENE", sourceSegmentId: null,
  referenceStart: 0, referenceHoldStart: 0.5, referenceEnd: 1,
  owner: "REFERENCE", signature: "",
};
async function fixture(kind: "gradient" | "uniform" | "nonlinear" = "gradient") {
  return buildReferenceShow(Array.from({ length: 25 }, (_, drone) => {
    const x = drone % 5 - 2, y = Math.floor(drone / 5) - 2;
    return { name: `${drone + 1}.essp`, bytes: buildSyntheticEssp({
      xyz: Array.from({ length: 9 }, () => [x * 100, 0, 3000 + y * 100]),
      rgb: Array.from({ length: 13 }, (_, frame) => [
        kind === "uniform" ? 100 + frame : kind === "nonlinear" ? 40 + 15 * x * x + frame : 100 + 20 * x + frame,
        20, 10,
      ]),
    }) };
  }));
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("spatial RGB diagnostic", () => {
  it("renders supported measured values in a named accessible region with a live status", async () => {
    const evidence = analyzeSpatialRgb(await fixture(), binding);
    render(<SpatialRgbDiagnostic evidence={evidence} ro />);
    const panel = screen.getByRole("region", { name: "Diagnostic RGB spațial" });
    expect(within(panel).getByRole("status").textContent).toContain("Datele susțin");
    expect(within(panel).getByText("300").textContent).toBe("300");
    expect(within(panel).getByText("1.000 / 0.000 / 0.000")).toBeTruthy();
    expect(within(panel).getByText("20.00 RGB/m")).toBeTruthy();
    expect(within(panel).getByText("12.00 RGB/s")).toBeTruthy();
    expect(within(panel).getByText("-0.60 m/s")).toBeTruthy();
    expect(panel.textContent).toContain("Rețeta efectelor: necunoscută");
  });
  it.each([
    ["uniform", "Culori uniforme", false],
    ["nonlinear", "Un singur gradient stabil nu este susținut", true],
  ] as const)("renders %s without a direction or temporal speed", async (kind, message, hasFit) => {
    render(<SpatialRgbDiagnostic evidence={analyzeSpatialRgb(await fixture(kind), binding)} ro />);
    expect(screen.getByRole("status").textContent).toContain(message);
    expect(Boolean(screen.queryByText("Fit liniar mediu"))).toBe(hasFit);
    expect(screen.queryByText("Axă X / Y / Z")).toBeNull();
    expect(screen.queryByText("Viteză aparentă a câmpului")).toBeNull();
  });
  it("distinguishes insufficient and missing paired evidence", async () => {
    const show = await fixture();
    const view = render(<SpatialRgbDiagnostic evidence={analyzeSpatialRgb({ ...show, drones: show.drones.slice(0, 5) }, binding)} ro />);
    expect(screen.getByRole("status").textContent).toContain("Probe insuficiente");
    expect(screen.queryByText("Fit liniar mediu")).toBeNull();
    view.rerender(<SpatialRgbDiagnostic evidence={analyzeSpatialRgb(show, { ...binding, referenceStart: 2, referenceEnd: 3 })} ro />);
    expect(screen.getByRole("status").textContent).toContain("Nu există probe");
    expect(screen.getByText("Probe pereche XYZ/RGB").nextElementSibling?.textContent).toBe("0");
  });
  it("handles unavailable analysis and English localization", () => {
    render(<SpatialRgbDiagnostic evidence={undefined} ro={false} />);
    expect(screen.getByRole("region", { name: "Spatial RGB diagnostic" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("unavailable or unsupported");
  });
  it("never renders nonfinite metrics and gates unsupported temporal evidence", async () => {
    const evidence = analyzeSpatialRgb(await fixture(), binding);
    render(<SpatialRgbDiagnostic evidence={{ ...evidence, coherence: NaN,
      minimumCoherence: Infinity, direction: [NaN, 0, 0], strengthRgbPerMeter: Infinity,
      temporal: { ...evidence.temporal, apparentSpeedMetersPerSecond: NaN, fieldChangeRgbPerSecond: Infinity },
    }} ro />);
    expect(screen.getByRole("region").textContent).not.toMatch(/NaN|Infinity/);
    expect(screen.queryByText("Axă X / Y / Z")).toBeNull();
    expect(screen.getByText("Viteza aparentă nu este susținută de date.")).toBeTruthy();
  });
  it("integrates with selected source binding without changing the saved layer", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const layer = buildReferenceLayer(await fixture(), [binding]);
    const before = JSON.stringify(layer);
    state.studio = { referenceLayer: layer, selectedClipId: "scene" };
    const view = render(<SourceScenePanel />);
    expect(screen.getByRole("region", { name: "Diagnostic RGB spațial" })).toBeTruthy();
    expect(JSON.stringify(layer)).toBe(before);
    state.studio = { referenceLayer: layer, selectedClipId: "other" };
    view.rerender(<SourceScenePanel />);
    expect(screen.queryByRole("region")).toBeNull();
  });
});