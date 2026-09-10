/**
 * SHOW READINESS — PRESENTATION ONLY.
 *
 * Renders the pure model from `buildShowReadiness`. It computes no safety,
 * geometry or geofence facts, and it never mutates the project: every action is
 * delegated to the canonical authority that owns it.
 */
import { AlertTriangle, CheckCircle2, Circle, Loader2, ShieldAlert } from "lucide-react";
import { useState } from "react";

import {
  geofenceFactRows,
  type ReadinessActionId,
  type ReadinessItemState,
  type ShowReadinessModel,
} from "@/lib/adapters/showReadiness";

const STATUS_CLASS: Record<ShowReadinessModel["status"], string> = {
  READY: "border-safe/60 bg-safe/10 text-safe",
  READY_WITH_WARNINGS: "border-warning/60 bg-warning/10 text-warning",
  BLOCKED: "border-destructive/60 bg-destructive/10 text-destructive",
  INCOMPLETE: "border-border bg-muted/30 text-muted-foreground",
};

const ITEM_CLASS: Record<ReadinessItemState, string> = {
  OK: "text-safe",
  WARNING: "text-warning",
  BLOCKED: "text-destructive",
  TODO: "text-muted-foreground",
};

function ItemIcon({ state }: { state: ReadinessItemState }) {
  if (state === "OK") return <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />;
  if (state === "WARNING") return <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />;
  if (state === "BLOCKED") return <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />;
  return <Circle className="mt-0.5 size-3.5 shrink-0" />;
}

export default function ShowReadinessView({
  model,
  busy,
  progress,
  onAction,
}: {
  model: ShowReadinessModel;
  busy?: boolean;
  progress?: string | null;
  onAction: (action: ReadinessActionId) => void;
}) {
  const [openItems, setOpenItems] = useState(true);
  const [openGeofence, setOpenGeofence] = useState(true);

  const primary =
    model.items.find((i) => i.state === "BLOCKED" && i.action)?.action ??
    model.items.find((i) => i.state === "TODO" && i.action)?.action ??
    model.items.find((i) => i.id === "HANDOFF")?.action ??
    null;

  return (
    <section className="panel-card min-w-0" data-testid="show-readiness">
      <h2 className="panel-title">
        <ShieldAlert className="size-3.5" /> Show readiness
      </h2>

      <div
        className={`rounded border p-2 ${STATUS_CLASS[model.status]}`}
        data-testid="readiness-status"
        data-status={model.status}
      >
        <p className="font-mono text-[11px] font-semibold tracking-wide">
          {model.status.replace(/_/g, " ")}
        </p>
        <p className="text-[10px] leading-relaxed">{model.statusDetail}</p>
      </div>

      {/* PRIMARY ACTION — always visible, also on a narrow inspector. */}
      {primary && (
        <button
          type="button"
          onClick={() => onAction(primary.id)}
          disabled={!!busy}
          data-testid="readiness-primary-action"
          data-action={primary.id}
          className="chip-btn w-full justify-center disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3 animate-spin" /> : null}
          {primary.label}
        </button>
      )}

      {busy && progress ? (
        <p
          className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
          data-testid="readiness-progress"
        >
          {progress}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => setOpenItems((v) => !v)}
        aria-expanded={openItems}
        aria-controls="readiness-items"
        data-testid="readiness-items-toggle"
        className="w-full text-left font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
      >
        Checks ({model.items.filter((i) => i.state === "OK").length}/{model.items.length})
      </button>
      <ul id="readiness-items" role="region" hidden={!openItems} className="space-y-1">
        {openItems &&
          model.items.map((item) => (
            <li
              key={item.id}
              data-testid={`readiness-item-${item.id}`}
              data-state={item.state}
              className="min-w-0 rounded border border-border/70 p-2"
            >
              <div className={`flex min-w-0 items-start gap-2 ${ITEM_CLASS[item.state]}`}>
                <ItemIcon state={item.state} />
                <div className="min-w-0 flex-1">
                  <p className="break-words font-mono text-[11px] font-semibold">{item.label}</p>
                  <p className="break-words text-[10px] leading-relaxed text-muted-foreground">
                    {item.detail}
                  </p>
                </div>
              </div>
              {item.action && (
                <button
                  type="button"
                  onClick={() => onAction(item.action!.id)}
                  disabled={!!busy}
                  data-testid={`readiness-action-${item.id}`}
                  data-action={item.action.id}
                  className="chip-btn mt-1 w-full justify-center disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {item.action.label}
                </button>
              )}
            </li>
          ))}
      </ul>

      <button
        type="button"
        onClick={() => setOpenGeofence((v) => !v)}
        aria-expanded={openGeofence}
        aria-controls="readiness-geofence"
        data-testid="readiness-geofence-toggle"
        className="w-full text-left font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
      >
        Geofence facts
      </button>
      <div id="readiness-geofence" role="region" hidden={!openGeofence}>
        {openGeofence ? (
          model.geofence ? (
            <dl
              className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground"
              data-testid="readiness-geofence-facts"
            >
              {geofenceFactRows(model.geofence).map((row) => (
                <div key={row.label} className="col-span-2 flex min-w-0 justify-between gap-2">
                  <dt className="min-w-0 truncate uppercase tracking-[0.12em]">{row.label}</dt>
                  <dd className="shrink-0 text-foreground">{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p
              className="text-[10px] leading-relaxed text-muted-foreground"
              data-testid="readiness-geofence-missing"
            >
              No canonical geofence scan for this revision.
            </p>
          )
        ) : null}
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Readiness reports canonical validation and export state only. It is never an authorisation
        to fly.
      </p>
    </section>
  );
}
