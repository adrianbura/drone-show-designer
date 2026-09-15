/**
 * VALIDATION REPORT — the printable document is a pure projection.
 *
 * These tests observe that the document only restates facts the full-show
 * validator already produced, that it is deterministic, and that the rendered
 * bytes form a structurally valid PDF carrying the disclaimer.
 */
import { describe, expect, it } from "vitest";

import {
  buildValidationReport,
  renderValidationReportPdf,
  validationReportFileName,
  VALIDATION_REPORT_DISCLAIMER,
} from "@/lib/report";
import { createDemoProject } from "@/lib/show/defaultProject";
import { makeFormation } from "@/lib/show/formations";
import { analyzeFullShow } from "@/lib/show/fullshow";
import { rectangularPerimeter, type ShowSite } from "@/lib/show/geo";
import type { ShowProject } from "@/lib/show/types";

const GENERATED_AT = "2026-09-15T05:00:00.000Z";
const ORIGIN = { lat: 44.4268, lon: 26.1025 };
const settings = { sampleRate: 5, assignmentStrategy: "nearestNeighbor" as const };

function site(): ShowSite {
  return {
    origin: ORIGIN,
    headingDeg: 0,
    perimeter: rectangularPerimeter({ origin: ORIGIN, headingDeg: 0 }, 1200, 1200),
    marginM: 2,
    ceilingM: 400,
  };
}

function project(droneCount = 8): ShowProject {
  const base = createDemoProject();
  const p: ShowProject = { ...base, droneCount };
  return {
    ...p,
    formations: p.formations.map((f) =>
      makeFormation(f.id, f.name, f.kind, droneCount, p.area, f.params),
    ),
  };
}

function analyzed(withSite: boolean) {
  const base = project();
  const p = withSite ? { ...base, site: site() } : base;
  const { report } = analyzeFullShow(p, settings);
  return { project: p, report };
}

describe("validation report", () => {
  it("projects the analysis into a printable document without inventing facts", () => {
    const { project: p, report } = analyzed(true);
    const doc = buildValidationReport({ project: p, report, generatedAt: GENERATED_AT });

    expect(doc.status).toBe(report.status);
    expect(doc.generatedAt).toBe(GENERATED_AT);
    expect(doc.disclaimer).toBe(VALIDATION_REPORT_DISCLAIMER);
    expect(doc.sections).toHaveLength(10);

    const flat = JSON.stringify(doc);
    expect(flat).toContain(report.analysisRevision);
    expect(flat).toContain(report.engineVersion);
    expect(flat).toContain(p.limits.minSeparation.toFixed(2));
    expect(flat).toContain(report.exportReadiness.status);
  });

  it("is deterministic for identical input", () => {
    const { project: p, report } = analyzed(true);
    const a = buildValidationReport({ project: p, report, generatedAt: GENERATED_AT });
    const b = buildValidationReport({ project: p, report, generatedAt: GENERATED_AT });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(renderValidationReportPdf(a)).toEqual(renderValidationReportPdf(b));
  });

  it("states plainly when no flight site is authored", () => {
    const { project: p, report } = analyzed(false);
    const doc = buildValidationReport({ project: p, report, generatedAt: GENERATED_AT });
    expect(JSON.stringify(doc.sections[0])).toContain("No real-world flight site");
  });

  it("renders a structurally valid multi-page PDF byte stream", () => {
    const { project: p, report } = analyzed(true);
    const bytes = renderValidationReportPdf(
      buildValidationReport({ project: p, report, generatedAt: GENERATED_AT }),
    );
    const text = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Type /Catalog");
    expect(text).toContain("startxref");
    expect((text.match(/\/Type \/Page[^s]/g) ?? []).length).toBeGreaterThan(1);
    expect(text).toContain("not a flight authorisation");
  });

  it("builds a filesystem-safe file name", () => {
    const named = { ...project(), name: "Lloret / Show #1" };
    expect(validationReportFileName(named, GENERATED_AT)).toMatch(
      /^[a-z0-9-]+-validation-[0-9T-]+\.pdf$/,
    );
  });
});
