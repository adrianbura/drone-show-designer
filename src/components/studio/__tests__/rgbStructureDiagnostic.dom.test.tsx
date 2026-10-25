import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import RgbStructureDiagnostic from "../RgbStructureDiagnostic";
import type { analyzeRgbStructure } from "@/lib/import/essp/native/rgbStructure";

const evidence = {
  groups: {
    status: "MULTIPLE_GROUPS",
    groups: [
      { id: "G1", support: 18, supportFraction: 0.5, droneIds: [] },
      { id: "G2", support: 18, supportFraction: 0.5, droneIds: [] },
    ],
    ticks: 10,
    ambiguousFraction: 0,
    meanSimultaneousSupported: 2,
  },
  temporal: {
    status: "PERIODIC_UNVALIDATED",
    periodSeconds: 2,
    trainCorrelation: 0.9,
    heldOutCorrelation: 0.2,
    phaseCoherence: 0.5,
    waveHeldOutR2: null,
  },
  reconstruction: {
    status: "EVALUATED",
    reference: "EXACT_SOURCE",
    tolerance: 2,
    models: [
      { model: "FLEET_COLOR_PER_TICK", meanAbsError: 40, maxAbsError: 200, withinTolerance: false },
    ],
    best: "UNKNOWN",
  },
  recipe: "UNKNOWN",
} as unknown as ReturnType<typeof analyzeRgbStructure>;

describe("RgbStructureDiagnostic", () => {
  it("renders Romanian evidence with UNKNOWN fallback", () => {
    render(<RgbStructureDiagnostic evidence={evidence} ro />);
    expect(screen.getByTestId("rgb-groups").textContent).toContain("Mai multe grupuri");
    expect(screen.getByTestId("rgb-temporal").textContent).toContain("nevalidată");
    expect(screen.getByTestId("rgb-reconstruction").textContent).toContain("Necunoscut");
  });
  it("renders English", () => {
    render(<RgbStructureDiagnostic evidence={evidence} ro={false} />);
    expect(screen.getAllByText(/Effect recipe: unknown/).length).toBeGreaterThan(0);
  });
});
