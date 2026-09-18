import { describe, expect, it } from "vitest";

import { summarizeCompileIssues } from "../imageDiagnostics";
import { en } from "@/i18n/en";
import { ro } from "@/i18n/ro";
import type { VisualCompileIssue } from "@/lib/visual";

const issue = (
  code: VisualCompileIssue["code"],
  severity: VisualCompileIssue["severity"],
  detail: Record<string, number | string> = {},
): VisualCompileIssue => ({ code, severity, detail });

describe("reference image diagnostics summary", () => {
  it("reports a clear state when the compiler found nothing", () => {
    const summary = summarizeCompileIssues([]);
    expect(summary.status).toBe("CLEAR");
    expect(summary.warningCount).toBe(0);
    expect(summary.infoCount).toBe(0);
    expect(summary.guidance).toEqual([]);
  });

  it("raises attention only for compiler warnings and counts notes separately", () => {
    const summary = summarizeCompileIssues([
      issue("SPACING_TIGHT", "warning", { minSpacing: 0.9, spacingTarget: 1.5 }),
      issue("SYMMETRY_ADJUSTED", "info", { primitiveId: "img-1" }),
    ]);
    expect(summary.status).toBe("ATTENTION");
    expect(summary.warningCount).toBe(1);
    expect(summary.infoCount).toBe(1);
    expect(summary.guidance).toEqual(["SPACING_TIGHT", "SYMMETRY_ADJUSTED"]);
  });

  it("stays clear when only info issues exist but still offers guidance", () => {
    const summary = summarizeCompileIssues([issue("UNDER_RESOLVED", "info", { points: 16 })]);
    expect(summary.status).toBe("CLEAR");
    expect(summary.infoCount).toBe(1);
    expect(summary.guidance).toEqual(["DETAILS_OMITTED"]);
  });

  it("collapses resolution issues into one hint and never repeats a code", () => {
    const summary = summarizeCompileIssues([
      issue("DETAILS_OMITTED", "warning", { count: 5 }),
      issue("UNDER_RESOLVED", "info", { primitiveId: "img-outer-1", points: 16 }),
      issue("SPACING_TIGHT", "warning", { minSpacing: 0.3, spacingTarget: 1.2 }),
      issue("SPACING_TIGHT", "warning", { minSpacing: 0.2, spacingTarget: 1.2 }),
    ]);
    expect(summary.warningCount).toBe(3);
    expect(summary.guidance).toEqual(["DETAILS_OMITTED", "SPACING_TIGHT"]);
  });

  it("has English and Romanian text for every status, severity label and guidance code", () => {
    const keys = [
      "image.compile.statusClear",
      "image.compile.statusAttention",
      "image.compile.notes",
      "image.compile.severity.warning",
      "image.compile.severity.info",
      "image.compile.guidanceTitle",
      "image.compile.guide.DETAILS_OMITTED",
      "image.compile.guide.UNDER_RESOLVED",
      "image.compile.guide.SPACING_TIGHT",
      "image.compile.guide.BUDGET_EXCEEDS_DESIGN",
      "image.compile.guide.EMPTY_DESIGN",
      "image.compile.guide.SYMMETRY_ADJUSTED",
    ] as const;
    for (const key of keys) {
      expect(en[key].length).toBeGreaterThan(0);
      expect(ro[key].length).toBeGreaterThan(0);
      expect(ro[key]).not.toBe(en[key]);
    }
    // Guidance is design advice, never a flight-safety or approval claim.
    for (const key of keys) {
      expect(`${en[key]} ${ro[key]}`.toLowerCase()).not.toContain("safe");
      expect(`${en[key]} ${ro[key]}`.toLowerCase()).not.toContain("approv");
    }
  });

  it("carries no blocking signal, so saving stays possible with warnings", () => {
    const summary = summarizeCompileIssues([issue("SPACING_TIGHT", "warning", {})]);
    expect(Object.keys(summary).sort()).toEqual([
      "guidance",
      "infoCount",
      "status",
      "warningCount",
    ]);
  });
});
