/**
 * AI CHOREOGRAPHY ASSISTANT — presentation only.
 *
 * The panel renders a DRAFT proposal and never mutates the show by itself: the
 * project changes only when a human presses apply. Geometry shown here comes
 * from the deterministic builder in src/lib/ai, not from AI prose.
 */
import { Sparkles, Undo2, Wand2, X } from "lucide-react";
import { useState } from "react";

import { useI18n } from "@/i18n";
import { useStudio } from "@/lib/studio/store";


/** Numeric proposal parameter. Editing a draft never touches the project. */
function ProposalField({
  label,
  value,
  step,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onCommit: (v: number) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        value={Number(value.toFixed(2))}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, n)));
        }}
        className="studio-input w-full py-0.5 font-mono text-[11px]"
      />
    </label>
  );
}

export default function AiPanel() {
  const {
    aiProvider,
    aiBusy,
    aiError,
    aiProposal,
    aiProposalErrors,
    aiHistory,
    aiPreviewPoints,
    aiPreviewTime,
    setAiPreviewTime,
    generateAiProposal,
    refineAiProposal,
    revertAiProposal,
    discardAiProposal,
    applyAiProposal,
    patchAiProposal,
  } = useStudio();
  const { t } = useI18n();
  const [prompt, setPrompt] = useState("");
  const [instruction, setInstruction] = useState("");

  const invalid = aiProposalErrors.length > 0;
  const cycle = aiProposal
    ? aiProposal.animationSpec.cycleDuration * Math.max(1, aiProposal.animationSpec.cycles)
    : 0;

  return (
    <section className="panel-card">
      <h2 className="panel-title">
        <Sparkles className="size-3.5" /> {t("ai.title")}
      </h2>

      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {t("ai.provider", { label: aiProvider.label })}
        {aiProvider.deterministic ? ` · ${t("ai.deterministic")}` : ""}
      </p>

      {/* AI is an ASSET CREATOR: it never places clips or syncs to the music. */}
      <p className="text-[11px] text-muted-foreground">{t("ai.assetOnly")}</p>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={t("ai.promptPlaceholder")}
        rows={2}
        className="studio-input resize-none"
        aria-label={t("ai.title")}
      />
      <button
        type="button"
        className="chip-btn w-full justify-center"
        disabled={aiBusy || prompt.trim().length === 0}
        onClick={() => void generateAiProposal(prompt)}
      >
        <Wand2 className="size-3" /> {aiBusy ? t("ai.busy") : t("ai.generate")}
      </button>

      {aiError && (
        <p className="text-[11px] text-destructive">
          {aiError.code}: {aiError.message}
        </p>
      )}

      {!aiProposal && !aiError && (
        <p className="text-[11px] text-muted-foreground">{t("ai.empty")}</p>
      )}

      {aiProposal && (
        <div className="space-y-2 rounded border border-border/70 p-2">
          <p className="text-[11px] text-muted-foreground">{t("ai.draft")}</p>
          <div>
            <p className="text-xs font-semibold text-foreground">{aiProposal.title}</p>
            <p className="text-[11px] text-muted-foreground">{aiProposal.description}</p>
          </div>

          <dl className="grid grid-cols-2 gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <div>
              <dt>concept</dt>
              <dd className="text-foreground">{aiProposal.concept}</dd>
            </div>
            <div>
              <dt>points</dt>
              <dd className="text-foreground">{aiProposal.fleetCount}</dd>
            </div>
            <div>
              <dt>width</dt>
              <dd className="text-foreground">{aiProposal.formationSpec.width.toFixed(1)} m</dd>
            </div>
            <div>
              <dt>altitude</dt>
              <dd className="text-foreground">{aiProposal.formationSpec.altitude.toFixed(1)} m</dd>
            </div>
            <div>
              <dt>transition</dt>
              <dd className="text-foreground">
                {aiProposal.timing.recommendedTransition.toFixed(1)} s
              </dd>
            </div>
            <div>
              <dt>hold</dt>
              <dd className="text-foreground">{aiProposal.timing.hold.toFixed(1)} s</dd>
            </div>
          </dl>

          {/* Draft parameter editing — re-validated on every change. */}
          <div className="grid grid-cols-2 gap-1.5">
            <ProposalField
              label={t("ai.width")}
              value={aiProposal.formationSpec.width}
              step={1}
              min={5}
              max={400}
              onCommit={(v) => patchAiProposal({ width: v })}
            />
            <ProposalField
              label={t("ai.altitude")}
              value={aiProposal.formationSpec.altitude}
              step={1}
              min={2}
              max={400}
              onCommit={(v) => patchAiProposal({ altitude: v })}
            />
            <ProposalField
              label={t("ai.transition")}
              value={aiProposal.timing.recommendedTransition}
              step={0.5}
              min={1}
              max={120}
              onCommit={(v) => patchAiProposal({ transition: v })}
            />
            <ProposalField
              label={t("ai.hold")}
              value={aiProposal.timing.hold}
              step={0.5}
              min={0}
              max={300}
              onCommit={(v) => patchAiProposal({ hold: v })}
            />
            {aiProposal.animationSpec.dynamic && (
              <>
                <ProposalField
                  label={t("ai.cycles")}
                  value={aiProposal.animationSpec.cycles}
                  step={1}
                  min={1}
                  max={40}
                  onCommit={(v) => patchAiProposal({ cycles: Math.round(v) })}
                />
                <ProposalField
                  label={t("ai.cycleDuration")}
                  value={aiProposal.animationSpec.cycleDuration}
                  step={0.1}
                  min={0.4}
                  max={30}
                  onCommit={(v) => patchAiProposal({ cycleDuration: v })}
                />
              </>
            )}
          </div>

          {aiProposal.animationSpec.dynamic && cycle > 0 && (
            <label className="block space-y-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("ai.previewTime")} · {aiPreviewTime.toFixed(2)} s
              </span>
              <input
                type="range"
                min={0}
                max={cycle}
                step={cycle / 120}
                value={Math.min(aiPreviewTime, cycle)}
                onChange={(e) => setAiPreviewTime(Number(e.target.value))}
                className="w-full"
              />
            </label>
          )}

          {aiPreviewPoints && (
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              preview {aiPreviewPoints.length} pts
            </p>
          )}

          {aiProposal.assumptions.length > 0 && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("ai.assumptions")}
              </p>
              <ul className="list-disc pl-4 text-[11px] text-muted-foreground">
                {aiProposal.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}

          {(aiProposal.warnings.length > 0 || invalid) && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("ai.warnings")}
              </p>
              <ul className="list-disc pl-4 text-[11px] text-destructive">
                {invalid && <li>{t("ai.invalid")}</li>}
                {[...aiProposal.warnings, ...aiProposalErrors].map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-1.5">
            <input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={t("ai.refinePlaceholder")}
              className="studio-input flex-1"
              aria-label={t("ai.refine")}
            />
            <button
              type="button"
              className="chip-btn"
              disabled={aiBusy || instruction.trim().length === 0}
              onClick={() => void refineAiProposal(instruction)}
            >
              {t("ai.refine")}
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className="chip-btn"
              disabled={invalid}
              onClick={() => applyAiProposal()}
            >
              {t("ai.apply")}
            </button>
            {aiHistory.length > 0 && (
              <button type="button" className="chip-btn" onClick={revertAiProposal}>
                <Undo2 className="size-3" /> {t("ai.revert")}
              </button>
            )}
            <button type="button" className="chip-btn" onClick={discardAiProposal}>
              <X className="size-3" /> {t("ai.discard")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
