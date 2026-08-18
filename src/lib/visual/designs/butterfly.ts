/**
 * BUILT-IN DESIGN — butterfly with structured wings.
 *
 * Strong mirror symmetry, outer wing contours, body, antennae and internal wing
 * veins. The wings are NOT uniformly filled: structure comes first, fill is a
 * low-priority extra that only appears at higher drone counts.
 */
import {
  VISUAL_DESIGN_SCHEMA_VERSION,
  type DesignPoint,
  type VisualFormationDesign,
  type VisualPrimitive,
} from "../types";
import { ellipsePath, mirrorPair } from "./util";

const UPPER_WING: DesignPoint[] = [
  [-0.03, 0.06],
  [-0.14, 0.3],
  [-0.3, 0.44],
  [-0.44, 0.4],
  [-0.48, 0.26],
  [-0.38, 0.12],
  [-0.2, 0.04],
  [-0.05, 0.02],
];

const LOWER_WING: DesignPoint[] = [
  [-0.04, 0.0],
  [-0.16, -0.08],
  [-0.3, -0.2],
  [-0.34, -0.34],
  [-0.26, -0.43],
  [-0.14, -0.34],
  [-0.06, -0.16],
];

const UPPER_VEINS: DesignPoint[][] = [
  [
    [-0.04, 0.06],
    [-0.16, 0.24],
    [-0.28, 0.36],
    [-0.4, 0.36],
  ],
  [
    [-0.04, 0.05],
    [-0.18, 0.18],
    [-0.32, 0.24],
    [-0.44, 0.28],
  ],
  [
    [-0.04, 0.04],
    [-0.18, 0.11],
    [-0.32, 0.14],
    [-0.42, 0.18],
  ],
];

const LOWER_VEINS: DesignPoint[][] = [
  [
    [-0.05, -0.02],
    [-0.16, -0.14],
    [-0.24, -0.26],
    [-0.27, -0.36],
  ],
  [
    [-0.05, -0.05],
    [-0.13, -0.16],
    [-0.18, -0.28],
  ],
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
      path: ellipsePath([0, 0.02], 0.03, 0.33, 26),
    },
  ];

  list.push(
    ...mirrorPair(
      {
        id: "upper-wing-left",
        type: "CLOSED_CONTOUR",
        part: "LEFT_WING",
        priority: 1,
        essential: true,
        minPoints: 12,
        path: UPPER_WING,
      },
      "upper-wing-right",
      "RIGHT_WING",
    ),
    ...mirrorPair(
      {
        id: "lower-wing-left",
        type: "CLOSED_CONTOUR",
        part: "LEFT_WING",
        priority: 0.9,
        essential: true,
        minPoints: 10,
        path: LOWER_WING,
      },
      "lower-wing-right",
      "RIGHT_WING",
    ),
    ...mirrorPair(
      {
        id: "antenna-left",
        type: "POLYLINE",
        part: "LEFT_ANTENNA",
        priority: 0.7,
        minPoints: 3,
        path: [
          [-0.012, 0.32],
          [-0.06, 0.42],
          [-0.11, 0.47],
        ],
      },
      "antenna-right",
      "RIGHT_ANTENNA",
    ),
  );

  UPPER_VEINS.forEach((path, i) => {
    list.push(
      ...mirrorPair(
        {
          id: `upper-vein-left-${i + 1}`,
          type: "POLYLINE",
          part: "LEFT_WING",
          priority: 0.8 - i * 0.08,
          minPoints: 3,
          path,
        },
        `upper-vein-right-${i + 1}`,
        "RIGHT_WING",
      ),
    );
  });
  LOWER_VEINS.forEach((path, i) => {
    list.push(
      ...mirrorPair(
        {
          id: `lower-vein-left-${i + 1}`,
          type: "POLYLINE",
          part: "LEFT_WING",
          priority: 0.6 - i * 0.08,
          minPoints: 3,
          path,
        },
        `lower-vein-right-${i + 1}`,
        "RIGHT_WING",
      ),
    );
  });

  list.push(
    ...mirrorPair(
      {
        id: "upper-fill-left",
        type: "REGION",
        part: "LEFT_WING",
        priority: 0.4,
        outline: UPPER_WING,
      },
      "upper-fill-right",
      "RIGHT_WING",
    ),
    ...mirrorPair(
      {
        id: "lower-fill-left",
        type: "REGION",
        part: "LEFT_WING",
        priority: 0.3,
        outline: LOWER_WING,
      },
      "lower-fill-right",
      "RIGHT_WING",
    ),
  );
  return list;
}

export const BUTTERFLY_DESIGN: VisualFormationDesign = {
  schemaVersion: VISUAL_DESIGN_SCHEMA_VERSION,
  id: "builtin-butterfly",
  name: "Butterfly",
  version: 1,
  mode: "ARTICULATED_2_5D",
  coordinateSpace: "DESIGN_XYZ",
  symmetry: "MIRROR_X",
  bounds: { width: 1, height: 0.95, depth: 0.16 },
  defaultStyle: "STRUCTURAL",
  defaultPointCount: 200,
  fillBias: "BALANCED",
  spacingTarget: 0.03,
  primitives: primitives(),
  semanticParts: [
    { id: "BODY", priority: 1, color: [70, 58, 52], depth: 0.05, animatable: true },
    {
      id: "LEFT_WING",
      priority: 1,
      mirrorOf: "RIGHT_WING",
      color: [255, 146, 62],
      depth: -0.02,
      animatable: true,
    },
    {
      id: "RIGHT_WING",
      priority: 1,
      mirrorOf: "LEFT_WING",
      color: [255, 146, 62],
      depth: -0.02,
      animatable: true,
    },
    { id: "LEFT_ANTENNA", priority: 0.7, mirrorOf: "RIGHT_ANTENNA", color: [240, 220, 180] },
    { id: "RIGHT_ANTENNA", priority: 0.7, mirrorOf: "LEFT_ANTENNA", color: [240, 220, 180] },
  ],
  metadata: {
    sourceType: "BUILT_IN",
    tags: ["butterfly", "insect", "symmetric"],
    notes: "Original symmetric wing structure; no traced source imagery.",
  },
};
