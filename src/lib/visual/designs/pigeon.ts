/**
 * BUILT-IN DESIGN — pigeon with open wings.
 *
 * Original geometry authored from generic bird-anatomy principles (clear
 * silhouette, wing structure, body/head/tail hierarchy). No copyrighted source
 * imagery is stored or traced.
 *
 * Semantic hierarchy: BODY, HEAD, TAIL, LEFT_WING, RIGHT_WING — the wings are
 * flagged animatable so the dynamic bridge can turn them into motion groups.
 */
import {
  VISUAL_DESIGN_SCHEMA_VERSION,
  type DesignPoint,
  type VisualFormationDesign,
  type VisualPrimitive,
} from "../types";
import { circlePath, mirrorPair } from "./util";

const WING_OUTLINE: DesignPoint[] = [
  [-0.07, 0.16],
  [-0.2, 0.3],
  [-0.34, 0.36],
  [-0.46, 0.32],
  [-0.5, 0.21],
  [-0.42, 0.12],
  [-0.3, 0.06],
  [-0.18, 0.0],
  [-0.09, -0.02],
  [-0.07, 0.09],
];

const WING_VEINS: DesignPoint[][] = [
  [
    [-0.08, 0.13],
    [-0.22, 0.22],
    [-0.36, 0.29],
    [-0.46, 0.28],
  ],
  [
    [-0.08, 0.09],
    [-0.22, 0.16],
    [-0.34, 0.2],
    [-0.44, 0.22],
  ],
  [
    [-0.08, 0.05],
    [-0.2, 0.09],
    [-0.31, 0.1],
    [-0.4, 0.15],
  ],
];

const BODY_OUTLINE: DesignPoint[] = [
  [0.0, -0.22],
  [0.075, -0.1],
  [0.09, 0.06],
  [0.06, 0.16],
  [0.0, 0.2],
  [-0.06, 0.16],
  [-0.09, 0.06],
  [-0.075, -0.1],
];

const TAIL_OUTLINE: DesignPoint[] = [
  [-0.035, -0.2],
  [-0.11, -0.42],
  [-0.04, -0.37],
  [0.0, -0.46],
  [0.04, -0.37],
  [0.11, -0.42],
  [0.035, -0.2],
];

function primitives(): VisualPrimitive[] {
  const list: VisualPrimitive[] = [
    {
      id: "body-outline",
      type: "CLOSED_CONTOUR",
      part: "BODY",
      priority: 1,
      essential: true,
      minPoints: 10,
      path: BODY_OUTLINE,
    },
    {
      id: "body-fill",
      type: "REGION",
      part: "BODY",
      priority: 0.55,
      minPoints: 4,
      outline: BODY_OUTLINE,
    },
    {
      id: "head-outline",
      type: "CLOSED_CONTOUR",
      part: "HEAD",
      priority: 1,
      essential: true,
      minPoints: 8,
      path: circlePath([0, 0.28], 0.075, 20),
    },
    {
      id: "beak",
      type: "POLYLINE",
      part: "HEAD",
      priority: 0.9,
      minPoints: 2,
      path: [
        [0.065, 0.295],
        [0.125, 0.275],
        [0.065, 0.255],
      ],
    },
    {
      id: "tail-outline",
      type: "CLOSED_CONTOUR",
      part: "TAIL",
      priority: 0.85,
      essential: true,
      minPoints: 8,
      path: TAIL_OUTLINE,
    },
    {
      id: "tail-fill",
      type: "REGION",
      part: "TAIL",
      priority: 0.3,
      outline: TAIL_OUTLINE,
    },
  ];

  // Wings: mirrored contours, internal strokes and a light fill.
  list.push(
    ...mirrorPair(
      {
        id: "wing-left-outline",
        type: "CLOSED_CONTOUR",
        part: "LEFT_WING",
        priority: 1,
        essential: true,
        minPoints: 12,
        path: WING_OUTLINE,
      },
      "wing-right-outline",
      "RIGHT_WING",
    ),
  );
  WING_VEINS.forEach((path, i) => {
    list.push(
      ...mirrorPair(
        {
          id: `wing-left-vein-${i + 1}`,
          type: "POLYLINE",
          part: "LEFT_WING",
          priority: 0.85 - i * 0.1,
          minPoints: 3,
          path,
        },
        `wing-right-vein-${i + 1}`,
        "RIGHT_WING",
      ),
    );
  });
  list.push(
    ...mirrorPair(
      {
        id: "wing-left-fill",
        type: "REGION",
        part: "LEFT_WING",
        priority: 0.35,
        outline: WING_OUTLINE,
      },
      "wing-right-fill",
      "RIGHT_WING",
    ),
    ...mirrorPair(
      {
        id: "eye-left",
        type: "POINT_FEATURE",
        part: "HEAD",
        priority: 0.5,
        maxPoints: 1,
        position: [-0.03, 0.3],
      },
      "eye-right",
      "HEAD",
    ),
  );
  return list;
}

export const PIGEON_DESIGN: VisualFormationDesign = {
  schemaVersion: VISUAL_DESIGN_SCHEMA_VERSION,
  id: "builtin-pigeon",
  name: "Pigeon",
  version: 1,
  mode: "ARTICULATED_2_5D",
  coordinateSpace: "DESIGN_XYZ",
  symmetry: "MIRROR_X",
  bounds: { width: 1, height: 0.95, depth: 0.2 },
  defaultStyle: "STRUCTURAL",
  defaultPointCount: 150,
  fillBias: "BALANCED",
  spacingTarget: 0.035,
  primitives: primitives(),
  semanticParts: [
    { id: "BODY", priority: 1, color: [225, 230, 240], depth: 0.06, animatable: true },
    { id: "HEAD", priority: 1, color: [240, 244, 250], depth: 0.08, animatable: true },
    { id: "TAIL", priority: 0.8, color: [200, 208, 222], depth: 0.02, animatable: true },
    {
      id: "LEFT_WING",
      priority: 1,
      mirrorOf: "RIGHT_WING",
      color: [185, 198, 218],
      depth: -0.03,
      animatable: true,
    },
    {
      id: "RIGHT_WING",
      priority: 1,
      mirrorOf: "LEFT_WING",
      color: [185, 198, 218],
      depth: -0.03,
      animatable: true,
    },
  ],
  metadata: {
    sourceType: "BUILT_IN",
    tags: ["bird", "pigeon", "animal"],
    notes: "Original silhouette authored from generic bird anatomy principles.",
  },
};
