# Plan: Editable imported show — grouped dynamic scenes with an unchanged export

## A. Measured on ESSP_8_12_mainv4_2f6001-2.zip (run read-only this turn)
- 150 drones, XYZ clock at 8 Hz. 138 forensic segments: 45 STATIC, 41 TRANSLATION, 20 DEFORMATION, 8 RIGID, 5 ROTATION, 14 TRANSITION, 1 TAKEOFF, 4 LANDING.
- Scenes shown on the timeline today: **119** (45 static + 74 dynamic), plus takeoff and landing. 53 of them are 2 s or shorter; the median is 2.25 s.
- Order of the scenes (S = static, T = translation, R = rotation, M = rigid motion, D = deformation):
  `MTSDSSDSDSDSDDDDDDDSMTMTMTMTMTMTTTSDDDDSSTSSDSSTSDDSTSTSSTSTSTTTSSSSSSSTSTSTSTSSRSRSRSRSTSRTSTTTTTTTTTTTTTTTSTSSSSDDMST`
- **Your proposal as written (consecutive dynamic scenes + the same visual identity, existing 0.4 m tolerance) merges only ONE pair: 119 → 118** (127.75–129.75 s, 2 translations).
  - For neighbouring dynamic scenes, the maximum identity residual against the previous anchor is 0.30–10.9 m. The median is about 0.9 m, so the shape really changes from one segment to the next.
  - The identity rule therefore does not solve the problem.
- Grouping **all consecutive dynamic scenes** (never with a static one): **78 groups = 45 static + 33 dynamic**. Largest groups:
  - 408.50–450.00 s (15 segments)
  - 90.00–131.00 s (14)
  - 54.00–74.25 s (7)
  - 145.25–152.25 s (4)
  - 176.00–182.00 s (3)
  - 548.50–577.75 s (3)
  - 7.50–28.75 s (2)
  - 161.75–164.75 s (2)
- For comparison: the existing opt-in mode `visualSceneSegments` (which also merges static with dynamic) gives 97.
- Remaining noise is the S/T alternation (for example `STSTST`, an image moving in steps). Reducing it would require merging static with dynamic, which you excluded. I agree with excluding it, see B.

## B. Does the "static + dynamic re-join" blocker apply to dynamic + dynamic?
- Evidence: HANDOFF "Următorul pas exact" item 1. The first symptom was a static hold turned into a dynamic episode, which blocked Replace as Text with `DYNAMIC_CLIP_UNSUPPORTED`. The other 18 regressions came from fixtures that treated a translation as a new image. The roadmap (line 161) says the same.
- With dynamic + dynamic only, **that symptom does not occur**: every member was already a dynamic clip, so Replace as Text was already unavailable for them. No static hold changes type.
- A new problem appears, though, if we merge real clips: a binding has a single `sourceSegmentId`, a single interval and a single signature (`native/types.ts:78–92`).
  - A merged clip would promote its whole span on the first edit.
  - Converting across several classifications would need one dynamic formation built over several segments with different semantics.
  - This changes the clip→binding mapping that `reconcileReferenceLayer`, `reseedReferenceSignatures`, `promoteReferenceClips` and `verifySpliceBoundaries` rely on.

## Recommendation: group in what the designer sees and edits, not in the saved data
- Clips and bindings **stay per segment** (granularity unchanged). The timeline shows ONE bar per group, and editing a group applies the same transformation to every member, in a single Undo.
- Export, splices, signatures and ownership stay exactly as they are. Grouping is a pure authoring/display change, as requested.
- Internal continuity holds when the group is edited: all members receive the same transformation with a **common group pivot** (the group centroid), so internal boundaries do not break. Only the group edges become splices with the reference, which `spliceOk` checks.
- Alternative (if you insist on real clips): one clip per group with one binding over the whole span. It is riskier; I do not recommend it now.

