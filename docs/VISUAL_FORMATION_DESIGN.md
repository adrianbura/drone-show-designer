# Visual Formation Design

Canonical intermediate representation between artistic intent (a prompt, an
image, a built-in artwork, later a real AI provider) and drone geometry.
Implemented in `src/lib/visual/types.ts`, `serialize.ts`, `designs/`.

## Product decision

**AI is an asset creator. The user directs the show.**

- AI / image analysis / built-in designs produce a `VisualFormationDesign`.
- The deterministic Drone Art Compiler turns a design into EXACTLY N formation
  points.
- The result is saved to the Formation Library as a reusable asset.
- The **user** places the asset on the show timeline, chooses transition / hold,
  synchronises it with the music and edits lighting effects.
- Nothing in this pipeline performs beat detection, section detection, automatic
  scene sequencing or automatic timeline placement.

## Pipeline

```text
Prompt / Image / Built-in
        -> VisualFormationDesign        (artistic structure, no drones)
        -> Drone Art Compiler           (deterministic, exactly N points)
        -> Formation / DynamicFormation (native engine content)
        -> Formation Library            (immutable reusable asset)
        -> USER places it on the show timeline
        -> Fleet participation, assignment, trajectory, lighting, validation
```

## Fleet size vs formation drone count

| Concept | Meaning |
| --- | --- |
| `project.droneCount` | PROJECT FLEET SIZE — physical drones available |
| `targetPointCount` | FORMATION DRONE COUNT — points in the asset |

A 150-point pigeon stays a 150-point asset in a 500-drone project. Assets are
**never** padded with dummy points; fleet participation (Sprint 7.3) gives the
remaining drones roles when the asset is used in a show.

## Model

```text
VisualFormationDesign {
  schemaVersion, id, name, version
  mode              CONTOUR_2D | SEMANTIC_2D | ARTICULATED_2_5D | PARAMETRIC_3D
  coordinateSpace   DESIGN_XY | DESIGN_XYZ   (X right, Y up, Z forward)
  primitives[]      the artwork itself
  semanticParts[]   BODY, HEAD, LEFT_WING, LEFT_EYE, HAIR, ...
  symmetry          NONE | MIRROR_X | MIRROR_Y
  bounds            design-space width / height / depth
  defaultStyle, defaultPointCount, fillBias, spacingTarget
  metadata          sourceType MANUAL | BUILT_IN | IMAGE_ANALYSIS | AI_GENERATED
}
```

### Primitives

| Type | Represents |
| --- | --- |
| `CLOSED_CONTOUR` | silhouette, eye contour, wing contour, heart outline |
| `POLYLINE` | internal structure: wing veins, brows, nose, feather direction |
| `REGION` | fillable area: body mass, wing area, hair, continent |
| `POINT_FEATURE` | localised landmark: pupil, wing root, mouth corner |
| `PARAMETRIC_CURVE` | prepared: circle, ellipse, helix (orbits) |
| `PARAMETRIC_SURFACE` | prepared: sphere, ellipsoid, plane patch (Earth) |

Every primitive carries `priority` (0..1), optional `essential`, `minPoints`,
`maxPoints`, `enabled`, `color` (base artistic colour intent), `depth` (2.5D hint)
and `mirrorOf` (symmetry peer). Priority drives detail adaptation: at low drone
counts high-priority information survives, at higher counts lower-priority detail
progressively appears — from the **same** design, with no manual redraw.

### Semantic parts

Each primitive may belong to a part. The compiler preserves
`point -> primitive -> semantic part`, which is what lets `LEFT_WING` /
`RIGHT_WING` become motion groups of the existing Sprint 6B dynamic engine
(`src/lib/visual/dynamicBridge.ts`). Parts marked `animatable` are offered as
"Create dynamic version"; static creation stays the default.

### Symmetry

`MIRROR_X` designs allocate mirrored structures in balanced pairs. An odd
leftover point is given deterministically to the highest-priority non-mirrored
primitive (typically the body), so a 151-point butterfly is 75 / 75 / 1 rather
than accidentally asymmetric.

### Built-in designs

- `builtin-pigeon` — silhouette, body, head + beak, tail, mirrored wings with
  internal wing strokes. Original geometry from generic bird anatomy principles.
- `builtin-butterfly` — mirrored upper/lower wing contours, body, antennae,
  internal veins, low-priority wing fill.
- `builtin-portrait` — synthetic generic face (not any real person): face
  outline, eyes + pupils, brows, nose, mouth, hair, clothing.

Simple geometry (circle, ring, star, heart, spiral, wave, sphere) intentionally
stays with the existing procedural generators — a parametric circle needs no
artwork description. Future AI routes "circle" to the procedural generator and
"realistic pigeon" to the visual compiler.

### Image input preparation (Sprint 8B)

Designs are plain JSON (`serializeDesign` / `parseDesign` with strict
validation), so a future `Image -> VisualFormationDesign` module can populate
one. `metadata.sourceType` and `metadata.sourceRef` carry provenance; image bytes
are never stored in a design or a project file.

## Structure editor (Sprint 8B2)

The operator can repair an imperfect extraction BEFORE it becomes drones. The
editor lives in `src/lib/visual/editor/` and edits the design only — never drone
positions, trajectories, participation, launch/staging, lighting or export.

```text
IMAGE -> extracted design -> MANUAL STRUCTURE CORRECTION -> compiler -> exact N
```

Four pure commands (`commands.ts`), which are also the surface a future AI agent
can drive:

| Command | Effect |
| --- | --- |
| `setPrimitiveEnabled` | reversible disable; the compiler ignores it |
| `setPrimitiveImportance` | LOW/MEDIUM/HIGH/ESSENTIAL -> existing `priority` + `essential` |
| `deletePrimitive` | destructive removal, clears `mirrorOf` references |
| `addPolyline` | adds a manually drawn POLYLINE (`edit-poly-N`) |

Importance mapping: LOW 0.35, MEDIUM 0.6, HIGH 0.85, ESSENTIAL 1.0 + `essential`.
There is no second priority system.

`useStructureEditor` keeps the extracted design intact next to an edited draft,
with a LOCAL snapshot undo/redo history (one gesture = one entry) and Reset that
restores the extraction with no image re-decode. Selection, hover, drawing state
and history are editor-only and are never serialized. Changing detail, structure,
background or simplify re-extracts (primitive ids belong to an extraction) and
clears manual edits, which the UI states explicitly.

Coordinates go through `viewTransform.ts` (screen -> canvas -> analysis -> design)
so preview scaling can never alter stored geometry. A REGION is one logical
primitive; hole-level node editing is deferred, but holes extracted as separate
`img-hole-*` contours remain individually selectable and deletable.

Provenance after manual editing: the asset stays `IMPORTED` with the same
filename and analysis fingerprint, plus flat markers `edited`, `editOps`,
`designVersion` and an `edited` tag. Saving still never touches the timeline.
