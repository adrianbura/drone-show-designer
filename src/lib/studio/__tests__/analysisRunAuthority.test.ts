/**
 * FULL-SHOW ANALYSIS RACE AUTHORITY.
 *
 * The race behaviour is pure, so no timers/sleeps are needed: a "late" result is
 * simply a token whose generation has been superseded. The store harness below
 * mirrors the exact store command boundary (`invalidateDerivedAnalysis` with the
 * run-cancellation setters) so no policy is duplicated.
 */
import { describe, expect, it } from "vitest";

import { createAnalysisRunAuthority, type AnalysisRunToken } from "../analysisRunAuthority";
import { invalidateDerivedAnalysis, type DerivedAnalysisSetters } from "../derivedAnalysis";

describe("analysis run authority", () => {
  it("accepts the newest run when the revision is unchanged", () => {
    const a = createAnalysisRunAuthority();
    const run = a.begin("rev-A");
    expect(a.isCancelled(run)).toBe(false);
    expect(a.accepts(run, "rev-A")).toBe(true);
  });

  it("rejects a late success after invalidation (run A -> B)", () => {
    const a = createAnalysisRunAuthority();
    const runA = a.begin("rev-A");
    a.invalidate(); // project content replaced (apply / undo / redo / load)
    expect(a.isCancelled(runA)).toBe(true);
    expect(a.accepts(runA, "rev-A")).toBe(false);
    expect(a.accepts(runA, "rev-B")).toBe(false);
  });

  it("rejects a late error belonging to a superseded revision", () => {
    const a = createAnalysisRunAuthority();
    const runA = a.begin("rev-A");
    a.invalidate();
    // The catch branch uses the same predicate as the success branch.
    expect(a.accepts(runA, "rev-B")).toBe(false);
  });

  it("rejects a result whose starting revision is no longer current", () => {
    const a = createAnalysisRunAuthority();
    const runA = a.begin("rev-A");
    expect(a.accepts(runA, "rev-B")).toBe(false);
  });

  it("accepts run B after run A was cancelled", () => {
    const a = createAnalysisRunAuthority();
    const runA = a.begin("rev-A");
    a.invalidate();
    const runB = a.begin("rev-B");
    expect(a.accepts(runA, "rev-B")).toBe(false);
    expect(a.accepts(runB, "rev-B")).toBe(true);
  });

  it("begin cancels the previous run and generation increases monotonically", () => {
    const a = createAnalysisRunAuthority();
    const runs: AnalysisRunToken[] = [a.begin("r1"), a.begin("r2"), a.begin("r3")];
    expect(runs.map((r) => r.runId)).toEqual([1, 2, 3]);
    expect(a.isCancelled(runs[0]!)).toBe(true);
    expect(a.isCancelled(runs[1]!)).toBe(true);
    expect(a.isCancelled(runs[2]!)).toBe(false);
  });

  it("manual cancel leaves the authority reusable", () => {
    const a = createAnalysisRunAuthority();
    const runA = a.begin("rev-A");
    a.invalidate(); // Cancel Full-Show Validation
    expect(a.accepts(runA, "rev-A")).toBe(false);
    const retry = a.begin("rev-A");
    expect(a.accepts(retry, "rev-A")).toBe(true);
  });
});

/** Faithful model of the store slices a full-show run and invalidation touch. */
class StoreModel {
  revision = "rev-A";
  authority = createAnalysisRunAuthority();
  fullShow: { revision: string } | null = null;
  fullShowError: { code: string; message: string } | null = null;
  fullShowBusy = false;
  fullShowProgress: unknown = null;
  /** Authored settings are never touched by invalidation. */
  settings = { sampleRate: 10 };

