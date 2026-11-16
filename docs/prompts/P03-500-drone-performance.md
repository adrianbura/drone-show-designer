# 500-drone performance

Read and obey [_COMMON.md](_COMMON.md) in full before proceeding. Inspect [CONTINUATION](../CONTINUATION.md), actual code and current status; older findings are hypotheses until confirmed. Follow the explicit mode supplied with this prompt; absent mode, plan first and wait for approval.

## Goal
Remove the top measured render/analysis/memory bottlenecks at realistic fleet sizes.

## Context (files)
`src/components/studio/Viewport3D.tsx`; `src/lib/show/{conflicts,safety}.ts`; `src/lib/studio/fullShowAnalysis.ts`; `src/workers/*`; `src/hooks/useNarrowWorkspace.ts`. Locate actual mesh/sampler call sites before editing.

## Tasks
1. Baseline browser at 150/300/500 drones with reproducible legitimate projects, same machine/viewport/playback/settings. Do not inflate real imported drone count and pretend it remains the same archive.
2. Record frame-time median/p95, paused redraw behavior, analysis duration, JS heap/retained objects where available, main-thread tasks and worker messages. State software-renderer limitations.
3. Verify actual single instanced fleet mesh, no duplicate canvas/mesh rendering, spatial-hash separation path and worker use; document evidence rather than assumptions.
4. Fix only ranked bottlenecks: instance updates/allocation, memoization, partitioning/transfer/cancellation if justified. Preserve selection, LED fidelity, seek and playback.
5. Rerun baseline workload and full export tests at unchanged sample clocks.

## Acceptance (measurable)
Publish a before/after table for all fleet sizes, reproducible scripts and resource limits. Top targeted bottleneck measurably improves; unrelated sizes do not regress beyond measured noise. Selection/seek/LED/playback and complete safety findings unchanged; no blank 3D view. No universal FPS promise without hardware evidence.

## Do-not list
No arbitrary drone dropping, altered positions/RGB, safety-rate reduction, multiple decorative viewports, speculative rewrites or unsupported GPU claims.

Deliver the standard final report from COMMON/README, including real evidence, unverified work and credits; update continuation/HANDOFF/roadmap only after actual approved work.
