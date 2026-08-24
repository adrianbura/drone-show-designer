/**
 * ANALYSIS DRIVER — RgbaImage -> ImageAnalysisResult.
 *
 * Pure and synchronous. Reports exactly what it decided to preserve so the
 * STRUCTURE preview can be trusted as a diagnostic surface.
 */
import { firstPixel, ringArea, targetFromLabels, traceContour } from "./contours";
import { downscale, toLuminance } from "./luminance";
import {
  buildMask,
  cleanMask,
  consolidateStipple,
  findHoleLabels,
  labelComponents,
} from "./mask";
import { simplifyRingBounded } from "./simplify2d";
import {
  DETAIL_PROFILES,
  ImageAnalysisError,
  IMAGE_ANALYSIS_VERSION,
  resolveImageAnalysisOptions,
  type ImageAnalysisOptions,
  type ImageAnalysisResult,
  type ImageComponent,
  type PixelRing,
  type RgbaImage,
} from "./types";

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function analyzeImage(
  image: RgbaImage,
  options: ImageAnalysisOptions = {},
): ImageAnalysisResult {
  if (image.width <= 0 || image.height <= 0) {
    throw new ImageAnalysisError("EMPTY_IMAGE", "Image has no pixels", {
      width: image.width,
      height: image.height,
    });
  }
  const resolved = resolveImageAnalysisOptions(options);
  const profile = DETAIL_PROFILES[resolved.detail];
  const t0 = now();

  const small = downscale(image, profile.analysisEdge);
  const field = toLuminance(small);
  const built = buildMask(field, resolved.background);
  // Dotted / stippled references (drone renders) must be bridged into a solid
  // silhouette before noise removal, otherwise every dot is eroded away.
  const bridged = consolidateStipple(built.mask);
  const mask = cleanMask(bridged, profile.morphRadius);

  const fgComponents = labelComponents(mask, 1);
  if (fgComponents.count === 0) {
    throw new ImageAnalysisError("NO_STRUCTURE", "No foreground structure found", {
      polarity: built.polarity,
      threshold: built.threshold,
    });
  }
  const bgComponents = labelComponents(mask, 0);
  const holeLabels = findHoleLabels(mask, bgComponents);

  // Rank components by area; the largest one is the essential silhouette.
  const order = fgComponents.areas
    .map((area, i) => ({ label: i + 1, area }))
    .sort((a, b) => b.area - a.area || a.label - b.label);
  const largest = order[0]!.area;
  const minArea = Math.max(6, Math.round(largest * profile.minComponentAreaFrac));
  const keptRanked = order.filter((c) => c.area >= minArea).slice(0, profile.maxComponents);
  const keptLabels = new Set(keptRanked.map((c) => c.label));

  // Assign holes to their surrounding foreground component (8-neighbour probe).
  const holesByComponent = new Map<number, { label: number; area: number }[]>();
  let holesFound = 0;
  for (const holeLabel of holeLabels) {
    const area = bgComponents.areas[holeLabel - 1] ?? 0;
    holesFound++;
    const owner = ownerOfHole(mask.width, mask.height, bgComponents.labels, fgComponents.labels, holeLabel);
    if (owner == null || !keptLabels.has(owner)) continue;
    const list = holesByComponent.get(owner) ?? [];
    list.push({ label: holeLabel, area });
    holesByComponent.set(owner, list);
  }

  const epsilon = Math.max(
    0.5,
    profile.analysisEdge * profile.epsilonFrac * resolved.simplify,
  );

  let rawPoints = 0;
  let simplifiedPoints = 0;
  let holesKept = 0;
  const components: ImageComponent[] = [];

  for (const entry of keptRanked) {
    const target = targetFromLabels(mask.width, mask.height, fgComponents.labels, entry.label);
    const start = firstPixel(target);
    if (!start) continue;
    const raw = traceContour(target, start);
    rawPoints += raw.length;
    const outer = simplifyRingBounded(raw, epsilon, profile.maxRingPoints);
    if (outer.length < 3) continue;
    simplifiedPoints += outer.length;

    const holes: PixelRing[] = [];
    const holeList = (holesByComponent.get(entry.label) ?? [])
      .filter((h) => h.area >= Math.max(4, entry.area * profile.minHoleAreaFrac))
      .sort((a, b) => b.area - a.area || a.label - b.label)
      .slice(0, profile.maxHolesPerComponent);
    for (const h of holeList) {
      const ht = targetFromLabels(mask.width, mask.height, bgComponents.labels, h.label);
      const hs = firstPixel(ht);
      if (!hs) continue;
      const hraw = traceContour(ht, hs);
      rawPoints += hraw.length;
      const ring = simplifyRingBounded(
        hraw,
        epsilon,
        Math.max(8, Math.round(profile.maxRingPoints / 2)),
      );
      if (ring.length < 3 || ringArea(ring) < 4) continue;
      simplifiedPoints += ring.length;
      holes.push(ring);
      holesKept++;
    }

    components.push({
      id: entry.label,
      area: entry.area,
      outer,
      holes,
      bbox: fgComponents.bboxes[entry.label - 1] ?? [0, 0, mask.width - 1, mask.height - 1],
    });
  }

  if (components.length === 0) {
    throw new ImageAnalysisError("NO_STRUCTURE", "No usable contour survived analysis", {
      componentsFound: fgComponents.count,
    });
  }

  const analysisMs = now() - t0;
  const signature = components
    .map((c) => `${c.id}:${c.area}:${c.outer.length}:${c.holes.length}`)
    .join("|");

  return {
    options: resolved,
    components,
    diagnostics: {
      sourceWidth: image.width,
      sourceHeight: image.height,
      analysisWidth: mask.width,
      analysisHeight: mask.height,
      polarity: built.polarity,
      threshold: Number(built.threshold.toFixed(4)),
      foregroundRatio: Number(built.foregroundRatio.toFixed(4)),
      componentsFound: fgComponents.count,
      componentsKept: components.length,
      componentsDropped: Math.max(0, fgComponents.count - components.length),
      holesFound,
      holesKept,
      rawContourPoints: rawPoints,
      simplifiedContourPoints: simplifiedPoints,
      rdpEpsilon: Number(epsilon.toFixed(3)),
      analysisMs: Number(analysisMs.toFixed(2)),
    },
    fingerprint: fnv1a(
      [
        IMAGE_ANALYSIS_VERSION,
        resolved.detail,
        resolved.structure,
        resolved.background,
        resolved.simplify.toFixed(3),
        mask.width,
        mask.height,
        signature,
      ].join("~"),
    ),
  };
}

/** Finds the foreground label that surrounds a hole, deterministically. */
function ownerOfHole(
  w: number,
  h: number,
  bgLabels: Int32Array,
  fgLabels: Int32Array,
  holeLabel: number,
): number | null {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (bgLabels[y * w + x] !== holeLabel) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const fg = fgLabels[yy * w + xx] ?? 0;
          if (fg > 0) return fg;
        }
      }
    }
  }
  return null;
}
