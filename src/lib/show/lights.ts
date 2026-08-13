/**
 * Light Program Engine — per-drone RGB evaluation.
 *
 * Colours are evaluated from the active clip's base colour and effect. The same
 * evaluation feeds the 3D preview and the exported light program, so what the
 * operator sees is what the fleet flies.
 */
import type { LightEffect, RGB, TimelineClip } from "./types";

function hsvToRgb(h: number, s: number, v: number): RGB {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][i % 6]!;
  return [Math.round(r! * 255), Math.round(g! * 255), Math.round(b! * 255)];
}

function scale(color: RGB, k: number): RGB {
  return [
    Math.round(color[0] * k),
    Math.round(color[1] * k),
    Math.round(color[2] * k),
  ];
}

export function evaluateEffect(
  effect: LightEffect,
  base: RGB,
  index: number,
  count: number,
  t: number,
): RGB {
  const phase = count > 0 ? index / count : 0;
  switch (effect) {
    case "solid":
      return base;
    case "pulse":
      return scale(base, 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2)));
    case "rainbow":
      return hsvToRgb((phase + t * 0.15) % 1, 0.9, 1);
    case "chase":
      return scale(base, Math.abs(((phase - t * 0.4) % 1) + 1) % 1 < 0.12 ? 1 : 0.15);
    case "twinkle": {
      const seeded = Math.sin(index * 12.9898 + Math.floor(t * 6) * 78.233) * 43758.5453;
      return scale(base, (seeded - Math.floor(seeded)) > 0.7 ? 1 : 0.25);
    }
  }
}

export function lightColorAt(
  clip: Pick<TimelineClip, "color" | "effect"> | undefined,
  index: number,
  count: number,
  t: number,
): RGB {
  if (!clip) return [90, 100, 120];
  return evaluateEffect(clip.effect, clip.color, index, count, t);
}

export function rgbToHex(color: RGB): string {
  return `#${color.map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0")).join("")}`;
}

export function hexToRgb(hex: string): RGB {
  const v = hex.replace("#", "");
  return [
    parseInt(v.slice(0, 2), 16) || 0,
    parseInt(v.slice(2, 4), 16) || 0,
    parseInt(v.slice(4, 6), 16) || 0,
  ];
}
