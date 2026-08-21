/**
 * Sample/demo show registry.
 *
 * Generic, opt-in only: nothing here is ever the startup project. The store
 * exposes ONE loader (`loadSampleShow`) over this registry so adding a sample
 * never adds another story-specific store API.
 */
import type { ShowProject } from "../types";
import { createDepthStaggerDemoProject, DEPTH_STAGGER_DEMO_ID } from "./depthStaggerDemo";

export interface SampleShowDescriptor {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly create: () => ShowProject;
}

export const SAMPLE_SHOWS: readonly SampleShowDescriptor[] = [
  {
    id: DEPTH_STAGGER_DEMO_ID,
    name: "Depth Stagger Demo",
    description:
      "Four-drone demo with two near-vertical columns: the canonical sample for the Geometry Proposal workflow.",
    create: createDepthStaggerDemoProject,
  },
];

export function findSampleShow(id: string): SampleShowDescriptor | null {
  return SAMPLE_SHOWS.find((sample) => sample.id === id) ?? null;
}
