/**
 * COLLAPSIBLE EVERYDAY SECTION (presentation only).
 *
 * A real button header with aria-expanded / aria-controls, an optional badge fed
 * from canonical state, and one child region. It owns no project state.
 */
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export default function WorkspaceSection({
  id,
  label,
  badge,
  open,
  onToggle,
  testId,
  headerTestId,
  children,
}: {
  id: string;
  label: string;
  badge?: string | null;
  open: boolean;
  onToggle: () => void;
  testId: string;
  headerTestId: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded border border-border bg-panel/40" data-testid={testId}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`${id}-region`}
        data-testid={headerTestId}
        data-open={open ? "1" : "0"}
        className="flex min-h-[40px] w-full items-center gap-2 rounded px-2 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        {open ? (
          <ChevronDown className="size-3 shrink-0" />
        ) : (
          <ChevronRight className="size-3 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-[0.16em]">
          {label}
        </span>
        {badge ? (
          <span
            className="shrink-0 rounded border border-border px-1 font-mono text-[9px] text-muted-foreground"
            data-testid={`${headerTestId}-badge`}
          >
            {badge}
          </span>
        ) : null}
      </button>
      <div
        id={`${id}-region`}
        role="region"
        hidden={!open}
        className={open ? "px-2 pb-2" : "hidden"}
      >
        {open ? children : null}
      </div>
    </section>
  );
}
