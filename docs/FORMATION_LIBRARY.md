# Formation Library

`src/lib/library/` — versioned, engine-agnostic, reusable DESIGN assets.

- Assets are immutable snapshots. Using one in a show always creates a
  project-owned copy, so deleting an asset can never alter an existing show.
- Static assets store the exact `Formation`; dynamic assets store the FULL
  `DynamicFormation` (points, groups, keyframes, transform, loop, algorithm
  version) and are never flattened.
- Persistence sits behind `FormationAssetRepository`; the browser implementation
  keeps a single document and skips malformed assets instead of failing.
- Fleet compatibility: `EXACT`, `PARTIAL` (fewer points than the fleet — fully
  usable, fleet participation gives every other drone a role) and `TOO_LARGE`
  (blocked loudly, never silently resampled).

## Visual-design assets (Sprint 8A)

Assets compiled by the Drone Art Compiler are saved with `source`
`AI_GENERATED` and carry provenance inside `Formation.params`:

```text
visualSource            VISUAL_DESIGN
visualDesignId          builtin-pigeon
visualDesignVersion     1
visualCompilerVersion   1.0.0
visualTargetPointCount  150
visualStyle             STRUCTURAL
seed                    1
```

`readVisualProvenance` reads it back, which enables **recompilation** of the same
design at a different drone count (150 -> 220) without redrawing.

Saving an asset NEVER adds it to the show timeline. The user opens the library
and chooses *Add as next scene* / *Add to current scene* when they want it.
