/**
 * FULL-SHOW ANALYSIS RUN AUTHORITY (pure, unit-testable).
 *
 * A validation result describes ONE project revision. If the Studio moves to a
 * different revision while an analysis is in flight — geometry apply, undo,
 * redo, loading another project — the in-flight result is worthless and must
 * never be installed. This tiny authority owns that decision so the store never
 * has to reason about stale closures, and so the race behaviour can be tested
 * without timers.
 *
 * Rules:
 *  - `begin(revision)` mints a monotonically increasing run token.
 *  - `invalidate()` advances the generation: every outstanding token is cancelled.
 *  - `accepts(token, currentRevision)` is TRUE only when the token is still the
 *    newest run AND the revision it started from is still current.
 */
export interface AnalysisRunToken {
  readonly runId: number;
  readonly revision: string;
}

export interface AnalysisRunAuthority {
  /** Newest minted run id (0 when nothing has ever run). */
  readonly generation: number;
  /** Mints a new run token and cancels any previous run. */
  begin(revision: string): AnalysisRunToken;
  /** Cancels every outstanding run (project content replaced, manual cancel). */
  invalidate(): void;
  /** TRUE once the token is no longer the newest run. */
  isCancelled(token: AnalysisRunToken): boolean;
  /** TRUE only for the newest run whose starting revision is still current. */
  accepts(token: AnalysisRunToken, currentRevision: string): boolean;
}

export function createAnalysisRunAuthority(): AnalysisRunAuthority {
  let generation = 0;
  return {
    get generation() {
      return generation;
    },
    begin(revision: string): AnalysisRunToken {
      generation += 1;
      return { runId: generation, revision };
    },
    invalidate(): void {
      generation += 1;
    },
    isCancelled(token: AnalysisRunToken): boolean {
      return token.runId !== generation;
    },
    accepts(token: AnalysisRunToken, currentRevision: string): boolean {
      return token.runId === generation && token.revision === currentRevision;
    },
  };
}
