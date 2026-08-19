# Multi-Formation Scenes

`src/lib/show/scene/` — one artistic scene may contain several formation objects
at once. `createSceneEvaluator` samples every object with its hierarchical
transform, `planFleetParticipation` solves ONE global allocation across all
simultaneous objects, and `trajectory/schedule.ts` enforces fleet capacity.

## Relationship to visual-design assets (Sprint 8A)

A compiled visual asset is a normal formation asset, so it participates in scenes
exactly like any other:

- FORMATION DRONE COUNT is per object and independent of PROJECT FLEET SIZE. A
  150-point pigeon plus a 120-point text block is a valid 500-drone scene; the
  remaining drones receive participation roles.
- Assets are never padded with dummy points to match the fleet.
- Placement into a scene is always a USER action (*Add as next scene* / *Add to
  current scene*). Compiling or saving an asset never touches the timeline.

## ESSP true scene decomposition

`src/lib/import/essp/native/decomposition.ts` decides, per extracted reference
clip, between:

- `SCENE_CONTAINER` — one native formation object (the default);
- `COMPOSED_SCENE` — several inferred objects, each with its own formation /
  dynamic formation and its own disjoint source-drone membership.

The decision is evidence driven (forensic motion clusters plus spatial
separation, scored on separation ratio, membership stability and coherence
gain) and only accepted above a confidence threshold. Below it the clip stays a
single object — the importer never invents structure it cannot measure.

Each accepted object is an ordinary `SceneFormationInstance`, so it can be
selected, transformed, relit and promoted to planner ownership independently;
untouched objects of the same scene stay reference-exact.

## Reference-assisted scene editing

For a clip that came from an ESSP extraction the Scene panel offers a
comparison surface. It is a DESIGN aid only: it never changes trajectory
ownership, promotion, planning, validation or export.

- **Reference ghost** (`comparison.ts`) draws the ORIGINAL imported positions of
  the clip behind the editable geometry. Membership comes from the stored
  `sourceDroneIds` provenance, so selecting one scene object highlights exactly
  that object's source drones and dims the rest. Membership is never re-inferred.
- **One comparison clock.** Every object of a composed scene is compared at the
  SAME absolute reference time: either the extraction frame (mid-hold of the
  reference interval, the default) or the current playhead clamped to the
  binding.
- **Deviation metrics** report per object RMS, max, centroid shift, scale change
  and best-fit rotation about +Y, plus a whole-scene RMS/max. A freshly
  extracted, unedited scene reads ~0.
- **Reset object to extracted state** (`sceneEditing.ts`) restores geometry and
  transform for ONE object from an immutable extraction snapshot stored on the
  reference layer (`extractedScenes`). Siblings, lighting and all timings are
  untouched, and it is a single undo entry. Restoring never reclaims REFERENCE
  ownership.
- **Duplicate scene as editable copy** creates a planner-owned copy of the whole
  composition under fresh ids using ordinary timeline semantics (LANDING stays
  last). The reference-owned source clip is left byte-identical.
