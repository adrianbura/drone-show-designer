/** Observable affine RGB fields only; no effect recognition, persistence or resampling. */
import { esspToStudio } from "../coordinates";
import { rawPositionAt } from "../playback";
import type { ReferenceShow } from "../types";
import type { ReferenceClipBinding } from "./types";

type Vec = [number, number, number];
type Matrix = [Vec, Vec, Vec];
const zero = (): Vec => [0, 0, 0];
const matrix = (): Matrix => [zero(), zero(), zero()];
const dot = (a: Vec, b: Vec) => a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);
const norm = (a: Vec) => Math.sqrt(dot(a, a));
const multiply = (a: Matrix, v: Vec): Vec => a.map((row) => dot(row, v)) as Vec;

/** Fixed-work Jacobi decomposition of a symmetric 3x3 matrix, including planar fleets. */
function eigen(a: Matrix) {
  const m = a.map((row) => [...row]);
  const vectors = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let iteration = 0; iteration < 18; iteration++) {
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      if (p === undefined || q === undefined) continue;
      const mp = m[p],
        mq = m[q];
      if (!mp || !mq) continue;
      const off = mp[q] ?? 0;
      if (Math.abs(off) < 1e-12) continue;
      const angle = 0.5 * Math.atan2(2 * off, (mq[q] ?? 0) - (mp[p] ?? 0));
      const c = Math.cos(angle),
        s = Math.sin(angle);
      for (let k = 0; k < 3; k++) {
        const row = m[k];
        if (!row) continue;
        const u = row[p] ?? 0,
          v = row[q] ?? 0;
        row[p] = c * u - s * v;
        row[q] = s * u + c * v;
      }
      for (let k = 0; k < 3; k++) {
        const u = mp[k] ?? 0,
          v = mq[k] ?? 0;
        mp[k] = c * u - s * v;
        mq[k] = s * u + c * v;
        const row = vectors[k];
        if (!row) continue;
        const x = row[p] ?? 0,
          y = row[q] ?? 0;
        row[p] = c * x - s * y;
        row[q] = s * x + c * y;
      }
    }
  }
  return [0, 1, 2]
    .map((i) => ({
      value: Math.max(0, m[i]?.[i] ?? 0),
      vector: vectors.map((row) => row[i] ?? 0) as Vec,
    }))
    .sort((a, b) => b.value - a.value);
}

interface Frame {
  index: number;
  time: number;
  count: number;
  rank: number;
  center: Vec;
  mean: Vec;
  gradient: Matrix;
  coherence: number | null;
  direction: Vec | null;
  strength: number | null;
  uniform: boolean;
}

