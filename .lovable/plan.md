# Sprint 8B2 — Visual Structure Editor (architecture proposal)

## 1. Current 8B1 architecture findings

- `VisualFormationDesign` (src/lib/visual/types.ts) already carries everything the editor needs: per-primitive `id`, `priority` (0..1), `essential`, `enabled`, `minPoints`, `maxPoints`, `part`, `mirrorOf`. **No schema change is required for features 1–4.**
- The compiler already honours the editor semantics: `allocateBudget` filters `p.enabled !== false`, sorts degradation by `essential` then `priority`, and `primitiveWeight` uses `pow(priority, 1.6)`. So enable/disable and importance are *already* respected — 8B2 only needs a UI + immutable mutation layer.
- Primitive IDs from image analysis are deterministic and structural: `img-outer-<componentId>`, `img-hole-<componentId>-<i>`, `img-region-<componentId>`. They are stable across re-render but **change when Detail/Structure/Background/Simplify change** (components are re-labelled). This drives the reset/re-extract rules below.
- `ImageDesignPanel.tsx` is fully derived state: `source -> useMemo analysis -> useMemo design -> useMemo compiled`. There is no editable design object today; the design is recomputed on every control change.
- `validateDesign`/`serializeDesign` already validate ids, duplicate ids, priorities, path lengths, `PART_MISSING`, `MIRROR_TARGET_MISSING` — good enough to validate manually edited designs and drawn polylines (POLYLINE requires >= 2 points).
- Persistence: only the compiled `Formation` + `AssetSourceRef` reach the library. `AssetSourceRef.params` is `Record<string, string|number|boolean>` — flat, so edit metadata must be flat scalars.
- Studio store has two *separate* histories already (`undoTimeline`/`redoTimeline`, `undoDynamic`/`redoDynamic`) and the global shortcut handler falls back between them. Precedent supports a third, local history.
- Panel width: the STRUCTURE canvas is 268x200 CSS px inside LeftPanel. That is too small for accurate contour picking. Recommendation in section 11 (no Studio redesign).

## 2. Best editor state model

A single new hook `useStructureEditor` (src/lib/visual/editor/) holding:

```text
extracted   VisualFormationDesign   // the 8B1 output, never mutated
draft       VisualFormationDesign   // extracted + applied commands
past[]      VisualFormationDesign   // undo snapshots (bounded, e.g. 50)
future[]    VisualFormationDesign
selectedId  string | null           // editor-only
drawing     { active, points[] }    // editor-only
```

`extracted` is kept in memory next to the analysis, so **Reset is free** (no re-decode). When analysis inputs change (Detail/Structure/Background/Simplify/new image), the editor re-seeds from the new extraction and clears history — ids are no longer valid, so silently remapping edits would be dishonest. The UI states this ("controls changed — structure edits reset").

`draft` is the *only* thing fed to `compileVisualFormation`, so DRONES updates from one code path.

## 3. Command / mutation model

A small pure command layer (worth it: it is ~80 lines, testable, and is exactly the surface a future AI agent calls):

```text
setPrimitiveEnabled(design, id, enabled)      -> design
setPrimitiveImportance(design, id, level)     -> design
deletePrimitive(design, id)                   -> design
addPolyline(design, path, level?)             -> design
```

Rules: pure, immutable (`{...design, primitives: [...]}`, version+1), unknown id is a no-op returning the same reference, `deletePrimitive` also clears `mirrorOf` references pointing at the deleted id (keeps `validateDesign` clean).

## 4. Undo / redo recommendation

Local, snapshot-based, inside `useStructureEditor`. Reasons: designs are small (hundreds of points), snapshots make immutability trivially provable, and the domain is intentionally separate from timeline/dynamic history. One user gesture = one snapshot push (a finished polyline is one entry, not one per click). Do **not** wire into the global Ctrl+Z handler in 8B2 (it would steal timeline undo while the panel has focus); expose explicit Undo/Redo toolbar buttons, plus keyboard only while the structure canvas has focus.

