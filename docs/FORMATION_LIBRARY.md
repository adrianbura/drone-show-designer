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

## Formation scene assets (whole compositions)

`assetType` `FORMATION_SCENE` stores a WHOLE `FormationScene` plus a bundled
dependency snapshot (`formations`, `dynamicFormations`). The payload never points
at a project-owned id, so an asset is fully self-contained.

- `collectSceneDependencies(scene, project)` bundles exactly what the objects
  reference; a missing source is a hard `MALFORMED_ASSET`.
- `validateSceneAssetPayload` runs on save and on every load/import: unbundled
  dependencies, duplicate object ids, empty geometry and invalid drone budgets
  are rejected, never repaired.
- `instantiateSceneAsset` is the only reuse path: fresh scene id, fresh
  dependency ids, object sources remapped. `addSceneAssetToShow` appends a new
  timeline clip bound to the copied scene (LANDING stays last).
- Thumbnails are composite: the scene resolved at t = 0, not one dependency.
- ESSP extraction emits SCENE drafts per extracted scene clip; saving them is
  metadata only and never promotes a clip. Provenance stays `ESSP_DERIVED`.
