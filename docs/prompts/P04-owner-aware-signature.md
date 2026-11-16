# Owner-aware clip signature

Read and obey [_COMMON.md](_COMMON.md) in full before proceeding. Inspect [CONTINUATION](../CONTINUATION.md), actual code and current status; older findings are hypotheses until confirmed. Follow the explicit mode supplied with this prompt; absent mode, plan first and wait for approval.

## Goal
Prevent non-output global changes from promoting untouched REFERENCE clips.

## Context (files)
`src/lib/import/essp/native/{signature,intervals,types}.ts`; `src/lib/studio/store.tsx`; project serialization/history tests. Current signatures include limits, altitudes, count and assignment strategy for every clip.

## Tasks
1. Enumerate which inputs affect actual output per owner and phase: geometry, timing, recorded RGB versus authored color/effects, participation, drone identity/count, pre-show, strategy and boundary overrides.
2. Plan versioned owner-aware signatures and safe migration/reseeding; avoid using candidate owner to hide a real first edit. REFERENCE output unaffected by global limits/altitudes/strategy stays reference; output-changing edits still promote.
3. Keep planner-owned dependency coverage and derived transition closure. Drone-count/participation changes require explicit capability/safety checks, not automatic immunity.
4. Add tests both ways: unchanged real output/global config preserves owner; timing/geometry/lighting changes promote appropriate clips; global real-output changes still invalidate; Undo/save/open preserve ownership without phantom promotion.
5. Verify untouched byte identity and mixed edited export on owner ZIP.

## Acceptance (measurable)
No promotion for proven non-output global changes to REFERENCE clips. Every tested real-output edit promotes exact affected bindings/transition closure. Signature migration deterministic, no accidental PLANNER→REFERENCE reset; Undo legitimately restores snapshots. Planner validation invalidates on changed limits even when imported ownership stays unchanged.

## Do-not list
No blanket exclusion of all globals, silent ownership demotion, suppressing actual output changes, loss of dependency tracking or disabling baseline safety checks.

Deliver the standard final report from COMMON/README, including real evidence, unverified work and credits; update continuation/HANDOFF/roadmap only after actual approved work.
