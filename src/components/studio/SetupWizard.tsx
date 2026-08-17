/**
 * PROJECT SETUP WIZARD — New Show creation and Show Setup editing.
 *
 * The wizard is a thin authoring surface: every derived number comes from
 * `evaluateProjectSetup` and the launch grid engine, and applying the draft goes
 * through the store actions that own project mutation.
 */
import { AlertTriangle, Check, Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n";
import {
  detectLaunchGridPreset,
  evaluateProjectSetup,
  DEFAULT_SETUP_DRAFT,
  LAUNCH_GRID_PRESETS,
  RECOMMENDED_MAX_DRONES,
  SETUP_MAX_DRONES,
  SETUP_MIN_DRONES,
  SETUP_STEPS,
  type LaunchGridPresetId,
  type ProjectSetupDraft,
  type SetupStep,
} from "@/lib/show/setup";
import { useStudio } from "@/lib/studio/store";
import LaunchGridPreview from "./LaunchGridPreview";

const FLEET_PRESETS = [24, 48, 100, 150, 200];

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
        {unit ? <span className="text-muted-foreground/70">{unit}</span> : null}
      </span>
      <Input
        type="number"
        className="h-8 font-mono text-xs"
        min={min}
        max={max}
        step={step}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          setDraft(null);
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-sunken px-2.5 py-2">
      <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-xs text-foreground">{value}</div>
    </div>
  );
}

