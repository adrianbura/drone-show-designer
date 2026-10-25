import { useId } from "react";
import type { analyzeSpatialRgb } from "@/lib/import/essp/native/spatialRgb";

type Evidence = ReturnType<typeof analyzeSpatialRgb>;
const finite = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Presentation of measured source evidence only, never effect recognition. */
export default function SpatialRgbDiagnostic({
  evidence,
  ro,
}: {
  evidence: Evidence | null | undefined;
  ro: boolean;
}) {
  const heading = useId();
  const text = (romanian: string, english: string) => (ro ? romanian : english);
  const explanations: Record<string, string> = {
    NO_PAIRED_SAMPLES: text(
      "Nu există probe de poziție și culoare la aceleași momente în acest interval.",
      "No paired position and color samples at matching times in this interval.",
    ),
    UNIFORM: text(
      "Culori uniforme în spațiu. Pot varia în timp, dar nu indică o direcție a gradientului.",
      "Spatially uniform colors. They may change over time, but provide no gradient direction.",
    ),
    INSUFFICIENT_EVIDENCE: text(
      "Probe insuficiente sau geometrie insuficientă pentru o estimare spațială sigură.",
      "Insufficient samples or geometry for a reliable spatial estimate.",
    ),
    LOW_OR_UNSTABLE_FIT: text(
      "Un singur gradient stabil nu este susținut. Pot exista culori neliniare, mai multe direcții sau variații în timp.",
      "A single stable gradient is not supported. Colors may be nonlinear, multidirectional or changing over time.",
    ),
    SUPPORTED_GRADIENT: text(
      "Datele susțin un gradient spațial liniar cu axă stabilă, nu identificarea unui efect.",
      "The data supports a linear spatial gradient with a stable axis, not an identified effect.",
    ),
  };
  const explanation = evidence ? explanations[evidence.status] : undefined;
  const supported = evidence?.status === "SUPPORTED_GRADIENT";
  const direction = supported && evidence.direction?.every(finite) ? evidence.direction : null;
  const temporal = supported ? evidence?.temporal : null;
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const rows: [string, string][] = [];
  const add = (label: string, value: number | null | undefined, unit = "") => {
    if (finite(value)) rows.push([label, `${value.toFixed(2)}${unit ? ` ${unit}` : ""}`]);
  };
  if (evidence) {
    if (finite(evidence.pairedSamples))
      rows.push([
        text("Probe pereche XYZ/RGB", "Paired XYZ/RGB samples"),
        String(evidence.pairedSamples),
      ]);
    if (finite(evidence.pairedFrames) && finite(evidence.evaluatedFrames))
      rows.push([
        text("Momente cu probe / evaluate", "Paired / evaluated timestamps"),
        `${evidence.pairedFrames} / ${evidence.evaluatedFrames}`,
      ]);
    add(text("Ceas RGB original", "Original RGB clock"), evidence.rgbRateHz, "Hz");
    if (finite(evidence.firstPairedTime) && finite(evidence.lastPairedTime))
      rows.push([
        text("Prima / ultima probă", "First / last sample"),
        `${evidence.firstPairedTime.toFixed(3)} / ${evidence.lastPairedTime.toFixed(3)} s`,
      ]);
    if (finite(evidence.coherence))
      rows.push([text("Fit liniar mediu", "Mean linear fit"), percent(evidence.coherence)]);
    if (finite(evidence.minimumCoherence))
      rows.push([
        text("Fit liniar minim", "Minimum linear fit"),
        percent(evidence.minimumCoherence),
      ]);
    if (supported) {
      if (finite(evidence.supportedFrameFraction))
        rows.push([
          text("Momente cu gradient susținut", "Gradient-supported timestamps"),
          percent(evidence.supportedFrameFraction),
        ]);
      if (finite(evidence.directionStability))
        rows.push([
          text("Stabilitatea axei", "Axis stability"),
          percent(evidence.directionStability),
        ]);
      if (direction)
        rows.push([
          text("Axă X / Y / Z", "Axis X / Y / Z"),
          direction.map((v) => v.toFixed(3)).join(" / "),
        ]);
      add(text("Putere gradient", "Gradient strength"), evidence.strengthRgbPerMeter, "RGB/m");
    }
  }
  if (
    temporal &&
    finite(temporal.consecutiveSupportedPairs) &&
    temporal.consecutiveSupportedPairs > 0
  ) {
    rows.push([
      text("Perechi temporale susținute", "Supported temporal pairs"),
      String(temporal.consecutiveSupportedPairs),
    ]);
    add(text("Schimbare câmp", "Field change"), temporal.fieldChangeRgbPerSecond, "RGB/s");
    add(
      text("Schimbare gradient", "Gradient change"),
      temporal.gradientChangeRgbPerMeterSecond,
      "RGB/m/s",
    );
    add(
      text("Viteză aparentă a câmpului", "Apparent field speed"),
      temporal.apparentSpeedMetersPerSecond,
      "m/s",
    );
  }
  return (
    <section
      aria-labelledby={heading}
      className="min-w-0 space-y-2 border-t border-border pt-2 text-xs"
    >
      <h4 id={heading} className="font-medium">
        {text("Diagnostic RGB spațial", "Spatial RGB diagnostic")}
      </h4>
      <p role="status" aria-live="polite" className="break-words text-muted-foreground">
        {explanation ??
          text(
            "Analiza spațială nu este disponibilă sau nu este suportată.",
            "Spatial analysis is unavailable or unsupported.",
          )}
      </p>
      <dl className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-2 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="min-w-0 break-words text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words font-mono">{value}</dd>
          </div>
        ))}
      </dl>
      {supported && (
        <p className="text-muted-foreground">
          {text(
            "Axa este fără sens de deplasare (X lateral, Y vertical, Z adâncime). Viteza aparentă, când există, nu este viteza dronelor.",
            "The axis has no travel orientation (X lateral, Y vertical, Z depth). Apparent speed, when available, is not drone speed.",
          )}
        </p>
      )}
      {supported && (!temporal || !finite(temporal.apparentSpeedMetersPerSecond)) && (
        <p className="text-muted-foreground">
          {text(
            "Viteza aparentă nu este susținută de date.",
            "Apparent speed is not supported by the data.",
          )}
        </p>
      )}
      <p className="text-muted-foreground">
        {text(
          "Fit-ul măsoară doar modelul liniar; un fit mare nu identifică un efect. RGB reprezintă valori înregistrate, nu intensitate luminoasă calibrată. Rețeta efectelor: necunoscută.",
          "Fit measures only the linear model; a high fit does not identify an effect. RGB represents recorded values, not calibrated light intensity. Effect recipe: unknown.",
        )}
      </p>
    </section>
  );
}
