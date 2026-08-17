/**
 * DETERMINISTIC MOCK CHOREOGRAPHY PROVIDER.
 *
 * A stand-in for a real model provider: identical requests always return an
 * identical proposal, no network call is made and no key is required. It only
 * ever emits STRUCTURED DESIGN INTENT — never flight commands, never a safety
 * verdict. Swapping in an OpenAI / Anthropic / Gemini / local-model provider is
 * a matter of implementing ChoreographyAIProvider behind a server function.
 */
import { parsePrompt, type PromptIntent } from "./prompt";
import {
  AI_PROPOSAL_SCHEMA_VERSION,
  CHOREOGRAPHY_ENGINE_VERSION,
  ChoreographyAIError,
  type AIChoreographyProposalV1,
  type ChoreographyConcept,
  type ChoreographyPart,
  type ChoreographyAIProvider,
  type GenerateProposalRequest,
  type PromptLanguage,
  type RefineProposalRequest,
} from "./types";

export const MOCK_PROVIDER_ID = "mock-deterministic";
export const MOCK_PROVIDER_LABEL = "Deterministic (offline)";

const DEFAULT_AREA = { width: 120, depth: 120, height: 80 };

function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

const WINGED: readonly ChoreographyConcept[] = ["BIRD", "BUTTERFLY"];

const TITLES: Record<ChoreographyConcept, { en: string; ro: string }> = {
  BIRD: { en: "Flying bird", ro: "Pasăre în zbor" },
  BUTTERFLY: { en: "Butterfly", ro: "Fluture" },
  HEART: { en: "Heart", ro: "Inimă" },
  CIRCLE: { en: "Circle", ro: "Cerc" },
  RING: { en: "Ring", ro: "Inel" },
  STAR: { en: "Star", ro: "Stea" },
  SPIRAL: { en: "Spiral", ro: "Spirală" },
  WAVE: { en: "Wave", ro: "Val" },
  ABSTRACT: { en: "Abstract cloud", ro: "Nor abstract" },
};

function lang(intent: PromptIntent): "en" | "ro" {
  return intent.language === "ro" ? "ro" : "en";
}

function describe(
  concept: ChoreographyConcept,
  intent: PromptIntent,
  cycles: number,
  cycle: number,
  translation: readonly [number, number, number],
  rotationDeg: number,
): string {
  const l = lang(intent);
  const motion: string[] = [];
  if (WINGED.includes(concept)) {
    motion.push(
      l === "ro"
        ? `bate din aripi ${cycles} ori (${round(cycle, 1)} s pe ciclu)`
        : `flaps its wings ${cycles} times (${round(cycle, 1)} s per cycle)`,
    );
  }
  if (translation[2]) motion.push(l === "ro" ? `avansează ${round(translation[2], 0)} m` : `travels ${round(translation[2], 0)} m forward`);
  if (translation[0]) motion.push(l === "ro" ? `se deplasează ${round(translation[0], 0)} m lateral` : `drifts ${round(translation[0], 0)} m sideways`);
  if (translation[1]) motion.push(l === "ro" ? `urcă ${round(translation[1], 0)} m` : `climbs ${round(translation[1], 0)} m`);
  if (rotationDeg) motion.push(l === "ro" ? `se rotește ${round(rotationDeg, 0)}°` : `yaws ${round(rotationDeg, 0)}°`);
  const head = TITLES[concept][l];
  if (motion.length === 0) return l === "ro" ? `${head} static.` : `Static ${head.toLowerCase()}.`;
  return l === "ro" ? `${head} care ${motion.join(", ")}.` : `${head} that ${motion.join(", ")}.`;
}

