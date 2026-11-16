# Browser verification pass

Read and obey [_COMMON.md](_COMMON.md) in full before proceeding. Inspect [CONTINUATION](../CONTINUATION.md), actual code and current status; older findings are hypotheses until confirmed. Follow the explicit mode supplied with this prompt; absent mode, plan first and wait for approval.

## Goal
Verify the real operator flow through valid exported ESSP, not just source tests.

## Context (files)
`src/components/studio/{EsspPanel,Timeline,AgentPanel,Inspector}.tsx`; `src/lib/studio/store.tsx`; current end-to-end test infrastructure. Previous browser MOVE Apply/Undo exists; export and rotate/scale do not.

## Tasks
1. Use owner ZIP in the running app. Capture environment, viewport, archive hash and page errors; baseline before changing any code.
2. Drive import → Make editable → shared group bars → selection → MOVE/ROTATE/SCALE via Agent; verify group members and common pivot, preview, Apply, Undo and read-back ownership/numerical state.
3. Exercise relevant Inspector path separately; do not imply group-aware Inspector behavior if absent. Check confirmation/unsaved-work and failure states.
4. After P01/P05, perform real full validation → export/download → re-import and compare through permanent fidelity script/UI. Verify blocked unsafe edit remains nonexportable.
5. Record screenshots at key states and timings for each action; inspect screenshots, include browser runtime/network errors. Fix only reproduced bugs, each with focused regression tests.

## Acceptance (measurable)
Evidence for each listed action including successful edited export and re-import, unchanged source, one Undo, correct group membership, visible errors/refusals and nonoverlapping controls at desktop/mobile. Exact screenshots/commands/timings available. Mark unavailable hardware/auth/input or unexercised paths plainly.

## Do-not list
No demo-only substitution, signed-out/empty state claimed as verified, guessed selectors/state, source-only evidence presented as browser success, UI redesign or unrelated backend work.

Deliver the standard final report from COMMON/README, including real evidence, unverified work and credits; update continuation/HANDOFF/roadmap only after actual approved work.
