# ESSP 150-drone show — product benchmark

Date: 2026-09-21  
Source: owner-supplied `ESSP_8_12_mainv4_2f6001(5).zip`  
Scope: read-only product analysis; no source trajectories or RGB payloads are committed.

## Why this reference matters

This archive is the primary behavioral benchmark for Drone Show Designer. It is not only evidence
for the observed ESSP byte layout. It demonstrates how a real 150-drone show is structured:
formation dwell, image-to-image transitions, coordinated motion, per-drone colour and the relation
between motion and lighting.

All scene labels below are analytical or visual hypotheses. ESSP contains samples, not the original
storyboard or semantic names, so the application must never present inferred intent as fact.

## Verified source facts

| Property                      |                                             Observed value |
| ----------------------------- | ---------------------------------------------------------: |
| Drone files                   |                                150 (`1.essp` … `150.essp`) |
| Position clock                |                             8 Hz, 4,746 samples, 593.125 s |
| RGB clock                     |                             12 Hz, 7,120 samples, 593.25 s |
| Launch layout                 |                       regular 15 × 10 grid, 2.10 m spacing |
| Spatial envelope              | X −49.35…49.83 m; altitude 0…88.30 m; depth −15.63…20.54 m |
| Maximum sampled step/speed    |                                        0.526 m / 4.210 m/s |
| Minimum sampled pair distance |                                        1.987 m at 18.125 s |
| Codec verification            |            150/150 files byte-perfect after parse → encode |

### Common presentation-plane tilt

The images are not authored in a perfectly vertical X–Y plane. A least-squares/PCA plane fit on
representative settled frames (32, 90, 168, 216, 267, 319, 374, 427, 475 and 526 s) finds a stable
tilt of approximately **14–15° from the frontal plane** in most scenes. In studio coordinates the
dominant relation is `Z ≈ −0.26 × Y + constant`: as altitude increases, the upper part of the image
moves toward negative Z. The X contribution is normally near zero, so this is primarily a rotation
around the X axis, not a sideways yaw.

Frames with strongly three-dimensional content have larger residuals around the fitted plane, but
retain the same underlying inclination. This is present in the decoded positions, not introduced by
the 2D plotting projection. Product implication: formation authoring needs an explicit audience
presentation plane (position + yaw + pitch/tilt), and front preview must project through that plane
rather than silently flattening all formations onto world X–Y.

The differing 0.125 s position/RGB endpoints are preserved. Colours remain sample-and-hold on the
12 Hz source clock; position playback remains linearly interpolated on the 8 Hz source clock.

## Macro choreography

The conservative forensic preset is the useful high-level reading: 33 inferred segments, including
11 long static/near-static formations, 7 major formation transitions, 11 translation phases,
takeoff/staging and two-part landing. The balanced preset deliberately exposes micro-motion and
produces 138 segments; it is useful for inspection, not as an automatic storyboard.

After the opening section, the show repeatedly uses this grammar:

1. settle into a readable silhouette;
2. hold or animate colour/micro-motion for roughly 38–45 seconds;
3. concentrate geometric change into a roughly 7–12 second transition;
4. settle quickly into the next silhouette.

Representative broad intervals (boundaries are heuristic and overlap by the analysis window):

