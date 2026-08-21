/**
 * SHARED ASYNC JOB AUTHORITY (pure, unit-testable, timer-free).
 *
 * One invariant for every asynchronous Studio job: a result started for
 * project/session A must NEVER install state after the Studio has moved to
 * project/session B, and a late failure/progress callback must be rejected on
 * exactly the same terms as a late success.
 *
 * Two orthogonal pieces:
 *
 *  - `ProjectSessionAuthority` — a monotonic generation that advances ONLY when
 *    the active document/session is actually replaced (successful New, Sample,
 *    Open, Autosave Recovery). It answers "does this job still belong to the
 *    currently open document?". It is NOT the flight `analysisRevision`, and it
 *    is never a timestamp.
 *
 *  - `AsyncJobAuthority` — one per subsystem (audio, SVG, ESSP import, AI,
 *    forensics). It answers "is this the newest job of this subsystem, started
 *    from a scope that is still current?". The scope string carries the session
 *    generation plus whatever design inputs the result depends on (fleet count,
 *    area, ...), so an old answer is never silently revalidated against
 *    different inputs.
 *
 * Busy cleanup uses `isCurrent` (ownership), never `accepts`: a stale job's
 * finally{} must not clear a busy flag that a NEWER job of the same subsystem
 * currently owns.
 */

export interface AsyncJobToken {
  readonly jobId: number;
  readonly scope: string;
}

export interface AsyncJobAuthority {
  /** Newest minted job id (0 when nothing has ever run). */
  readonly generation: number;
  /** Mints a token and supersedes any previous job of this subsystem. */
  begin(scope: string): AsyncJobToken;
  /** Cancels every outstanding job (session replaced, explicit cancel/clear). */
  invalidate(): void;
  /** TRUE while the token still owns the subsystem (busy-flag ownership). */
  isCurrent(token: AsyncJobToken): boolean;
  /** TRUE only for the newest job whose starting scope is still current. */
  accepts(token: AsyncJobToken, currentScope: string): boolean;
}

export function createAsyncJobAuthority(): AsyncJobAuthority {
  let generation = 0;
  return {
    get generation() {
      return generation;
    },
    begin(scope: string): AsyncJobToken {
      generation += 1;
      return { jobId: generation, scope };
    },
    invalidate(): void {
      generation += 1;
    },
    isCurrent(token: AsyncJobToken): boolean {
      return token.jobId === generation;
    },
    accepts(token: AsyncJobToken, currentScope: string): boolean {
      return token.jobId === generation && token.scope === currentScope;
    },
  };
}

export interface ProjectSessionAuthority {
  /** Current session generation; advances on successful adoption only. */
  readonly generation: number;
  /** Advances the generation (successful project/session replacement). */
  advance(): number;
  /** Scope key for a job: session generation plus dependent design inputs. */
  scope(...parts: (string | number | boolean | null | undefined)[]): string;
}

export function createProjectSessionAuthority(): ProjectSessionAuthority {
  let generation = 0;
  return {
    get generation() {
      return generation;
    },
    advance(): number {
      generation += 1;
      return generation;
    },
    scope(...parts): string {
      return [`s${generation}`, ...parts.map((p) => (p === null || p === undefined ? "" : String(p)))].join(
        "|",
      );
    },
  };
}

/**
 * THE ONE PLACE a project adoption invalidates async work. Advances the session
 * generation and cancels every registered subsystem authority, so the adoption
 * boundary never grows a per-subsystem invalidate list.
 */
export function invalidateProjectSessionJobs(
  session: ProjectSessionAuthority,
  jobs: readonly AsyncJobAuthority[],
): number {
  for (const job of jobs) job.invalidate();
  return session.advance();
}
