# Dynamic Formations

`src/lib/show/dynamic/` — the ONLY animation engine in the product.

Model, per point i at local time t:

```text
P_i(t) = pivot + T(t) + R(t) * S(t) * [ (base_i - pivot) + D_i(t) ]
```

Global translation/rotation/scale tracks are separate from additive per-group
deformation, so a bird can translate, bank and flap at once. Sampling is
memoised and exact-N; assignment, trajectory planning, conflict detection,
safety validation and export are unchanged downstream.

## Visual design bridge (Sprint 8A)

`src/lib/visual/dynamicBridge.ts` turns the semantic parts of a compiled artwork
into motion groups of this engine — it does not add a second animation engine.

- `animatableParts(design, compiled)` lists parts flagged `animatable` that
  actually received points (pigeon and butterfly wings, head, tail).
- `dynamicFromCompiled(formation, design, compiled, options)` wraps the compiled
  formation with `dynamicFromFormation` and adds one `MotionGroup` per part using
  the compiler's `point -> part` mapping. Group keyframes stay neutral: the user
  animates them with the existing dynamic panel and presets.

Static creation remains the default; a dynamic version is produced only when the
user explicitly asks for it ("Create dynamic version").