## C. Plan, in order
Phase A — shared projection plus grouping
1. `native/extract.ts`: add a pure `displayedSceneGroups(report)` built on `displayedSceneSegments`. It groups consecutive dynamic segments that touch (gap ≤ 1 position sample). Static segments are never part of a group. Output: `{ id, start, end, kind: STATIC | DYNAMIC, segmentIds[] }`. It reads only the saved report; nothing is persisted.
2. Group membership for clips: a mapping `segmentId → group`, computed from `layer.bindings[].sourceSegmentId`. It is derived, not saved; the project and the layer stay unchanged.
3. `Timeline.tsx`: overlay plus a grouped mode (default) that draws one bar per group. Clicking it selects the group (first clip plus the member list); an "Expand group" option shows the individual clips. The overlay and the bars use the same function.
4. Group editing: `agent/operations.ts` gets an optional `pivot` for ROTATE/SCALE. A new `applyAgentOpToGroup` applies the same op to every member using the group centroid. `AgentPanel` and the Inspector use the group when the selection is a group. It is atomic: one candidate and one Undo.

Phase B1 — safety profile (ALREADY IMPLEMENTED last turn, numbers measured)
5. No change needed. Recorded values: separation 1.987 → 1.95 m, minimum altitude 0.83 → 0.8 m, max altitude 88.3 m (limit stays at 95), velocity 4.21 / acceleration 3.89 / jerk 48.30 → 48.4, yaw unknown, area 140x140x100, takeoff/show altitudes 8.445/42.495 m.
6. Fix: the measured jerk at 8 Hz is largely quantization noise. Proposal: keep the jerk limit at the default (10) and only display the measured value as "unreliable at 8 Hz", unless you decide otherwise.

Phase B2 — "do not worsen" (ALREADY IMPLEMENTED; one condition still missing)
7. Add the missing condition: relative mode only when the edit touches at least one clip with a REFERENCE binding (readiness from `newlyPromotedClipIds`/`before.promotedClipIds`; agent from `layer.bindings`). Edits to native clips inside an imported project stay absolute.

Export fidelity (new)
8. Synthetic test (in the suite):
   - Untouched show: `buildEsspExportPackage` produces bytes identical to the source per drone (same file count, headers, XYZ/RGB clocks and durations), with and without grouping. Grouping does not touch the data, so the test proves the invariant.
9. Synthetic test after editing a group:
   - only the group's bindings are PLANNER, all others REFERENCE;
   - `spliceOk === true` at the edges;
   - the files of REFERENCE intervals are verbatim outside the group;
   - readiness is computed from the real export result (not from the clip list).
10. Round trip: export → `buildReferenceShow` → compare drone count, durations, positions on the XYZ clock and RGB on the RGB clock against the effective trajectory the editor shows (tolerance = int16 quantization for positions, exact for RGB).
11. Real archive: a local script `scripts/essp-export-fidelity.ts` (same pattern as the RGB audit; it does not enter the app). It runs steps 8–10 on the uploaded ZIP and records the results in HANDOFF. The real file is not in the repo, so it cannot be part of the suite.
12. RGB: test that a group edit (move/scale/rotate) leaves `sampledColors`/recorded RGB identical at the former internal boundaries, and that no effect recipe appears. Today's geometric ops do not touch RGB; the test locks this in.
13. `HANDOFF.md`, `roadmap.md`, and one `AGENTS.md` rule: "scene groups are a derived view; clips/bindings stay per segment".

## D. Tests and risks
- Tests to change: `displayedScenes.test` (+ groups: static never grouped, the group ends at the last member), `importedReadiness`/`importedDoNotWorsen` (+ case: native clip in an imported project stays absolute), `moveScale.test` (+ explicit pivot).
- New tests: groups = overlay (same list), group edit = one Undo, internal continuity after rotate/scale with a common pivot, steps 8–12.
- Risks:
  - Members with different easing / playbackRate / dynamicStartOffset / participation are not merged at the data level, so nothing is lost. A group edit applies the transformation geometrically only.
  - A group rotation that is too large can produce a velocity jump at the edges. Readiness blocks this through `spliceOk` and the relative gates.
  - Editing a group promotes all its members (larger planner span). That is correct, because they all changed.
  - Without step 7, an edit to a native clip could get the relative check.
  - The real-archive check stays outside the suite (the file is not in the repo).
- Disagreements:
  1. The identity rule does not group anything useful on this show (119 → 118). I use contiguity of dynamic scenes instead.
  2. I do not recommend merging real clips; the binding granularity must stay per segment.
  3. B1/B2 are already in the code; only the REFERENCE condition and the jerk decision remain.
