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
