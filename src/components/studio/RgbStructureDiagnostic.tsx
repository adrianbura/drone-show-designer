import { useId } from "react";
import type { analyzeRgbStructure } from "@/lib/import/essp/native/rgbStructure";

type Evidence = ReturnType<typeof analyzeRgbStructure>;
const n = (v: number | null | undefined, d = 2) =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—";

/** Measured RGB structure only; never effect recognition. */
export default function RgbStructureDiagnostic({
  evidence,
  ro,
}: {
  evidence: Evidence | null | undefined;
  ro: boolean;
}) {
  const heading = useId();
  const t = (r: string, e: string) => (ro ? r : e);
  if (!evidence) return null;
  const { groups, temporal, reconstruction } = evidence;
  const groupText: Record<string, string> = {
    NO_RGB: t("Fără probe RGB.", "No RGB samples."),
    AMBIGUOUS: t(
      "Grupuri ambigue: majoritatea dronelor nu împart exact aceeași secvență de culori.",
      "Ambiguous groups: most drones do not share an exact color sequence.",
    ),
    SINGLE_GROUP: t("Un singur grup cu secvență identică.", "One group with an identical sequence."),
    MULTIPLE_GROUPS: t(
      "Mai multe grupuri simultane cu secvențe identice.",
      "Multiple simultaneous groups with identical sequences.",
    ),
  };
  const temporalText: Record<string, string> = {
    NO_RGB: t("Fără probe RGB.", "No RGB samples."),
    TOO_LONG: t(
      "Interval prea lung pentru analiza temporală; necunoscut.",
      "Interval too long for temporal analysis; unknown.",
    ),
    STATIC: t("Culori constante în timp.", "Colors constant over time."),
    NONPERIODIC_OR_UNKNOWN: t(
      "Variație fără periodicitate validată; necunoscut.",
      "Variation without validated periodicity; unknown.",
    ),
    PERIODIC_UNVALIDATED: t(
      "Periodicitate posibilă, nevalidată pe datele rezervate; necunoscut.",
      "Possible periodicity, not validated on held-out data; unknown.",
    ),
    PULSATION_SUPPORTED: t(
      "Pulsație în fază susținută și validată pe a doua jumătate.",
      "In-phase pulsation supported and validated on the held-out half.",
    ),
    WAVE_SUPPORTED: t(
      "Val (decalaj de fază după poziție) validat pe drone rezervate.",
      "Wave (position-dependent phase lag) validated on held-out drones.",
    ),
  };
  const model: Record<string, string> = {
    FLEET_COLOR_PER_TICK: t("Culoare comună per moment", "Shared color per tick"),
    STATIC_COLOR_PER_DRONE: t("Culoare fixă per dronă", "Fixed color per drone"),
    EXACT_GROUPS_PLUS_UNGROUPED_UNKNOWN: t("Grupuri exacte", "Exact groups"),
    UNKNOWN: t("Necunoscut — se redă sursa exactă", "Unknown — exact source is played"),
  };
  return (
    <section aria-labelledby={heading} className="min-w-0 space-y-2 border-t border-border pt-2 text-xs">
      <h4 id={heading} className="font-medium">
        {t("Structură RGB", "RGB structure")}
      </h4>
      <p data-testid="rgb-groups" className="break-words text-muted-foreground">
        {groupText[groups.status]}{" "}
        {groups.groups.length > 0 &&
          `${t("Grupuri", "Groups")}: ${groups.groups.length}; ${t("cel mai mare", "largest")}: ${groups.groups[0]!.support}; ${t("ambiguu", "ambiguous")}: ${n((groups.ambiguousFraction ?? 0) * 100, 1)}%`}
      </p>
      <p data-testid="rgb-temporal" className="break-words text-muted-foreground">
        {temporalText[temporal.status]}
        {temporal.periodSeconds !== null &&
          ` ${t("Perioadă", "Period")}: ${n(temporal.periodSeconds)} s; ${t("validare", "held-out")}: ${n(temporal.heldOutCorrelation ?? temporal.waveHeldOutR2)}`}
      </p>
      {reconstruction.status === "EVALUATED" && (
        <dl className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1">
          {reconstruction.models.map((m) => (
            <div key={m.model} className="contents">
              <dt className="min-w-0 break-words text-muted-foreground">{model[m.model]}</dt>
              <dd className="font-mono">
                {n(m.meanAbsError)} / {m.maxAbsError}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p data-testid="rgb-reconstruction" className="break-words">
        {t("Model în toleranță", "Model within tolerance")}: {model[reconstruction.best]}
      </p>
      <p className="text-muted-foreground">
        {t(
          "Eroare medie / maximă în octeți RGB față de sursa exactă. Redarea folosește mereu mostrele originale. Rețeta efectelor: necunoscută.",
          "Mean / max RGB byte error versus the exact source. Playback always uses the original samples. Effect recipe: unknown.",
        )}
      </p>
    </section>
  );
}