## 5. Selection model

Selection by primitive id, editor-only, never serialized. Hit-testing on the STRUCTURE canvas, in analysis-pixel space:

1. distance to any contour/polyline segment < ~6 px -> that primitive
2. else point-in-polygon on REGION outlines (respecting holes) -> that region
3. else clear selection

Deterministic tie-break: nearest distance, then higher priority, then id. Disabled primitives stay selectable (drawn dashed/dim) so they can be re-enabled.

## 6. Priority mapping

Verified against `allocateBudget`/`primitiveWeight` (superlinear `priority^1.6`, `underResolved` threshold at 0.8):

| Level | priority | essential |
| --- | --- | --- |
| LOW | 0.35 | false |
| MEDIUM | 0.6 | false |
| HIGH | 0.85 | false |
| ESSENTIAL | 1.0 | true |

Reading back: `essential === true` -> ESSENTIAL, else nearest band by priority. No second priority system, no schema field.

## 7. Region / hole behaviour

A REGION is one logical primitive; selecting anywhere inside it (or on its outline) selects the whole region including holes. Individual hole editing is **deferred**: holes live inside `RegionPrimitive.holes` and have no ids, so per-hole editing needs a schema change. Note that in STRUCTURAL/OUTLINE modes holes already exist as separate `img-hole-*` CLOSED_CONTOUR primitives with their own ids — those *are* individually selectable, disable-able and deletable. That covers the "incorrect hole" case without new schema.

## 8. Draw-polyline coordinate model

Three explicit conversions, each a pure tested function:

```text
screen (clientX/Y) -> canvas px  (getBoundingClientRect, CSS-vs-canvas scale)
canvas px          -> analysis px (invert the letterbox: (x-ox)/scale)
analysis px        -> design XY   (existing makeMapper math, Y flipped, /longEdge)
```

The letterbox transform (`scale`, `ox`, `oy`) is currently inline in `StructureCanvas`; extract it to `editor/viewTransform.ts` so drawing and hit-testing share one implementation and it can be unit-tested. Geometry is stored in design space, so resizing or rescaling the preview can never alter saved geometry.

Interaction: Add line -> click points (live rubber band) -> Enter/double-click commits (>= 2 points) -> Esc cancels and pushes nothing. Committed polyline id: `edit-poly-1`, `edit-poly-2`, … (stable, collision-checked). Default importance MEDIUM.

## 9. Reset model

`resetStructure()` = `draft := extracted`, clear selection/drawing, push one undo entry (so Reset itself is undoable). No image decode, no re-analysis.

## 10. Provenance after manual editing

Asset `source` stays **IMPORTED** and `sourceRef.kind` stays `IMAGE` with the same filename + analysis fingerprint. Add flat scalars to `sourceRef.params`:

```text
edited: true
editOps: 4          // committed gesture count
designVersion: 5    // draft design version
```

Plus tag `edited`. Design-side: `metadata.notes` gains a short "manually edited structure" marker. No edit-history persistence, no `USER` downgrade.

## 11. UI layout recommendation

Keep REFERENCE / STRUCTURE / DRONES in `ImageDesignPanel`. Add above the STRUCTURE canvas a compact toolbar (Select, Add line, Undo, Redo, Reset) and below it the inspector (Type, Status, Importance select, Points, Part, Disable/Enable, Delete).

**Reported limitation:** at 268x200 px the preview is honestly too tight for picking thin contours. Mitigation inside the existing panel, no Studio redesign: (a) generous 6 px hit radius, (b) a "Structure list" fallback — one row per primitive with type/points/importance and enable/delete, so every operation is reachable without pixel-accurate clicking, (c) a full-panel-width expanded canvas toggle deferred to 8B3 if it still feels cramped after the browser pass.

## 12. Required files / modules