  private setters(): DerivedAnalysisSetters {
    return {
      setTransitionAnalysis: () => {},
      setAssignmentComparison: () => {},
      setOptimization: () => {},
      setTransitionError: () => {},
      setFullShow: () => {
        this.fullShow = null;
      },
      setFullShowError: () => {
        this.fullShowError = null;
      },
      setHighlightedDrones: () => {},
      setPreShowPreview: () => {},
      invalidateFullShowRun: () => this.authority.invalidate(),
      setFullShowProgress: () => {
        this.fullShowProgress = null;
      },
      setFullShowBusy: () => {
        this.fullShowBusy = false;
      },
    };
  }

  /** Any canonical project-content replacement (apply / undo / redo / load). */
  replaceContent(nextRevision: string) {
    this.revision = nextRevision;
    invalidateDerivedAnalysis(this.setters());
  }

  startRun(): AnalysisRunToken {
    this.fullShowBusy = true;
    this.fullShowProgress = { stage: "preparing" };
    return this.authority.begin(this.revision);
  }

  finishRun(token: AnalysisRunToken) {
    if (this.authority.accepts(token, this.revision)) {
      this.fullShow = { revision: token.revision };
    }
    this.fullShowBusy = false;
    this.fullShowProgress = null;
  }

  failRun(token: AnalysisRunToken) {
    if (this.authority.accepts(token, this.revision)) {
      this.fullShowError = { code: "UNKNOWN", message: "late" };
    }
    this.fullShowBusy = false;
    this.fullShowProgress = null;
  }

  /** Canonical export gate proxy: a report is only usable when it is current. */
  exportGate(): "READY" | "NO_REPORT" | "STALE" {
    if (!this.fullShow) return "NO_REPORT";
    return this.fullShow.revision === this.revision ? "READY" : "STALE";
  }
}

describe("store race acceptance", () => {
  for (const command of ["geometry apply", "undo", "redo", "loadSampleShow"] as const) {
    it(`${command} invalidates the active analysis generation`, () => {
      const store = new StoreModel();
      const token = store.startRun();
      store.replaceContent("rev-B");
      expect(store.authority.isCancelled(token)).toBe(true);
      expect(store.fullShowBusy).toBe(false);
      expect(store.fullShowProgress).toBeNull();
    });
  }

  it("a stale success cannot repopulate fullShow and the export gate stays NO_REPORT", () => {
    const store = new StoreModel();
    const token = store.startRun();
    store.replaceContent("rev-B");
    store.finishRun(token);
    expect(store.fullShow).toBeNull();
    expect(store.exportGate()).toBe("NO_REPORT");
    expect(store.fullShowBusy).toBe(false);
  });

  it("a stale failure cannot populate fullShowError", () => {
    const store = new StoreModel();
    const token = store.startRun();
    store.replaceContent("rev-B");
    store.failRun(token);
    expect(store.fullShowError).toBeNull();
  });

  it("a current success installs and the export gate becomes READY", () => {
    const store = new StoreModel();
    const token = store.startRun();
    store.finishRun(token);
    expect(store.fullShow).toEqual({ revision: "rev-A" });
    expect(store.exportGate()).toBe("READY");
  });

  it("a new run after invalidation installs normally", () => {
    const store = new StoreModel();
    const stale = store.startRun();
    store.replaceContent("rev-B");
    store.finishRun(stale);
    const fresh = store.startRun();
    store.finishRun(fresh);
    expect(store.fullShow).toEqual({ revision: "rev-B" });
    expect(store.exportGate()).toBe("READY");
  });

  it("manual cancel leaves the store reusable and never installs a partial report", () => {
    const store = new StoreModel();
    const token = store.startRun();
    store.authority.invalidate();
    store.failRun(token);
    expect(store.fullShow).toBeNull();
    expect(store.fullShowError).toBeNull();
    expect(store.fullShowBusy).toBe(false);
    const retry = store.startRun();
    store.finishRun(retry);
    expect(store.fullShow).toEqual({ revision: "rev-A" });
  });

  it("invalidation never clears authored settings", () => {
    const store = new StoreModel();
    store.startRun();
    store.replaceContent("rev-B");
    expect(store.settings).toEqual({ sampleRate: 10 });
  });
});
