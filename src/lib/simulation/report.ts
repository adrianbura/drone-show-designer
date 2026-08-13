/**
 * Simulation report parsing + export.
 *
 * WORDING RULE: a PASS means "the local PX4 SITL / mock simulation completed and
 * tracking metrics were computed". It is NEVER a statement about real-world
 * flight safety, approval or certification.
 */
import { downloadText } from "../adapters/export";
import {
  SIMULATION_REPORT_SCHEMA_NAME,
  SIMULATION_REPORT_SCHEMA_VERSION,
  type SimulationRunHistoryEntry,
  type SimulationRunReport,
  type SimulationRunStatus,
} from "./types";

export class SimulationReportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationReportParseError";
  }
}

const STATUSES: readonly SimulationRunStatus[] = [
  "PASS",
  "PASS_WITH_WARNINGS",
  "FAIL",
  "CANCELLED",
  "RUNNING",
];

/** Defensive parse of an untrusted bridge/file payload. */
export function parseSimulationRunReport(raw: unknown): SimulationRunReport {
  if (!raw || typeof raw !== "object") {
    throw new SimulationReportParseError("Report payload is not an object");
  }
  const r = raw as Record<string, unknown>;
  if (r["simulationReportSchema"] !== SIMULATION_REPORT_SCHEMA_NAME) {
    throw new SimulationReportParseError(`Unsupported report schema ${String(r["simulationReportSchema"])}`);
  }
  if (String(r["simulationReportSchemaVersion"]).split(".")[0] !== SIMULATION_REPORT_SCHEMA_VERSION.split(".")[0]) {
    throw new SimulationReportParseError(
      `Unsupported report schema version ${String(r["simulationReportSchemaVersion"])}`,
    );
  }
  if (typeof r["runId"] !== "string" || !r["runId"]) {
    throw new SimulationReportParseError("Report has no runId");
  }
  if (!STATUSES.includes(r["status"] as SimulationRunStatus)) {
    throw new SimulationReportParseError(`Unknown run status ${String(r["status"])}`);
  }
  const env = r["environment"];
  if (!env || typeof env !== "object") {
    throw new SimulationReportParseError("Report has no environment section");
  }
  return raw as SimulationRunReport;
}

export function historyEntryFromReport(report: SimulationRunReport): SimulationRunHistoryEntry {
  return {
    runId: report.runId,
    droneId: report.selectedDroneId,
    timestamp: report.startedAt,
    status: report.status,
    environmentMode: report.environment.mode,
    rmsPositionError: report.trackingMetrics?.rmsPositionError ?? null,
    maxPositionError: report.trackingMetrics?.maxPositionError ?? null,
  };
}

export function statusLabel(status: SimulationRunStatus): string {
  switch (status) {
    case "PASS":
      return "PX4 SITL simulation result: PASS";
    case "PASS_WITH_WARNINGS":
      return "PX4 SITL simulation result: PASS (warnings)";
    case "FAIL":
      return "PX4 SITL simulation result: FAIL";
    case "CANCELLED":
      return "Simulation cancelled";
    default:
      return "Simulation running";
  }
}

export function exportSimulationReport(report: SimulationRunReport) {
  downloadText(`${report.runId}.simulation-report.json`, JSON.stringify(report, null, 2), "application/json");
}
