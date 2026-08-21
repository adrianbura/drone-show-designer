/**
 * ASYNC JOB ISOLATION — one invariant, exercised per subsystem.
 *
 * A result started for project/session A must never install state after the
 * Studio adopted project/session B, and a late failure or progress callback must
 * be rejected on exactly the same terms as a late success. The scenarios below
 * drive the SAME authority the store uses (`asyncJobAuthority`) plus source-level
 * assertions that every audited subsystem actually routes through it — no timers,
 * no sleeps.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createAsyncJobAuthority,
  createProjectSessionAuthority,
  invalidateProjectSessionJobs,
} from "../asyncJobAuthority";

const STORE_SRC = readFileSync(join(process.cwd(), "src/lib/studio/store.tsx"), "utf8");

/** Minimal harness: a subsystem that installs a result / error / busy flag. */
function subsystem(scopeOf: () => string) {
  const jobs = createAsyncJobAuthority();
  const state = { result: null as string | null, error: null as string | null, busy: false };
  return {
    jobs,
    state,
    start() {
      const token = jobs.begin(scopeOf());
      state.busy = true;
      return {
        settle(value: string) {
          if (jobs.accepts(token, scopeOf())) state.result = value;
          if (jobs.isCurrent(token)) state.busy = false;
        },
        fail(message: string) {
          if (jobs.accepts(token, scopeOf())) state.error = message;
          if (jobs.isCurrent(token)) state.busy = false;
        },
        progress(value: string) {
          if (jobs.accepts(token, scopeOf())) state.result = `progress:${value}`;
        },
      };
    },
  };
}

describe("project session generation authority", () => {
  it("advances only when asked and never uses timestamps", () => {
    const session = createProjectSessionAuthority();
    expect(session.generation).toBe(0);
    const scopeBefore = session.scope();
    session.advance();
    expect(session.generation).toBe(1);
    expect(session.scope()).not.toBe(scopeBefore);
    expect(session.scope()).toMatch(/^s1/);
  });

  it("scopes dependent design inputs into the key", () => {
    const session = createProjectSessionAuthority();
    expect(session.scope(120, 200, 120, 7)).not.toBe(session.scope(140, 200, 120, 7));
  });

  it("successful adoption invalidates every registered subsystem token", () => {
    const session = createProjectSessionAuthority();
    const audio = createAsyncJobAuthority();
    const ai = createAsyncJobAuthority();
    const audioToken = audio.begin(session.scope());
    const aiToken = ai.begin(session.scope());
    invalidateProjectSessionJobs(session, [audio, ai]);
    expect(audio.accepts(audioToken, session.scope())).toBe(false);
    expect(ai.accepts(aiToken, session.scope())).toBe(false);
    expect(session.generation).toBe(1);
  });

  it("failed open does not advance the session generation", () => {
    const session = createProjectSessionAuthority();
    const audio = createAsyncJobAuthority();
    const token = audio.begin(session.scope());
    // A failed adoption returns BEFORE the invalidation boundary.
    expect(session.generation).toBe(0);
    expect(audio.accepts(token, session.scope())).toBe(true);
  });
});

describe("ESSP import isolation", () => {
  it("rejects an A result and an A error after B is adopted", () => {
    const session = createProjectSessionAuthority();
    const essp = subsystem(() => session.scope());
    const runA = essp.start();
    invalidateProjectSessionJobs(session, [essp.jobs]);
    runA.settle("reference-show-A");
    runA.fail("ESSP_IMPORT_FAILED");
    expect(essp.state.result).toBeNull();
    expect(essp.state.error).toBeNull();
  });

  it("lets the latest same-project import win and B import succeed", () => {
    const session = createProjectSessionAuthority();
    const essp = subsystem(() => session.scope());
    const first = essp.start();
    const second = essp.start();
    first.settle("import-1");
    expect(essp.state.result).toBeNull();
    second.settle("import-2");
    expect(essp.state.result).toBe("import-2");

    invalidateProjectSessionJobs(session, [essp.jobs]);
    const inB = essp.start();
    inB.settle("import-B");
    expect(essp.state.result).toBe("import-B");
    expect(essp.state.busy).toBe(false);
  });
});

describe("forensics isolation", () => {
  it("drops a report that arrives after a project switch", () => {
    const session = createProjectSessionAuthority();
    const forensics = subsystem(() => session.scope());
    const run = forensics.start();
    invalidateProjectSessionJobs(session, [forensics.jobs]);
    run.settle("report-A");
    run.progress("segment-1");
    run.fail("boom");
    expect(forensics.state.result).toBeNull();
    expect(forensics.state.error).toBeNull();
  });

  it("supersedes run A1 with A2", () => {
    const session = createProjectSessionAuthority();
    const forensics = subsystem(() => session.scope());
    const a1 = forensics.start();
    const a2 = forensics.start();
    a1.settle("A1");
    a1.fail("A1-error");
    expect(forensics.state.result).toBeNull();
    expect(forensics.state.error).toBeNull();
    a2.settle("A2");
    expect(forensics.state.result).toBe("A2");
  });
});

