/** Pure screen-space selection helpers for the scene viewport. */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export type ScenePointSelectionOperation = "REPLACE" | "ADD" | "SUBTRACT";
export type ScenePointSelectionTool = "CLICK" | "BOX" | "LASSO" | "BRUSH";

const distanceToSegment = (point: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
};

export function indicesInsideBox(
  points: readonly ScreenPoint[],
  path: readonly ScreenPoint[],
): number[] {
  const start = path[0];
  const end = path[path.length - 1];
  if (!start || !end) return [];
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  return points.reduce<number[]>((indices, point, index) => {
    if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY)
      indices.push(index);
    return indices;
  }, []);
}

export function pointInsidePolygon(point: ScreenPoint, polygon: readonly ScreenPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x
    )
      inside = !inside;
  }
  return inside;
}

export function indicesInsideLasso(
  points: readonly ScreenPoint[],
  polygon: readonly ScreenPoint[],
): number[] {
  return points.reduce<number[]>((indices, point, index) => {
    if (pointInsidePolygon(point, polygon)) indices.push(index);
    return indices;
  }, []);
}

export function indicesNearBrush(
  points: readonly ScreenPoint[],
  path: readonly ScreenPoint[],
  radius: number,
): number[] {
  if (path.length === 0) return [];
  return points.reduce<number[]>((indices, point, index) => {
    const hit =
      path.length === 1
        ? Math.hypot(point.x - path[0]!.x, point.y - path[0]!.y) <= radius
        : path
            .slice(1)
            .some((end, segment) => distanceToSegment(point, path[segment]!, end) <= radius);
    if (hit) indices.push(index);
    return indices;
  }, []);
}

export function applyPointSelection(
  current: readonly string[],
  candidates: readonly string[],
  operation: ScenePointSelectionOperation,
): string[] {
  const candidateSet = new Set(candidates);
  if (operation === "REPLACE") return [...candidateSet];
  if (operation === "SUBTRACT") return current.filter((id) => !candidateSet.has(id));
  return [...new Set([...current, ...candidateSet])];
}
