/**
 * AUTOSAVE RECOVERY PRECEDENCE.
 *
 * A recovery offer must only ever be genuinely unsaved work. The harness below
 * runs the SAME authorities the store calls (`writeAutosave` / `readAutosave` /
 * `clearAutosave` for storage, `isAutosaveWriteAuthorized` for the generation
 * discipline), and source assertions pin the store's wiring at each explicit
 * lifecycle boundary so the behaviour cannot drift out of the component.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { clearAutosave, readAutosave, writeAutosave } from "../../project/autosave";
import type { KeyValueStore } from "../../library/repository";
import { serializeProject } from "../../project/serialize";
import { createDepthStaggerDemoProject } from "../../show/stories/depthStaggerDemo";
import type { ShowProject } from "../../show/types";
import { isAutosaveWriteAuthorized, isRecoveryOfferable } from "../autosaveAuthority";

const STORE_SRC = readFileSync(join(process.cwd(), "src/lib/studio/store.tsx"), "utf8");

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    read: async (key: string) => map.get(key) ?? null,
    write: async (key: string, value: string) => {
      map.set(key, value);
    },
  } as unknown as KeyValueStore;
}

/**
 * Session harness mirroring the store's autosave discipline: a monotonic
 * generation, timers that capture it at schedule time, and explicit lifecycle
 * actions that consume obsolete recovery on their success boundary only.
 */
class Session {
  readonly store = memoryStore();
  generation = 0;
  recoveryOffer: unknown = null;
  project: ShowProject = createDepthStaggerDemoProject();
  dirty = false;
  savedAt: string | null = null;
  fileName = "show.droneshow.json";
  private pending: Array<{ generation: number; project: ShowProject; fileName: string }> = [];

  edit(name: string) {
    this.project = { ...this.project, name };
    this.dirty = true;
    this.schedule();
  }

  /** Debounced autosave scheduling; the timer captures the current generation. */
  schedule() {
    this.pending.push({
      generation: this.generation,
      project: this.project,
      fileName: this.fileName,
    });
  }

  /** Fires every pending timer, exactly like the real debounce callback. */
  async flushTimers() {
    const pending = this.pending;
    this.pending = [];
    for (const timer of pending) {
      if (!isAutosaveWriteAuthorized(timer.generation, this.generation)) continue;
      const savedAt = new Date().toISOString();
      await writeAutosave(this.store, {
        savedAt,
        fileName: timer.fileName,
        file: serializeProject(timer.project, { savedAt }),
      });
    }
  }

  private async consumeRecovery() {
    this.generation += 1;
    this.recoveryOffer = null;
    await clearAutosave(this.store);
  }

  async save(ok = true) {
    if (!ok) return; // failure never reaches the success boundary
    this.dirty = false;
    this.savedAt = new Date().toISOString();
    await this.consumeRecovery();
  }

  async open(file: { project: ShowProject; fileName: string } | null) {
    if (!file) return; // failed open: nothing adopted, recovery untouched
    this.project = file.project;
    this.fileName = file.fileName;
    this.dirty = false;
    this.savedAt = new Date().toISOString();
    await this.consumeRecovery();
  }

  async loadSample(project: ShowProject) {
    this.project = project;
    this.dirty = false;
    this.savedAt = null;
    await this.consumeRecovery();
  }

  async restore(ok = true) {
    const snapshot = await readAutosave(this.store);
    if (!snapshot) return;
    if (!ok) return; // atomic failure: snapshot NOT consumed
    this.project = snapshot.file.project;
    this.fileName = snapshot.fileName;
    this.dirty = true;
    this.savedAt = null;
    await this.consumeRecovery();
  }

  async dismiss() {
    await this.consumeRecovery();
  }

  /** Simulated restart: only persisted state survives. */
  async readAfterRestart() {
    return readAutosave(this.store);
  }
}

