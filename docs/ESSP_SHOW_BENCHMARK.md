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
