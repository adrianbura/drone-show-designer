import { useEffect, useMemo, useRef } from "react";
import { useI18n } from "@/i18n";
import { useStudio } from "@/lib/studio/store";
import { referenceShowFromLayer } from "@/lib/import/essp/native/layer";
import { sourceSceneEvidence } from "@/lib/import/essp/native/sceneEvidence";
import SpatialRgbDiagnostic from "./SpatialRgbDiagnostic";

export default function SourceScenePanel() {
  const { referenceLayer, selectedClipId } = useStudio();
  const { language } = useI18n();
  const ro = language === "ro";
  const canvas = useRef<HTMLCanvasElement>(null);
  const show = useMemo(() => {
    if (!referenceLayer) return null;
    try {
      return referenceShowFromLayer(referenceLayer);
    } catch {
      return null;
    }
  }, [referenceLayer]);
  const binding = referenceLayer?.bindings.find((entry) => entry.clipId === selectedClipId);
  const evidence = useMemo(
    () => (show && binding ? sourceSceneEvidence(show, binding) : null),
    [show, binding],
  );
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context || !evidence) return;
    context.clearRect(0, 0, 320, 160);
    const xs = evidence.preview.map((sample) => sample.position[0]);
    const ys = evidence.preview.map((sample) => sample.position[1]);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs);
    const minY = Math.min(...ys),
      maxY = Math.max(...ys);
    const scale = Math.min(296 / Math.max(1, maxX - minX), 136 / Math.max(1, maxY - minY));
    for (const sample of evidence.preview) {
      // Data color, not a theme color: the exact recorded RGB at preview time.
      context.fillStyle = `rgb(${sample.color.join(",")})`;
      context.beginPath();
      context.arc(
        160 + (sample.position[0] - (minX + maxX) / 2) * scale,
        80 - (sample.position[1] - (minY + maxY) / 2) * scale,
        2,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  }, [evidence]);
  if (!binding) return null;
  if (!evidence)
    return (
      <p className="text-xs text-warning">
        {ro ? "Datele sursă nu sunt disponibile." : "Source data unavailable."}
      </p>
    );
  const interval = (start: number, end: number) => `${start.toFixed(2)}–${end.toFixed(2)} s`;
  return (
    <section
      className="space-y-2 border-t border-border pt-2"
      aria-label={ro ? "Dovezi scenă importată" : "Imported scene evidence"}
    >
      <h3 className="text-xs font-medium">{ro ? "Scena din sursă" : "Source scene"}</h3>
      <canvas
        ref={canvas}
        width={320}
        height={160}
        className="aspect-[2/1] w-full bg-background"
        aria-label={`${ro ? "Proiecție frontală la" : "Front projection at"} ${evidence.previewTime.toFixed(2)} s`}
      />
      <dl className="grid grid-cols-[1fr_1.2fr] gap-1 text-[10px]">
        <dt className="text-muted-foreground">{ro ? "Tranziție dedusă" : "Inferred transition"}</dt>
        <dd>{interval(evidence.start, evidence.hold)}</dd>
        <dt className="text-muted-foreground">{ro ? "Imagine / mișcare" : "Visual / motion"}</dt>
        <dd>{interval(evidence.hold, evidence.end)}</dd>
        <dt className="text-muted-foreground">{ro ? "Mișcare dedusă" : "Inferred motion"}</dt>
        <dd className="break-words">{evidence.motion}</dd>
        <dt className="text-muted-foreground">{ro ? "Culori înregistrate" : "Recorded colors"}</dt>
        <dd>{evidence.lighting.distinctColors}</dd>
        <dt className="text-muted-foreground">{ro ? "Schimbări RGB" : "RGB changes"}</dt>
        <dd>{evidence.lighting.changes}</dd>
        <dt className="text-muted-foreground">{ro ? "Eșantioane RGB" : "RGB samples"}</dt>
        <dd>{evidence.lighting.rgbSamples}</dd>
        <dt className="text-muted-foreground">{ro ? "Rețeta efectelor" : "Effect recipe"}</dt>
        <dd className="text-warning">{ro ? "Necunoscută" : "Unknown"}</dd>
        <dt className="text-muted-foreground">{ro ? "Numele imaginii" : "Image identity"}</dt>
        <dd>{ro ? "Necunoscut" : "Unknown"}</dd>
        <dt className="text-muted-foreground">{ro ? "Redare interval" : "Interval playback"}</dt>
        <dd>
          {evidence.owner === "REFERENCE"
            ? ro
              ? "Sursă originală"
              : "Original source"
            : ro
              ? "Editat / recalculat"
              : "Edited / replanned"}
        </dd>
      </dl>
      {evidence.lighting.status === "NO_RGB_SAMPLES" && (
        <p className="text-[10px] text-warning">
          {ro ? "Nu există eșantioane RGB în acest interval." : "No RGB samples in this interval."}
        </p>
      )}
      <SpatialRgbDiagnostic evidence={evidence.lighting.spatial} ro={ro} />
    </section>
  );
}
