/**
 * Local autosave of the editable show.
 *
 * Autosave stores the SAME versioned project envelope as an explicit save, so a
 * recovered snapshot is exactly a reopened project. It never produces ESSP, PX4
 * or any hardware payload, and it is never written on an animation frame: the
 * caller debounces mutations before handing a snapshot over.
 */
import type { KeyValueStore } from "../library/repository";
import { migrateProjectFile } from "./serialize";
import type { ProjectAutosaveSnapshot, ProjectFile } from "./types";

export const AUTOSAVE_STORAGE_KEY = "dss.projectAutosave.v1";
/** Minimum wall-clock gap between two autosave writes. */
export const AUTOSAVE_DEBOUNCE_MS = 2500;

export async function writeAutosave(
  store: KeyValueStore,
  snapshot: ProjectAutosaveSnapshot,
  key = AUTOSAVE_STORAGE_KEY,
): Promise<void> {
  await store.write(key, JSON.stringify(snapshot));
}

/** Returns null for a missing, unreadable or unsupported snapshot. */
export async function readAutosave(
  store: KeyValueStore,
  key = AUTOSAVE_STORAGE_KEY,
): Promise<ProjectAutosaveSnapshot | null> {
  const raw = await store.read(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ProjectAutosaveSnapshot>;
    if (!parsed || typeof parsed !== "object" || !parsed.file) return null;
    const file: ProjectFile = migrateProjectFile(parsed.file);
    return {
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : file.savedAt,
      fileName: typeof parsed.fileName === "string" ? parsed.fileName : "",
      file,
    };
  } catch {
    return null;
  }
}

export async function clearAutosave(store: KeyValueStore, key = AUTOSAVE_STORAGE_KEY): Promise<void> {
  await store.write(key, "");
}
