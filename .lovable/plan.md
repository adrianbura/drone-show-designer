# Scene Composer — Design Revision (Skybrush-inspired), Review Before Implementation

Read-only design. No code changed yet.

## 1. Principle mapping (Skybrush → this app)

| Skybrush (Blender) | This app |
| --- | --- |
| Select drone objects, then act | Select **scene objects** (visuals); logical drone slots highlight automatically |
| Light Effects list (ordered stack, on/off, time-scoped) | Ordered **effect stack** per selection, built on existing `src/lib/show/lighting` |
| Storyboard transitions computed by the tool | Existing assignment/trajectory engines stay automatic and hidden |
| Placeholder / manual drone objects | **Never** — participation planner assigns unused fleet to reserve/hold |
| Physical drone indices visible | Only in **Advanced** mode |

## 2. Scene Composer wireframe

```text
+-------------------------- TOP BAR: project, fleet 150, status, Advanced [ ] -------+
| LEFT: Visuals                | VIEWPORT (3D)                | INSPECTOR (selection)|
| + Add visual                 |                              | Scene 31             |
|   SVG  AI  Image  Text  Lib  |   [ SUPER RALY ]  <- selected | -------------------- |
|                              |   ============                | SELECTION            |
| Scene 31                     |   ============                |  Text "SUPER RALY"   |
|  * Text "SUPER RALY"   96 dr |                              |  drones used 96 [--] |
|    Underline A         24 dr |  selected object drones      |  visible  [x]        |
|    Underline B         24 dr |  highlighted (cyan)          |  pos / rot / scale   |
|  Group: Title (3)            |                              |  base colour  [##]   |
|                              |                              | MOTION STACK         |
| Fleet budget                 |                              |  1 Wave  [x] 0.0-8.0 |
|  used 144 / 150              |                              |  + Add motion        |
|  reserve 6 (auto)            |                              | LIGHTING STACK       |
+------------------------------+------------------------------+  1 Fade in [x] 0-1.5 |
| TIMELINE  [ Scene 30 ][ Scene 31 ][ Scene 32 ]              |  2 Pulse   [x] 1.5-6 |
|                                                              |  + Add effect       |
|                                                              | Duplicate Group Del |
|                                                              | > Advanced          |
+--------------------------------------------------------------+---------------------+
```

Everyday inspector shows exactly: name, drones used, visibility, position/scale/rotation, base colour, motion stack, lighting stack, duplicate, group/ungroup, delete. Everything else (physical drone IDs, optimizer offsets, ownership promotion, raw conflict evidence, forensic/import diagnostics) moves under a collapsed **Advanced** disclosure.

## 3. Selection state model

Reuse `SceneSelection` (`src/lib/show/scene/selection.ts`) as the single authority; extend with an optional point-level layer instead of adding a parallel model:

```ts
interface SceneSelection {          // existing
  ids: readonly string[];
  primaryId: string | null;
}
interface ComposerSelection {       // new, editor-only
  objects: SceneSelection;
  pointIds: readonly string[];      // double-click subset mode, empty by default
  mode: "OBJECT" | "POINT";
}
```

- click → `applySceneClick(scene, sel, id, "REPLACE")`
- Shift+click → `"TOGGLE"`
- Ctrl+A → `selectAllSceneObjects`
- double-click → `mode = "POINT"` for objects with stable point ids (SVG/static); dynamic sources stay OBJECT-only
- clip switch / undo / redo → existing `reconcileEditorSelection` reconciles both layers
- Highlight: `resolveScene()` already returns `groups` with `offset`/`pointCount`, so highlighted slot indices are derived, never stored.

## 4. Object selection → existing lighting targets

`LightingTarget` already has the exact shapes needed; no schema change:

- one object selected → `{ kind: "SCENE_OBJECT", clipId, instanceId }`
- whole scene selected (nothing else) → `{ kind: "SCENE", clipId }`
- point subset (double-click) → `{ kind: "POINT_GROUP", clipId, instanceId, pointIds }`
- multi-select → one effect per selected object, same params, created in one history step

