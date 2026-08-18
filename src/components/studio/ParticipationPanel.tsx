/**
 * FLEET PARTICIPATION PANEL (Sprint 7.3).
 *
 * Exposes the participation policy and the reserve zone, and reports the DERIVED
 * plan of the selected clip. Every drone is always planned: the counts shown here
 * always add up to the fleet size, so a partial formation never means "unplanned
 * drones". Reserve lighting is choreography only — it never affects flight
 * planning, safety validation or export.
 */
import { Users } from "lucide-react";

import {
  PARTICIPATION_POLICIES,
  type ParticipationPolicy,
  type ReserveLightingPolicy,
} from "@/lib/show/participation";
import { useStudio } from "@/lib/studio/store";

const POLICY_LABEL: Record<ParticipationPolicy, string> = {
  SMART_PREPARE: "Smart prepare (look ahead)",
  HOLD_CURRENT: "Hold current position",
  RESERVE_FORMATION: "Reserve formation",
  MANUAL: "Manual selection",
};

const LIGHTING: ReserveLightingPolicy[] = ["OFF", "DIM", "NORMAL"];

export default function ParticipationPanel() {
  const {
    project,
    plan,
    selectedClipId,
    participationSettings,
    patchParticipation,
    setClipParticipation,
  } = useStudio();

  const clipOverride = selectedClipId ? participationSettings.clips?.[selectedClipId] : undefined;
  const clipPlan = selectedClipId
    ? (plan.participation.find((p) => p.clipId === selectedClipId) ?? null)
    : null;
  const warnings = plan.participationWarnings.filter((w) => w.clipId === selectedClipId);
  const zone = participationSettings.reserveZone;

  return (
    <section className="panel-card">
      <h2 className="panel-title flex items-center gap-1.5">
        <Users className="size-3" /> Fleet participation
      </h2>

      <div className="space-y-2">
        <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="uppercase tracking-[0.14em]">Default policy</span>
          <select
            value={participationSettings.defaultPolicy}
            onChange={(e) => patchParticipation({ defaultPolicy: e.target.value as ParticipationPolicy })}
            className="h-7 min-w-0 flex-1 rounded border border-border bg-surface-sunken px-1.5 text-[11px] text-foreground"
          >
            {PARTICIPATION_POLICIES.map((p) => (
              <option key={p} value={p}>
                {POLICY_LABEL[p]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="uppercase tracking-[0.14em]">Look-ahead scenes</span>
          <input
            type="number"
            min={0}
            max={4}
            step={1}
            value={participationSettings.lookAheadScenes}
            onChange={(e) => patchParticipation({ lookAheadScenes: Number(e.target.value) })}
            className="h-7 w-16 rounded border border-border bg-surface-sunken px-1.5 text-right text-[11px] text-foreground"
          />
        </label>

        <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="uppercase tracking-[0.14em]">Reserve lighting</span>
          <select
            value={participationSettings.reserveLighting}
            onChange={(e) =>
              patchParticipation({ reserveLighting: e.target.value as ReserveLightingPolicy })
            }
            className="h-7 rounded border border-border bg-surface-sunken px-1.5 text-[11px] text-foreground"
          >
            {LIGHTING.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-1.5">
          {(["x", "y", "z"] as const).map((axis, i) => (
            <label key={axis} className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
              <span className="uppercase tracking-[0.14em]">Zone {axis}</span>
              <input
                type="number"
                step={1}
                value={Number(zone.center[i]!.toFixed(1))}
                onChange={(e) => {
                  const center = [...zone.center] as [number, number, number];
                  center[i] = Number(e.target.value);
                  patchParticipation({ reserveZone: { ...zone, center } });
                }}
                className="h-6 w-14 rounded border border-border bg-surface-sunken px-1 text-right text-[10px] text-foreground"
              />
            </label>
          ))}
          <label className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground">
            <span className="uppercase tracking-[0.14em]">Spacing</span>
            <input
              type="number"
              step={0.5}
              min={project.limits.minSeparation}
              value={Number(zone.spacing.toFixed(1))}
              onChange={(e) => patchParticipation({ reserveZone: { ...zone, spacing: Number(e.target.value) } })}
              className="h-6 w-14 rounded border border-border bg-surface-sunken px-1 text-right text-[10px] text-foreground"
            />
          </label>
        </div>
      </div>

      <div className="mt-3 space-y-2 border-t border-border pt-2">
        {!selectedClipId ? (
          <p className="text-[11px] text-muted-foreground">Select a clip to review its participation.</p>
        ) : (
          <>
            <label className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="uppercase tracking-[0.14em]">Clip policy</span>
              <select
                value={clipOverride?.policy ?? ""}
                onChange={(e) =>
                  setClipParticipation(
                    selectedClipId,
                    e.target.value
                      ? { ...clipOverride, policy: e.target.value as ParticipationPolicy }
                      : null,
                  )
                }
                className="h-7 min-w-0 flex-1 rounded border border-border bg-surface-sunken px-1.5 text-[11px] text-foreground"
              >
                <option value="">Project default</option>
                {PARTICIPATION_POLICIES.map((p) => (
                  <option key={p} value={p}>
                    {POLICY_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>

            {clipPlan ? (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px]">
                {(
                  [
                    ["Fleet", clipPlan.counts.fleet],
                    ["Active", clipPlan.counts.active],
                    ["Pre-position", clipPlan.counts.preposition],
                    ["Hold", clipPlan.counts.hold],
                    ["Reserve", clipPlan.counts.reserve],
                    ["Manual", clipPlan.counts.manual],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-2">
                    <dt className="uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
                    <dd className="text-foreground">{value}</dd>
                  </div>
                ))}
                <div className="col-span-2 flex items-center justify-between gap-2">
                  <dt className="uppercase tracking-[0.14em] text-muted-foreground">Solver</dt>
                  <dd className="text-foreground">
                    {clipPlan.provenance.solver} · v{clipPlan.provenance.algorithmVersion}
                  </dd>
                </div>
                {clipPlan.lookAhead.usedClipId ? (
                  <div className="col-span-2 flex items-center justify-between gap-2">
                    <dt className="uppercase tracking-[0.14em] text-muted-foreground">Prepares</dt>
                    <dd className="text-foreground">{clipPlan.lookAhead.usedClipId}</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                This clip uses the whole fleet — no reserve planning is needed.
              </p>
            )}

            {[...(clipPlan?.warnings ?? []).map((w) => w.message), ...warnings.map((w) => w.message)].map(
              (message, i) => (
                <p key={i} className="font-mono text-[10px] leading-relaxed text-warning">
                  {message}
                </p>
              ),
            )}
          </>
        )}
      </div>
    </section>
  );
}