| Time (s) | Observation                                                     | Product lesson                                                  |
| -------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| 0–31     | ascent plus large fleet translation/deformation                 | takeoff is choreography, not only a vertical phase              |
| 31–77    | elevated staging with strong LED activity and local deformation | allow motion/lighting inside a nominal hold                     |
| 77–88    | full-fleet transition; ~23.16 m net shape change                | transitions need first-class preview and diagnostics            |
| 92–131   | extended global/rigid travel in short phrases                   | preserve rigid group motion without rebuilding points           |
| 131–143  | full-fleet transition; ~20.18 m net shape change                | scene boundaries should expose motion and colour together       |
| 149–187  | long readable image with continuing colour/micro-motion         | a formation is not equivalent to a frozen frame                 |
| 187–194  | 7.25 s full-fleet transition                                    | fast scene-to-scene authoring is a core workflow                |
| 194–239  | long stable image (~44.75 s)                                    | reusable formation plus independent effect lanes is appropriate |
| 239–246  | 7 s full-fleet transition                                       | assignment/easing must be inspectable at the boundary           |
| 245–289  | long image with internal evolution (~44 s)                      | support partial/group dynamics during holds                     |
| 289–298  | large coordinated move (~12.73 m centroid travel)               | global transform and internal morph can coexist                 |
| 298–342  | another long display block (~43.75 s)                           | authoring should be scene-oriented, not raw keyframe-oriented   |
| 341–352  | full-fleet transition; ~21.84 m net shape change                | transition templates should be benchmarked against real timing  |
| 352–396  | repeated rotation/static phrases                                | rotation and stop/start rhythm should be easy to author         |
| 396–406  | full-fleet transition; ~23.06 m net shape change                | show a correspondence/trajectory preview before commit          |
| 406–449  | long image with strong per-drone colour diversity               | group masks and spatial colour fields are essential             |
| 451–453  | short high-energy transition                                    | editor must handle both short accents and long morphs           |
| 453–497  | long image with active lighting (~44.5 s)                       | decouple geometry duration from lighting evolution              |
| 497–505  | coordinated transition/translation                              | one transition may combine multiple motion components           |
| 504–549  | final long image (~44.5 s)                                      | text/logo-like content is a normal production use case          |
| 549–593  | staged descent and final landing                                | landing may contain an intermediate visual phase                |

## Visual reading

Front-projection snapshots (studio X versus altitude) show materially different silhouettes:
outline/emblem-like vertical figures, a multi-arc motif, wave/heart-like repeated curves,
key/tool-like and hourglass/tower-like vertical figures, a long vehicle/boat-like outline, and
wide text/logo-like arrangements. These names are visual hypotheses only. The reliable conclusion
is that the show mixes outline figures, repeated motifs, text-like layouts, multiple disconnected
parts and negative space; the editor must support all of those without manual placement of 150
individual points.

## Lighting observations

- RGB is genuinely per drone: at representative seconds the show uses more than 100 distinct lit
  RGB triplets; around 422–447 s, 144–146 distinct colours appear among 149–150 lit drones.
- Peak sampled mean brightness occurs around 207–235 s and 318–338 s; all 150 drones are lit in
  those samples.
- Colour continues to change through geometrically stable sections. Lighting therefore needs an
  independent timeline/clock and cannot be stored only as a formation colour.
- The current forensic `changeEventTimes` threshold reports zero discrete events for this archive,
  despite strong continuous colour evolution. This is an analysis limitation: a continuous gradient
  or travelling field should not be forced into isolated event detection.
- Required future measurements: dominant palette over time, hue/brightness velocity, spatial
  gradient direction, travelling-wave speed, group coherence and fade/sweep boundaries.

### Read-only spatial RGB evidence (2026-10-25)

`native/spatialRgb.ts`, exposed as `sourceSceneEvidence(...).lighting.spatial`, now measures
an **observable affine RGB field**, not an effect recipe. Every original RGB tick in the binding's
half-open interval `[referenceStart, referenceEnd)` is evaluated, including travel. Its original
RGB bytes are paired with XYZ linearly interpolated on the independent position clock and mapped
to studio metres. Missing RGB/XYZ and timestamps after a drone's final XYZ sample are excluded,
not extrapolated. Frame range, paired frames/samples and first/last paired timestamps expose coverage.

For each tick the fit is `RGB = meanRGB + G × (position − centroid)`, using centered least squares
and a minimum-norm pseudoinverse. Position covariance modes below `max(1e-8, largest × 1e-6)`
are discarded, so a planar formation does not invent a gradient normal to its observed plane.

- **Spatial coherence:** mean and minimum of `clamp(1 − residual RGB energy / centered RGB energy,
  0, 1)` over eligible frames. This is linear explained variance, not neighbor coherence or proof
  of a semantic effect. Require at least 12 paired drones and an observable positional mode.
- **Uniform:** centered RGB energy per drone below 1 byte²; direction, strength and coherence
  are null. Tiny quantization differences do not establish a meaningful spatial direction.
- **Supported gradient frame:** coherence ≥0.85; each non-uniform channel separately has fit
  ≥0.85; the dominant eigenvalue of `GᵀG` explains ≥90% of gradient energy; at least
  `max(12, 4 × (spatial rank + 1))` paired drones. Orthogonal multichannel gradients and nonlinear
  patterns are not forced into a single direction even when aggregate coherence is high.
