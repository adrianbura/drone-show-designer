/**
 * Bridge HTTP surface — paths and low-level transport only.
 *
 * The bridge is a LOCAL developer service; the default base URL is loopback.
 * There is deliberately no arm/takeoff/goto/land/send-mavlink path here: the
 * bridge only prepares and executes one controlled simulation trajectory.
 */
import { BRIDGE_API_VERSION, BridgeError, type BridgeErrorCode } from "./types";

export const DEFAULT_BRIDGE_BASE_URL = "http://127.0.0.1:8787";

export const BRIDGE_PATHS = {
  health: `/api/${BRIDGE_API_VERSION}/health`,
  environment: `/api/${BRIDGE_API_VERSION}/environment`,
  validatePackage: `/api/${BRIDGE_API_VERSION}/package/validate`,
  prepare: `/api/${BRIDGE_API_VERSION}/simulation/prepare`,
  run: `/api/${BRIDGE_API_VERSION}/simulation/run`,
  cancel: `/api/${BRIDGE_API_VERSION}/simulation/cancel`,
  run_: (runId: string) => `/api/${BRIDGE_API_VERSION}/simulation/${encodeURIComponent(runId)}`,
  report: (runId: string) =>
    `/api/${BRIDGE_API_VERSION}/simulation/${encodeURIComponent(runId)}/report`,
  history: `/api/${BRIDGE_API_VERSION}/simulation/history`,
} as const;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface BridgeTransportOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
}

const BRIDGE_ERROR_CODES = new Set<string>([
  "BRIDGE_CONFIG_INVALID",
  "NON_LOCAL_ENDPOINT_REJECTED",
  "PACKAGE_INVALID",
  "PACKAGE_STALE",
  "SHOW_VALIDATION_FAILED",
  "PX4_NOT_AVAILABLE",
  "PX4_CONNECTION_FAILED",
  "VEHICLE_NOT_DISCOVERED",
  "MULTIPLE_SYSTEMS_NOT_SUPPORTED",
  "TRAJECTORY_INVALID",
  "SIMULATION_NOT_READY",
  "SIMULATION_ALREADY_RUNNING",
  "SIMULATION_CANCELLED",
  "TELEMETRY_UNAVAILABLE",
  "SIMULATION_EXECUTION_FAILED",
]);

function toBridgeErrorCode(raw: unknown): BridgeErrorCode {
  return BRIDGE_ERROR_CODES.has(String(raw))
    ? (String(raw) as BridgeErrorCode)
    : "SIMULATION_EXECUTION_FAILED";
}

export async function bridgeRequest<T>(
  path: string,
  { baseUrl = DEFAULT_BRIDGE_BASE_URL, fetchImpl, timeoutMs = 15000 }: BridgeTransportOptions,
  init?: RequestInit,
): Promise<T> {
  const doFetch: FetchLike =
    fetchImpl ?? ((input, opts) => globalThis.fetch(input as string, opts));
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  let response: Response;
  try {
    response = await doFetch(`${baseUrl}${path}`, {
      ...init,
      ...(controller ? { signal: controller.signal } : {}),
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (error) {
    throw new BridgeError(
      "BRIDGE_UNREACHABLE",
      "Simulation bridge is offline",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    if (timer) clearTimeout(timer);
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const detail = (body ?? {}) as { code?: string; message?: string; detail?: unknown };
    const nested = (detail.detail ?? {}) as { code?: string; message?: string };
    throw new BridgeError(
      toBridgeErrorCode(detail.code ?? nested.code),
      detail.message ?? nested.message ?? `Bridge request failed (${response.status})`,
      text.slice(0, 500),
    );
  }
  return body as T;
}
