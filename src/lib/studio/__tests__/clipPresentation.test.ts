import { describe, expect, it } from "vitest";

import {
  CLIP_MEDIUM_PX,
  CLIP_RICH_PX,
  clipDensity,
  clipIssueSeverity,
  clipWidthPx,
  formatRippleDelta,
  phaseStyle,
  showsThumbnail,
} from "../clipPresentation";
import type { FullShowIssue } from "@/lib/show/fullshow/types";

const view = { start: 0, end: 100 };

describe("clip presentation density", () => {
  it("derives width from the visible window only", () => {
    expect(clipWidthPx(10, view, 1000)).toBeCloseTo(100);
    // Zooming in (half the window) doubles the rendered width of the same clip.
    expect(clipWidthPx(10, { start: 0, end: 50 }, 1000)).toBeCloseTo(200);
  });

  it("escalates verbosity monotonically with width", () => {
    expect(clipDensity(10)).toBe("COMPACT");
    expect(clipDensity(CLIP_MEDIUM_PX)).toBe("MEDIUM");
    expect(clipDensity(CLIP_RICH_PX)).toBe("RICH");
    expect(clipDensity(CLIP_RICH_PX + 500)).toBe("RICH");
  });

  it("hides thumbnails only on unreadably narrow clips", () => {
    expect(showsThumbnail(20)).toBe(false);
    expect(showsThumbnail(200)).toBe(true);
  });
});

describe("phase hierarchy", () => {
  it("gives each authorable phase a distinct non-textual treatment", () => {
    const styles = (["TAKEOFF", "SHOW", "LANDING"] as const).map((p) => phaseStyle(p));
    const stripes = new Set(styles.map((s) => s.stripeClass));
    const glyphs = new Set(styles.map((s) => s.glyph));
    expect(stripes.size).toBe(3);
    expect(glyphs.size).toBe(3);
  });

  it("falls back to the SHOW treatment for the non-authorable pre-show phase", () => {
    expect(phaseStyle("PRE_SHOW")).toEqual(phaseStyle("SHOW"));
  });
});

describe("clip issue severity", () => {
  const issue = (clipId: string, severity: FullShowIssue["severity"]): FullShowIssue =>
    ({ id: `${clipId}-${severity}`, severity, message: "m", clipId }) as FullShowIssue;

  it("reports nothing without analysis", () => {
    expect(clipIssueSeverity(undefined, "a")).toBeNull();
    expect(clipIssueSeverity([], "a")).toBeNull();
  });

  it("prefers error over warning and ignores other clips", () => {
    const issues = [issue("a", "warning"), issue("a", "error"), issue("b", "error")];
    expect(clipIssueSeverity(issues, "a")).toBe("error");
    expect(clipIssueSeverity([issue("a", "warning"), issue("b", "error")], "a")).toBe("warning");
    expect(clipIssueSeverity([issue("b", "error")], "a")).toBeNull();
  });
});

describe("ripple delta readout", () => {
  it("is empty when nothing shifts", () => {
    expect(formatRippleDelta(0)).toBe("");
    expect(formatRippleDelta(Number.NaN)).toBe("");
  });

  it("is signed and locale aware", () => {
    expect(formatRippleDelta(1.5)).toBe("+1.5s");
    expect(formatRippleDelta(-0.4)).toBe("−0.4s");
    expect(formatRippleDelta(1.5, true)).toBe("+1,5s");
  });
});
