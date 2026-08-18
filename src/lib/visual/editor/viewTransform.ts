/**
 * STRUCTURE EDITOR — coordinate transforms.
 *
 * Three explicit, pure conversions so drawing, hit-testing and rendering all
 * agree, and so preview scaling can NEVER alter stored geometry:
 *
 *   screen (clientX/Y) -> canvas px  (element rect, CSS vs backing-store scale)
 *   canvas px          -> analysis px (invert the aspect-preserving letterbox)
 *   analysis px        -> design XY  (Y up, origin centred, long edge = 1)
 */
import type { DesignPoint } from "../types";

export interface LetterboxTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly analysisWidth: number;
  readonly analysisHeight: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
}

/** Aspect-preserving fit of an analysis raster inside a canvas, with padding. */
export function letterbox(
  canvasWidth: number,
  canvasHeight: number,
  analysisWidth: number,
  analysisHeight: number,
  padding = 12,
): LetterboxTransform {
  const aw = Math.max(1, analysisWidth);
  const ah = Math.max(1, analysisHeight);
  const scale = Math.min((canvasWidth - padding) / aw, (canvasHeight - padding) / ah);
  return {
    scale,
    offsetX: (canvasWidth - aw * scale) / 2,
    offsetY: (canvasHeight - ah * scale) / 2,
    analysisWidth: aw,
    analysisHeight: ah,
    canvasWidth,
    canvasHeight,
  };
}

export function analysisToCanvas(
  t: LetterboxTransform,
  x: number,
  y: number,
): readonly [number, number] {
  return [t.offsetX + x * t.scale, t.offsetY + y * t.scale];
}

export function canvasToAnalysis(
  t: LetterboxTransform,
  x: number,
  y: number,
): readonly [number, number] {
  return [(x - t.offsetX) / t.scale, (y - t.offsetY) / t.scale];
}

/** Same mapping as the image package: X right, Y UP, long edge normalised to 1. */
export function analysisToDesign(
  analysisWidth: number,
  analysisHeight: number,
  x: number,
  y: number,
): DesignPoint {
  const longEdge = Math.max(analysisWidth, analysisHeight) || 1;
  return [(x + 0.5 - analysisWidth / 2) / longEdge, (analysisHeight / 2 - (y + 0.5)) / longEdge];
}

export function designToAnalysis(
  analysisWidth: number,
  analysisHeight: number,
  point: DesignPoint,
): readonly [number, number] {
  const longEdge = Math.max(analysisWidth, analysisHeight) || 1;
  return [
    point[0] * longEdge + analysisWidth / 2 - 0.5,
    analysisHeight / 2 - 0.5 - point[1] * longEdge,
  ];
}

export interface CanvasRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** CSS pointer position -> canvas backing-store pixels. */
export function screenToCanvas(
  rect: CanvasRect,
  canvasWidth: number,
  canvasHeight: number,
  clientX: number,
  clientY: number,
): readonly [number, number] {
  const sx = rect.width > 0 ? canvasWidth / rect.width : 1;
  const sy = rect.height > 0 ? canvasHeight / rect.height : 1;
  return [(clientX - rect.left) * sx, (clientY - rect.top) * sy];
}

/** Full screen -> design conversion used by the polyline tool. */
export function screenToDesign(
  rect: CanvasRect,
  t: LetterboxTransform,
  clientX: number,
  clientY: number,
): DesignPoint {
  const [cx, cy] = screenToCanvas(rect, t.canvasWidth, t.canvasHeight, clientX, clientY);
  const [ax, ay] = canvasToAnalysis(t, cx, cy);
  return analysisToDesign(t.analysisWidth, t.analysisHeight, ax, ay);
}

/** Hit tolerance expressed in canvas pixels, converted to design units. */
export function toleranceInDesignUnits(t: LetterboxTransform, canvasPixels: number): number {
  const longEdge = Math.max(t.analysisWidth, t.analysisHeight) || 1;
  return canvasPixels / (t.scale * longEdge);
}
