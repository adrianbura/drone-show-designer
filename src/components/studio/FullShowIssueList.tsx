/**
 * FULL-SHOW ISSUE LIST — PRESENTATION ONLY.
 *
 * Groups the canonical `FullShowIssue` records for reading (geofence findings
 * kept together, then everything else) and displays the context the report
 * already carries: drone id, clip and measured value against its limit. It
 * never edits, re-severities or recomputes an issue.
 */
import type { FullShowIssue, FullShowIssueCategory } from "@/lib/show/fullshow";

const CATEGORY_LABEL: Record<FullShowIssueCategory, string> = {
  timeline: "Timeline",
  continuity: "Continuity",
  conflict: "Proximity",
  safety: "Safety",
  geofence: "GPS geofence",
  homePads: "Home pads",
  takeoff: "Take-off",
  landing: "Landing",
  lighting: "Lighting",
  transition: "Transition",
  preShow: "Pre-show",
};

function measured(issue: FullShowIssue): string | null {
  if (typeof issue.value !== "number" || !Number.isFinite(issue.value)) return null;
  const limit =
    typeof issue.limit === "number" && Number.isFinite(issue.limit)
      ? ` / limit ${issue.limit.toFixed(2)}`
      : "";
  return `${issue.value.toFixed(2)}${limit}`;
}

function IssueRow({
  issue,
  clipLabel,
  onFocus,
}: {
  issue: FullShowIssue;
  clipLabel: (clipId: string) => string;
  onFocus: (issue: FullShowIssue) => void;
}) {
  const value = measured(issue);
  return (
    <li>
      <button
        type="button"
        onClick={() => onFocus(issue)}
        data-testid={`issue-row-${issue.id}`}
        data-issue-time={typeof issue.time === "number" ? issue.time : ""}
        className={`issue-row min-w-0 ${issue.severity === "error" ? "issue-row-critical" : ""}`}
      >
        <span className="font-mono text-[10px] shrink-0">
          {typeof issue.time === "number" ? `${issue.time.toFixed(1)}s` : "—"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words">
            <span className="font-mono text-[9px] uppercase tracking-wider opacity-70">
              {CATEGORY_LABEL[issue.category]}
            </span>{" "}
            {issue.message}
          </span>
          <span className="block font-mono text-[9px] text-muted-foreground">
            {issue.droneIds?.length ? `drone ${issue.droneIds.join(", ")}` : "all drones"}
            {issue.clipId ? ` · ${clipLabel(issue.clipId)}` : ""}
            {value ? ` · ${value}` : ""}
          </span>
        </span>
      </button>
    </li>
  );
}

export default function FullShowIssueList({
  issues,
  clipLabel,
  onFocus,
}: {
  issues: readonly FullShowIssue[];
  clipLabel: (clipId: string) => string;
  onFocus: (issue: FullShowIssue) => void;
}) {
  const geofence = issues.filter((i) => i.category === "geofence");
  const others = issues.filter((i) => i.category !== "geofence");

  if (issues.length === 0) {
    return (
      <p className="text-[11px] text-safe">No issue in this category for the composed show.</p>
    );
  }

  return (
    <div className="max-h-64 min-w-0 space-y-2 overflow-y-auto">
      {geofence.length > 0 && (
        <div data-testid="issue-group-geofence">
          <p className="pb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            GPS geofence ({geofence.length})
          </p>
          <ul className="space-y-1">
            {geofence.slice(0, 100).map((issue) => (
              <IssueRow key={issue.id} issue={issue} clipLabel={clipLabel} onFocus={onFocus} />
            ))}
          </ul>
        </div>
      )}
      {others.length > 0 && (
        <div data-testid="issue-group-other">
          {geofence.length > 0 && (
            <p className="pb-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
              Other findings ({others.length})
            </p>
          )}
          <ul className="space-y-1">
            {others.slice(0, 200).map((issue) => (
              <IssueRow key={issue.id} issue={issue} clipLabel={clipLabel} onFocus={onFocus} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
