/**
 * Deterministic synthetic point-cloud fixtures for forensics tests.
 * No randomness beyond a seeded PRNG; every fixture is reproducible.
 */
import { sequenceFromFrames } from "../adapter";
import type { PointCloudSequence } from "../types";

export type P = [number, number, number];

export const RATE_HZ = 8;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 40-point ring formation in the XZ plane at 40 m altitude. */
export function baseShape(count = 40, radius = 20, altitude = 40): P[] {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return [Math.cos(a) * radius, altitude, Math.sin(a) * radius] as P;
  });
}

function rotateY(p: P, rad: number, pivot: P): P {
  const dx = p[0] - pivot[0];
  const dz = p[2] - pivot[2];
  return [
    pivot[0] + dx * Math.cos(rad) - dz * Math.sin(rad),
    p[1],
    pivot[2] + dx * Math.sin(rad) + dz * Math.cos(rad),
  ];
}

function build(frames: P[][]): PointCloudSequence {
  return sequenceFromFrames(frames, RATE_HZ);
}

export function staticFixture(seconds = 6): PointCloudSequence {
  const shape = baseShape();
  const n = Math.round(seconds * RATE_HZ);
  return build(Array.from({ length: n }, () => shape.map((p) => [...p] as P)));
}

export function translationFixture(seconds = 6, speed = 4): PointCloudSequence {
  const shape = baseShape();
  const n = Math.round(seconds * RATE_HZ);
  return build(
    Array.from({ length: n }, (_, s) => {
      const dx = (s / RATE_HZ) * speed;
      return shape.map((p) => [p[0] + dx, p[1], p[2]] as P);
    }),
  );
}

export function rotationFixture(seconds = 6, degPerSec = 30): PointCloudSequence {
  const shape = baseShape();
  const n = Math.round(seconds * RATE_HZ);
  return build(
    Array.from({ length: n }, (_, s) => {
      const rad = ((s / RATE_HZ) * degPerSec * Math.PI) / 180;
      return shape.map((p) => rotateY(p, rad, [0, p[1], 0]));
    }),
  );
}

export function rigidMotionFixture(seconds = 6): PointCloudSequence {
  const shape = baseShape();
  const n = Math.round(seconds * RATE_HZ);
  return build(
    Array.from({ length: n }, (_, s) => {
      const t = s / RATE_HZ;
      const rad = (t * 30 * Math.PI) / 180;
      return shape.map((p) => {
        const r = rotateY(p, rad, [0, p[1], 0]);
        return [r[0] + t * 4, r[1], r[2]] as P;
      });
    }),
  );
}

export function scaleChangeFixture(seconds = 6): PointCloudSequence {
  const shape = baseShape();
  const n = Math.round(seconds * RATE_HZ);
  return build(
    Array.from({ length: n }, (_, s) => {
      const k = 1 + (s / RATE_HZ) * 0.1;
      return shape.map((p) => [p[0] * k, p[1], p[2] * k] as P);
    }),
  );
}

/** Continuous morph from a ring to an unrelated line formation. */
export function morphFixture(seconds = 6): PointCloudSequence {
  const from = baseShape();
  const to: P[] = from.map((_, i) => [(i - from.length / 2) * 2.5, 40 + (i % 5) * 4, 0]);
  const n = Math.round(seconds * RATE_HZ);
  return build(
    Array.from({ length: n }, (_, s) => {
      const u = s / (n - 1);
      return from.map((p, i) => [
        p[0] + (to[i]![0] - p[0]) * u,
        p[1] + (to[i]![1] - p[1]) * u,
        p[2] + (to[i]![2] - p[2]) * u,
      ] as P);
    }),
  );
}

/** 70 % rigid body, 30 % "wing" points oscillating locally. */
export function localDeformationFixture(seconds = 8, periodSeconds = 2): PointCloudSequence {
  const shape = baseShape(40);
  const wing = new Set<number>();
  for (let i = 0; i < 12; i++) wing.add(i);
  const n = Math.round(seconds * RATE_HZ);
  return build(
    Array.from({ length: n }, (_, s) => {
      const t = s / RATE_HZ;
      const phase = Math.sin((2 * Math.PI * t) / periodSeconds);
      return shape.map((p, i) =>
        wing.has(i) ? ([p[0], p[1] + phase * 6, p[2]] as P) : ([...p] as P),
      );
    }),
  );
}

export function takeoffFixture(seconds = 8): PointCloudSequence {
  const grid: P[] = [];
  for (let x = 0; x < 8; x++) for (let z = 0; z < 5; z++) grid.push([x * 3, 0, z * 3]);
  const n = Math.round(seconds * RATE_HZ);
  return build(
    Array.from({ length: n }, (_, s) => {
      const t = s / RATE_HZ;
      const alt = Math.min(40, t * 5);
      return grid.map((p) => [p[0], p[1] + alt, p[2]] as P);
    }),
  );
}

export function landingFixture(seconds = 8): PointCloudSequence {
  const grid: P[] = [];
  for (let x = 0; x < 8; x++) for (let z = 0; z < 5; z++) grid.push([x * 3, 0, z * 3]);
  const n = Math.round(seconds * RATE_HZ);
  return build(
    Array.from({ length: n }, (_, s) => {
      const t = s / RATE_HZ;
      const alt = Math.max(0, 40 - t * 5);
      return grid.map((p) => [p[0], p[1] + alt, p[2]] as P);
    }),
  );
}

/** Rigid motion plus deterministic sub-decimetre noise. */
export function noisyRigidFixture(seconds = 6): PointCloudSequence {
  const rnd = mulberry32(1234);
  const shape = baseShape();
  const n = Math.round(seconds * RATE_HZ);
  return build(
    Array.from({ length: n }, (_, s) => {
      const t = s / RATE_HZ;
      const rad = (t * 30 * Math.PI) / 180;
      return shape.map((p) => {
        const r = rotateY(p, rad, [0, p[1], 0]);
        return [
          r[0] + t * 4 + (rnd() - 0.5) * 0.06,
          r[1] + (rnd() - 0.5) * 0.06,
          r[2] + (rnd() - 0.5) * 0.06,
        ] as P;
      });
    }),
  );
}