Base colour maps to `SceneObjectLighting.color` on the instance (already persisted); fade/pulse/chase/twinkle/gradient map to existing types: `FADE_IN`/`FADE_OUT`, `PULSE`, `DIRECTIONAL_REVEAL` or `COLOR_SWEEP` (chase), `PULSE` with per-point phase / `GROUP_SEQUENCE` (twinkle), `COLOR_TRANSITION` + gradient stops (gradient). Stack order = existing effect ordering; start/duration use anchor `SCENE_START` so times are relative to the selected scene. Enable/disable uses the existing effect `enabled` flag (add only if missing — one boolean, no new engine).

## 5. Wave attached to one SVG object

No new animation engine. Chain:

1. SVG import (`src/lib/show/svg`) produces a static formation asset.
2. "Add motion → Wave" calls the existing `DYNAMIC_PRESETS` `WAVE` builder (`src/lib/show/dynamic/create.ts`) on that asset's points, creating a dynamic formation owned by the project.
3. The scene object's `source` flips from `{ kind: "STATIC" }` to `{ kind: "DYNAMIC", dynamicFormationId }` via `patchObject`; transform, budget, lighting and name are preserved.
4. Per-object `animation` (`playbackRate`, `startOffset`, `phaseCycles`) gives the stack's time scope. Removing the motion flips the source back to the retained static formation id.

Only the text object changes; the underline objects keep their static sources, satisfying "Wave applied only to the text".

## 6. Native Line geometry

`src/lib/show/formations.ts` has grid/circle/sphere/helix/cube/wave/heart/text but no line. Add one deterministic generator (`line`) in the existing shape switch: params `length`, `rotationDeg`, `thickness` (1 row default), evenly spaced N points, N = the object's own drone count. This is geometry only — it feeds the same static-source path as any library asset, so assignment/trajectory/safety are untouched.

## 7. Group / ungroup

Start **editor-only** (a selection set with a shared gizmo pivot, using existing `src/lib/show/scene/group.ts` batch transforms). Rationale: `group.ts` already applies layout-correct multi-object transforms, and no export or safety contract reads grouping. Persisted named groups become a later additive scene field (`FormationScene.groups`) with a schema bump; not needed for the vertical slice.

## 8. Files affected

New:
- `src/lib/studio/composerSelection.ts` — ComposerSelection helpers (pure, wraps existing selection).
- `src/lib/studio/effectStack.ts` — preset → `LightingEffect` builders, reorder/enable/time-scope helpers (composition over the lighting engine).
- `src/components/studio/SceneComposerPanel.tsx` — left visuals list + fleet budget.
- `src/components/studio/EffectStackPanel.tsx` — motion + lighting stacks.

Changed:
- `src/lib/show/formations.ts` (+ `line` shape) and its types.
- `src/lib/show/scene/selection.ts` (point-mode helper only, additive).
- `src/lib/studio/store.tsx` — composer selection actions, add-motion command, stack mutations (each one history step).
- `src/components/studio/Inspector.tsx` — everyday vs Advanced split.
- `SceneObjectsPanel.tsx`, `LightingEffectsPanel.tsx`, `ParticipationPanel.tsx` — reuse inside the new layout; diagnostics behind Advanced.
- `src/components/studio/Viewport3D.tsx` — click / Shift+click / double-click picking and slot highlight.
- `src/i18n/en.ts`, `src/i18n/ro.ts`.

Untouched by contract: participation planner, assignment, trajectory, conflicts, safety, lighting evaluate/engine, persistence and export.

## 9. Tests and acceptance criteria

- `composerSelection` unit: click/Shift+click/Ctrl+A/point mode/reconcile after undo.
- `effectStack` unit: each preset builds a valid canonical effect; reorder and enable/disable are order-stable; multi-select creates N effects in one history step.
- `line` generator unit: N points, exact spacing, deterministic.
- SVG→Wave unit: source flips to DYNAMIC, budget/lighting/transform preserved; underlines unchanged.
- Acceptance (Scene 31): SVG "SUPER RALY" 96 drones + two underlines 24/24; fleet 150 → used 144, remaining 6 auto reserve, no placeholders; group transform moves all three; save→open byte parity; Undo/Redo restores selection and stacks; validation and export produce a report with no new blockers.
- DOM tests: everyday inspector shows only the required 11 controls; physical IDs and optimizer evidence appear only with Advanced on.

## 10. Required core change

Exactly one small additive core change: the `line` shape in `formations.ts`. Optionally one boolean (`enabled`) on `LightingEffect` if not already present. Everything else is composition over the existing engines.
