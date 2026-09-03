/**
 * DETERMINISTIC BUILDER — proposal -> native studio content.
 *
 * The builder is the only bridge between AI output and project content. It is
 * pure and deterministic: identical proposals always yield identical geometry
 * and identical keyframes, the requested fleet size is honoured EXACTLY, and
 * nothing here plans trajectories, checks safety or touches hardware. Built
 * content is a DRAFT until a human applies it.
 */
import { DYNAMIC_FORMATION_ALGORITHM_VERSION } from "../show/dynamic/types";
import type {
  DynamicFormation,
  DynamicFormationPoint,
  GroupDeformationKeyframe,
  MotionGroup,
  TransformKeyframe,
} from "../show/dynamic/types";
import { pointId } from "../show/dynamic/create";
import { generatePoints } from "../show/formations";
import type { Formation, ShowArea, Vec3 } from "../show/types";
import {
  buildWingedGeometry,
  buildWomanProfileGeometry,
  ringPoints,
  rotateYaw,
  spiralPoints,
  starPoints,
  type ConceptGeometry,
} from "./geometry";
import { ChoreographyAIError, type AIChoreographyProposalV1, type ChoreographyPart } from "./types";

export interface BuildOptions {
  readonly area: ShowArea;
  readonly idPrefix?: string;
  readonly seed?: number;
}

export interface BuiltProposalContent {
  readonly formation: Formation;
  readonly dynamicFormation: DynamicFormation | null;
  /** Semantic parts that became motion groups, in build order. */
  readonly parts: readonly ChoreographyPart[];
}

const PART_LABEL: Record<ChoreographyPart, string> = {
  BODY: "Body",
  LEFT_WING: "Left wing",
  RIGHT_WING: "Right wing",
  HEAD: "Head",
  TAIL: "Tail",
  FACE: "Face profile",
  HAIR: "Hair",
  NECK: "Neck and shoulders",
};

const PART_COLOR: Record<ChoreographyPart, readonly [number, number, number]> = {
  BODY: [120, 180, 255],
  LEFT_WING: [255, 170, 90],
  RIGHT_WING: [140, 255, 190],
  HEAD: [255, 240, 160],
  TAIL: [200, 150, 255],
  FACE: [255, 190, 170],
  HAIR: [210, 120, 255],
  NECK: [255, 170, 190],
};

function isWinged(concept: AIChoreographyProposalV1["concept"]): boolean {
  return concept === "BIRD" || concept === "BUTTERFLY";
}

/** Static point cloud for the proposal. Always exactly `fleetCount` points. */
function conceptGeometry(proposal: AIChoreographyProposalV1, area: ShowArea): ConceptGeometry {
  const { fleetCount, formationSpec: spec, concept } = proposal;
  if (isWinged(concept)) {
    return buildWingedGeometry({
      count: fleetCount,
      span: spec.width,
      bodyLength: Math.max(4, spec.depth),
      altitude: spec.altitude,
      broadWings: concept === "BUTTERFLY",
      includeHeadTail: concept === "BIRD",
    });
  }
  if (concept === "WOMAN_PROFILE") {
    return buildWomanProfileGeometry({
      count: fleetCount,
      width: spec.width,
      height: spec.height,
      depth: spec.depth,
      altitude: spec.altitude,
    });
  }
  const size = spec.width;
  let points: Vec3[];
  switch (concept) {
    case "RING":
      points = ringPoints(fleetCount, size, spec.altitude);
      break;
    case "STAR":
      points = starPoints(fleetCount, size, spec.altitude);
      break;
    case "SPIRAL":
      points = spiralPoints(fleetCount, size, spec.altitude);
      break;
    case "CIRCLE":
      points = generatePoints("circle", fleetCount, area, { size, altitude: spec.altitude });
      break;
    case "HEART":
      points = generatePoints("heart", fleetCount, area, { size, altitude: spec.altitude });
      break;
    case "WAVE":
      points = generatePoints("wave", fleetCount, area, { size, altitude: spec.altitude });
      break;
    default:
      points = generatePoints("sphere", fleetCount, area, { size, altitude: spec.altitude });
      break;
  }
  return { points, parts: [] };
}

function flapKeyframes(
  cycle: number,
  amplitudeDeg: number,
  sign: number,
): GroupDeformationKeyframe[] {
  const quarter = cycle / 4;
  const amp = amplitudeDeg * sign;
  const key = (t: number, rot: number): GroupDeformationKeyframe => ({
    t,
    offset: [0, 0, 0],
    rotation: [0, 0, rot],
    scale: 1,
    interpolation: "smooth",
  });
  // neutral -> up -> neutral -> down -> neutral: one complete, closed cycle.
  return [key(0, 0), key(quarter, amp), key(2 * quarter, 0), key(3 * quarter, -amp), key(cycle, 0)];
}