describe("autosave recovery precedence", () => {
  it("autosave -> manual Save leaves storage empty across a restart", async () => {
    const s = new Session();
    s.edit("edited");
    await s.flushTimers();
    expect(await s.readAfterRestart()).not.toBeNull();
    await s.save();
    expect(await s.readAfterRestart()).toBeNull();
  });

  it("a failed Save preserves recovery", async () => {
    const s = new Session();
    s.edit("edited");
    await s.flushTimers();
    await s.save(false);
    expect(await s.readAfterRestart()).not.toBeNull();
  });

  it("Save -> edit again creates a fresh recovery of the post-save state", async () => {
    const s = new Session();
    s.edit("first");
    await s.flushTimers();
    await s.save();
    s.edit("after save");
    await s.flushTimers();
    const snapshot = await s.readAfterRestart();
    expect(snapshot?.file.project.name).toBe("after save");
  });

  it("a pending autosave timer cannot recreate the snapshot after Save", async () => {
    const s = new Session();
    s.edit("edited"); // timer scheduled, not fired
    await s.save();
    await s.flushTimers(); // late timer
    expect(await s.readAfterRestart()).toBeNull();
  });

  it("a successful Open consumes the previous project's recovery", async () => {
    const s = new Session();
    s.edit("project A edit");
    await s.flushTimers();
    await s.open({ project: createDepthStaggerDemoProject(), fileName: "b.droneshow.json" });
    expect(await s.readAfterRestart()).toBeNull();
    expect(s.recoveryOffer).toBeNull();
  });

  it("a failed Open preserves recovery", async () => {
    const s = new Session();
    s.edit("project A edit");
    await s.flushTimers();
    await s.open(null);
    expect(await s.readAfterRestart()).not.toBeNull();
  });

  it("a pending project A timer cannot write over project B's recovery slot", async () => {
    const s = new Session();
    s.edit("project A edit"); // A timer scheduled
    await s.open({ project: createDepthStaggerDemoProject(), fileName: "b.droneshow.json" });
    await s.flushTimers(); // late A timer
    expect(await s.readAfterRestart()).toBeNull();

    // ...and B still autosaves normally afterwards.
    s.edit("project B edit");
    await s.flushTimers();
    const snapshot = await s.readAfterRestart();
    expect(snapshot?.file.project.name).toBe("project B edit");
  });

  it("New / Load Sample consumes the replaced project's recovery but keeps autosaving", async () => {
    const s = new Session();
    s.edit("old project");
    await s.flushTimers();
    await s.loadSample(createDepthStaggerDemoProject());
    expect(await s.readAfterRestart()).toBeNull();
    s.edit("sample edit");
    await s.flushTimers();
    expect((await s.readAfterRestart())?.file.project.name).toBe("sample edit");
  });

  it("a successful Restore consumes the snapshot but keeps the project dirty", async () => {
    const s = new Session();
    s.edit("recovered work");
    await s.flushTimers();
    await s.restore();
    expect(s.project.name).toBe("recovered work");
    expect(s.dirty).toBe(true);
    expect(s.savedAt).toBeNull();
    expect(await s.readAfterRestart()).toBeNull();
    // Subsequent edits autosave normally.
    s.edit("post recovery edit");
    await s.flushTimers();
    expect((await s.readAfterRestart())?.file.project.name).toBe("post recovery edit");
  });

  it("a failed Restore preserves the snapshot", async () => {
    const s = new Session();
    s.edit("recovered work");
    await s.flushTimers();
    await s.restore(false);
    expect(await s.readAfterRestart()).not.toBeNull();
  });

  it("dismiss is idempotent", async () => {
    const s = new Session();
    s.edit("edited");
    await s.flushTimers();
    await s.dismiss();
    await s.dismiss();
    expect(await s.readAfterRestart()).toBeNull();
    expect(s.recoveryOffer).toBeNull();
  });
});

describe("autosave precedence helpers", () => {
  it("authorizes a write only for the generation it was scheduled in", () => {
    expect(isAutosaveWriteAuthorized(3, 3)).toBe(true);
    expect(isAutosaveWriteAuthorized(3, 4)).toBe(false);
  });

  it("offers only snapshots that carry a project file", () => {
    expect(isRecoveryOfferable(null)).toBe(false);
    expect(isRecoveryOfferable({})).toBe(false);
    expect(isRecoveryOfferable({ file: { project: {} } })).toBe(true);
  });
});

describe("store wiring", () => {
  it("consumes recovery on the manual-save success boundary", () => {
    // Save and Save As share ONE writer, so the boundary is asserted there.
    const save = STORE_SRC.slice(STORE_SRC.indexOf("const writeProjectDocument"));
    const body = save.slice(0, save.indexOf("const saveProjectFile"));
    expect(body).toContain("markSaved(name)");
    expect(body).toContain("consumeAutosaveRecoveryRef.current()");
    // Consumption must live after the success boundary, never in the catch.
    expect(body.indexOf("consumeAutosaveRecoveryRef.current()")).toBeLessThan(
      body.indexOf("} catch"),
    );
  });


  it("consumes recovery only on the successful adoption path", () => {
    const adopt = STORE_SRC.slice(STORE_SRC.indexOf("const adoptProject = useCallback"));
    const body = adopt.slice(0, adopt.indexOf("adoptProjectRef.current"));
    expect(body).toContain("consumeAutosaveRecoveryRef.current()");
    expect(body.indexOf("consumeAutosaveRecoveryRef.current()")).toBeGreaterThan(
      body.indexOf("return {\n          ok: false"),
    );
  });

  it("guards autosave writes with the generation authority", () => {
    expect(STORE_SRC).toContain("isAutosaveWriteAuthorized(generation, autosaveGeneration.current)");
  });

  it("keeps dismiss as the idempotent consume action", () => {
    expect(STORE_SRC).toContain("const dismissAutosave = consumeAutosaveRecovery;");
  });
});
