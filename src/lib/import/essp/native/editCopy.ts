import type { FeasibleEditHint, ImportedEditTransaction } from "./editTransaction";

type Lang = "ro" | "en";

/** Plain-words explanation of a tapered edit, shared by Agent and Inspector. */
export function taperedEditExplanation(tx: ImportedEditTransaction, lang: Lang): string {
  const e = tx.edit;
  const ramp = e.rampSeconds.toFixed(2);
  const hold = Math.max(0, e.end - e.start - 2 * e.guardSeconds - 2 * e.rampSeconds).toFixed(2);
  return lang === "ro"
    ? `Noua poziție este atinsă lin în ${ramp} s și este menținută ${hold} s în mijlocul scenei; prima și ultima parte a scenei revin lin la original, astfel încât scenele vecine rămân neatinse. Culorile (RGB) rămân cele originale.`
    : `The new pose is reached smoothly over ${ramp} s and held for ${hold} s in the middle of the scene; the first and last part of the scene blend back to the original so neighbouring scenes are untouched. Colours (RGB) stay original.`;
}

export function feasibleHintText(hint: FeasibleEditHint, lang: Lang): string {
  const m =
    hint.kind === "MOVE_SCENE"
      ? `${hint.magnitude.toFixed(2)} m`
      : hint.kind === "ROTATE_SCENE"
        ? `${hint.magnitude.toFixed(1)}°`
        : `×${hint.magnitude.toFixed(3)}`;
  const what =
    lang === "ro"
      ? hint.kind === "MOVE_SCENE"
        ? "mutarea maximă fezabilă"
        : hint.kind === "ROTATE_SCENE"
          ? "rotirea maximă fezabilă"
          : "scalarea maximă fezabilă"
      : hint.kind === "MOVE_SCENE"
        ? "max feasible move"
        : hint.kind === "ROTATE_SCENE"
          ? "max feasible rotation"
          : "max feasible scale";
  return lang === "ro"
    ? `Prea mare pentru durata acestei scene: ${what} ≈ ${m} (rampă ${hint.rampSeconds.toFixed(2)} s, limite de viteză/accelerație ale show-ului). Verificarea completă se aplică în continuare.`
    : `Too large for this scene's duration: ${what} ≈ ${m} (ramp ${hint.rampSeconds.toFixed(2)} s, show velocity/acceleration limits). The full check still applies.`;
}

export function importedEditRefusal(
  result: { reason: string; feasible?: FeasibleEditHint },
  lang: Lang,
): string {
  if (result.feasible) return feasibleHintText(result.feasible, lang);
  const map: Record<string, [string, string]> = {
    OVERLAPPING_EDIT_INTERVAL: [
      "Scena se suprapune parțial cu o editare existentă; anulează-o sau editează exact aceeași scenă.",
      "This scene partly overlaps an existing edit; undo it or edit exactly the same scene.",
    ],
    INSUFFICIENT_EDIT_TIME: [
      "Scena este prea scurtă pentru o tranziție lină.",
      "The scene is too short for a smooth blend.",
    ],
  };
  const hit = map[result.reason];
  return hit ? hit[lang === "ro" ? 0 : 1] : result.reason;
}

/** One-line factual summary: what, how much, ramp, and the measured peaks. */
export function taperedEditSummary(tx: ImportedEditTransaction, lang: Lang): string {
  const e = tx.edit;
  const what =
    e.kind === "MOVE_SCENE"
      ? `${lang === "ro" ? "Mutare" : "Move"} x ${(e.offset?.[0] ?? 0).toFixed(2)} m, y ${(e.offset?.[1] ?? 0).toFixed(2)} m, z ${(e.offset?.[2] ?? 0).toFixed(2)} m`
      : e.kind === "ROTATE_SCENE"
        ? `${lang === "ro" ? "Rotire" : "Rotation"} ${e.axis ?? "Y"} ${(e.degrees ?? 0).toFixed(1)}°`
        : `${lang === "ro" ? "Scalare" : "Scale"} ×${(e.factor ?? 1).toFixed(3)}`;
  const span = `${e.start.toFixed(2)}–${e.end.toFixed(2)} s`;
  return lang === "ro"
    ? `${what} · scena ${span} · rampă ${e.rampSeconds.toFixed(2)} s · viteză max ${tx.maxVelocity.toFixed(2)} m/s · accelerație max ${tx.maxAcceleration.toFixed(2)} m/s²`
    : `${what} · scene ${span} · ramp ${e.rampSeconds.toFixed(2)} s · peak velocity ${tx.maxVelocity.toFixed(2)} m/s · peak acceleration ${tx.maxAcceleration.toFixed(2)} m/s²`;
}
