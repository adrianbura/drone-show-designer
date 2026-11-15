/**
 * Sample/demo show registry.
 *
 * Generic, opt-in only: nothing here is ever the startup project. The store
 * exposes ONE loader (`loadSampleShow`) over this registry so adding a sample
 * never adds another story-specific store API.
 */
import type { ShowProject } from "../types";
import type { ProjectFile } from "../../project/types";
import { parseProjectFile } from "../../project/serialize";
import { createDepthStaggerDemoProject, DEPTH_STAGGER_DEMO_ID } from "./depthStaggerDemo";
import weddingShowText from "@/assets/shows/a-and-b-wedding-show-200-drones.droneshow.json?raw";

export interface SampleShowDescriptor {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly create: () => ShowProject;
  /**
   * Full-fidelity variant for samples bundled as saved project files: the whole
   * envelope (planning state, editor preferences) is adopted, not just the
   * project. The store still marks it UNSAVED — a bundled sample never claims
   * a file on disk.
   */
  readonly createFile?: () => ProjectFile;
}

export const WEDDING_STORY_SAMPLE_ID = "story-a-and-b-wedding";

export const SAMPLE_SHOWS: readonly SampleShowDescriptor[] = [
  {
    id: DEPTH_STAGGER_DEMO_ID,
    name: "Depth Stagger Demo",
    description:
      "Four-drone demo with two near-vertical columns: the canonical sample for the Geometry Proposal workflow.",
    create: createDepthStaggerDemoProject,
  },
  {
    id: WEDDING_STORY_SAMPLE_ID,
    name: "A & B — Wedding Story",
    description:
      "Authored 200-drone wedding story show. Formerly the startup project; now strictly opt-in.",
    create: () => parseProjectFile(weddingShowText).project,
    createFile: () => parseProjectFile(weddingShowText),
  },
];

export function findSampleShow(id: string): SampleShowDescriptor | null {
  return SAMPLE_SHOWS.find((sample) => sample.id === id) ?? null;
}
