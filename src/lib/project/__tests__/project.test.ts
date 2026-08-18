import { describe, expect, it } from "vitest";

import { createDefaultProject } from "../../show/defaultProject";
import { MemoryKeyValueStore } from "../../library/repository";
import {
  clearAutosave,
  ensureProjectExtension,
  parseProjectFile,
  ProjectFileError,
  projectFileToJson,
  PROJECT_FILE_KIND,
  PROJECT_SCHEMA_VERSION,
  readAutosave,
  serializeProject,
  suggestedProjectFileName,
  writeAutosave,
} from "../index";

describe("project file", () => {
  it("round-trips an editable project without losing show semantics", () => {
    const project = createDefaultProject(64);
    const text = projectFileToJson(serializeProject(project));
    const reopened = parseProjectFile(text).project;

    expect(reopened.droneCount).toBe(64);
    expect(reopened.timeline.length).toBe(project.timeline.length);
    expect(reopened.formations.map((f) => f.points.length)).toEqual(
      project.formations.map((f) => f.points.length),
    );
    expect(reopened.limits).toEqual(project.limits);
    expect(reopened.altitudes).toEqual(project.altitudes);
  });

  it("is stable across save -> load -> save", () => {
    const project = createDefaultProject(32);
    const first = serializeProject(project, { savedAt: "2024-01-01T00:00:00.000Z" });
    const reopened = parseProjectFile(projectFileToJson(first)).project;
    const second = serializeProject(reopened, { savedAt: "2024-01-01T00:00:00.000Z" });
    expect(projectFileToJson(second)).toBe(projectFileToJson(first));
  });

  it("rejects a file that is not a studio project", () => {
    expect(() => parseProjectFile(JSON.stringify({ kind: "SomethingElse" }))).toThrowError(ProjectFileError);
    try {
      parseProjectFile("{ not json");
    } catch (err) {
      expect((err as ProjectFileError).code).toBe("NOT_JSON");
    }
  });

  it("refuses a newer schema version instead of guessing", () => {
    const file = {
      kind: PROJECT_FILE_KIND,
      schemaVersion: PROJECT_SCHEMA_VERSION + 5,
      project: createDefaultProject(8),
    };
    try {
      parseProjectFile(JSON.stringify(file));
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ProjectFileError).code).toBe("UNSUPPORTED_VERSION");
    }
  });

  it("rejects corrupted geometry before it can replace the open project", () => {
    const project = createDefaultProject(16);
    const broken = {
      ...serializeProject(project),
      project: {
        ...project,
        formations: [{ ...project.formations[0]!, points: [[1, 2] as unknown as [number, number, number]] }],
      },
    };
    try {
      parseProjectFile(JSON.stringify(broken));
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as ProjectFileError).code).toBe("FORMATION_INTEGRITY");
    }
  });

  it("derives deterministic, safe file names", () => {
    expect(suggestedProjectFileName("Show Porumbel — Ediția 2")).toBe("show-porumbel-editia-2.droneshow.json");
    expect(ensureProjectExtension("my show")).toBe("my show.droneshow.json");
    expect(ensureProjectExtension("keep.droneshow.json")).toBe("keep.droneshow.json");
  });

  it("recovers an autosaved snapshot and ignores a corrupted one", async () => {
    const store = new MemoryKeyValueStore();
    const project = createDefaultProject(24);
    await writeAutosave(store, {
      savedAt: "2024-05-05T10:00:00.000Z",
      fileName: "auto.droneshow.json",
      file: serializeProject(project),
    });

    const restored = await readAutosave(store);
    expect(restored?.file.project.droneCount).toBe(24);
    expect(restored?.fileName).toBe("auto.droneshow.json");

    await store.write("dss.projectAutosave.v1", "{{{");
    expect(await readAutosave(store)).toBeNull();

    await clearAutosave(store);
    expect(await readAutosave(store)).toBeNull();
  });
});

describe("session-only audio availability (BUG-A1)", () => {
  const session = () => {
    const project = createDefaultProject(64);
    return {
      ...project,
      audio: { name: "show.mp3", bpm: 128, offset: 1.5, duration: 180, attached: true },
    };
  };

  it("keeps audio metadata but drops the attachment claim on save + load", () => {
    const original = session();
    expect(original.audio.attached).toBe(true);

    const file = serializeProject(original);
    // Never persist a false claim that local audio bytes remain available.
    expect(file.project.audio.attached).toBe(false);

    const reopened = parseProjectFile(projectFileToJson(file)).project;
    expect(reopened.audio.attached).toBe(false);
    expect(reopened.audio.name).toBe("show.mp3");
    expect(reopened.audio.bpm).toBe(128);
    expect(reopened.audio.offset).toBeCloseTo(1.5, 6);
    expect(reopened.audio.duration).toBe(180);
  });

  it("sanitizes a legacy file that claims an attached track", () => {
    const legacy = serializeProject(session());
    const tampered = JSON.parse(projectFileToJson(legacy));
    tampered.project.audio.attached = true;
    expect(parseProjectFile(JSON.stringify(tampered)).project.audio.attached).toBe(false);
  });

  it("is stable across save -> load -> save", () => {
    const first = parseProjectFile(projectFileToJson(serializeProject(session()))).project;
    const second = parseProjectFile(projectFileToJson(serializeProject(first))).project;
    expect(second.audio).toEqual(first.audio);
    expect(second).toEqual(first);
  });

  it("treats an autosaved snapshot exactly like a reopened project", async () => {
    const store = new MemoryKeyValueStore();
    await writeAutosave(store, {
      savedAt: "2024-05-05T10:00:00.000Z",
      fileName: "auto.droneshow.json",
      file: serializeProject(session()),
    });
    const restored = await readAutosave(store);
    expect(restored?.file.project.audio.attached).toBe(false);
    expect(restored?.file.project.audio.name).toBe("show.mp3");
  });
});