function fitFrame(show: ReferenceShow, index: number): Frame {
  const time = index / show.timing.rgbRateHz;
  const positions: Vec[] = [],
    colors: Vec[] = [];
  const center = zero(),
    mean = zero();
  for (const drone of show.drones) {
    // No extrapolation or held RGB beyond a track's last original sample.
    if (
      index >= drone.rgbSampleCount ||
      drone.positionSampleCount === 0 ||
      time > (drone.positionSampleCount - 1) / show.timing.positionRateHz
    )
      continue;
    const offset = index * 3;
    const r = drone.rgbSamples[offset],
      g = drone.rgbSamples[offset + 1],
      b = drone.rgbSamples[offset + 2];
    if (r === undefined || g === undefined || b === undefined) continue;
    const position = esspToStudio(rawPositionAt(drone, time, show.timing.positionRateHz));
    const color: Vec = [r, g, b];
    positions.push(position);
    colors.push(color);
    for (let i = 0; i < 3; i++) {
      center[i] = (center[i] ?? 0) + (position[i] ?? 0);
      mean[i] = (mean[i] ?? 0) + (color[i] ?? 0);
    }
  }
  const count = positions.length;
  for (let i = 0; i < 3; i++) {
    center[i] = (center[i] ?? 0) / Math.max(1, count);
    mean[i] = (mean[i] ?? 0) / Math.max(1, count);
  }
  const covariance = matrix(),
    cross = matrix();
  let variance = 0;
  positions.forEach((position, d) => {
    const color = colors[d];
    if (!color) return;
    const x = position.map((v, i) => v - (center[i] ?? 0)) as Vec;
    const y = color.map((v, i) => v - (mean[i] ?? 0)) as Vec;
    variance += dot(y, y);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        const cov = covariance[i],
          xy = cross[i];
        if (!cov || !xy) continue;
        cov[j] = (cov[j] ?? 0) + (x[i] ?? 0) * (x[j] ?? 0);
        xy[j] = (xy[j] ?? 0) + (y[i] ?? 0) * (x[j] ?? 0);
      }
  });
  const modes = eigen(covariance);
  const cutoff = Math.max(1e-8, (modes[0]?.value ?? 0) * 1e-6);
  const observed = modes.filter((mode) => mode.value > cutoff);
  const gradient = matrix();
  for (let channel = 0; channel < 3; channel++) {
    const row = gradient[channel],
      rhs = cross[channel];
    if (!row || !rhs) continue;
    for (const mode of observed) {
      const scale = dot(rhs, mode.vector) / mode.value;
      for (let i = 0; i < 3; i++) row[i] = (row[i] ?? 0) + scale * (mode.vector[i] ?? 0);
    }
  }
  let error = 0;
  positions.forEach((position, d) => {
    const color = colors[d];
    if (!color) return;
    const predicted = multiply(gradient, position.map((v, i) => v - (center[i] ?? 0)) as Vec);
    for (let i = 0; i < 3; i++)
      error += ((color[i] ?? 0) - (mean[i] ?? 0) - (predicted[i] ?? 0)) ** 2;
  });
  const uniform = count > 0 && variance / count < 1;
  const coherence =
    !uniform && count >= 12 && observed.length > 0
      ? Math.max(0, Math.min(1, 1 - error / variance))
      : null;
  const gram = matrix();
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const row = gram[i];
      if (row) row[j] = gradient.reduce((sum, g) => sum + (g[i] ?? 0) * (g[j] ?? 0), 0);
    }
  const principal = eigen(gram)[0];
  const total = gram.reduce((sum, row, i) => sum + (row[i] ?? 0), 0);
  let direction: Vec | null = null;
  let strength: number | null = null;
  // Each changing channel must fit too; a bright linear channel cannot hide nonlinear color.
  const channelFits = [0, 1, 2].every((i) => {
    let v = 0,
      e = 0;
    positions.forEach((position, d) => {
      const delta = (colors[d]?.[i] ?? 0) - (mean[i] ?? 0);
      const row = gradient[i];
      const predicted = row ? dot(row, position.map((x, j) => x - (center[j] ?? 0)) as Vec) : 0;
      v += delta ** 2;
      e += (delta - predicted) ** 2;
    });
    return v / Math.max(1, count) < 1 || 1 - e / v >= 0.85;
  });
  if (
    principal &&
    coherence !== null &&
    coherence >= 0.85 &&
    channelFits &&
    total > 1e-8 &&
    principal.value / total >= 0.9 &&
    count >= 4 * (observed.length + 1)
  ) {
    direction = principal.vector;
    const pivot = direction.reduce(
      (best, v, i) => (Math.abs(v) > Math.abs(direction?.[best] ?? 0) ? i : best),
      0,
    );
    if ((direction[pivot] ?? 0) < 0) direction = direction.map((v) => -v) as Vec;
    strength = Math.sqrt(principal.value);
  }
  return {
    index,
    time,
    count,
    rank: observed.length,
    center,
    mean,
    gradient,
    coherence,
    direction,
    strength,
    uniform,
  };
}

