/**
 * SimulationClient — the ONLY place in the frontend that talks to the bridge.
 *
 * React components never call fetch directly. The client is transport-only: it
 * neither streams setpoints (the bridge owns the control loop) nor mutates the
 * show in any way.
 */
import { bridgeRequest, BRIDGE_PATHS, DEFAULT_BRIDGE_BASE_URL, type BridgeTransportOptions } from "./api";
import type {
  BridgeHealth,
  PackageValidationResponse,
  PrepareResponse,
  SimulationEnvironment,
  SimulationPackage,
  SimulationRunHistoryEntry,
  SimulationRunReport,
  SimulationRunStateSnapshot,
} from "./types";

export type RunMode = "TEST_TRAJECTORY" | "SHOW_TRAJECTORY";

export interface RunRequest {
  readonly runId: string;
  readonly mode: RunMode;
}

export class SimulationClient {
  private readonly options: BridgeTransportOptions;

  constructor(options: BridgeTransportOptions = {}) {
    this.options = { baseUrl: DEFAULT_BRIDGE_BASE_URL, ...options };
  }

  get baseUrl(): string {
    return this.options.baseUrl ?? DEFAULT_BRIDGE_BASE_URL;
  }

  health(): Promise<BridgeHealth> {
    return bridgeRequest<BridgeHealth>(BRIDGE_PATHS.health, { ...this.options, timeoutMs: 4000 });
  }

  environment(): Promise<SimulationEnvironment> {
    return bridgeRequest<SimulationEnvironment>(BRIDGE_PATHS.environment, this.options);
  }

  validatePackage(pkg: SimulationPackage): Promise<PackageValidationResponse> {
    return bridgeRequest<PackageValidationResponse>(BRIDGE_PATHS.validatePackage, this.options, {
      method: "POST",
      body: JSON.stringify({ package: pkg }),
    });
  }

  /** Sends the whole package once — never one request per trajectory sample. */
  prepare(pkg: SimulationPackage, mode: "MOCK" | "PX4_SITL"): Promise<PrepareResponse> {
    return bridgeRequest<PrepareResponse>(BRIDGE_PATHS.prepare, this.options, {
      method: "POST",
      body: JSON.stringify({ package: pkg, environmentMode: mode }),
    });
  }

  run(request: RunRequest): Promise<SimulationRunStateSnapshot> {
    return bridgeRequest<SimulationRunStateSnapshot>(BRIDGE_PATHS.run, this.options, {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  cancel(runId: string): Promise<SimulationRunStateSnapshot> {
    return bridgeRequest<SimulationRunStateSnapshot>(BRIDGE_PATHS.cancel, this.options, {
      method: "POST",
      body: JSON.stringify({ runId }),
    });
  }

  runState(runId: string): Promise<SimulationRunStateSnapshot> {
    return bridgeRequest<SimulationRunStateSnapshot>(BRIDGE_PATHS.run_(runId), this.options);
  }

  report(runId: string): Promise<SimulationRunReport> {
    return bridgeRequest<SimulationRunReport>(BRIDGE_PATHS.report(runId), this.options);
  }

  history(): Promise<{ runs: SimulationRunHistoryEntry[] }> {
    return bridgeRequest<{ runs: SimulationRunHistoryEntry[] }>(BRIDGE_PATHS.history, this.options);
  }
}

/** Guard used by the UI: is this report a MOCK result or a real PX4 SITL one? */
export function isMockReport(report: SimulationRunReport | null): boolean {
  return report?.environment.mode === "MOCK";
}

export function environmentLabel(report: SimulationRunReport | null): string {
  if (!report) return "—";
  return report.environment.mode === "MOCK" ? "MOCK" : "PX4 SITL";
}
