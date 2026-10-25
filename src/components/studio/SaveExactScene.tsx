import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useLibrary } from "@/lib/library/provider";
import { buildExactSceneAsset } from "@/lib/import/essp/native/sceneLibrary";
import type { ReferenceClipBinding } from "@/lib/import/essp/native/types";
import type { ReferenceShow } from "@/lib/import/essp/types";
import { useStudio } from "@/lib/studio/store";

/**
 * Saves the selected imported scene to the personal library as an EXACT copy
 * (original XYZ trajectories + recorded RGB + timing + provenance). The source
 * show is only read. Changing the drone count is explicitly not offered.
 */
export default function SaveExactScene({
  show,
  binding,
  ro,
}: {
  show: ReferenceShow;
  binding: ReferenceClipBinding;
  ro: boolean;
}) {
  const library = useLibrary();
  const { project } = useStudio();
  const [status, setStatus] = useState<string | null>(null);
  const t = (r: string, e: string) => (ro ? r : e);
  if (binding.kind !== "SCENE") return null;
  const clip = project.timeline.find((c) => c.id === binding.clipId);
  const clipName =
    project.formations.find((f) => f.id === clip?.formationId)?.name ?? "Imported scene";

  const save = async () => {
    setStatus(null);
    let result;
    try {
      result = buildExactSceneAsset(show, binding, {
        name: clipName,
        formationId: `essp-exact-${binding.clipId}`,
      });
    } catch (err) {
      setStatus(t("Eroare la extragere: ", "Extraction failed: ") + String(err));
      return;
    }
    if (!result.asset) {
      const msg: Record<string, string> = {
        INTERVAL_TOO_SHORT: t("Intervalul imaginii este prea scurt.", "Visual interval too short."),
        NO_RGB: t("Lipsesc eșantioane RGB.", "RGB samples missing."),
        NO_DRONES: t("Nu există drone.", "No drones."),
        TAKEOFF_OR_LANDING: t(
          "Decolarea/aterizarea nu se salvează.",
          "Takeoff/landing is not saved.",
        ),
      };
      setStatus(msg[result.error!] ?? String(result.error));
      return;
    }
    const saved = await library.saveAsset(result.asset);
    setStatus(
      saved
        ? t(
            `Salvată în bibliotecă: „${saved.name}” — ${saved.droneCount} drone, abatere traiectorie ${(result.fidelityRmsMeters ?? 0).toExponential(1)} m.`,
            `Saved to library: “${saved.name}” — ${saved.droneCount} drones, trajectory deviation ${(result.fidelityRmsMeters ?? 0).toExponential(1)} m.`,
          )
        : t("Salvarea a eșuat.", "Save failed."),
    );
  };

  return (
    <div className="space-y-1.5 border-t border-border pt-2 text-[10px]">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 w-full"
        data-testid="save-exact-scene"
        onClick={() => void save()}
      >
        {t("Salvează scena exactă în bibliotecă", "Save exact scene to library")}
      </Button>
      <p className="text-muted-foreground">
        {t(
          "Păstrează traiectoriile originale, culorile înregistrate și timpii intervalului imaginii. Sursa ESSP nu se modifică; folosirea creează o copie editabilă. Rețeta efectelor rămâne necunoscută. Nu este o validare de zbor.",
          "Keeps the original trajectories, recorded colors and timing of the visual interval. The ESSP source is unchanged; using it creates an editable copy. Effect recipe stays unknown. Not a flight validation.",
        )}
      </p>
      <p className="text-warning">
        {t(
          "Schimbarea numărului de drone: indisponibilă — validare în așteptare (nu se inventează traiectorii).",
          "Changing drone count: unavailable — validation pending (no trajectories are invented).",
        )}
      </p>
      {status && (
        <p data-testid="save-exact-scene-status" className="break-words">
          {status}
        </p>
      )}
    </div>
  );
}