- **Direction/strength:** dominant unsigned studio XYZ unit axis of `GᵀG`, and its singular
  value in RGB Euclidean bytes/metre. The largest absolute axis component is positive for
  deterministic sign. This is not an identified sweep's travel direction. A clip exposes these
  only if ≥80% of paired frames support a gradient and axial stability is ≥0.95 (dominant
  eigenvalue of the mean direction outer-product matrix).
- **Temporal change:** consecutive supported ticks only, with equal paired count and spatial rank;
  never bridge unsupported ticks or clip boundaries. Mean Euclidean RGB change/second is evaluated
  at the midpoint of consecutive centroids in world coordinates. Mean Frobenius change of `G`
  is reported in RGB bytes/metre/second, avoiding confusion with drone velocity.
- **Apparent field speed:** least-squares iso-color speed `−dot(dRGB/dt, G×axis)/|G×axis|²`
  in metres/second projected onto the reported axis. Return null unless axes align ≥0.98,
  gradient changes ≤5% per tick and unexplained temporal RGB change is ≤10% (absolute numerical
  tolerance 1e-6); ≥80% of supported consecutive pairs must pass. This is conditional apparent
  field drift, not drone speed, a wave detector, or evidence of an authored effect.

Statuses explicitly distinguish no paired samples, insufficient evidence, uniform, low/unstable
fit and supported gradient. `recipe` remains **UNKNOWN** throughout. Memory is O(drone count),
runtime O(original RGB ticks × drone count), with fixed-size matrix work; no all-pairs search,
persisted fit, raw sample mutation or source resampling. Existing scene RGB counts remain exact.

**Actual saved-project check:** 150 drones, all 23 original saved bindings, 5,841 RGB ticks,
598 ms total / 93 ms longest binding in sandbox Bun (single measured run, not a browser latency
promise). All 23 reported LOW_OR_UNSTABLE_FIT, rather than inventing a single gradient.
Reference layer/report and 150/150 reconstructed ESSP files remained identical. This saved project
has a different position clock from the raw benchmark; it does not substitute for an interval-by-
interval audit of the original archive or the opt-in 25-clip projection.

**Limits:** RGB bytes are not calibrated light intensity or perceptual hue; no gamma conversion,
nonlinear/multi-group field recognition, active-drone masks, palette naming or recipe inference.
Fits are in-sample diagnostics, not confidence probabilities; accidental correlations remain
possible. A minimum-norm planar fit says nothing about its unobserved normal or field behavior
outside sampled positions; field speed is conditional on that extension. Short clips have little
temporal evidence, changing planes/geometries can confound drift, and whole-clip aggregation can
hide brief changes (minimum coherence and support coverage help expose this). Next: measure the
original benchmark by interval, inspect low-fit/multigroup cases and design localized diagnostic
presentation; do not change canonical lighting or import defaults on these measurements alone.

### Original ZIP interval audit (2026-10-25)

The agent actually accessed owner-uploaded `ESSP_8_12_mainv4_2f6001-2.zip` and
`ESSP_8_12_mainv4_2f6001.zip`; both have SHA-256
`0055f8ce360ac2adebcfdaff866b3715ac18df7bbedb91ef7fac465f11af2c9a`.
The first was audited, not the saved editor project. The historical `(5).zip` filename above
has no recorded checksum: identity with that earlier upload cannot be established from its name.
Observed payload facts match 150 files, 4,746 XYZ samples at 8 Hz and 7,120 RGB samples at 12 Hz.
All 150 reconstructed files were byte-identical; the archive checksum was unchanged after audit.

Reproduce locally (Bun CLI, never an app/server endpoint):

```sh
bun scripts/auditEsspRgb.ts original.zip /tmp/essp-rgb-audit 0055f8ce360ac2adebcfdaff866b3715ac18df7bbedb91ef7fac465f11af2c9a
```

Reports: [JSON](audits/essp-original-rgb-0055f8ce.json) and
[Markdown](audits/essp-original-rgb-0055f8ce.md). Two independent runs produced byte-identical
JSON and Markdown. Reports contain aggregate evidence and per-file hashes, not source tracks.
279 summaries: full show, all 21 numeric broad benchmark intervals, all 138 current balanced
forensic segments, and 119 non-overlapping 5-second windows (last window truncated).
Overlapping benchmark/forensic summaries are not additive. Native ticks are half-open;
full-show stop is sampleCount/rate to include the last RGB sample, never extrapolating XYZ.