function buildProposal(
  prompt: string,
  intent: PromptIntent,
  fleetCount: number,
  area: { width: number; depth: number; height: number },
  base?: AIChoreographyProposalV1,
): AIChoreographyProposalV1 {
  const l = lang(intent);
  const concept: ChoreographyConcept = intent.concept ?? base?.concept ?? "ABSTRACT";
  const winged = WINGED.includes(concept);
  const assumptions: string[] = [];
  const warnings: string[] = [];

  if (!intent.concept && !base) {
    assumptions.push(
      l === "ro"
        ? "Conceptul nu a fost recunoscut: am folosit un nor abstract. Menționează pasăre, fluture, inimă, cerc, inel, stea, spirală sau val."
        : "The concept was not recognised, so an abstract cloud was used. Mention bird, butterfly, heart, circle, ring, star, spiral or wave.",
    );
  }
  if (intent.fleetCount !== undefined && intent.fleetCount !== fleetCount) {
    warnings.push(
      l === "ro"
        ? `Promptul cere ${intent.fleetCount} drone, dar proiectul are ${fleetCount}. Am folosit flota proiectului.`
        : `The prompt asks for ${intent.fleetCount} drones but the project has ${fleetCount}. The project fleet was used.`,
    );
  }

  const sizeScale = intent.sizeScale ?? 1;
  const baseWidth = base ? base.formationSpec.width : Math.min(area.width, area.depth) * 0.65;
  const width = clamp(baseWidth * sizeScale, 12, Math.min(area.width, area.depth) * 0.95);
  const depth = winged ? clamp(width * 0.4, 5, area.depth * 0.5) : clamp(width * 0.3, 4, area.depth * 0.5);
  const altitude = base ? base.formationSpec.altitude : clamp(area.height * 0.5, 20, area.height - 10);

  const baseCycle = base ? base.animationSpec.cycleDuration : winged ? 2.4 : 4;
  const cycle = round(clamp(baseCycle * (intent.speedScale ?? 1), 0.8, 20), 2);
  const cycles = intent.cycles ?? base?.animationSpec.cycles ?? (winged ? 4 : 2);
  const amplitudeDeg = intent.amplitudeDeg ?? base?.animationSpec.amplitudeDeg ?? (concept === "BUTTERFLY" ? 42 : 28);
  const bodyDeforms = intent.bodyDeforms ?? base?.animationSpec.bodyDeforms ?? winged;

  const prev = base?.globalMotion;
  const translation: [number, number, number] = [
    round(intent.right ?? prev?.translation[0] ?? 0, 2),
    round(intent.climb ?? prev?.translation[1] ?? 0, 2),
    round(intent.forward ?? prev?.translation[2] ?? (winged ? 0 : 0), 2),
  ];
  const rotationDeg = round(intent.rotationDeg ?? prev?.rotationDeg ?? 0, 2);

  const duration = round(cycle * cycles, 2);
  const dynamic = winged || duration > 0;
  const transition = round(clamp(width / 8 + 3, 4, 20), 1);

  const motionGroups: ChoreographyPart[] = winged
    ? concept === "BIRD"
      ? ["BODY", "LEFT_WING", "RIGHT_WING", "HEAD", "TAIL"]
      : ["BODY", "LEFT_WING", "RIGHT_WING"]
    : [];

  if (winged && fleetCount < 40) {
    warnings.push(
      l === "ro"
        ? "Sub 40 de drone silueta aripilor devine grosieră."
        : "Below 40 drones the wing silhouette becomes coarse.",
    );
  }
  assumptions.push(
    l === "ro"
      ? `Dimensiuni presupuse: ${round(width, 0)} m deschidere, altitudine ${round(altitude, 0)} m.`
      : `Assumed size: ${round(width, 0)} m span at ${round(altitude, 0)} m altitude.`,
  );
  assumptions.push(
    l === "ro"
      ? "Fezabilitatea (viteză, accelerație, separare) este decisă exclusiv de validatorul de siguranță."
      : "Feasibility (velocity, acceleration, separation) is decided only by the safety validator.",
  );

  const color = intent.color ?? base?.lightingIntent.color ?? ([255, 255, 255] as const);
  const idSeed = `${prompt}|${fleetCount}|${concept}|${cycles}|${cycle}|${translation.join(",")}|${rotationDeg}|${width}`;

  return {
    schemaVersion: AI_PROPOSAL_SCHEMA_VERSION,
    id: `aip-${hash(idSeed)}`,
    title: TITLES[concept][l],
    description: describe(concept, intent, cycles, cycle, translation, rotationDeg),
    concept,
    fleetCount,
    formationSpec: {
      width: round(width, 2),
      height: round(winged ? width * 0.45 : width, 2),
      depth: round(depth, 2),
      altitude: round(altitude, 2),
      rotationDeg: base?.formationSpec.rotationDeg ?? 0,
    },
    motionGroups,
    animationSpec: {
      dynamic,
      cycleDuration: cycle,
      cycles,
      amplitudeDeg,
      loop: "NONE",
      bodyDeforms,
    },
    globalMotion: { translation, rotationDeg },
    timing: { recommendedTransition: transition, hold: duration },
    lightingIntent: {
      color,
      effect: winged ? "pulse" : "solid",
      description:
        l === "ro"
          ? `Intenție de lumină: ${intent.colorName ?? "alb"}, accent pe siluetă.`
          : `Lighting intent: ${intent.colorName ?? "white"}, silhouette-first.`,
    },
    assumptions,
    warnings,
    provenance: {
      providerId: MOCK_PROVIDER_ID,
      providerLabel: MOCK_PROVIDER_LABEL,
      deterministic: true,
      prompt,
      promptLanguage: intent.language as PromptLanguage,
      engineVersion: CHOREOGRAPHY_ENGINE_VERSION,
      createdAt: base?.provenance.createdAt ?? "1970-01-01T00:00:00.000Z",
    },
  };
}

export class MockChoreographyProvider implements ChoreographyAIProvider {
  readonly id = MOCK_PROVIDER_ID;
  readonly label = MOCK_PROVIDER_LABEL;
  readonly deterministic = true;

  async generateProposal(request: GenerateProposalRequest): Promise<AIChoreographyProposalV1> {
    const prompt = request.prompt.trim();
    if (!prompt) throw new ChoreographyAIError("EMPTY_PROMPT", "Describe the choreography you want.");
    const intent = parsePrompt(prompt);
    return buildProposal(prompt, intent, request.fleetCount, request.area ?? DEFAULT_AREA);
  }

  async refineProposal(request: RefineProposalRequest): Promise<AIChoreographyProposalV1> {
    const instruction = request.instruction.trim();
    if (!instruction) throw new ChoreographyAIError("EMPTY_PROMPT", "Describe the change you want.");
    const base = request.proposal;
    const intent = parsePrompt(instruction);
    const merged: PromptIntent = {
      ...intent,
      language: intent.language === "unknown" ? base.provenance.promptLanguage : intent.language,
      concept: intent.concept ?? base.concept,
    };
    const prompt = `${base.provenance.prompt} | ${instruction}`;
    const next = buildProposal(prompt, merged, base.fleetCount, DEFAULT_AREA, base);
    return {
      ...next,
      formationSpec: {
        ...next.formationSpec,
        // Refinement keeps the area-derived geometry of the original proposal
        // and only applies the requested delta.
        depth: base.formationSpec.depth,
      },
    };
  }
}

export const mockChoreographyProvider = new MockChoreographyProvider();
