# Drone Art Compiler

`compileVisualFormation(design, targetPointCount, options)` —
`src/lib/visual/compiler.ts`.

## Guarantees

1. **Exact N.** For a compilable design, `points.length === targetPointCount`,
   always. Verified for 1, 10, 50, 80, 150, 200, 300, 500 and 1200 points on
   every built-in design.
2. **Determinism.** Same design + count + options + compiler version produce
   byte-identical geometry. Low-discrepancy (Halton / Fibonacci) sequences and an
   explicit seed replace un-seeded randomness.
3. **Purity.** No LLM, no network, no React state, no mutation of the design.
4. **No safety claims.** The report contains visual-design diagnostics only.
   Assignment, trajectory planning, conflict detection, safety validation and
   full-show validation remain authoritative after the asset enters a show.

## Stages

```text
design + count + style
  -> budget allocation      (allocate.ts)
  -> per-primitive sampling  (sample.ts)
  -> design space -> show-local metres (width, altitude, yaw, depthScale)
  -> compiled points + base colours + point->primitive->part mapping + report
```

### 1. Budget allocation (`allocate.ts`)

Never uniform. Weight per primitive =
`measure x styleWeight x fillBias x priority^1.6 x semanticPriority`, where
measure is arc length (curves), `sqrt(area) * k` (regions) or a small constant
(point features). Exact-sum distribution uses largest remainder with id-stable
tie-breaks.

- **Minimum representation:** each kept primitive first receives `minPoints`
  (defaults per type, overridable), so an essential eye contour never gets zero.
- **Graceful degradation:** while the budget cannot cover the minimums, the
  lowest-priority NON-essential primitive is dropped, deterministically. Dropped
  ids are reported.
- **Caps:** `maxPoints` prevents a large region from eating the budget; surplus
  is redistributed by priority.
- **Symmetry:** mirrored pairs are equalised; the odd point goes to the
  highest-priority central primitive.

### 2. Sampling (`sample.ts`)

- **Curves:** arc-length uniform, independent of source vertex density.
  High-curvature vertices (heart tip, beak, wing tip, star corner) are preserved
  by snapping the nearest unclaimed sample onto the corner.
- **Regions:** deterministic Halton scan filtered by an even-odd interior test,
  hole exclusion and a spacing-aware boundary inset, followed by a bounded
  3-pass relaxation (blue-noise-like, never an unstable rejection loop). Any
  shortfall falls back to outline samples so the count stays exact.
- **Point features:** the landmark position first, then tight concentric rings —
  a feature can influence allocation without being one-drone-per-feature.
- **Parametric:** circle / ellipse / helix curves and Fibonacci sphere /
  ellipsoid / plane patch surfaces, prepared for 3D designs (Earth, orbits).

### 3. Styles

| Style | Bias |
| --- | --- |
| `OUTLINE` | outer contours (logos, text, heart, icons) |
| `STRUCTURAL` | contours + internal strokes + landmarks (animals, portraits) |
| `BALANCED` | contours and region fill mixed |
| `FILLED` | region interiors dominate (high drone counts) |

`fillBias` (`CONTOUR_HEAVY` / `BALANCED` / `FILL_HEAVY`) is an extra per-design
preference on top of the style.

### 4. Colours

Compiled points carry base artistic colours from primitive or semantic-part
colour intent. These are **artwork colours, not lighting timeline effects** —
Sprint 7.4 lighting effects remain a separate, user-controlled program.

### 5. Report

```text
requestedPoints / producedPoints
primitivesUsed / primitivesTotal
highPriorityPreserved            share of priority >= 0.8 primitives kept
droppedPrimitiveIds
allocationByPart                 e.g. BODY 28, LEFT_WING 48, RIGHT_WING 48
allocations                      per primitive counts
minSpacing / spacingTarget       metres
issues                           DETAILS_OMITTED, UNDER_RESOLVED,
                                 SPACING_TIGHT, SYMMETRY_ADJUSTED
compilerVersion / style
```

## Library integration and recompilation

`formationFromCompiled` wraps the result as a native `Formation` and stores
provenance in `params` (`visualSource`, `visualDesignId`, `visualDesignVersion`,
`visualCompilerVersion`, `visualTargetPointCount`, `visualStyle`, `seed`).
`readVisualProvenance` reads it back, so a saved asset can be recompiled at
another drone count (150 -> 220) without redrawing anything.

Saving an asset **never** adds it to the show timeline.
