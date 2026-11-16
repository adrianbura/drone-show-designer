# Windowed incremental re-analysis

Read and obey [_COMMON.md](_COMMON.md) in full before proceeding. Inspect [CONTINUATION](../CONTINUATION.md), actual code and current status; older findings are hypotheses until confirmed. Follow the explicit mode supplied with this prompt; absent mode, plan first and wait for approval.

## Goal
Reduce Apply/Undo latency without reducing full export validation coverage.

## Context (files)
`src/lib/studio/store.tsx`; `src/lib/studio/fullShowAnalysis.ts`; `src/workers/fullShowAnalysis.worker.ts`; `src/lib/show/diagnostics/geometryTrajectoryConsequence.ts`; `src/lib/show/fullshow/*`; history restore tests. Historical headless Apply/Undo ~25–51 s, not a standardized baseline.

## Tasks
1. Profile Apply and Undo separately on owner ZIP after P01/P05 correctness baseline: repeated same-group edits, median/p95, main-thread blocking, worker transfer, composition/analysis breakdown.
2. Plan a windowed analysis keyed by revision, ownership and edited binding closure. Include connecting transitions, derivative stencil radius, spatial conflict margin, source-clock alignment and affected-neighbor dependencies; explain why outside results remain valid.
3. Execute analysis in a worker with cancellation/stale-result rejection. Cache only evidence with valid revision/window keys; ownership/history restores invalidate correctly.
4. Keep complete analysis on demand AND mandatory before export; incremental results cannot satisfy full export eligibility.
5. Compare window findings against complete analysis for moves/scales/rotations, boundary conflicts, duration/global changes and Undo. Global/topology changes fall back to full analysis.
6. Re-measure identical machine/data/settings; establish whether ≤5 s is feasible before promising it.

## Acceptance (measurable)
Proposed target: median Apply AND Undo ≤5 s on the real archive, with p95/sample count disclosed; confirm against baseline. No missing new conflict/continuity violations compared with full analysis, stale work never installs, single Undo restores state. Every export still demands a fresh full report. Report target miss honestly.

## Do-not list
No fewer safety samples merely for speed, window masking, silent stale cache reuse, export using partial analysis, source retiming or unmeasured performance claims.

Deliver the standard final report from COMMON/README, including real evidence, unverified work and credits; update continuation/HANDOFF/roadmap only after actual approved work.
