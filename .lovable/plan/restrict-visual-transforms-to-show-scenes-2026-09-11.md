# Restrict visual transforms to SHOW scenes

## Goal
Remove the misleading transform workflow from TAKEOFF and LANDING clips while preserving the existing SHOW-scene gizmo preview and larger handles.

## Changes
- Derive authoring availability from the selected clip's canonical phase.
- In Visuals and Transform views, replace editable controls for TAKEOFF/LANDING with: “Transform is available on SHOW visuals. Select or create a SHOW scene.”
- Hide the viewport transform gizmo whenever the selected clip is not SHOW.
- Guard canonical transform gesture and direct transform actions so non-SHOW clips cannot create project or history changes.
- Keep clip timing unchanged.

## Regression coverage
- SHOW Move, Rotate, and Scale persist after gesture commit and change canonical viewport samples.
- One completed SHOW gesture creates exactly one undo entry.
- TAKEOFF and LANDING expose no enabled transform controls and reject transform gestures without project/history mutation.
- Existing live-drone preview behavior and enlarged handles remain intact.

## Technical details
- Reuse `clipPhase()` as the single phase authority.
- Do not alter takeoff/landing trajectory planners, scene resolution, rendering, or transform mathematics.
- Apply the phase guard at both UI and store action boundaries to prevent misleading success through any caller.
