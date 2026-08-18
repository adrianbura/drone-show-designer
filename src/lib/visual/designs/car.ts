/**
 * BUILT-IN DESIGN — side-view sports car with two independently animatable
 * wheels.
 *
 * Authored from scratch in normalised design space (X right, Y up); no traced
 * source imagery. The wheels are declared `animatable` with motion `SPIN_Z`,
 * so the dynamic bridge turns them into motion groups that rotate about their
 * own centre — the drone-art equivalent of rolling wheels.
 */
import {
  VISUAL_DESIGN_SCHEMA_VERSION,
  type DesignPoint,
  type VisualFormationDesign,
  type VisualPrimitive,
} from "../types";
import { circlePath } from "./util";

const BODY_OUTLINE: DesignPoint[] = [
  [-0.48, -0.09],
  [-0.47, 0.01],
  [-0.38, 0.04],
  [-0.28, 0.15],
  [-0.08, 0.21],
  [0.1, 0.2],
  [0.24, 0.06],
  [0.42, 0.03],
  [0.48, -0.03],
  [0.47, -0.13],
  [0.34, -0.14],
  [0.16, -0.14],
  [-0.18, -0.14],
  [-0.38, -0.14],
];

const CABIN: DesignPoint[] = [
  [-0.26, 0.04],
  [-0.25, 0.13],
  [-0.08, 0.18],
  [0.09, 0.17],
  [0.2, 0.06],
  [-0.02, 0.05],
];

const B_PILLAR: DesignPoint[] = [
  [-0.03, 0.05],
  [-0.02, 0.18],
];

const DOOR_LINE: DesignPoint[] = [
  [-0.02, 0.04],
  [-0.02, -0.11],
];

const SILL_LINE: DesignPoint[] = [
  [-0.36, -0.1],
  [0.3, -0.1],
];

const REAR_ARCH: DesignPoint[] = [
  [-0.4, -0.13],
  [-0.36, -0.03],
  [-0.28, 0.0],
  [-0.2, -0.03],
  [-0.16, -0.13],
];

const FRONT_ARCH: DesignPoint[] = [
  [0.14, -0.13],
  [0.18, -0.03],
  [0.26, 0.0],
  [0.34, -0.03],
  [0.38, -0.13],
];

const REAR_WHEEL: DesignPoint = [-0.28, -0.19];
const FRONT_WHEEL: DesignPoint = [0.26, -0.19];
const TIRE_R = 0.11;
const RIM_R = 0.055;

