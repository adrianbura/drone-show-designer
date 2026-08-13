/**
 * SimulationPanel — PX4 SITL / mock single-vehicle simulation (Sprint 5).
 *
 * Read-only with respect to the show: it selects one drone, hands the bridge an
 * immutable package and displays returned diagnostics. Every result is labelled
 * as a SIMULATION result, never as a real-world safety statement.
 */
import { Ban, Cpu, Download, RefreshCw, Rocket, Ruler } from "lucide-react";

import { exportSimulationReport, statusLabel } from "@/lib/simulation/report";
import { useSimulation } from "@/lib/simulation/useSimulation";

const VALIDATION_LABEL: Record<string, string> = {
  VALIDATED: "validated",
  VALIDATED_WITH_WARNINGS: "validated (warnings)",
  STALE_VALIDATION: "stale — re-run full-show validation",
  FAILED_VALIDATION: "full-show validation FAILED",
  UNVALIDATED: "not validated yet",
};

export default function SimulationPanel() {
  const sim = useSimulation();
  const metrics = sim.report?.trackingMetrics ?? null;
  const isMock = (sim.report?.environment.mode ?? sim.environmentMode) === "MOCK";

  return (
    <section className="panel-card">
      <h2 className="panel-title">
        <Cpu className="size-3.5" /> Simulation bridge
        <span className={`status-pill ${sim.online ? "status-available" : "status-unavailable"}`}>
          {sim.online ? "online" : "offline"}
        </span>
      </h2>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        SIMULATION ONLY — replays ONE drone trajectory through a local PX4 SITL vehicle or an
        in-process mock. No real aircraft can be commanded from here.
      </p>

      {!sim.online && (
        <div className="space-y-2">
          <p className="text-[10px] leading-relaxed text-warning">
            Bridge not reachable at {sim.baseUrl}. Start it locally:
            <span className="block pt-1 font-mono">
              cd simulation_bridge && python -m uvicorn app.main:app --port 8787
            </span>
          </p>
          <button onClick={() => void sim.refreshHealth()} className="chip-btn w-full justify-center">
            <RefreshCw className="size-3" /> Retry connection
          </button>
        </div>
      )}

      {sim.online && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1.5">
              <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Drone
              </span>
              <select
                value={sim.droneId}
                onChange={(e) => sim.setDroneId(e.target.value)}
                className="studio-input"
                disabled={sim.running}
              >
                {sim.droneIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Target
              </span>
              <select
                value={sim.environmentMode}
                onChange={(e) => sim.setEnvironmentMode(e.target.value as "MOCK" | "PX4_SITL")}
                className="studio-input"
                disabled={sim.running}
              >
                <option value="MOCK">Mock vehicle</option>
                <option value="PX4_SITL" disabled={!sim.health?.px4Available}>
                  PX4 SITL
                </option>
              </select>
            </label>
          </div>

          {!sim.health?.px4Available && (
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              {sim.health?.px4Detail ?? "MAVSDK unavailable — mock mode only."}
            </p>
          )}

          <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
            show gate: {VALIDATION_LABEL[sim.validationState] ?? sim.validationState}
          </p>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => void sim.runShow()}
              disabled={sim.busy || sim.running || !sim.showRunnable || !sim.droneId}
              className="chip-btn justify-center disabled:opacity-40"
              title={sim.showRunnable ? "" : "Only a validated show can be simulated"}
            >
              <Rocket className="size-3" /> Run drone
            </button>
            <button
              onClick={() => void sim.runTest()}
              disabled={sim.busy || sim.running}
              className="chip-btn justify-center disabled:opacity-40"
            >
              <Ruler className="size-3" /> Test pattern
            </button>
          </div>
          <button
            onClick={() => void sim.validate()}
            disabled={sim.busy || sim.running || !sim.droneId}
            className="chip-btn w-full justify-center disabled:opacity-40"
          >
            Validate package on bridge
          </button>
          {sim.running && (
            <button onClick={() => void sim.cancel()} className="chip-btn w-full justify-center">
              <Ban className="size-3" /> Cancel run
            </button>
          )}

          {sim.error && (
            <p className="text-[10px] leading-relaxed text-critical">
              {sim.error.code}: {sim.error.message}
            </p>
          )}

          {sim.snapshot && (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
              <dt>state</dt>
              <dd className="text-right text-foreground">{sim.snapshot.state}</dd>
              <dt>stage</dt>
              <dd className="text-right text-foreground">{sim.snapshot.stage}</dd>
              <dt>elapsed</dt>
              <dd className="text-right text-foreground">
                {sim.snapshot.elapsedSeconds.toFixed(1)} s ({(sim.snapshot.progress * 100).toFixed(0)}%)
              </dd>
              {sim.snapshot.latest && (
                <>
                  <dt>live error</dt>
                  <dd className="text-right text-foreground">
                    {sim.snapshot.latest.error.toFixed(2)} m
                  </dd>
                </>
              )}
            </dl>
          )}

          {sim.report && (
            <div className="space-y-2 rounded border border-border/70 p-2">
              <p className="text-xs text-foreground">{statusLabel(sim.report.status)}</p>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                {isMock ? "MOCK vehicle — not PX4. " : ""}
                {sim.report.statement}
              </p>
              {metrics && (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
                  <dt>rms err</dt>
                  <dd className="text-right text-foreground">
                    {metrics.rmsPositionError.toFixed(3)} m
                  </dd>
                  <dt>max err</dt>
                  <dd className="text-right text-foreground">
                    {metrics.maxPositionError.toFixed(3)} m
                  </dd>
                  <dt>p95 err</dt>
                  <dd className="text-right text-foreground">
                    {metrics.p95PositionError.toFixed(3)} m
                  </dd>
                  <dt>final err</dt>
                  <dd className="text-right text-foreground">
                    {metrics.finalPositionError.toFixed(3)} m
                  </dd>
                  <dt>est. lag</dt>
                  <dd className="text-right text-foreground">
                    {metrics.estimatedTrackingLagSeconds === null
                      ? "n/a"
                      : `${metrics.estimatedTrackingLagSeconds.toFixed(2)} s`}
                  </dd>
                  <dt>samples</dt>
                  <dd className="text-right text-foreground">{metrics.sampleCount}</dd>
                </dl>
              )}
              {sim.report.warnings.slice(0, 3).map((w) => (
                <p key={w} className="text-[10px] leading-relaxed text-warning">
                  {w}
                </p>
              ))}
              {sim.report.errors.slice(0, 3).map((e) => (
                <p key={e} className="text-[10px] leading-relaxed text-critical">
                  {e}
                </p>
              ))}
              <button
                onClick={() => exportSimulationReport(sim.report!)}
                className="chip-btn w-full justify-center"
              >
                <Download className="size-3" /> Export simulation report
              </button>
            </div>
          )}

          {sim.history.length > 0 && (
            <ul className="space-y-1 pt-1">
              {sim.history.slice(0, 5).map((entry) => (
                <li
                  key={entry.runId}
                  className="flex items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground"
                >
                  <span className="truncate">
                    {entry.environmentMode} · {entry.droneId ?? "test"}
                  </span>
                  <span className={entry.status === "FAIL" ? "text-critical" : "text-safe"}>
                    {entry.status}
                    {entry.maxPositionError !== null
                      ? ` · ${entry.maxPositionError.toFixed(2)} m`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
