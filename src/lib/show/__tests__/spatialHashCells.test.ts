import { describe, expect, it } from "vitest";
import { neighbourPairs, separationViolations, separationViolationsBruteForce } from "../safety";
import type { Vector3Tuple } from "../types";

describe("cell-wise spatial hash", () => {
  it("checks all 26 neighbouring directions, including negative coordinates, exactly once", () => {
    const positions: Vector3Tuple[] = [];
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++) {
          positions.push([x + 0.25, y + 0.25, z + 0.25]);
        }
    const actual = neighbourPairs(positions, 1).map((p) => p.join(":"));
    const expected: string[] = [];
    positions.forEach((a, i) =>
      positions.forEach((b, j) => {
        if (j > i && a.every((v, k) => Math.abs(Math.floor(v) - Math.floor(b[k] ?? 0)) <= 1))
          expected.push(`${i}:${j}`);
      }),
    );
    expect(actual.sort()).toEqual(expected.sort());
    expect(new Set(actual).size).toBe(actual.length);
  });
  it.each([150, 300, 500])(
    "preserves brute-force violations at %i drones, including parked pairs",
    (count) => {
      const positions: Vector3Tuple[] = Array.from({ length: count }, (_, i) => [
        ((i * 37) % 97) / 7 - 7,
        i % 11 === 0 ? 0 : ((i * 19) % 73) / 9 + 0.6,
        ((i * 29) % 89) / 7 - 6,
      ]);
      expect(separationViolations(positions, 2.5)).toEqual(
        separationViolationsBruteForce(positions, 2.5),
      );
    },
  );
});