export default function SetupWizard({
  open,
  mode,
  onOpenChange,
}: {
  open: boolean;
  /** CREATE replaces the project; EDIT patches the open one. */
  mode: "CREATE" | "EDIT";
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const { currentSetupDraft, createProjectFromDraft, applySetupDraft } = useStudio();
  const [draft, setDraft] = useState<ProjectSetupDraft>(DEFAULT_SETUP_DRAFT);
  const [step, setStep] = useState<SetupStep>("PROJECT");

  // Opening the dialog seeds the draft: CREATE starts from the defaults, EDIT
  // from the project as it is right now.
  useEffect(() => {
    if (!open) return;
    setDraft(mode === "EDIT" ? currentSetupDraft : DEFAULT_SETUP_DRAFT);
    setStep("PROJECT");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  const evaluation = useMemo(() => evaluateProjectSetup(draft), [draft]);
  const preset = detectLaunchGridPreset(draft.launch);
  const stepIndex = SETUP_STEPS.indexOf(step);
  const errors = evaluation.issues.filter((i) => i.severity === "error");
  const warnings = evaluation.issues.filter((i) => i.severity === "warning");

  const patch = (p: Partial<ProjectSetupDraft>) => setDraft((d) => ({ ...d, ...p }));
  const patchLaunch = (p: Partial<ProjectSetupDraft["launch"]>) =>
    setDraft((d) => ({ ...d, launch: { ...d.launch, ...p } }));
  const patchStaging = (p: Partial<ProjectSetupDraft["staging"]>) =>
    setDraft((d) => ({ ...d, staging: { ...d.staging, ...p } }));

  const applyPreset = (id: Exclude<LaunchGridPresetId, "CUSTOM">) =>
    patchLaunch(LAUNCH_GRID_PRESETS[id]);

  const autoShape = () => {
    // Near-square grid that fits the fleet — a convenience, not a constraint.
    const columns = Math.max(1, Math.ceil(Math.sqrt(draft.droneCount)));
    patchLaunch({ columns, rows: Math.max(1, Math.ceil(draft.droneCount / columns)) });
  };

  const submit = () => {
    if (!evaluation.canCreate) return;
    if (mode === "CREATE") createProjectFromDraft(draft);
    else applySetupDraft(draft);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="font-display text-sm tracking-[0.16em]">
            {mode === "CREATE" ? t("setup.newShow") : t("setup.editTitle")}
          </DialogTitle>
          <DialogDescription className="font-mono text-[10px] uppercase tracking-[0.16em]">
            {t("setup.stepOf", { current: stepIndex + 1, total: SETUP_STEPS.length })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1">
          {SETUP_STEPS.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => setStep(s)}
              className={`flex-1 rounded-md border px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.16em] transition-colors ${
                s === step
                  ? "border-accent bg-accent/10 text-accent"
                  : i < stepIndex
                    ? "border-border text-foreground"
                    : "border-border text-muted-foreground"
              }`}
            >
              {t(
                `setup.step.${
                  s === "LAUNCH_GRID" ? "launchGrid" : s.toLowerCase()
                }` as `setup.step.project`,
              )}
            </button>
          ))}
        </div>

        {step === "PROJECT" ? (
          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t("project.showName")}
              </span>
              <Input
                className="h-8 text-xs"
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t("common.description")} · {t("common.optional")}
              </span>
              <Input
                className="h-8 text-xs"
                value={draft.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </label>
          </div>
        ) : null}

        {step === "FLEET" ? (
          <div className="space-y-3">
            <NumberField
              label={t("project.droneCount")}
              value={draft.droneCount}
              onChange={(droneCount) => patch({ droneCount: Math.round(droneCount) })}
              min={SETUP_MIN_DRONES}
              max={SETUP_MAX_DRONES}
            />
            <div className="flex flex-wrap gap-1.5">
              {FLEET_PRESETS.map((n) => (
                <Button
                  key={n}
                  type="button"
                  size="sm"
                  variant={draft.droneCount === n ? "default" : "outline"}
                  className="h-7 font-mono text-[10px]"
                  onClick={() => patch({ droneCount: n })}
                >
                  {n}
                </Button>
              ))}
            </div>
            <p className="flex gap-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 size-3 shrink-0" />
              {t("setup.fleetHint", { recommended: RECOMMENDED_MAX_DRONES })}
            </p>
          </div>
        ) : null}

        {step === "LAUNCH_GRID" ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label={t("launchGrid.rows")}
                  value={draft.launch.rows}
                  onChange={(rows) => patchLaunch({ rows: Math.round(rows) })}
                  min={1}
                  max={200}
                />
                <NumberField
                  label={t("launchGrid.columns")}
                  value={draft.launch.columns}
                  onChange={(columns) => patchLaunch({ columns: Math.round(columns) })}
                  min={1}
                  max={200}
                />
                <NumberField
                  label={t("launchGrid.spacingX")}
                  value={draft.launch.spacingX}
                  onChange={(spacingX) => patchLaunch({ spacingX })}
                  min={0.5}
                  max={20}
                  step={0.1}
                  unit="m"
                />
                <NumberField
                  label={t("launchGrid.spacingZ")}
                  value={draft.launch.spacingZ}
                  onChange={(spacingZ) => patchLaunch({ spacingZ })}
                  min={0.5}
                  max={20}
                  step={0.1}
                  unit="m"
                />
                <NumberField
                  label={t("launchGrid.offsetX")}
                  value={draft.launch.originX}
                  onChange={(originX) => patchLaunch({ originX })}
                  min={-500}
                  max={500}
                  step={0.5}
                  unit="m"
                />
                <NumberField
                  label={t("launchGrid.offsetZ")}
                  value={draft.launch.originZ}
                  onChange={(originZ) => patchLaunch({ originZ })}
                  min={-500}
                  max={500}
                  step={0.5}
                  unit="m"
                />
                <NumberField
                  label={t("launchGrid.rotation")}
                  value={draft.launch.rotationDeg}
                  onChange={(rotationDeg) => patchLaunch({ rotationDeg })}
                  min={-180}
                  max={180}
                  step={1}
                  unit="°"
                />
                <NumberField
                  label={t("launchGrid.groundAltitude")}
                  value={draft.launch.groundAltitude}
                  onChange={(groundAltitude) => patchLaunch({ groundAltitude })}
                  min={0}
                  max={100}
                  step={0.1}
                  unit="m"
                />
              </div>
              <div className="space-y-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {t("setup.presets")}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {(["COMPACT", "STANDARD", "WIDE"] as const).map((id) => (
                    <Button
                      key={id}
                      type="button"
                      size="sm"
                      variant={preset === id ? "default" : "outline"}
                      className="h-7 font-mono text-[10px]"
                      onClick={() => applyPreset(id)}
                    >
                      {t(`setup.preset.${id.toLowerCase()}` as "setup.preset.compact")}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 font-mono text-[10px]"
                    onClick={autoShape}
                  >
                    {evaluation.effectiveRows}×{evaluation.effectiveColumns}
                  </Button>
                </div>
                <p className="font-mono text-[9px] leading-relaxed text-muted-foreground">
                  {t("setup.presetNote")}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t("launchGrid.preview")}
              </span>
              <LaunchGridPreview droneCount={draft.droneCount} launch={draft.launch} />
              <div className="grid grid-cols-2 gap-2">
                <Metric label={t("launchGrid.capacity")} value={String(evaluation.capacity)} />
                <Metric label={t("launchGrid.occupied")} value={String(evaluation.occupiedPads)} />
                <Metric label={t("launchGrid.unused")} value={String(evaluation.unusedPads)} />
                <Metric
                  label={t("launchGrid.minPadSpacing")}
                  value={`${evaluation.minPadSpacing.toFixed(2)} m`}
                />
              </div>
              <p className="font-mono text-[9px] leading-relaxed text-muted-foreground">
                {t("launchGrid.padOrder")} {t("launchGrid.axisNote")}
              </p>
            </div>
          </div>
        ) : null}

        {step === "REVIEW" ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t("staging.enable")}
              </span>
              <Switch
                checked={draft.preShowEnabled}
                onCheckedChange={(preShowEnabled) => patch({ preShowEnabled })}
              />
            </div>
            {draft.preShowEnabled ? (
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label={t("staging.altitude")}
                  value={draft.staging.altitude}
                  onChange={(altitude) => patchStaging({ altitude, enabled: true })}
                  min={1}
                  max={300}
                  step={1}
                  unit="m"
                />
                <NumberField
                  label={t("staging.spacing")}
                  value={draft.staging.spacing}
                  onChange={(spacing) => patchStaging({ spacing, enabled: true })}
                  min={1}
                  max={50}
                  step={0.5}
                  unit="m"
                />
                <NumberField
                  label={t("staging.offsetX")}
                  value={draft.staging.leftRight}
                  onChange={(leftRight) => patchStaging({ leftRight, enabled: true })}
                  min={-500}
                  max={500}
                  step={1}
                  unit="m"
                />
                <NumberField
                  label={t("staging.offsetZ")}
                  value={draft.staging.forwardBack}
                  onChange={(forwardBack) => patchStaging({ forwardBack, enabled: true })}
                  min={-500}
                  max={500}
                  step={1}
                  unit="m"
                />
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <Metric label={t("project.showName")} value={draft.name || "—"} />
              <Metric label={t("project.droneCount")} value={String(draft.droneCount)} />
              <Metric
                label={t("launchGrid.footprint")}
                value={`${evaluation.footprint.rotatedWidth.toFixed(1)} × ${evaluation.footprint.rotatedDepth.toFixed(1)} m`}
              />
              <Metric
                label={t("launchGrid.title")}
                value={`${draft.launch.rows} × ${draft.launch.columns}`}
              />
            </div>
            <p className="font-mono text-[9px] leading-relaxed text-muted-foreground">
              {mode === "CREATE" ? t("setup.reviewNote") : t("setup.editNote")}
            </p>
          </div>
        ) : null}

        {errors.length > 0 || warnings.length > 0 ? (
          <ul className="space-y-1">
            {[...errors, ...warnings].map((issue) => (
              <li
                key={`${issue.code}-${issue.field}`}
                className={`flex gap-2 font-mono text-[10px] leading-relaxed ${
                  issue.severity === "error" ? "text-destructive" : "text-warning"
                }`}
              >
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                {t(`setup.issue.${issue.code}` as "setup.issue.NAME_REQUIRED", issue.values)}
              </li>
            ))}
          </ul>
        ) : null}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="font-mono text-[10px] uppercase tracking-[0.16em]"
            disabled={stepIndex === 0}
            onClick={() => setStep(SETUP_STEPS[stepIndex - 1] ?? "PROJECT")}
          >
            {t("common.back")}
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="font-mono text-[10px] uppercase tracking-[0.16em]"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            {stepIndex < SETUP_STEPS.length - 1 ? (
              <Button
                type="button"
                size="sm"
                className="font-mono text-[10px] uppercase tracking-[0.16em]"
                onClick={() => setStep(SETUP_STEPS[stepIndex + 1] ?? "REVIEW")}
              >
                {t("common.next")}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                className="font-mono text-[10px] uppercase tracking-[0.16em]"
                disabled={!evaluation.canCreate}
                onClick={submit}
              >
                <Check className="size-3" />
                {mode === "CREATE" ? t("setup.createShow") : t("setup.applyChanges")}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
