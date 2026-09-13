/**
 * EFFECT CATALOG — one searchable surface listing every everyday colour and
 * motion effect, so the operator applies an effect with one click instead of
 * hunting through separate panels.
 *
 * PRESENTATION ONLY. Entries come from the pure `effectCatalog` helper and are
 * applied through the callbacks the parent already wires to canonical store
 * actions. Nothing is computed or mutated here.
 */
import { Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  filterEffectCatalog,
  groupEffectCatalog,
  type EffectCatalogFilter,
} from "@/lib/studio/effectCatalog";
import type { LightingSelectionPresetId, MotionSelectionPresetId } from "@/lib/studio/selectionEffects";

const FILTERS: readonly { readonly id: EffectCatalogFilter; readonly label: string }[] = [
  { id: "ALL", label: "All" },
  { id: "COLOR", label: "Colour" },
  { id: "MOTION", label: "Motion" },
];

export default function EffectCatalog({
  disabled,
  targetName,
  time,
  initialFilter = "ALL",
  autoFocusSearch = false,
  onApplyColor,
  onApplyMotion,
}: {
  disabled: boolean;
  targetName: string;
  time: number;
  initialFilter?: EffectCatalogFilter;
  /** Everyday navigation lands on the search field; mutates nothing. */
  autoFocusSearch?: boolean;
  onApplyColor: (id: LightingSelectionPresetId) => void;
  onApplyMotion: (id: MotionSelectionPresetId) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<EffectCatalogFilter>(initialFilter);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (autoFocusSearch) searchRef.current?.focus({ preventScroll: true });
  }, [autoFocusSearch]);




  const groups = useMemo(
    () => groupEffectCatalog(filterEffectCatalog(query, filter)),
    [query, filter],
  );
  const matchCount = groups.reduce((total, group) => total + group.entries.length, 0);

  return (
    <section
      className="mt-2 rounded border border-border bg-surface-sunken px-1.5 py-1.5"
      data-testid="effect-catalog"
      data-matches={matchCount}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
          <Sparkles className="size-3" /> Effect catalog
        </p>
        <div className="flex gap-1" role="group" aria-label="Effect kind filter">
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              data-testid={`effect-catalog-filter-${entry.id}`}
              data-active={filter === entry.id ? "1" : "0"}
              aria-pressed={filter === entry.id}
              onClick={() => setFilter(entry.id)}
              className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] ${
                filter === entry.id
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      <label className="mt-1 flex items-center gap-1 rounded border border-border bg-background px-1.5">
        <Search className="size-3 text-muted-foreground" />
        <span className="sr-only">Search effects</span>
        <input
          ref={searchRef}
          type="search"
          value={query}
          data-testid="effect-catalog-search"
          aria-label="Search effects"
          placeholder="Search effects…"
          onChange={(event) => setQuery(event.target.value)}
          className="h-6 w-full bg-transparent font-mono text-[10px] text-foreground outline-none"
        />
      </label>

      <p
        className="mt-1 font-mono text-[9px] text-muted-foreground"
        data-testid="effect-catalog-context"
      >
        {disabled
          ? "Select an object or drone points to apply an effect."
          : `Applies to ${targetName} at ${time.toFixed(2)}s. Preview first, then Apply.`}
      </p>

      {matchCount === 0 ? (
        <p
          className="mt-1 font-mono text-[10px] text-muted-foreground"
          data-testid="effect-catalog-empty"
        >
          No effect matches “{query}”.
        </p>
      ) : (
        <div className="mt-1 space-y-1.5">
          {groups.map((group) => (
            <div key={group.category} data-testid={`effect-catalog-group-${group.category}`}>
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground/80">
                {group.label}
              </p>
              <div className="mt-1 grid grid-cols-2 gap-1">
                {group.entries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    disabled={disabled}
                    data-testid={`effect-catalog-apply-${entry.id}`}
                    data-kind={entry.kind}
                    title={`${entry.description} Starts at ${time.toFixed(2)}s on ${targetName}.`}
                    onClick={() => {
                      if (entry.kind === "COLOR" && entry.lightingPresetId) {
                        onApplyColor(entry.lightingPresetId);
                      } else if (entry.motionPresetId) {
                        onApplyMotion(entry.motionPresetId);
                      }
                    }}
                    className="flex flex-col items-start gap-0.5 rounded border border-border bg-background px-1.5 py-1 text-left hover:border-accent disabled:opacity-40"
                  >
                    <span className="font-mono text-[10px] text-foreground">{entry.label}</span>
                    <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-muted-foreground">
                      {entry.kind === "COLOR" ? "Colour" : "Motion"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
