/**
 * useSimulation — client-side orchestration of ONE bridge simulation run.
 *
 * The studio never streams setpoints and never controls a vehicle: it builds an
 * immutable package, hands it to the local bridge, polls run state, and renders
 * the returned diagnostics. Show data is read-only here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SimulationClient } from "./client";
import { buildSimulationPackage, SimulationPackageError, deriveValidationState } from "./package";
import { historyEntryFromReport, parseSimulationRunReport } from "./report";
import {
  BridgeError,
  type BridgeHealth,
  type PackageValidationState,
  type RunMode,
  type SimulationEnvironmentMode,
  type SimulationPackage,
  type SimulationRunHistoryEntry,
  type SimulationRunReport,
  type SimulationRunStateSnapshot,
} from "./types";
import { useStudio } from "../studio/store";

const POLL_MS = 400;

export interface SimulationUiError {
  readonly code: string;
  readonly message: string;
  readonly detail?: string;
}

function toUiError(error: unknown): SimulationUiError {
  if (error instanceof BridgeError) {
    return { code: error.code, message: error.message, detail: error.detail };
  }
  if (error instanceof SimulationPackageError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "SIMULATION_EXECUTION_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}

export function useSimulation() {
  const { project, plan, trajectorySet, analysisRevision, fullShowReport, fullShowStale } =
    useStudio();

  const client = useMemo(() => new SimulationClient(), []);
  const [health, setHealth] = useState<BridgeHealth | null>(null);
  const [online, setOnline] = useState(false);
  const [droneId, setDroneId] = useState<string>(plan.drones[0]?.id ?? "");
  const [environmentMode, setEnvironmentMode] = useState<SimulationEnvironmentMode>("MOCK");
  const [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<SimulationRunStateSnapshot | null>(null);
  const [report, setReport] = useState<SimulationRunReport | null>(null);
  const [history, setHistory] = useState<readonly SimulationRunHistoryEntry[]>([]);
  const [error, setError] = useState<SimulationUiError | null>(null);
  const activeRunId = useRef<string | null>(null);

  const droneIds = useMemo(() => plan.drones.map((d) => d.id), [plan.drones]);
  useEffect(() => {
    if (!droneIds.includes(droneId)) setDroneId(droneIds[0] ?? "");
  }, [droneIds, droneId]);

  const validationState: PackageValidationState = useMemo(
    () => deriveValidationState(fullShowReport, fullShowStale, analysisRevision),
    [fullShowReport, fullShowStale, analysisRevision],
  );
  const showRunnable =
    validationState === "VALIDATED" || validationState === "VALIDATED_WITH_WARNINGS";

  const refreshHealth = useCallback(async () => {
    try {
      const next = await client.health();
      setHealth(next);
      setOnline(true);
      return next;
    } catch (caught) {
      setHealth(null);
      setOnline(false);
      setError(toUiError(caught));
      return null;
    }
  }, [client]);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  const buildPackage = useCallback((): SimulationPackage => {
    return buildSimulationPackage({
      project,
      plan,
      set: trajectorySet,
      droneId,
      analysisRevision,
      fullShow: fullShowReport,
      fullShowStale,
    });
  }, [project, plan, trajectorySet, droneId, analysisRevision, fullShowReport, fullShowStale]);

  /** Polls until the run reaches a terminal state, then fetches the report. */
  const followRun = useCallback(
    async (runId: string) => {
      activeRunId.current = runId;
      for (;;) {
        if (activeRunId.current !== runId) return;
        let state: SimulationRunStateSnapshot;
        try {
          state = await client.runState(runId);
        } catch (caught) {
          setError(toUiError(caught));
          return;
        }
        setSnapshot(state);
        if (state.state === "COMPLETED" || state.state === "FAILED" || state.state === "CANCELLED") {
          try {
            const parsed = parseSimulationRunReport(await client.report(runId));
            setReport(parsed);
            setHistory((prev) => [historyEntryFromReport(parsed), ...prev].slice(0, 20));
          } catch (caught) {
            setError(toUiError(caught));
          }
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    },
    [client],
  );

  const start = useCallback(
    async (mode: RunMode) => {
      setBusy(true);
      setError(null);
      setReport(null);
      try {
        const pkg = mode === "SHOW_TRAJECTORY" ? buildPackage() : null;
        const prepared = await client.prepare(pkg, environmentMode);
        setSnapshot({
          runId: prepared.runId,
          state: prepared.state,
          status: "RUNNING",
          elapsedSeconds: 0,
          progress: 0,
          stage: "Preparing",
          latest: null,
          environmentMode,
          droneId: mode === "SHOW_TRAJECTORY" ? droneId : null,
        });
        await client.run({ runId: prepared.runId, mode });
        void followRun(prepared.runId);
      } catch (caught) {
        setError(toUiError(caught));
        setSnapshot(null);
      } finally {
        setBusy(false);
      }
    },
    [buildPackage, client, droneId, environmentMode, followRun],
  );

  const cancel = useCallback(async () => {
    const runId = snapshot?.runId;
    if (!runId) return;
    try {
      setSnapshot(await client.cancel(runId));
    } catch (caught) {
      setError(toUiError(caught));
    }
  }, [client, snapshot?.runId]);

  const validate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      return await client.validatePackage(buildPackage());
    } catch (caught) {
      setError(toUiError(caught));
      return null;
    } finally {
      setBusy(false);
    }
  }, [buildPackage, client]);

  useEffect(() => () => void (activeRunId.current = null), []);

  const running =
    snapshot !== null &&
    snapshot.state !== "COMPLETED" &&
    snapshot.state !== "FAILED" &&
    snapshot.state !== "CANCELLED";

  return {
    baseUrl: client.baseUrl,
    online,
    health,
    droneIds,
    droneId,
    setDroneId,
    environmentMode,
    setEnvironmentMode,
    validationState,
    showRunnable,
    busy,
    running,
    snapshot,
    report,
    history,
    error,
    refreshHealth,
    validate,
    runShow: () => start("SHOW_TRAJECTORY"),
    runTest: () => start("TEST_TRAJECTORY"),
    cancel,
    clearError: () => setError(null),
  };
}