/** Radial spokes make the rotation of a wheel unmistakable in the sky. */
function spokes(center: DesignPoint, part: string, idPrefix: string): VisualPrimitive[] {
  const inner = 0.022;
  return [0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => {
    const a = (deg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return {
      id: `${idPrefix}-spoke-${i + 1}`,
      type: "POLYLINE",
      part,
      priority: 0.85 - (i % 2) * 0.1,
      minPoints: 2,
      path: [
        [center[0] + cos * inner, center[1] + sin * inner],
        [center[0] + cos * RIM_R, center[1] + sin * RIM_R],
      ] as DesignPoint[],
    } satisfies VisualPrimitive;
  });
}

function wheel(center: DesignPoint, part: string, idPrefix: string): VisualPrimitive[] {
  return [
    {
      id: `${idPrefix}-tire`,
      type: "CLOSED_CONTOUR",
      part,
      priority: 1,
      essential: true,
      minPoints: 14,
      path: circlePath(center, TIRE_R, 28),
    },
    {
      id: `${idPrefix}-rim`,
      type: "CLOSED_CONTOUR",
      part,
      priority: 0.9,
      essential: true,
      minPoints: 10,
      path: circlePath(center, RIM_R, 18),
    },
    ...spokes(center, part, idPrefix),
    {
      id: `${idPrefix}-hub`,
      type: "POINT_FEATURE",
      part,
      priority: 0.7,
      minPoints: 1,
      position: center,
      spread: 0.008,
    },
  ];
}

function primitives(): VisualPrimitive[] {
  return [
    {
      id: "body-outline",
      type: "CLOSED_CONTOUR",
      part: "BODY",
      priority: 1,
      essential: true,
      minPoints: 26,
      path: BODY_OUTLINE,
    },
    {
      id: "cabin",
      type: "CLOSED_CONTOUR",
      part: "CABIN",
      priority: 0.95,
      essential: true,
      minPoints: 12,
      path: CABIN,
    },
    ...wheel(REAR_WHEEL, "REAR_WHEEL", "rear-wheel"),
    ...wheel(FRONT_WHEEL, "FRONT_WHEEL", "front-wheel"),
    {
      id: "rear-arch",
      type: "POLYLINE",
      part: "BODY",
      priority: 0.8,
      minPoints: 5,
      path: REAR_ARCH,
    },
    {
      id: "front-arch",
      type: "POLYLINE",
      part: "BODY",
      priority: 0.8,
      minPoints: 5,
      path: FRONT_ARCH,
    },
    {
      id: "b-pillar",
      type: "POLYLINE",
      part: "CABIN",
      priority: 0.6,
      minPoints: 3,
      path: B_PILLAR,
    },
    {
      id: "door-line",
      type: "POLYLINE",
      part: "BODY",
      priority: 0.55,
      minPoints: 3,
      path: DOOR_LINE,
    },
    {
      id: "sill-line",
      type: "POLYLINE",
      part: "BODY",
      priority: 0.5,
      minPoints: 4,
      path: SILL_LINE,
    },
    {
      id: "headlight",
      type: "POINT_FEATURE",
      part: "LIGHTS",
      priority: 0.75,
      minPoints: 2,
      position: [0.45, -0.02],
      spread: 0.016,
      color: [255, 240, 190],
    },
    {
      id: "taillight",
      type: "POINT_FEATURE",
      part: "LIGHTS",
      priority: 0.7,
      minPoints: 2,
      position: [-0.46, -0.01],
      spread: 0.014,
      color: [255, 70, 60],
    },
    {
      id: "body-fill",
      type: "REGION",
      part: "BODY",
      priority: 0.35,
      outline: BODY_OUTLINE,
    },
    {
      id: "cabin-fill",
      type: "REGION",
      part: "CABIN",
      priority: 0.3,
      outline: CABIN,
    },
  ];
}

export const CAR_DESIGN: VisualFormationDesign = {
  schemaVersion: VISUAL_DESIGN_SCHEMA_VERSION,
  id: "builtin-car",
  name: "Car (rolling wheels)",
  version: 1,
  mode: "ARTICULATED_2_5D",
  coordinateSpace: "DESIGN_XYZ",
  symmetry: "NONE",
  bounds: { width: 1, height: 0.52, depth: 0.1 },
  defaultStyle: "STRUCTURAL",
  defaultPointCount: 180,
  fillBias: "CONTOUR_HEAVY",
  spacingTarget: 0.03,
  primitives: primitives(),
  semanticParts: [
    { id: "BODY", priority: 1, color: [235, 60, 70], depth: 0 },
    { id: "CABIN", priority: 0.95, color: [140, 210, 255], depth: 0.02 },
    {
      id: "REAR_WHEEL",
      priority: 1,
      color: [225, 225, 235],
      depth: 0.04,
      animatable: true,
      motion: "SPIN_Z",
    },
    {
      id: "FRONT_WHEEL",
      priority: 1,
      color: [225, 225, 235],
      depth: 0.04,
      animatable: true,
      motion: "SPIN_Z",
    },
    { id: "LIGHTS", priority: 0.75, color: [255, 240, 190] },
  ],
  metadata: {
    sourceType: "BUILT_IN",
    tags: ["car", "vehicle", "wheels", "animated"],
    notes: "Original side-view car silhouette; wheels spin about their own centre.",
  },
};
