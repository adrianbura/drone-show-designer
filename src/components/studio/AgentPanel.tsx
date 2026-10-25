/**
 * AI AGENT PANEL — right-side chat surface (Ctrl+K).
 *
 * The panel is a thin shell around the deterministic engine:
 *  1. The request is interpreted into typed operations (local parser first,
 *     model backend when the local parser cannot understand it).
 *  2. Operations produce a candidate project via applyAgentOp.
 *  3. validateAgentProject gates the commit; failures are shown, never applied.
 *  4. "Apply" installs the candidate as ONE undoable revision.
 *
 * The panel never claims model intelligence when the model was not used: every
 * answer is labelled "local" or "model".
 */
import { Bot, Check, Loader2, Send, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { interpretAgentCommand } from "@/lib/agent/agent.functions";
import { capabilitySummary } from "@/lib/agent/capabilities";
import {
  applyAgentOp,
  resolveSceneTarget,
  type AgentOp,
  type AgentOpSummary,
} from "@/lib/agent/operations";
import { parseAgentCommand } from "@/lib/agent/parser";
import { validateAgentProject, type AgentValidationIssue } from "@/lib/agent/validate";
import { useI18n } from "@/i18n";
import { useStudio } from "@/lib/studio/store";
import type { ShowProject } from "@/lib/show/types";

interface PendingEdit {
  ops: AgentOp[];
  source: "local" | "model";
  candidate: ShowProject;
  summaries: AgentOpSummary[];
}

type ChatEntry =
  | { role: "user"; text: string }
  | { role: "agent"; text: string; source?: "local" | "model" }
  | { role: "preview"; edit: PendingEdit };

const ISSUE_LABELS: Record<AgentValidationIssue, [string, string]> = {
  NON_FINITE_GEOMETRY: [
    "Geometrie invalidă (valori nenumerice).",
    "Invalid geometry (non-finite values).",
  ],
  OUTSIDE_FLIGHT_AREA: ["Iese din spațiul de zbor declarat.", "Leaves the declared flight area."],
  ALTITUDE_BELOW_MIN: ["Coboară sub altitudinea minimă.", "Drops below the minimum altitude."],
  ALTITUDE_ABOVE_MAX: ["Depășește altitudinea maximă.", "Exceeds the maximum altitude."],
};

const FAILURE_LABELS: Record<string, [string, string]> = {
  NO_CLIP_SELECTED: [
    "Selectează mai întâi o scenă din cronologie.",
    "Select a scene in the timeline first.",
  ],
  CLIP_NOT_FOUND: ["Scena selectată nu mai există.", "The selected scene no longer exists."],
  PHASE_NOT_EDITABLE: [
    "Decolarea și aterizarea nu se editează vizual.",
    "Takeoff and landing are not visually editable.",
  ],
  MULTI_OBJECT_SCENE: [
    "Scenele cu mai multe obiecte nu sunt încă suportate de agent.",
    "Multi-object scenes are not supported by the agent yet.",
  ],
  INVALID_OP: ["Operația cerută nu este validă.", "The requested operation is not valid."],
  DURATION_BELOW_ANIMATION: [
    "Durata nu poate fi mai scurtă decât animația scenei.",
    "The duration cannot be shorter than the scene's animation.",
  ],
  SCENE_NOT_FOUND: ["Nu am găsit scena cerută.", "I could not find the requested scene."],
  SCENE_AMBIGUOUS: [
    "Mai multe scene se potrivesc — spune numărul exact din cronologie.",
    "Several scenes match — give the exact timeline number.",
  ],
};

export default function AgentPanel({ onClose }: { onClose: () => void }) {
  const { language } = useI18n();
  const ro = language === "ro";
  const t = (r: string, e: string, values?: Record<string, string | number>) => {
    const s = ro ? r : e;
    return values
      ? s.replace(/\{(\w+)\}/g, (m, name: string) => (name in values ? String(values[name]) : m))
      : s;
  };
  const {
    project,
    selectedClipId,
    selectClip,
    applyAgentProject,
    undoTimeline,
    timelineHistoryDepth,
  } = useStudio();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const selectedClip = project.timeline.find((c) => c.id === selectedClipId) ?? null;
  const selectedName = selectedClip
    ? (project.dynamicFormations?.find((d) => d.id === selectedClip.dynamicFormationId)?.name ??
      project.formations.find((f) => f.id === selectedClip.formationId)?.name ??
      selectedClip.id)
    : null;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries, busy]);

  const say = useCallback((text: string, source?: "local" | "model") => {
    setEntries((e) => [...e, source ? { role: "agent", text, source } : { role: "agent", text }]);
  }, []);

  const submit = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setEntries((e) => [...e, { role: "user", text }]);
    setBusy(true);
    try {
      // Local deterministic parse first — free, instant, transparent.
      let ops: AgentOp[] = [];
      let source: "local" | "model" = "local";
      let clarification: string | null = null;
      const local = parseAgentCommand(text);
      if (local.ok) {
        ops = local.ops;
      } else {
        const interpreted = await interpretAgentCommand({ data: { text } });
        clarification = interpreted.clarification;
        if (interpreted.understood && interpreted.ops.length > 0) {
          source = interpreted.source;
          ops = interpreted.ops
            .map((o): AgentOp | null => {
              if (o.kind === "ROTATE_SCENE" && o.axis && o.degrees !== null) {
                return { kind: "ROTATE_SCENE", axis: o.axis, degrees: o.degrees };
              }
              if (o.kind === "RECOLOR_SCENE" && o.color) {
                return { kind: "RECOLOR_SCENE", color: o.color };
              }
              if (
                o.kind === "SET_DURATION" &&
                (o.holdSeconds !== null || o.deltaSeconds !== null)
              ) {
                return {
                  kind: "SET_DURATION",
                  ...(o.holdSeconds !== null ? { holdSeconds: o.holdSeconds } : {}),
                  ...(o.deltaSeconds !== null ? { deltaSeconds: o.deltaSeconds } : {}),
                };
              }
              if (o.kind === "SELECT_SCENE" && (o.sceneIndex !== null || o.sceneName)) {
                return {
                  kind: "SELECT_SCENE",
                  ...(o.sceneIndex !== null ? { sceneIndex: o.sceneIndex } : {}),
                  ...(o.sceneName ? { sceneName: o.sceneName } : {}),
                };
              }
              return null;
            })
            .filter((o): o is AgentOp => o !== null);
        }
      }
      if (ops.length === 0) {
        if (clarification) {
          say(clarification, source === "model" ? "model" : undefined);
        } else {
          say(
            `${t("Nu am înțeles cererea.", "I did not understand the request.")} ${capabilitySummary(ro)}`,
          );
        }
        return;
      }

      // Apply operations in sequence on a candidate copy; never touch the live
      // project. SELECT_SCENE is UI state: it resolves immediately, updates the
      // target for the operations that follow it, and is committed at the end.
      let candidate = project;
      let targetClipId = selectedClipId;
      let pendingSelect: string | null = null;
      const summaries: AgentOpSummary[] = [];
      for (const op of ops) {
        if (op.kind === "SELECT_SCENE") {
          const target = resolveSceneTarget(candidate, op);
          if (!target.ok) {
            const label = FAILURE_LABELS[target.reason] ?? FAILURE_LABELS["SCENE_NOT_FOUND"]!;
            const extra =
              target.reason === "SCENE_AMBIGUOUS" && target.candidates
                ? ` (${target.candidates.slice(0, 4).join(", ")})`
                : "";
            say(t(label[0], label[1]) + extra);
            return;
          }
          targetClipId = target.clipId;
          pendingSelect = target.clipId;
          say(
            t("Am selectat scena „{name}”.", "Selected scene “{name}”.", { name: target.clipName }),
            source,
          );
          continue;
        }
        const r = applyAgentOp(candidate, targetClipId, op);
        if (!r.ok) {
          const label = FAILURE_LABELS[r.reason] ?? FAILURE_LABELS["INVALID_OP"]!;
          say(t(label[0], label[1]));
          return;
        }
        candidate = r.project;
        summaries.push(r.summary);
      }
      if (pendingSelect) selectClip(pendingSelect);
      if (summaries.length === 0) return;
      const validation = validateAgentProject(candidate, targetClipId!);
      if (!validation.ok) {
        for (const issue of validation.issues) {
          const label = ISSUE_LABELS[issue];
          say(
            `${t("Modificarea a fost refuzată de validator:", "The validator refused the change:")} ${t(label[0], label[1])}`,
          );
        }
        return;
      }
      setEntries((e) => [...e, { role: "preview", edit: { ops, source, candidate, summaries } }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [input, busy, project, selectedClipId, selectClip, say, t, ro]);

  const apply = useCallback(
    (edit: PendingEdit) => {
      applyAgentProject(edit.candidate);
      setEntries((e) => e.filter((x) => !(x.role === "preview" && x.edit === edit)));
      say(
        t(
          "Am aplicat modificarea. O poți anula cu Ctrl+Z sau cu butonul de mai jos.",
          "Change applied. You can undo it with Ctrl+Z or the button below.",
        ),
        edit.source,
      );
      inputRef.current?.focus();
    },
    [applyAgentProject, say, t],
  );

  return (
    <aside
      className="flex h-full w-[320px] shrink-0 flex-col border-l border-border bg-panel"
      aria-label={t("Agent AI", "AI agent")}
      data-testid="agent-panel"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="agent-pulse flex size-6 items-center justify-center rounded-full bg-accent/20 text-accent">
          <Bot className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-foreground">
            {t("Agent de regie", "Direction agent")}
          </p>
          <p
            className="truncate font-mono text-[10px] text-muted-foreground"
            data-testid="agent-context"
          >
            {selectedName
              ? t("Scenă: {name}", "Scene: {name}", { name: selectedName })
              : t("Nicio scenă selectată", "No scene selected")}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mini-btn"
          aria-label={t("Închide agentul", "Close agent")}
        >
          <X className="size-3.5" />
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {entries.length === 0 && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t(
              "Selectează o scenă și spune-mi ce să fac: „înclină scena 20 de grade spre stânga”, „schimbă culoarea în auriu”, „ține scena 12 secunde”, „selectează inima”. Fiecare modificare trece prin validator și poate fi anulată.",
              "Select a scene and tell me what to do: “tilt the scene 20 degrees left”, “recolor it gold”, “hold the scene for 12 seconds”, “select the heart”. Every change passes the validator and can be undone.",
            )}{" "}
            {capabilitySummary(ro)}
          </p>
        )}
        {entries.map((entry, i) => {
          if (entry.role === "user") {
            return (
              <div
                key={i}
                className="ml-8 rounded-lg bg-accent/15 px-2.5 py-1.5 text-xs text-foreground"
              >
                {entry.text}
              </div>
            );
          }
          if (entry.role === "agent") {
            return (
              <div key={i} className="mr-8 space-y-0.5">
                <p className="px-1 text-xs leading-relaxed text-foreground">{entry.text}</p>
                {entry.source && (
                  <p className="px-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                    {entry.source === "model"
                      ? t("răspuns model", "model answer")
                      : t("răspuns local", "local answer")}
                  </p>
                )}
              </div>
            );
          }
          const { edit } = entry;
          return (
            <div
              key={i}
              className="rounded-lg border border-accent/40 bg-accent/5 p-2.5"
              data-testid="agent-preview"
            >
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t("Previzualizare modificare", "Change preview")} ·{" "}
                {edit.source === "model" ? t("model", "model") : t("local", "local")}
              </p>
              <ul className="mt-1 space-y-1 text-xs text-foreground">
                {edit.summaries.map((s, j) => (
                  <li key={j}>
                    {s.kind === "SET_DURATION" ? (
                      <>
                        {t("Durata scenei", "Scene duration")} ·{" "}
                        {t("{a} s → {b} s", "{a} s → {b} s", {
                          a: (s.durationBefore ?? 0).toFixed(1),
                          b: (s.durationAfter ?? 0).toFixed(1),
                        })}
                        {(s.followersShifted ?? 0) > 0 &&
                          ` · ${t("{n} scene următoare decalează", "{n} following scenes shift", {
                            n: s.followersShifted ?? 0,
                          })}`}
                      </>
                    ) : s.kind === "ROTATE_SCENE" ? (
                      <>
                        {t("Rotire scenă", "Scene rotation")} ·{" "}
                        {t("altitudine {a}–{b} m → {c}–{d} m", "altitude {a}–{b} m → {c}–{d} m", {
                          a: s.altitudeBefore[0].toFixed(1),
                          b: s.altitudeBefore[1].toFixed(1),
                          c: s.altitudeAfter[0].toFixed(1),
                          d: s.altitudeAfter[1].toFixed(1),
                        })}
                      </>
                    ) : (
                      t(
                        "Recolorare scenă (animația de luminozitate se păstrează)",
                        "Scene recolor (luminance animation preserved)",
                      )
                    )}
                    {s.lightingMayOverride && (
                      <span className="block text-[10px] text-warning">
                        {t(
                          "Scena are efecte de lumini proprii care pot acoperi culoarea de bază.",
                          "This scene has its own lighting effects that may cover the base color.",
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  className="chip-btn chip-btn-active flex-1 justify-center"
                  onClick={() => apply(edit)}
                  data-testid="agent-apply"
                >
                  <Check className="size-3" /> {t("Aplică", "Apply")}
                </button>
                <button
                  type="button"
                  className="chip-btn flex-1 justify-center"
                  onClick={() => setEntries((e) => e.filter((x) => x !== entry))}
                  data-testid="agent-discard"
                >
                  <X className="size-3" /> {t("Renunță", "Discard")}
                </button>
              </div>
            </div>
          );
        })}
        {busy && (
          <p className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> {t("Analizez…", "Thinking…")}
          </p>
        )}
      </div>

      <footer className="space-y-2 border-t border-border p-3">
        {timelineHistoryDepth.past > 0 && (
          <button
            type="button"
            className="chip-btn w-full justify-center"
            onClick={undoTimeline}
            data-testid="agent-undo"
          >
            <Undo2 className="size-3" /> {t("Anulează ultima modificare", "Undo last change")}
          </button>
        )}
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("Spune ce să modific…", "Tell me what to change…")}
            aria-label={t("Comandă pentru agent", "Agent command")}
            className="studio-input flex-1"
            data-testid="agent-input"
          />
          <button
            type="submit"
            className="mini-btn mini-btn-accent px-2.5"
            disabled={busy || !input.trim()}
            aria-label={t("Trimite", "Send")}
            data-testid="agent-send"
          >
            <Send className="size-3.5" />
          </button>
        </form>
      </footer>
    </aside>
  );
}
