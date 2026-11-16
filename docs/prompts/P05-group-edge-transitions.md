# Group-edge transition re-planning

Read and obey [_COMMON.md](_COMMON.md) in full before proceeding. Inspect [CONTINUATION](../CONTINUATION.md), actual code and current status; older findings are hypotheses until confirmed. Follow the explicit mode supplied with this prompt; absent mode, plan first and wait for approval.

## Goal
Make feasible group edits continuous and exportable without re-planning untouched imported intervals.

## Context (files)
`src/lib/show/transition/candidate.ts`; `src/lib/show/trajectory/{schedule,planner}.ts`; `src/lib/show/fullshow/effective.ts`; `native/{intervals,splice}.ts`; `src/lib/studio/geometryApply{Command,StoreTransaction}.ts`; `AgentPanel.tsx`; `agent/operations.ts`. NOT completed by the preceding task; verify actual state before deciding to skip.

## Tasks
1. Reproduce real group 7.5–28.75 s (+0.03 m), incoming velocity mismatch and outgoing 1.217 m gap; inspect source-clock alignment, dynamicStartOffset/playbackRate, assignment identity and internal members. Use measured source XYZ, not default home-pad state.
2. Define pure group-aware preparation against one candidate: reconcile exact binding range, derive necessary incoming/outgoing TRANSITION ownership only, lock drone identities, constrain source/edited endpoint positions AND velocities.
3. Reuse boundary-velocity planner/override schema and prepared atomic transaction; do not call single-clip optimizer independently on every member and assume consistency.
4. Analyze the same effective output that preview/export uses. Check internal boundaries, feasibility at true 1 ms transitions, all motion limits/conflicts and full export gates. If time is insufficient, refuse atomically; retiming or expanding into neighboring holds requires a separate approved plan.
5. Install project+overrides+reference layer in one Undo unit, retain reference holds/RGB outside edited interval, preserve raw source/report. Cover Agent and Inspector paths or explicitly bound scope.
6. Verify MOVE/SCALE/ROTATE on safely feasible synthetic and real cases; unreplanned large jump and infeasible constrained transition must remain refused. If a safe complete pass is not possible, deliver diagnosis only, no half-installed mechanism.

## Acceptance (measurable)
At least one meaningful feasible real group edit exports/re-imports successfully with spliceOk and full gates satisfied; edited interval/necessary transitions only planner-owned, outside reference XYZ/RGB unchanged. Exact endpoint continuity, deterministic state and one Undo restoration tested. A >5 cm unreplanned jump still fails. Explicit refusals and remaining real blocker mean task incomplete, not accepted.

## Do-not list
No blending imported holds, static+dynamic merge, whole-show re-planning, arbitrary transition duration increase, ignored planner hold fallback/errors, limit widening or atomicity split across unrelated effects.

Deliver the standard final report from COMMON/README, including real evidence, unverified work and credits; update continuation/HANDOFF/roadmap only after actual approved work.
