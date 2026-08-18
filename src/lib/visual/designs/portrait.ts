/**
 * BUILT-IN DESIGN — generic stylised portrait (test design).
 *
 * SYNTHETIC face: it does not depict, trace or reproduce any real person. Its
 * purpose is to exercise the priority model — face outline, eyes, nose and mouth
 * must survive at low counts, while hair and clothing detail degrades first.
 */
import {
  VISUAL_DESIGN_SCHEMA_VERSION,
  type DesignPoint,
  type VisualFormationDesign,
  type VisualPrimitive,
} from "../types";
import { ellipsePath, mirrorPair } from "./util";

const FACE_OUTLINE: DesignPoint[] = [
  [0.0, 0.3],
  [0.13, 0.27],
  [0.2, 0.16],
  [0.22, 0.02],
  [0.2, -0.12],
  [0.12, -0.24],
  [0.0, -0.3],
  [-0.12, -0.24],
  [-0.2, -0.12],
  [-0.22, 0.02],
  [-0.2, 0.16],
  [-0.13, 0.27],
];

const HAIR_OUTLINE: DesignPoint[] = [
  [-0.26, 0.04],
  [-0.29, 0.24],
  [-0.18, 0.38],
  [0.0, 0.43],
  [0.18, 0.38],
  [0.29, 0.24],
  [0.26, 0.04],
  [0.2, 0.2],
  [0.1, 0.3],
  [-0.1, 0.3],
  [-0.2, 0.2],
];

const CLOTHING_OUTLINE: DesignPoint[] = [
  [-0.34, -0.5],
  [-0.3, -0.42],
  [-0.12, -0.3],
  [-0.06, -0.26],
  [0.06, -0.26],
  [0.12, -0.3],
  [0.3, -0.42],
  [0.34, -0.5],
];

const MOUTH: DesignPoint[] = [
  [-0.075, -0.14],
  [-0.03, -0.115],
  [0.0, -0.12],
  [0.03, -0.115],
  [0.075, -0.14],
  [0.03, -0.168],
  [0.0, -0.175],
  [-0.03, -0.168],
];

function primitives(): VisualPrimitive[] {
  const list: VisualPrimitive[] = [
    {
      id: "face-outline",
      type: "CLOSED_CONTOUR",
      part: "FACE",
      priority: 1,
      essential: true,
      minPoints: 16,
      path: FACE_OUTLINE,
    },
    {
      id: "nose",
      type: "POLYLINE",
      part: "NOSE",
      priority: 0.9,
      essential: true,
      minPoints: 4,
      path: [
        [0.0, 0.06],
        [-0.012, -0.02],
        [-0.038, -0.052],
        [0.0, -0.065],
        [0.038, -0.052],
      ],
    },
    {
      id: "mouth",
      type: "CLOSED_CONTOUR",
      part: "MOUTH",
      priority: 0.95,
      essential: true,
      minPoints: 8,
      path: MOUTH,
    },
    {
      id: "hair-contour",
      type: "POLYLINE",
      part: "HAIR",
      priority: 0.6,
      minPoints: 6,
      path: HAIR_OUTLINE,
    },
    {
      id: "hair-fill",
      type: "REGION",
      part: "HAIR",
      priority: 0.4,
      outline: HAIR_OUTLINE,
    },
    {
      id: "clothing",
      type: "POLYLINE",
      part: "CLOTHING",
      priority: 0.3,
      minPoints: 4,
      path: CLOTHING_OUTLINE,
    },
    {
      id: "face-fill",
      type: "REGION",
      part: "FACE",
      priority: 0.22,
      outline: FACE_OUTLINE,
    },
  ];

  list.push(
    ...mirrorPair(
      {
        id: "eye-left-outline",
        type: "CLOSED_CONTOUR",
        part: "LEFT_EYE",
        priority: 1,
        essential: true,
        minPoints: 8,
        path: ellipsePath([-0.09, 0.08], 0.048, 0.024, 16),
      },
      "eye-right-outline",
      "RIGHT_EYE",
    ),
    ...mirrorPair(
      {
        id: "pupil-left",
        type: "POINT_FEATURE",
        part: "LEFT_EYE",
        priority: 0.95,
        essential: true,
        maxPoints: 3,
        position: [-0.09, 0.08],
        spread: 0.012,
      },
      "pupil-right",
      "RIGHT_EYE",
    ),
    ...mirrorPair(
      {
        id: "brow-left",
        type: "POLYLINE",
        part: "LEFT_BROW",
        priority: 0.75,
        minPoints: 3,
        path: [
          [-0.148, 0.145],
          [-0.09, 0.168],
          [-0.038, 0.148],
        ],
      },
      "brow-right",
      "RIGHT_BROW",
    ),
  );
  return list;
}

export const PORTRAIT_DESIGN: VisualFormationDesign = {
  schemaVersion: VISUAL_DESIGN_SCHEMA_VERSION,
  id: "builtin-portrait",
  name: "Portrait (generic)",
  version: 1,
  mode: "ARTICULATED_2_5D",
  coordinateSpace: "DESIGN_XYZ",
  symmetry: "MIRROR_X",
  bounds: { width: 0.7, height: 0.95, depth: 0.12 },
  defaultStyle: "STRUCTURAL",
  defaultPointCount: 300,
  fillBias: "BALANCED",
  spacingTarget: 0.025,
  primitives: primitives(),
  semanticParts: [
    { id: "FACE", priority: 1, color: [238, 196, 168], depth: 0.04 },
    { id: "LEFT_EYE", priority: 1, mirrorOf: "RIGHT_EYE", color: [70, 90, 130], depth: 0.05 },
    { id: "RIGHT_EYE", priority: 1, mirrorOf: "LEFT_EYE", color: [70, 90, 130], depth: 0.05 },
    { id: "NOSE", priority: 0.9, color: [230, 180, 150], depth: 0.06 },
    { id: "MOUTH", priority: 0.95, color: [205, 110, 105], depth: 0.05 },
    { id: "LEFT_BROW", priority: 0.75, mirrorOf: "RIGHT_BROW", color: [95, 65, 50] },
    { id: "RIGHT_BROW", priority: 0.75, mirrorOf: "LEFT_BROW", color: [95, 65, 50] },
    { id: "HAIR", priority: 0.55, color: [92, 62, 48], depth: -0.02 },
    { id: "CLOTHING", priority: 0.3, color: [80, 110, 190], depth: 0.02 },
  ],
  metadata: {
    sourceType: "BUILT_IN",
    tags: ["portrait", "face", "test"],
    notes: "Synthetic generic face. Not based on any real person or photograph.",
  },
};
