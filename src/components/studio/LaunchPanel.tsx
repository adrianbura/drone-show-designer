import { CheckCircle2, Loader2, Rocket, TriangleAlert, XCircle } from "lucide-react";
import { useMemo } from "react";

import { useI18n } from "@/i18n";
import type { LaunchGroupingStrategy, StagingFormationKind } from "@/lib/show/preshow";
import { resolveGridShape } from "@/lib/show/preshow/launchGrid";
import { useStudio } from "@/lib/studio/store";

const GROUPING: LaunchGroupingStrategy[] = ["ROWS", "COLUMNS", "BLOCKS", "MANUAL"];
const STAGING_KINDS: StagingFormationKind[] = ["grid", "circle", "formation"];

function num(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "n/a";
  return v.toFixed(digits);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

function Field({
  label,
  value,
  unit,
  step = 1,
  min,
  onChange,
}: {
  label: string;
  value: number;
  unit?: string;
  step?: number;
  min?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
        {unit ? ` (${unit})` : ""}
      </span>
      <input
        type="number"
        value={value}
        step={step}
        {...(min !== undefined ? { min } : {})}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        className="studio-input font-mono text-xs"
      />
    </label>
  );
}

/**
 * PRE-SHOW / LAUNCH panel: launch grid, staging formation, grouped take-off and
 * the pre-show validation report.
 *
 * Simulation and choreography only — this panel never arms, commands or talks to
 * any aircraft, radio or ground station.
 */
export default function LaunchPanel() {
  const {
    preShowConfig,
    preShowEnabled,
    setPreShowEnabled,
    patchPreShow,
    preShowPlan,
    preShowReport,
    preShowBusy,
    preShowError,
    previewLaunch,
    clearPreShowReport,
    launchSchedule,
    intervalSuggestion,
    groupOrderComparison,
    suggestInterval,
    compareOrders,
    applySuggestedInterval,
    project,
    setTime,
    startTime,
    preShowOverlay,
    showLaunchPads,
    setShowLaunchPads,
    showStaging,
    setShowStaging,
    showLaunchGroups,
    setShowLaunchGroups,
    selectedLaunchGroupId,
    selectLaunchGroup,
  } = useStudio();
  const { t } = useI18n();


  const status = preShowReport?.status ?? null;
  const StatusIcon = status === "VALID" ? CheckCircle2 : status === "WARNING" ? TriangleAlert : XCircle;
  const statusClass =
    status === "VALID" ? "text-success" : status === "WARNING" ? "text-warning" : "text-destructive";

  const configuredCapacity = preShowConfig.launch.rows * preShowConfig.launch.columns;
  const resolvedGrid = useMemo(
    () => resolveGridShape(project.droneCount, preShowConfig.launch),
    [project.droneCount, preShowConfig.launch],
  );
  const effectiveCapacity = resolvedGrid.rows * resolvedGrid.columns;
  const occupiedPads = project.droneCount;
  const autoGrownRows = Math.max(0, resolvedGrid.rows - preShowConfig.launch.rows);
  const unusedCells = Math.max(0, effectiveCapacity - occupiedPads);
  const groups = preShowPlan?.groups ?? [];
  const overlayGroups = preShowOverlay?.groups ?? [];
  const issues = useMemo(() => preShowReport?.issues.slice(0, 40) ?? [], [preShowReport]);

  return (
    <section className="panel-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="panel-title flex items-center gap-2">
          <Rocket className="size-3.5" /> Pre-show &amp; launch
        </h2>
        <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <input
            type="checkbox"
            checked={preShowEnabled}
            onChange={(e) => setPreShowEnabled(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          Enabled
        </label>
      </div>

      {!preShowEnabled ? (
        <p className="text-xs text-muted-foreground">
          Plan the physical launch grid, a staging formation and a grouped take-off before show time
          zero. The show timeline itself never moves: the pre-show occupies negative show time.
        </p>
      ) : (
        <div className="space-y-4">
          {/* -------------------------------------------------- launch grid */}
          <div className="space-y-2">
            <h3 className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Launch grid
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <Field
                label="Rows"
                value={preShowConfig.launch.rows}
                min={1}
                onChange={(v) => patchPreShow({ launch: { rows: Math.max(1, Math.round(v)) } })}
              />
              <Field
                label="Columns"
                value={preShowConfig.launch.columns}
                min={1}
                onChange={(v) => patchPreShow({ launch: { columns: Math.max(1, Math.round(v)) } })}
              />
              <Field
                label="Spacing X"
                value={preShowConfig.launch.spacingX}
                unit="m"
                step={0.5}
                onChange={(v) => patchPreShow({ launch: { spacingX: Math.max(0.1, v) } })}
              />
              <Field
                label="Spacing Z"
                value={preShowConfig.launch.spacingZ}
                unit="m"
                step={0.5}
                onChange={(v) => patchPreShow({ launch: { spacingZ: Math.max(0.1, v) } })}
              />
              <Field
                label="Origin X"
                value={preShowConfig.launch.originX}
                unit="m"
                onChange={(v) => patchPreShow({ launch: { originX: v } })}
              />
              <Field
                label="Origin Z"
                value={preShowConfig.launch.originZ}
                unit="m"
                onChange={(v) => patchPreShow({ launch: { originZ: v } })}
              />
              <Field
                label="Rotation"
                value={preShowConfig.launch.rotationDeg}
                unit="°"
                onChange={(v) => patchPreShow({ launch: { rotationDeg: v } })}
              />
            </div>
            <div className="space-y-1 rounded-md border border-border/60 bg-muted/20 p-2">
              <Row label={t("launchGrid.fleet")} value={String(project.droneCount)} />
              <Row
                label={t("launchGrid.configuredGrid")}
                value={`${preShowConfig.launch.rows} × ${preShowConfig.launch.columns}`}
              />
              <Row label={t("launchGrid.configuredCapacity")} value={String(configuredCapacity)} />
              <Row
                label={t("launchGrid.effectiveGrid")}
                value={`${resolvedGrid.rows} × ${resolvedGrid.columns}`}
              />
              <Row label={t("launchGrid.effectiveCapacity")} value={String(effectiveCapacity)} />
              <Row label={t("launchGrid.occupied")} value={String(occupiedPads)} />
              {autoGrownRows > 0 ? (
                <Row label={t("launchGrid.autoGrownRows")} value={`+${autoGrownRows}`} />
              ) : unusedCells > 0 ? (
                <Row label={t("launchGrid.unusedCells")} value={String(unusedCells)} />
              ) : null}
            </div>

          </div>

          {/* ------------------------------------------------------ staging */}
          <div className="space-y-2">
            <h3 className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Staging formation
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Kind
                </span>
                <select
                  value={preShowConfig.staging.formationKind}
                  onChange={(e) =>
                    patchPreShow({
                      staging: { formationKind: e.target.value as StagingFormationKind },
                    })
                  }
                  className="studio-input text-xs"
                >
                  {STAGING_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
              {preShowConfig.staging.formationKind === "formation" ? (
                <label className="space-y-1">
                  <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    Formation
                  </span>
                  <select
                    value={preShowConfig.staging.formationId ?? ""}
                    onChange={(e) =>
                      patchPreShow({ staging: { formationId: e.target.value || null } })
                    }
                    className="studio-input text-xs"
                  >
                    <option value="">Select…</option>
                    {project.formations.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <Field
                  label="Spacing"
                  value={preShowConfig.staging.spacing}
                  unit="m"
                  step={0.5}
                  onChange={(v) => patchPreShow({ staging: { spacing: Math.max(0.1, v) } })}
                />
              )}
              <Field
                label="Altitude"
                value={preShowConfig.staging.altitude}
                unit="m"
                onChange={(v) => patchPreShow({ staging: { altitude: v } })}
              />
              <Field
                label="Left / right"
                value={preShowConfig.staging.leftRight}
                unit="m"
                onChange={(v) => patchPreShow({ staging: { leftRight: v } })}
              />
              <Field
                label="Forward / back"
                value={preShowConfig.staging.forwardBack}
                unit="m"
                onChange={(v) => patchPreShow({ staging: { forwardBack: v } })}
              />
              <Field
                label="Rotation"
                value={preShowConfig.staging.rotationDeg}
                unit="°"
                onChange={(v) => patchPreShow({ staging: { rotationDeg: v } })}
              />
            </div>
          </div>

          {/* ------------------------------------------------ takeoff plan */}
          <div className="space-y-2">
            <h3 className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Grouped take-off
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Strategy
                </span>
                <select
                  value={preShowConfig.grouping.strategy}
                  onChange={(e) =>
                    patchPreShow({
                      grouping: { strategy: e.target.value as LaunchGroupingStrategy },
                    })
                  }
                  className="studio-input text-xs"
                >
                  {GROUPING.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Order
                </span>
                <select
                  value={preShowConfig.grouping.order}
                  onChange={(e) =>
                    patchPreShow({
                      grouping: { order: e.target.value as "forward" | "reverse" },
                    })
                  }
                  className="studio-input text-xs"
                >
                  <option value="forward">forward</option>
                  <option value="reverse">reverse</option>
                </select>
              </label>
              <Field
                label="Rows / group"
                value={preShowConfig.grouping.rowsPerGroup}
                min={1}
                onChange={(v) =>
                  patchPreShow({ grouping: { rowsPerGroup: Math.max(1, Math.round(v)) } })
                }
              />
              <Field
                label="Group interval"
                value={preShowConfig.grouping.groupIntervalSeconds}
                unit="s"
                step={0.5}
                onChange={(v) =>
                  patchPreShow({ grouping: { groupIntervalSeconds: Math.max(0, v) } })
                }
              />
              <Field
                label="Ascent"
                value={preShowConfig.ascentDuration}
                unit="s"
                step={0.5}
                onChange={(v) => patchPreShow({ ascentDuration: Math.max(0.5, v) })}
              />
              <Field
                label="Clearance"
                value={preShowConfig.initialClearance}
                unit="m"
                step={0.5}
                onChange={(v) => patchPreShow({ initialClearance: Math.max(0.5, v) })}
              />
              <Field
                label="Transit"
                value={preShowConfig.transitDuration}
                unit="s"
                step={0.5}
                onChange={(v) => patchPreShow({ transitDuration: Math.max(0.5, v) })}
              />
              <Field
                label="Staging hold"
                value={preShowConfig.stagingHold}
                unit="s"
                step={0.5}
                onChange={(v) => patchPreShow({ stagingHold: Math.max(0, v) })}
              />
            </div>
          </div>

          {/* ------------------------------------------------- overlays */}
          <div className="space-y-2">
            <h3 className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Viewport overlays (design guides)
            </h3>
            <div className="flex flex-wrap gap-3 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={showLaunchPads}
                  onChange={(e) => setShowLaunchPads(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                Launch pads
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={showStaging}
                  onChange={(e) => setShowStaging(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                Staging
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={showLaunchGroups}
                  onChange={(e) => setShowLaunchGroups(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                Groups
              </label>
            </div>
            {overlayGroups.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                <button
                  onClick={() => selectLaunchGroup(null)}
                  className={`mini-btn ${selectedLaunchGroupId === null ? "mini-btn-accent" : ""}`}
                >
                  All
                </button>
                {overlayGroups.map((g) => (
                  <button
                    key={g.groupId}
                    onClick={() =>
                      selectLaunchGroup(selectedLaunchGroupId === g.groupId ? null : g.groupId)
                    }
                    className={`mini-btn ${selectedLaunchGroupId === g.groupId ? "mini-btn-accent" : ""}`}
                    style={{ borderColor: `rgb(${g.color[0]},${g.color[1]},${g.color[2]})` }}
                    title={`${g.droneIndices.length} drones · +${num(g.startTime, 1)} s`}
                  >
                    {g.groupId.replace(/^GRP-?/, "G")}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* --------------------------------------------------- schedule */}
          {launchSchedule ? (
            <div className="space-y-1 rounded border border-border bg-surface-sunken p-2">
              <Row label="Groups" value={String(launchSchedule.groupCount)} />
              <Row label="Pre-show duration" value={`${num(launchSchedule.preShowDuration, 1)} s`} />
              <Row
                label="First liftoff"
                value={`T ${num(launchSchedule.firstLaunchShowTime, 1)} s`}
              />
              <Row
                label="Last liftoff"
                value={`T ${num(launchSchedule.lastLaunchShowTime, 1)} s`}
              />
              <Row label="All staged" value={`T ${num(launchSchedule.allStagedShowTime, 1)} s`} />
              <button
                onClick={() => setTime(startTime)}
                className="chip-btn mt-1 w-full justify-center"
              >
                Jump to launch start
              </button>
            </div>
          ) : null}

          {/* ---------------------------------------------------- actions */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={previewLaunch}
              disabled={preShowBusy}
              className="chip-btn justify-center"
            >
              {preShowBusy ? <Loader2 className="size-3 animate-spin" /> : null} Preview launch
            </button>
            <button onClick={suggestInterval} disabled={preShowBusy} className="chip-btn justify-center">
              Suggest interval
            </button>
            <button onClick={compareOrders} disabled={preShowBusy} className="chip-btn justify-center">
              Compare orders
            </button>
            <button onClick={clearPreShowReport} className="chip-btn justify-center">
              Clear
            </button>
          </div>

          {preShowError ? (
            <p className="text-[11px] text-destructive">{preShowError.message}</p>
          ) : null}

          {intervalSuggestion ? (
            <div className="space-y-1 rounded border border-border bg-surface-sunken p-2 text-[11px]">
              <Row
                label="Suggested interval"
                value={
                  intervalSuggestion.suggestedInterval === null
                    ? "none in range"
                    : `${num(intervalSuggestion.suggestedInterval, 2)} s`
                }
              />
              <p className="text-[10px] text-muted-foreground">{intervalSuggestion.statement}</p>
              {intervalSuggestion.suggestedInterval !== null ? (
                <button onClick={applySuggestedInterval} className="chip-btn w-full justify-center">
                  Apply suggestion
                </button>
              ) : null}
            </div>
          ) : null}

          {groupOrderComparison ? (
            <div className="space-y-1 rounded border border-border bg-surface-sunken p-2">
              {groupOrderComparison.map((c) => (
                <Row
                  key={c.order}
                  label={c.order}
                  value={`${num(c.minimumSeparation)} m min · ${c.conflictCount} conflicts`}
                />
              ))}
            </div>
          ) : null}

          {/* ----------------------------------------------------- report */}
          {preShowReport ? (
            <div className="space-y-2">
              <div className={`flex items-center gap-2 text-xs font-medium ${statusClass}`}>
                <StatusIcon className="size-4" />
                {preShowReport.statusLabel}
              </div>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                {preShowReport.statement}
              </p>
              <div className="space-y-1 rounded border border-border bg-surface-sunken p-2">
                <Row
                  label="Min separation"
                  value={`${num(preShowReport.metrics.minimumSeparation)} m`}
                />
                <Row label="Peak velocity" value={`${num(preShowReport.metrics.maximumVelocity)} m/s`} />
                <Row
                  label="Peak acceleration"
                  value={`${num(preShowReport.metrics.maximumAcceleration)} m/s²`}
                />
                <Row label="Conflicts" value={String(preShowReport.metrics.totalConflicts)} />
                <Row label="Pad spacing" value={`${num(preShowReport.launchGrid.minPadSpacing)} m`} />
                <Row
                  label="Staging spacing"
                  value={`${num(preShowReport.staging.minStaticSpacing)} m`}
                />
              </div>
              {groups.length > 0 ? (
                <div className="max-h-32 space-y-1 overflow-y-auto rounded border border-border bg-surface-sunken p-2">
                  {preShowReport.groupMetrics.map((g) => (
                    <Row
                      key={g.groupId}
                      label={`${g.groupId} · ${g.droneCount} drones`}
                      value={`+${num(g.startTime, 1)} s · ${num(g.maximumVelocity)} m/s`}
                    />
                  ))}
                </div>
              ) : null}
              {issues.length > 0 ? (
                <ul className="max-h-40 space-y-1 overflow-y-auto text-[11px]">
                  {issues.map((issue) => (
                    <li key={issue.id}>
                      <button
                        onClick={() =>
                          typeof issue.time === "number" ? setTime(issue.time) : undefined
                        }
                        className="w-full rounded border border-border px-2 py-1 text-left hover:border-accent"
                      >
                        <span
                          className={
                            issue.severity === "error"
                              ? "text-destructive"
                              : issue.severity === "warning"
                                ? "text-warning"
                                : "text-muted-foreground"
                          }
                        >
                          [{issue.severity}]
                        </span>{" "}
                        {issue.message}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