/** All original RGB ticks in [start,end); O(frames*drones), O(drones) working memory. */
export function analyzeSpatialRgb(show: ReferenceShow, binding: ReferenceClipBinding) {
  const rate = show.timing.rgbRateHz;
  const positionRate = show.timing.positionRateHz;
  const valid =
    Number.isFinite(rate) &&
    rate > 0 &&
    Number.isFinite(positionRate) &&
    positionRate > 0 &&
    Number.isFinite(binding.referenceStart) &&
    Number.isFinite(binding.referenceEnd);
  const maxFrames = show.drones.reduce((n, d) => Math.max(n, d.rgbSampleCount), 0);
  const first = valid
    ? Math.min(maxFrames, Math.max(0, Math.ceil(binding.referenceStart * rate)))
    : 0;
  const stop = valid
    ? Math.max(first, Math.min(maxFrames, Math.ceil(binding.referenceEnd * rate)))
    : 0;
  let pairedFrames = 0,
    pairedSamples = 0,
    uniformFrames = 0,
    fittedFrames = 0,
    supportedFrames = 0;
  let coherenceSum = 0,
    minimumCoherence = 1,
    strengthSum = 0;
  let firstPairedTime: number | null = null,
    lastPairedTime: number | null = null;
  const directions = matrix();
  let temporalPairs = 0,
    fieldRateSum = 0,
    gradientRateSum = 0,
    speedPairs = 0,
    speedSum = 0;
  let previous: Frame | null = null;
  for (let index = first; index < stop; index++) {
    const frame = fitFrame(show, index);
    if (frame.count > 0) {
      pairedFrames++;
      pairedSamples += frame.count;
      firstPairedTime ??= frame.time;
      lastPairedTime = frame.time;
    }
    if (frame.uniform) uniformFrames++;
    if (frame.coherence !== null) {
      fittedFrames++;
      coherenceSum += frame.coherence;
      minimumCoherence = Math.min(minimumCoherence, frame.coherence);
    }
    if (frame.direction && frame.strength !== null) {
      supportedFrames++;
      strengthSum += frame.strength;
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) {
          const row = directions[i];
          if (row) row[j] = (row[j] ?? 0) + (frame.direction[i] ?? 0) * (frame.direction[j] ?? 0);
        }
      if (
        previous?.direction &&
        previous.strength !== null &&
        previous.count === frame.count &&
        previous.rank === frame.rank
      ) {
        const dt = frame.time - previous.time;
        const anchor = frame.center.map((v, i) => (v + (previous?.center[i] ?? 0)) / 2) as Vec;
        const value = (f: Frame) => {
          const v = multiply(f.gradient, anchor.map((x, i) => x - (f.center[i] ?? 0)) as Vec);
          return v.map((x, i) => x + (f.mean[i] ?? 0)) as Vec;
        };
        const before = value(previous),
          after = value(frame);
        const velocity = after.map((v, i) => (v - (before[i] ?? 0)) / dt) as Vec;
        const delta = frame.gradient.map(
          (row, i) => row.map((v, j) => (v - (previous?.gradient[i]?.[j] ?? 0)) / dt) as Vec,
        ) as Matrix;
        temporalPairs++;
        fieldRateSum += norm(velocity);
        gradientRateSum += Math.sqrt(delta.reduce((sum, row) => sum + dot(row, row), 0));
        const axis = multiply(frame.gradient, frame.direction);
        const alignment = Math.abs(dot(frame.direction, previous.direction));
        const relativeChange =
          (Math.sqrt(delta.reduce((sum, row) => sum + dot(row, row), 0)) * dt) / frame.strength;
        const speed = -dot(velocity, axis) / dot(axis, axis);
        const residual = velocity.map((v, i) => v + speed * (axis[i] ?? 0)) as Vec;
        if (
          alignment >= 0.98 &&
          relativeChange <= 0.05 &&
          norm(residual) <= Math.max(1e-6, norm(velocity) * 0.1)
        ) {
          speedPairs++;
          speedSum += speed;
        }
      }
    }
    previous = frame; // Never bridge unsupported ticks or cross a clip boundary.
  }
  const principal = eigen(directions)[0];
  const directionStability =
    supportedFrames && principal ? principal.value / supportedFrames : null;
  const supportFraction = pairedFrames ? supportedFrames / pairedFrames : 0;
  const stable =
    supportFraction >= 0.8 && directionStability !== null && directionStability >= 0.95;
  let direction = stable && principal ? principal.vector : null;
  if (direction) {
    const pivot = direction.reduce(
      (best, v, i) => (Math.abs(v) > Math.abs(direction?.[best] ?? 0) ? i : best),
      0,
    );
    if ((direction[pivot] ?? 0) < 0) direction = direction.map((v) => -v) as Vec;
  }
  return {
    status:
      pairedFrames === 0
        ? ("NO_PAIRED_SAMPLES" as const)
        : uniformFrames === pairedFrames
          ? ("UNIFORM" as const)
          : fittedFrames === 0
            ? ("INSUFFICIENT_EVIDENCE" as const)
            : stable
              ? ("SUPPORTED_GRADIENT" as const)
              : ("LOW_OR_UNSTABLE_FIT" as const),
    rgbRateHz: rate,
    rgbFrameRange: [first, stop] as [number, number],
    evaluatedFrames: stop - first,
    pairedFrames,
    pairedSamples,
    firstPairedTime,
    lastPairedTime,
    coherence: fittedFrames ? coherenceSum / fittedFrames : null,
    minimumCoherence: fittedFrames ? minimumCoherence : null,
    supportedFrameFraction: supportFraction,
    directionStability,
    // Canonical unsigned axis in studio metres; it is not an effect's travel direction.
    direction,
    strengthRgbPerMeter: stable ? strengthSum / supportedFrames : null,
    temporal: {
      consecutiveSupportedPairs: temporalPairs,
      fieldChangeRgbPerSecond: temporalPairs ? fieldRateSum / temporalPairs : null,
      gradientChangeRgbPerMeterSecond: temporalPairs ? gradientRateSum / temporalPairs : null,
      speedSupportedPairs: speedPairs,
      // Apparent iso-color field speed, NOT drone speed or an identified sweep recipe.
      apparentSpeedMetersPerSecond:
        stable && temporalPairs > 0 && speedPairs / temporalPairs >= 0.8
          ? speedSum / speedPairs
          : null,
    },
    recipe: "UNKNOWN" as const,
  };
}
