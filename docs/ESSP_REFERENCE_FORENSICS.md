# ESSP Reference Forensics (analysis only)

Heuristic motion analysis of an **imported** reference show. The importer output is
immutable: forensics never rewrites positions, colours, timing or drone identity, and
it never claims to recover the original design intent.

## Pipeline

1. **Adapter** (`adapter.ts`) — converts the immutable `ReferenceShow` into a
   `PointCloudSequence` in studio metres, plus a deterministic FNV-1a `showHash`.
2. **Centroid track** (`centroid.ts`) — fleet centroid, altitude band, ground fraction.
3. **Motion windows** (`motion.ts`) — per-window robust rigid fit (`rigid.ts`, Horn
   quaternion + cyclic Jacobi, two outlier-rejection passes) yielding centroid speed,
   rotation rate, scale, rigid RMS and deformation RMS.
4. **Periodicity** (`periodicity.ts`) — autocorrelation on the *signed* deformation
   projection series, avoiding the period halving of rectified energy signals.
5. **Classification + segmentation** (`classification.ts`, `segmentation.ts`) —
   priority rules over the descriptors, run-merging, and takeoff / landing /
   possible-staging heuristics.
6. **Report** (`report.ts`) — versioned, serialisable `ReferenceForensicsReport`.

## Categories

`GROUND_STATIC`, `TAKEOFF_ASCENT`, `STATIC_FORMATION`, `POSSIBLE_STAGING`,
`GLOBAL_TRANSLATION`, `GLOBAL_ROTATION`, `RIGID_MOTION`, `DYNAMIC_DEFORMATION`,
`FORMATION_TRANSITION`, `LANDING_DESCENT`, `UNKNOWN`.

Labels are generic (`Static formation 03`). Operators may rename a segment in the
inspector; that changes metadata only, never the classification or the source data.

## Thresholds and determinism

All thresholds live in `types.ts` (`FORENSICS_PRESETS`: `CONSERVATIVE`, `BALANCED`,
`SENSITIVE`). No magic numbers elsewhere. Identical input plus identical thresholds
always yields an identical report. A report is **stale** when the show hash, the
algorithm version (`ESSP_FORENSICS_ALGORITHM_VERSION`) or the thresholds differ from
the current state; the UI flags this and requires a re-run.

## Studio integration

- **Inspector → Reference forensics**: run/cancel analysis, choose preset, browse
  segments, inspect per-segment metrics, export the report as JSON.
- **Timeline**: a read-only inferred-segment strip; clicking a segment seeks to it.
- **Viewport**: drones classified as active within the selected segment are
  highlighted (render-only tint), leaving imported colour data untouched.

## Segment → editable dynamic formation (conversion)

`src/lib/import/essp/conversion/` converts one forensic segment into a **new**
`DynamicFormation`. The reference show stays immutable; conversion output is an
independent project asset.

1. **Decompose** (`decompose.ts`) — exact sampled geometry, global translation
   (centroid), global rotation (Kabsch/robust fit, continuity-unwrapped in
   `rotation.ts`) and per-point internal deformation residuals.
2. **Simplify** (`simplify.ts`) — optional error-bounded keyframe reduction.
3. **Build** (`build.ts`) — native formation, points `DP-xxx`, suggested motion
   groups, loop-closure analysis.
4. **Fidelity** (`fidelity.ts`) — re-samples through the public dynamic sampler
   and reports mean/rms/p95/p99/max error, worst drone and worst time.

The Inspector panel (`ConversionPanel.tsx`) shows measured accuracy before Apply;
`ConversionOverlay.tsx` draws original vs reconstructed clouds and error vectors
(exaggeration is labelled). Accuracy is measured, never asserted.
