import { describe, expect, it } from "vitest";

import {
  applyPointSelection,
  indicesInsideBox,
  indicesInsideLasso,
  indicesNearBrush,
  pointInsidePolygon,
} from "../scenePointSelection";

const points = [
  { x: 5, y: 5 },
  { x: 15, y: 15 },
  { x: 30, y: 10 },
  { x: 50, y: 50 },
];

describe("scene point screen selection", () => {
  it("selects a box independently of drag direction", () => {
    expect(
      indicesInsideBox(points, [
        { x: 20, y: 20 },
        { x: 0, y: 0 },
      ]),
    ).toEqual([0, 1]);
  });

  it("selects points inside a lasso polygon", () => {
    const polygon = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 20, y: 30 },
    ];
    expect(pointInsidePolygon(points[1]!, polygon)).toBe(true);
    expect(indicesInsideLasso(points, polygon)).toEqual([0, 1, 2]);
  });

  it("selects points near a brush stroke", () => {
    expect(
      indicesNearBrush(
        points,
        [
          { x: 0, y: 10 },
          { x: 35, y: 10 },
        ],
        6,
      ),
    ).toEqual([0, 1, 2]);
  });

  it("applies replace, add and subtract deterministically", () => {
    expect(applyPointSelection(["a", "b"], ["b", "c"], "REPLACE")).toEqual(["b", "c"]);
    expect(applyPointSelection(["a", "b"], ["b", "c"], "ADD")).toEqual(["a", "b", "c"]);
    expect(applyPointSelection(["a", "b"], ["b", "c"], "SUBTRACT")).toEqual(["a"]);
  });
});
