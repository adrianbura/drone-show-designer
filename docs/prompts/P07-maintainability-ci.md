# Maintainability and CI

Read and obey [_COMMON.md](_COMMON.md) in full before proceeding. Inspect [CONTINUATION](../CONTINUATION.md), actual code and current status; older findings are hypotheses until confirmed. Follow the explicit mode supplied with this prompt; absent mode, plan first and wait for approval.

## Goal
Shorten the development loop with behavior-preserving module boundaries and reliable checks.

## Context (files)
`src/lib/studio/store.tsx`; existing history/project-adoption/planning modules and tests; `package.json`; repository GitHub Actions configuration (inspect existence first); framework/bootstrap constraints in AGENTS.

## Tasks
1. Baseline test/lint/build/typecheck runtime and dependency boundaries; propose small concern modules (history, adoption, reference extraction/ownership, planning/analysis) with explicit single authority.
2. Move one coherent concern at a time without behavior changes; preserve React closures, refs, HMR context, state transactions and history semantics. Parallelize only nonconflicting files.
3. Add/adjust behavior tests before extraction, review diff for unintended changes and rerun full correctness/fidelity.
4. Configure GitHub Actions for compatible tsgo, vitest, lint, configured build using locked dependencies. Inspect trigger branch/settings; do not invent secrets. Optional Playwright smoke only with reliable fixtures/resources.
5. Record before/after dev-loop timings and actual CI execution; workflow file creation alone is not a green CI run.

## Acceptance (measurable)
Store concern extraction is behavior-equivalent with all tests/fidelity green; lint clean, reproducible local checks and CI job definitions for type/tests/lint/build. Actual hosted CI status reported verified or unavailable. Measure dev-loop change, no forced arbitrary file-size target.

## Do-not list
No broad rewrites, duplicate stores/authorities, schema changes, framework migration, hidden history behavior change, repository-secret exposure or claiming CI ran without hosted evidence.

Deliver the standard final report from COMMON/README, including real evidence, unverified work and credits; update continuation/HANDOFF/roadmap only after actual approved work.