New diagnostic definitions: per-channel mean centered variance and mean squared residual
in byte² per paired drone; mean channel fit over non-uniform eligible ticks; total
energy-weighted fit `clamp(1 − sum residual / sum centered energy, 0, 1)` over eligible frames.
Color distribution reports top eight exact byte triplets, distinct triplets per tick,
largest exact-color group fraction, and dark fractions for all RGB and paired RGB separately.
Groups are descriptive, not inferred masks. Tick reasons prioritize no-pairs, uniform,
insufficient fleet/geometry, a non-uniform channel below 0.85 fit, then multi-axis gradient
energy below 0.9 dominant share. These are model limitations, NOT nonlinear effect recognition.

Results: 1,068,000 original RGB samples; 1,067,700 paired (99.9719%), 7,118/7,120 ticks paired.
Only the final two RGB ticks lack XYZ coverage (300 samples); they remain in the RGB counts.
7,116 ticks fail at least one channel's linear-fit threshold, two paired ticks have insufficient
geometry/gradient support, zero support one stable gradient. Every interval/window reports
LOW_OR_UNSTABLE_FIT. Energy-weighted full-show fit is 18.4464%; mean R/G/B fits are
15.9064% / 17.0553% / 14.8295%. This is not primarily missing-clock coverage or uniformity.
It is strong evidence against a single fleet-wide affine field; it does not prove authored groups.

Full-show exact dark fraction is 33.3774%, 30,939 distinct RGB triplets across time.
In 406–449 s, mean simultaneous distinct colors is 128.056 (range 22–148), dark fraction
10.1227%, mean largest exact-color group fraction 10.9535%: high diversity with weak global fit.
No direction/sweep/recipe is claimed. The 23 saved bindings remain a separate source; this
archive audit explains the same model limitation but does not re-audit those saved intervals.
Next: inspect local-neighborhood/group-conditional fit with explicit support and held-out checks,
not loosen global thresholds or generate guessed effects. Existing spatial RGB UI stays unchanged.

## Capability mapping

| Observed pattern                                   | Existing foundation                                          | Product gap / next acceptance target                              |
| -------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| long scene with independent colour evolution       | scene clips + canonical lighting effects                     | overview that presents geometry and LED story together            |
| 7–12 s full-fleet morphs                           | assignment strategies, min-jerk planner, transition analysis | one-click transition preview comparing paths, duration and easing |
| global move plus internal morph                    | dynamic formations + transition overrides                    | layered motion authoring with explicit global/local decomposition |
| repeated partial movement inside a hold            | point groups + motion effects                                | direct creation of groups from observed/selected visual parts     |
| 100+ simultaneous per-drone colours                | `COLOR_SWEEP`, directional reveal, blend modes               | spatial colour-field editor and richer multi-group gradients      |
| continuous LED animation without discrete cuts     | independent canonical lighting engine                        | continuous lighting analyzer and visual curve/heatmap             |
| outline, repeated motifs and text/logo-like scenes | visual compiler, text and figure library                     | reference-driven templates and faster multi-part composition      |
| common ~15° tilted presentation plane              | audience camera and site viewing direction                   | explicit formation tilt and audience-projected authoring          |
| staged takeoff/landing                             | canonical phases                                             | phase authoring that permits validated intermediate visual beats  |

## Product priority derived from the show

1. **Reference storyboard view:** readable macro segments with geometry and lighting tracks together;
   conservative segmentation by default, balanced detail on demand.
2. **Transition authoring:** correspondence preview, duration/easing comparison and global/local
   motion decomposition, validated against the observed 7–12 s transition family.
3. **Spatial lighting:** visual colour-field/sweep editor, group masks and continuous animation
   diagnostics capable of representing the 100+ colour states in this show.
4. **Formation composition:** multi-part outline/text/logo workflows and reusable visual groups.
5. **ESSP-derived pattern library:** save generic reconstructed formations/effects with provenance,
   never raw source payloads or invented semantic names.

## Limits

- This is one show, not a universal style guide.
- Segment boundaries are heuristic; the conservative and balanced presets serve different purposes.
- Semantic figure names are not encoded in ESSP and require owner confirmation if names matter.
- The archive is an analysis reference, not evidence of vendor certification or flight safety.
