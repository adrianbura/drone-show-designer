import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { ro } from "@/i18n/ro";
import type { VisualCompileIssue } from "@/lib/visual";
import { summarizeCompileIssues } from "../imageDiagnostics";

const issue = (
  code: VisualCompileIssue["code"],
  severity: VisualCompileIssue["severity"],
): VisualCompileIssue => ({ code, severity, detail: {} });

describe("reference image diagnostics summary", () => {
  it("reports a clear state when the compiler found nothing", () => {
    expect(summarizeCompileIssues([])).toEqual({
      status: "CLEAR",
      warningCount: 0,
      infoCount: 0,
      guidance: [],
    });
  });
  it("raises attention only for warnings", () => {
    const summary = summarizeCompileIssues([
      issue("SPACING_TIGHT", "warning"),
      issue("SYMMETRY_ADJUSTED", "info"),
    ]);
    expect(summary).toMatchObject({ status: "ATTENTION", warningCount: 1, infoCount: 1 });
  });
  it("keeps an info-only report clear", () => {
    expect(summarizeCompileIssues([issue("UNDER_RESOLVED", "info")])).toMatchObject({
      status: "CLEAR",
      guidance: ["DETAILS_OMITTED"],
    });
  });
  it("deduplicates corrective guidance", () => {
    const summary = summarizeCompileIssues([
      issue("DETAILS_OMITTED", "warning"),
      issue("UNDER_RESOLVED", "info"),
      issue("SPACING_TIGHT", "warning"),
      issue("SPACING_TIGHT", "warning"),
    ]);
    expect(summary.guidance).toEqual(["DETAILS_OMITTED", "SPACING_TIGHT"]);
  });
  it("has English and Romanian presentation strings", () => {
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
      expect(en[key]).toBeTruthy();
      expect(ro[key]).toBeTruthy();
      expect(ro[key]).not.toBe(en[key]);
      expect(`${en[key]} ${ro[key]}`.toLowerCase()).not.toMatch(/safe|approv/);
    }
  });
  it("contains no blocking signal", () => {
    expect(Object.keys(summarizeCompileIssues([issue("SPACING_TIGHT", "warning")])).sort()).toEqual(
      ["guidance", "infoCount", "status", "warningCount"],
    );
  });
});
