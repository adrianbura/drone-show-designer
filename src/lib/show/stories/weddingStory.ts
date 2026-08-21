/**
 * Legacy compatibility bridge.
 *
 * The authored Wedding Story / "Two Hearts, One Sky" sample was removed from
 * the product. This temporary bridge keeps the obsolete store `loadStoryShow`
 * symbol compiling until that dead API is removed in the next store cleanup.
 */
import type { ShowProject } from "../types";
import { createDepthStaggerDemoProject } from "./depthStaggerDemo";

/** @deprecated Wedding Story was removed; use createDepthStaggerDemoProject. */
export function createWeddingStoryProject(_droneCount?: number): ShowProject {
  return createDepthStaggerDemoProject();
}
