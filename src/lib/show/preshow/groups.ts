/**
 * GROUPED TAKEOFF SCHEDULER — deterministic launch-group membership + timing.
 *
 * Membership is derived from launch-grid geometry (rows / columns / blocks) or
 * supplied manually. Every drone belongs to exactly one group; ordering and
 * timing are explicit and never hardcoded.
 */
import { droneIndexFromId } from "../drones";
import {
  PreShowError,
  type LaunchGroup,
  type LaunchGroupingConfig,
  type LaunchLayout,
} from "./types";

export const DEFAULT_GROUPING: LaunchGroupingConfig = {
  strategy: "ROWS",
  rowsPerGroup: 1,
  columnsPerGroup: 1,
  blockRows: 2,
  blockColumns: 2,
  order: "forward",
  groupIntervalSeconds: 2,
  startTimeOverrides: {},
  manualGroups: [],
};

export function launchGroupId(index: number): string {
  return `GROUP-${String(index + 1).padStart(3, "0")}`;
}

interface Bucket {
  key: number;
  metadata: Record<string, number | string>;
  padIndices: number[];
}

function bucketsFor(layout: LaunchLayout, config: LaunchGroupingConfig): Bucket[] {
  const map = new Map<number, Bucket>();
  const add = (key: number, metadata: Record<string, number | string>, padIndex: number) => {
    const existing = map.get(key);
    if (existing) existing.padIndices.push(padIndex);
    else map.set(key, { key, metadata, padIndices: [padIndex] });
  };

  if (config.strategy === "COLUMNS") {
    const per = Math.max(1, Math.floor(config.columnsPerGroup));
    for (const pad of layout.pads) {
      const band = Math.floor(pad.column / per);
      add(band, { columnBand: band, columnsPerGroup: per }, pad.index);
    }
  } else if (config.strategy === "BLOCKS") {
    const br = Math.max(1, Math.floor(config.blockRows));
    const bc = Math.max(1, Math.floor(config.blockColumns));
    const rowsPerBlock = Math.max(1, Math.ceil(layout.rows / br));
    const colsPerBlock = Math.max(1, Math.ceil(layout.columns / bc));
    for (const pad of layout.pads) {
      const rb = Math.floor(pad.row / rowsPerBlock);
      const cb = Math.floor(pad.column / colsPerBlock);
      const key = rb * bc + cb;
      add(key, { rowBlock: rb, columnBlock: cb, rowsPerBlock, colsPerBlock }, pad.index);
    }
  } else {
    // ROWS (default)
    const per = Math.max(1, Math.floor(config.rowsPerGroup));
    for (const pad of layout.pads) {
      const band = Math.floor(pad.row / per);
      add(band, { rowBand: band, rowsPerGroup: per }, pad.index);
    }
  }

  return [...map.values()].sort((a, b) => a.key - b.key);
}

function manualBuckets(layout: LaunchLayout, config: LaunchGroupingConfig): Bucket[] {
  const assigned = new Set<number>();
  const buckets: Bucket[] = config.manualGroups.map((ids, i) => {
    const padIndices: number[] = [];
    for (const droneId of ids) {
      const index = droneIndexFromId(droneId);
      if (index < 0 || index >= layout.pads.length) {
        throw new PreShowError(
          "GROUP_MEMBERSHIP_INVALID",
          `Manual group ${i + 1} references unknown drone ${droneId}`,
          { droneId },
        );
      }
      if (assigned.has(index)) {
        throw new PreShowError(
          "GROUP_MEMBERSHIP_INVALID",
          `Drone ${droneId} appears in more than one manual launch group`,
          { droneId },
        );
      }
      assigned.add(index);
      padIndices.push(index);
    }
    return { key: i, metadata: { manual: 1 }, padIndices };
  });
  // Drones the operator did not place explicitly go to a deterministic
  // trailing group instead of silently disappearing from the plan.
  const rest = layout.pads.map((p) => p.index).filter((i) => !assigned.has(i));
  if (rest.length > 0) {
    buckets.push({ key: buckets.length, metadata: { manual: 1, remainder: 1 }, padIndices: rest });
  }
  return buckets.filter((b) => b.padIndices.length > 0);
}

/**
 * Builds launch groups in LAUNCH ORDER: group index 0 departs first, and its
 * start time is `index * groupIntervalSeconds` unless the operator overrode it.
 */
export function buildLaunchGroups(
  layout: LaunchLayout,
  config: LaunchGroupingConfig,
): LaunchGroup[] {
  if (!Number.isFinite(config.groupIntervalSeconds) || config.groupIntervalSeconds < 0) {
    throw new PreShowError("INVALID_GROUPING", "Group interval must be a finite, non-negative value", {
      groupIntervalSeconds: config.groupIntervalSeconds,
    });
  }
  const raw = config.strategy === "MANUAL" ? manualBuckets(layout, config) : bucketsFor(layout, config);
  const ordered = config.order === "reverse" ? [...raw].reverse() : raw;

  let previousStart = 0;
  return ordered.map((bucket, i) => {
    const id = launchGroupId(i);
    const scheduled = i * config.groupIntervalSeconds;
    const override = config.startTimeOverrides[id];
    const startTime = Number.isFinite(override) ? Math.max(0, override as number) : scheduled;
    const padIndices = [...bucket.padIndices].sort((a, b) => a - b);
    const group: LaunchGroup = {
      id,
      index: i,
      droneIndices: padIndices,
      droneIds: padIndices.map((k) => layout.padToDrone[layout.pads[k]!.id]!),
      padIds: padIndices.map((k) => layout.pads[k]!.id),
      startTime,
      delayFromPrevious: i === 0 ? startTime : startTime - previousStart,
      strategyMetadata: { strategy: config.strategy, order: config.order, ...bucket.metadata },
    };
    previousStart = startTime;
    return group;
  });
}

/** Structural check: exactly one group per drone, nothing missing or doubled. */
export function verifyGroupMembership(groups: readonly LaunchGroup[], droneCount: number): void {
  const seen = new Set<number>();
  for (const g of groups) {
    for (const i of g.droneIndices) {
      if (seen.has(i)) {
        throw new PreShowError("GROUP_MEMBERSHIP_INVALID", `Drone index ${i} is in two launch groups`);
      }
      seen.add(i);
    }
  }
  if (seen.size !== droneCount) {
    throw new PreShowError(
      "GROUP_MEMBERSHIP_INVALID",
      `Launch groups cover ${seen.size} of ${droneCount} drones`,
      { covered: seen.size, droneCount },
    );
  }
}