function bodyBreathKeyframes(cycle: number, amplitudeDeg: number): GroupDeformationKeyframe[] {
  const lift = Math.min(1.5, amplitudeDeg / 30);
  const key = (t: number, dy: number): GroupDeformationKeyframe => ({
    t,
    offset: [0, dy, 0],
    rotation: [0, 0, 0],
    scale: 1,
    interpolation: "smooth",
  });
  return [
    key(0, 0),
    key(cycle / 4, -lift * 0.4),
    key(cycle / 2, 0),
    key((3 * cycle) / 4, lift * 0.4),
    key(cycle, 0),
  ];
}

function hairSwayKeyframes(cycle: number, amplitudeDeg: number): GroupDeformationKeyframe[] {
  const drift = Math.min(0.8, Math.max(0.2, amplitudeDeg * 0.018));
  const key = (t: number, x: number): GroupDeformationKeyframe => ({
    t,
    offset: [x, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
    interpolation: "smooth",
  });
  return [
    key(0, 0),
    key(cycle / 4, drift),
    key(cycle / 2, 0),
    key((3 * cycle) / 4, -drift),
    key(cycle, 0),
  ];
}

function globalTrack(proposal: AIChoreographyProposalV1, duration: number): TransformKeyframe[] {
  const [tx, ty, tz] = proposal.globalMotion.translation;
  const yaw = proposal.globalMotion.rotationDeg;
  const neutral: TransformKeyframe = {
    t: 0,
    translation: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    interpolation: "minJerk",
  };
  if (!tx && !ty && !tz && !yaw) return [neutral];
  return [
    neutral,
    {
      t: duration,
      translation: [tx, ty, tz],
      rotation: [0, yaw, 0],
      scale: [1, 1, 1],
      interpolation: "minJerk",
    },
  ];
}

/** Builds the native formation (and animation) described by a proposal. */
export function buildProposalContent(
  proposal: AIChoreographyProposalV1,
  options: BuildOptions,
): BuiltProposalContent {
  const prefix = options.idPrefix ?? `ai-${proposal.id}`;
  const geometry = conceptGeometry(proposal, options.area);
  const points = rotateYaw(geometry.points, proposal.formationSpec.rotationDeg);

  if (points.length !== proposal.fleetCount) {
    throw new ChoreographyAIError(
      "BUILD_FAILED",
      `The builder produced ${points.length} points for a fleet of ${proposal.fleetCount}.`,
      { produced: points.length, expected: proposal.fleetCount },
    );
  }

  const formation: Formation = {
    id: `${prefix}-f`,
    name: proposal.title,
    kind: "custom",
    points,
    params: {
      source: "AI_PROPOSAL",
      concept: proposal.concept,
      seed: options.seed ?? 1,
      width: proposal.formationSpec.width,
      altitude: proposal.formationSpec.altitude,
      rotationDeg: proposal.formationSpec.rotationDeg,
      engineVersion: proposal.provenance.engineVersion,
    },
  };

  if (!proposal.animationSpec.dynamic) {
    return { formation, dynamicFormation: null, parts: [] };
  }

  const anim = proposal.animationSpec;
  const cycle = Math.max(0.5, anim.cycleDuration);
  const cycles = Math.max(1, Math.round(anim.cycles));
  const duration = cycle * cycles;

  const dynamicPoints: DynamicFormationPoint[] = points.map((base, i) => ({
    id: pointId(i),
    base,
  }));
  const activeParts = geometry.parts.filter((p) => proposal.motionGroups.includes(p.part));

  const groups: MotionGroup[] = activeParts.map((part, index) => {
    const isWing = part.part === "LEFT_WING" || part.part === "RIGHT_WING";
    const keyframes = isWing
      ? flapKeyframes(cycle, anim.amplitudeDeg, part.part === "LEFT_WING" ? -1 : 1)
      : part.part === "HAIR" && anim.bodyDeforms
        ? hairSwayKeyframes(cycle, anim.amplitudeDeg)
        : part.part === "BODY" && anim.bodyDeforms
          ? bodyBreathKeyframes(cycle, anim.amplitudeDeg)
          : [
              {
                t: 0,
                offset: [0, 0, 0] as Vec3,
                rotation: [0, 0, 0] as Vec3,
                scale: 1,
                interpolation: "smooth" as const,
              },
            ];
    return {
      id: `${prefix}-g${index + 1}`,
      name: PART_LABEL[part.part],
      pointIds: part.indices.map((i) => pointId(i)),
      color: PART_COLOR[part.part],
      pivot: part.pivot,
      keyframes,
      // Each group's track is one closed cycle, repeated for the whole duration.
      loop: "REPEAT",
      loopDuration: cycle,
      phaseOffset: 0,
      enabled: true,
    } satisfies MotionGroup;
  });

  const dynamicFormation: DynamicFormation = {
    id: `${prefix}-d`,
    name: proposal.title,
    sourceFormationId: formation.id,
    points: dynamicPoints,
    pivot: [0, proposal.formationSpec.altitude, 0],
    duration,
    loop: anim.loop,
    transform: globalTrack(proposal, duration),
    groups,
    seed: options.seed ?? 1,
    algorithmVersion: DYNAMIC_FORMATION_ALGORITHM_VERSION,
  };

  return { formation, dynamicFormation, parts: activeParts.map((p) => p.part) };
}
