/**
 * Structural validation of a proposal.
 *
 * A proposal is rejected BEFORE it can build geometry when it is not a valid
 * structure. This is schema validation only: physical feasibility is decided
 * exclusively by the existing trajectory planner, conflict detector and safety
 * validator, never here and never by the AI provider.
 */
import { AI_PROPOSAL_SCHEMA_VERSION, CHOREOGRAPHY_CONCEPTS, type AIChoreographyProposalV1 } from "./types";

export interface ProposalValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

function num(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateProposal(input: unknown, expectedFleet?: number): ProposalValidation {
  const errors: string[] = [];
  const p = input as AIChoreographyProposalV1 | null;

  if (!p || typeof p !== "object") return { valid: false, errors: ["The proposal is not an object."] };
  if (p.schemaVersion !== AI_PROPOSAL_SCHEMA_VERSION) {
    errors.push(`Unsupported proposal schema version ${String(p.schemaVersion)}.`);
  }
  if (typeof p.id !== "string" || !p.id) errors.push("The proposal has no id.");
  if (typeof p.title !== "string" || !p.title) errors.push("The proposal has no title.");
  if (!CHOREOGRAPHY_CONCEPTS.includes(p.concept)) errors.push(`Unsupported concept "${String(p.concept)}".`);
  if (!Number.isInteger(p.fleetCount) || p.fleetCount <= 0) errors.push("The fleet count must be a positive integer.");
  if (expectedFleet !== undefined && p.fleetCount !== expectedFleet) {
    errors.push(`The proposal targets ${p.fleetCount} drones but the project has ${expectedFleet}.`);
  }

  const spec = p.formationSpec;
  if (!spec || !num(spec.width) || spec.width <= 0) errors.push("formationSpec.width must be positive.");
  else if (!num(spec.height) || !num(spec.depth) || !num(spec.altitude) || !num(spec.rotationDeg)) {
    errors.push("formationSpec has invalid numeric fields.");
  } else if (spec.altitude <= 0) errors.push("formationSpec.altitude must be above the ground.");

  const anim = p.animationSpec;
  if (!anim || typeof anim.dynamic !== "boolean") errors.push("animationSpec.dynamic is missing.");
  else if (anim.dynamic) {
    if (!num(anim.cycleDuration) || anim.cycleDuration <= 0) errors.push("animationSpec.cycleDuration must be positive.");
    if (!Number.isInteger(anim.cycles) || anim.cycles <= 0) errors.push("animationSpec.cycles must be a positive integer.");
    if (!num(anim.amplitudeDeg) || anim.amplitudeDeg < 0) errors.push("animationSpec.amplitudeDeg must be >= 0.");
    if (!["NONE", "REPEAT", "PING_PONG"].includes(anim.loop)) errors.push("animationSpec.loop is invalid.");
  }

  const motion = p.globalMotion;
  if (
    !motion ||
    !Array.isArray(motion.translation) ||
    motion.translation.length !== 3 ||
    !motion.translation.every(num) ||
    !num(motion.rotationDeg)
  ) {
    errors.push("globalMotion is invalid.");
  }

  const timing = p.timing;
  if (!timing || !num(timing.recommendedTransition) || timing.recommendedTransition <= 0) {
    errors.push("timing.recommendedTransition must be positive.");
  }
  if (!timing || !num(timing.hold) || timing.hold <= 0) errors.push("timing.hold must be positive.");

  const light = p.lightingIntent;
  if (
    !light ||
    !Array.isArray(light.color) ||
    light.color.length !== 3 ||
    !light.color.every((c) => num(c) && c >= 0 && c <= 255)
  ) {
    errors.push("lightingIntent.color must be an sRGB triple.");
  }

  if (!Array.isArray(p.motionGroups)) errors.push("motionGroups must be an array.");
  if (!Array.isArray(p.assumptions)) errors.push("assumptions must be an array.");
  if (!Array.isArray(p.warnings)) errors.push("warnings must be an array.");
  if (!p.provenance || typeof p.provenance.providerId !== "string") errors.push("provenance is missing.");

  return { valid: errors.length === 0, errors };
}