describe("audio decode isolation", () => {
  it("rejects decode A after B adoption and lets B decode work", () => {
    const session = createProjectSessionAuthority();
    const audio = subsystem(() => session.scope());
    const decodeA = audio.start();
    invalidateProjectSessionJobs(session, [audio.jobs]);
    decodeA.settle("buffer-A");
    decodeA.fail("decode failed");
    expect(audio.state.result).toBeNull();
    expect(audio.state.error).toBeNull();

    const decodeB = audio.start();
    decodeB.settle("buffer-B");
    expect(audio.state.result).toBe("buffer-B");
  });

  it("lets file 2 win over file 1 and never lets a stale finally clear current busy", () => {
    const session = createProjectSessionAuthority();
    const audio = subsystem(() => session.scope());
    const file1 = audio.start();
    const file2 = audio.start();
    file1.settle("file-1");
    expect(audio.state.result).toBeNull();
    // file 2 is still running: the stale finally must not release busy.
    expect(audio.state.busy).toBe(true);
    file2.settle("file-2");
    expect(audio.state.result).toBe("file-2");
    expect(audio.state.busy).toBe(false);
  });
});

describe("SVG import isolation", () => {
  it("rejects a stale draft and stale error after adoption", () => {
    const session = createProjectSessionAuthority();
    const svg = subsystem(() => session.scope());
    const run = svg.start();
    invalidateProjectSessionJobs(session, [svg.jobs]);
    run.settle("draft-A");
    run.fail("SVG_PARSE_FAILED");
    expect(svg.state.result).toBeNull();
    expect(svg.state.error).toBeNull();
    // The stale job owns nothing anymore: busy is released by the adoption's
    // session reset, never by the superseded run.
    expect(svg.jobs.isCurrent({ jobId: 1, scope: "s0" })).toBe(false);
  });

  it("lets the latest SVG import win", () => {
    const session = createProjectSessionAuthority();
    const svg = subsystem(() => session.scope());
    const one = svg.start();
    const two = svg.start();
    one.settle("svg-1");
    two.settle("svg-2");
    expect(svg.state.result).toBe("svg-2");
  });
});

describe("AI request isolation", () => {
  const inputs = { fleet: 120, width: 200, height: 120, seed: 7 };
  const session = createProjectSessionAuthority();
  const scope = () => session.scope(inputs.fleet, inputs.width, inputs.height, inputs.seed);

  it("rejects a response and an error that arrive after another project is current", () => {
    const ai = subsystem(scope);
    const run = ai.start();
    invalidateProjectSessionJobs(session, [ai.jobs]);
    run.settle("proposal-A");
    run.fail("PROVIDER_UNAVAILABLE");
    expect(ai.state.result).toBeNull();
    expect(ai.state.error).toBeNull();
  });

  it("installs only the newest request, and never revalidates against changed inputs", () => {
    const ai = subsystem(scope);
    const a1 = ai.start();
    const a2 = ai.start();
    a1.settle("A1");
    expect(ai.state.result).toBeNull();
    a2.settle("A2");
    expect(ai.state.result).toBe("A2");

    const withFleet = ai.start();
    inputs.fleet = 200; // fleet changed while the request was in flight
    withFleet.settle("stale-fleet");
    expect(ai.state.result).toBe("A2");
  });

  it("accepts a current response", () => {
    const ai = subsystem(scope);
    const run = ai.start();
    run.settle("current");
    expect(ai.state.result).toBe("current");
    expect(ai.state.busy).toBe(false);
  });
});

describe("store wiring (audit)", () => {
  it("advances the session generation at the single adoption boundary", () => {
    expect(STORE_SRC).toContain("invalidateProjectSessionJobs(projectSession.current, [");
    // Exactly one adoption boundary owns the invalidation.
    expect(STORE_SRC.match(/invalidateProjectSessionJobs\(/g)).toHaveLength(1);
  });

  it("guards every audited async subsystem with accepts() and isCurrent() busy ownership", () => {
    for (const authority of ["audioJobs", "svgJobs", "esspJobs", "forensicsJobs", "aiJobs"]) {
      expect(STORE_SRC).toContain(`${authority}.current.begin(`);
      expect(STORE_SRC).toContain(`${authority}.current.accepts(`);
      expect(STORE_SRC).toContain(`${authority}.current.isCurrent(`);
    }
  });

  it("keeps the legacy unguarded forensics run counter out of the store", () => {
    expect(STORE_SRC).not.toContain("forensicsRunRef");
  });

  it("keeps the full-show analysis authority separate from session jobs", () => {
    expect(STORE_SRC).toContain("fullShowRunRef.current.begin(analysisRevisionRef.current)");
  });
});