New:
- `src/lib/visual/editor/commands.ts` — the four pure commands
- `src/lib/visual/editor/importance.ts` — level <-> (priority, essential) mapping
- `src/lib/visual/editor/viewTransform.ts` — letterbox + screen/analysis/design conversions
- `src/lib/visual/editor/hitTest.ts` — segment/polygon picking
- `src/lib/visual/editor/useStructureEditor.ts` — draft/history/selection/drawing state
- `src/lib/visual/editor/index.ts`
- `src/components/studio/StructureEditorToolbar.tsx`, `StructureInspector.tsx`, `StructureList.tsx`
- `src/lib/visual/editor/__tests__/editor.test.ts`

Modified: `src/components/studio/ImageDesignPanel.tsx` (wire draft + interactions into the existing STRUCTURE canvas), `src/lib/visual/index.ts` (export editor), `src/i18n/en.ts` + `ro.ts` (`image.editor.*`), `docs/VISUAL_FORMATION_DESIGN.md`.

Untouched: compiler, allocate, sample, image analysis, flight planning, participation, trajectory, SVG, ESSP/export, lighting, timeline, store.

## 13. Test plan

Pure deterministic tests, no DOM: disable/enable, importance mapping both directions, delete (incl. mirrorOf cleanup), add polyline, cancel polyline (no state change), reset, undo, redo, redo cleared by a new edit, source `extracted` object identity unchanged after every command (immutability), stable ids across repeated analysis of the same fixture, screen->canvas->analysis->design round trip within epsilon, hit-test picks the nearest contour and rejects empty space, `validateDesign(draft) === []` after each edit, `serializeDesign`/`parseDesign` round trip of an edited design, and serialized JSON contains no `selectedId`/`hover`/history keys.

Exact-N: one image fixture at 80/150/200/300, compiled after disable + delete + polyline + importance changes — `points.length` must equal the request every time.

## 14. Risks / edge cases

- Disabling/deleting everything -> `EMPTY_DESIGN` from the compiler: guard by keeping the last enabled primitive undeletable-with-a-message, and show the compiler issue rather than crashing.
- Ids change when analysis controls change -> edits intentionally reset, clearly messaged.
- Deleting a primitive that another primitive mirrors -> handled in `deletePrimitive`.
- Degenerate polyline (all points identical / 1 point) -> rejected on commit.
- High-detail contours (up to 420 points/ring) -> hit-testing stays O(points); fine at these sizes.
- Undo stack bounded at 50 to avoid unbounded memory.

## 15. What must remain deferred

Per-hole node editing, node/vertex dragging, freehand/Bézier, semantic part assignment and mirror assignment, automatic semantic recognition, internal ridge/skeleton synthesis, real AI provider, animation inference, grid snapping/topology/welding, global Ctrl+Z integration, full-screen editor.

Semantic-parts readiness check: `semanticParts[]` + `primitive.part` + `SemanticPart.mirrorOf` already support a future "select contours -> assign LEFT_WING" flow with no schema change; `validateDesign` enforces `PART_MISSING`, so the future command must add the part before assigning it.

## 16. Proposed 8B2 implementation plan

1. Extract `viewTransform` + `hitTest` from the existing canvas drawing code; unit test them.
2. Add `importance.ts` and `commands.ts`; unit test purity/immutability.
3. Add `useStructureEditor` (draft, snapshot history, selection, drawing); unit test undo/redo/reset.
4. Wire `ImageDesignPanel` to compile from `draft`; add toolbar, inspector, structure list, selection highlight and polyline drawing.
5. Add i18n keys (EN/RO) and provenance/`edited` metadata on save.
6. Run `bun run test:run`, `bun run typecheck`, `bun run build`, then the browser pass (import bird-like image -> select -> disable -> drones update -> undo -> ESSENTIAL -> add polyline -> delete -> save -> reopen asset), verifying exact-N, unchanged source image, unchanged timeline, no console errors.
