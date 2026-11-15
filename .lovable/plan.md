# Plan: Phase A (scene = clip) + Phase B (imported show is editable)

## What the code shows today (checked this turn)
- Phase A is mostly done already: `extract.ts` has `DEFAULT_MIN_SCENE_SECONDS = 0` and `displayedSceneSegments(report, …)` (lines 118–239). Still missing: the Timeline overlay (`Timeline.tsx:867`) draws the raw `forensicsReport.segments`, not the same projection. Until it does, "clip = displayed scene" is only true by coincidence.
- Finding 1 is correct: `applyReferenceExtraction` (`store.tsx` around line 4922) spreads `...previous` and never sets `limits`, `area` or `altitudes`. The defaults are 140x140x100 m, takeoff/show/landing at 15/40/0 m, and v12 / a5 / j10 / yaw90 / sep 2.5 / alt 2–95.
- Finding 2 is half right. The static checks in `evaluateGeometryApplyReadiness` already compare against the state before the edit (`introducesArea/Altitude/PairSeparationViolation`). The absolute checks are the trajectory ones: `after.status==="FAIL"`, `exportReadiness==="BLOCKED"`, `blockingIssueCount>0` and `canonicalProfilePass`. `delta.*` is used only for warnings today. `validateAgentProject` is fully absolute. `applyMove/applyScale` (`operations.ts` lines 512–581) checks `sepAfter < limits.minSeparation`.
- Finding 3 is correct: `signature.ts` lines 135–142 hash `droneCount` plus all limits. So does `assignmentStrategy`.
- Finding 4: this matches the 45–51 s Apply time I measured in the browser earlier. Not fixed in this phase.

## A. Files and functions, in order
1. `src/lib/import/essp/native/extract.ts`: export `displayedSceneSegments` as the only scene projection.
2. `src/components/studio/Timeline.tsx`: the overlay uses `displayedSceneSegments(forensicsReport)`.
3. NEW `src/lib/import/essp/native/safetyProfile.ts`: a pure function `deriveImportedSafetyProfile(show)` that returns `{ area, altitudes, limits, measured, source:"IMPORTED_SHOW" }`. It reads only the source samples and is not persisted to the report.
4. `src/lib/show/types.ts`: optional `ShowProject.safetyProfile?: { source:"IMPORTED_SHOW"; measured: {...}; derivedAt }`. Older projects stay valid. Save/load/history go through the existing serializer.
5. `store.tsx` `applyReferenceExtraction`: set `area/altitudes/limits/safetyProfile` on `next` BEFORE `reseedReferenceSignatures`. Keep a single `pushSnapshot(previous)`.
6. `geometryApplyReadiness.ts`: add a "do not worsen" mode (section C).
7. `src/lib/agent/validate.ts`: `validateAgentProject(candidate, clipId, baseline?)`, compared relative to `baseline`.
8. `src/lib/agent/operations.ts` `applyMove/applyScale`: relative separation and altitude checks.
9. `AgentPanel.tsx` and the Inspector call sites: pass `before` and `baseline`.
10. `Inspector.tsx`: a "Safety profile" card.
11. Tests, `HANDOFF.md`, `roadmap.md`, and `AGENTS.md` (one rule for the profile and one for "do not worsen").

## B. Step 1: derivation rule
The values come from samples of the imported show (all drones, every source frame, show segment from takeoff to landing):
- `area`: width/depth = 2·max|x| and 2·max|z|, height = max y. Add a 5 m margin and round up to the next metre. Never smaller than what was measured.
- `altitudes`: takeoff = the median height at the end of the takeoff clip, show = the median height of the scenes, landing = 0.
- `minSeparation = min(DEFAULT 2.5, floor_0.05(measured minimum in the air))`. Takeoff and landing on the ground are excluded, using the same rule as the existing analysis.
- `minAltitude = min(DEFAULT 2, floor_0.1(minimum airborne height))`, `maxAltitude = max(DEFAULT 95, ceil(max y))`, capped at the area height.
- `maxVelocity/Acceleration/Jerk/YawRate = max(DEFAULT, ceil_0.1(measured max · 1.0))`. These limits only loosen up to the show itself; they are never stricter than the default and never looser than measured.
- Real numbers: I have NOT measured them in this planning turn. The first implementation step runs the function read-only on `ESSP_8_12_mainv4_2f6001-2.zip`, reports the actual table (extents, altitudes, separation, v/a/j/yaw) and puts it in a test with tolerances. The roadmap only records 2.39 m separation and scene 11 below 2 m. I will not claim anything else until I have measured it.
- Inspector: a card labelled "Profile derived from the imported show: validated against this profile, NOT flight authorization". It shows measured value / applied value / default for each field. The same wording appears in the agent preview and in the readiness report `note`.

## C. Step 2: "do not worsen" gates
Shared rule: relative mode turns on ONLY when `project.safetyProfile?.source==="IMPORTED_SHOW"`, the edit touches a REFERENCE-derived clip, AND `before` evidence exists for the same project. Otherwise the current behaviour (absolute, fail-closed) stays unchanged.
- `evaluateGeometryApplyReadiness`. Relative mode replaces the 4 absolute blockers with:
  - `after.blockingIssueCount > before.blockingIssueCount`
  - `delta.totalConflictCount > 0`
  - `delta.minimumDynamicSeparation < -1e-9` while `after.minSep < limits.minSeparation`
  - status worse than before (PASS < WARN < FAIL)
  - export BLOCKED when it was not before

  `spliceOk===false`, the point-count check, the static checks and the promotion acknowledgement stay blockers in both modes. Velocity, acceleration and jerk become blockers in relative mode if they rise above `limits`, otherwise they stay warnings.
- `validateAgentProject(candidate, clipId, baseline)`: count the points out of bounds or out of altitude in the clip in both projects (same sampling). Refuse if the count rises, or if a new issue type appears that the baseline did not have. NON_FINITE always refuses. Without a baseline: absolute, as today.
- `applyScale/applyMove`: the refusal becomes `sepAfter < min(limits.minSeparation, sepBefore) - 1e-9`. A scene already below the limit may grow or move, but its separation cannot drop further.
- Tests:
  - an imported scene already under 2 m / with separation 2.39 is moved 1 m sideways → allowed
  - the same scene moved 3 m down, adding points below the minimum → refused
  - shrinking ×0.8 that reduces the separation → refused
  - growing ×1.2 → allowed
  - a native project with an absolute violation → still refused, same reason
  - imported project with no `before` → refused (fail-closed)
  - readiness with `after.blockingIssueCount === before` → canApply; with `+1` → blocked

## D. Tests
- Change: `extract.test` (the overlay/clip count uses the shared projection), `geometryApplyReadiness.test` (existing cases now say explicitly that they run in absolute mode), `moveScale.test` (separation check is relative), `agent.test` (validate signature).
- Add:
  1. Every clip `[start,end]` equals `displayedSceneSegments` within 1e-9, and the Timeline overlay uses the same list.
  2. After extraction with the derived profile, `newlyPromotedClipIds` is empty and every clip is REFERENCE.
  3. One Undo restores the exact pre-extraction project (deep-equal, including limits/area/altitudes).
  4. `sampleReferenceShow` positions and RGB at 50 times (plus frame boundaries) are identical before and after extraction.
  5. The source ESSP bytes (hash) and the saved forensics report (deep-equal/frozen) are unchanged.
  6. A deterministic profile test on a small synthetic show, plus a test with tolerances on the real file.

## E. Risks and where I disagree
- Disagreement 1: Phase A is no longer "to do" as a rule, only the overlay is. I recommend we do not rewrite `extract.ts`.
- Disagreement 2: the static gates are already relative. Only the trajectory part changes.
- Risk with the profile and Step 3: today every REFERENCE clip has a signature that includes the limits. If the user later changes a global limit, everything is promoted. Phase B does not touch the signature. The profile is set before reseed, so extraction promotes nothing. For Step 3 (owner-aware signature) I keep `safetyProfile` separate from `limits`, so it is clear later which fields can be ignored for REFERENCE clips. In the meantime, the Inspector warns that editing a global limit on an imported show can promote clips.
- Risk with loosened limits: a profile that is too permissive could hide real problems in native clips added later. The rule never goes above what the show itself measured, and the label states clearly that this is not flight authorization.
- Static/dynamic rejoin: a move/scale on a 1 s scene changes the boundary with its neighbours. With REFERENCE neighbours, the splice may break (`spliceOk` stays a blocker) or promotion may be needed (an explicit acknowledgement stays required). There is no automatic re-planning of imported trajectories.
- Undo: extraction is still exactly one snapshot. The profile lives inside the project, so Undo removes it too. History is not rewritten.
- Step 5 (windowed analysis in a worker): the "do not worsen" gates only read `before/after/delta` summaries. Later these can be computed on a window without changing the gate contract. I am deliberately not adding any dependency on a full-show-only count beyond `blockingIssueCount`.
- Limit: the agent's dynamic separation is sampled (2 Hz, at most 40 steps). It is not an exhaustive certification.

## Recommendation
Implement in this order: A2 overlay → B1 profile (with the real numbers measured and reported first) → B2 gates → tests → docs. Verify in the browser: Make editable → move/scale an imported scene → Apply → Undo.
