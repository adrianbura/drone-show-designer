# Common preamble — read before every P01–P10

You are continuing Drone Show Designer. Read AGENTS.md → docs/CONTINUATION.md → roadmap §23 → last HANDOFF section; satisfy AGENTS' broader initial read requirements too. Inspect latest commit, status/diff and task-relevant code before acting. Verify assertions from code/runtime, not earlier assistant prose. Honor explicit PLAN ONLY / plan_mode: no source edits or source commits until approved.

## Non-negotiable constraints

- Goal: imported ESSP show editable AND valid export; untouched import byte-identical. No flight-authorization claims or unverified aircraft compatibility promises.
- No invented effect recipes. Recorded RGB/source bytes/saved forensic report preserved; keep XYZ and RGB clocks independent, headers/counts/rates/durations and unknown payload fields intact.
- Dynamic groups are derived; per-segment clips/bindings/signatures remain. Never merge static with dynamic or re-plan untouched imported trajectories.
- No weakening gates for speed or acceptance: no silent limit widening, skipped takeoff validation, fake passing reports, discarded conflicts or expected-failure camouflage.
- Relative editing only with imported + reference-derived target + before evidence; missing evidence/native targets fail closed. Full computed export always requires fresh complete full-show analysis of actual effective output.
- Measure baseline → change → remeasure on the same machine/data/settings. Separate source-clock output measurements from analytic planner derivatives; include browser main-thread, worker, memory and latency where relevant.
- Run targeted regressions, full suite `bunx vitest run --maxWorkers=4 --testTimeout=30000`, and `tsgo -b --noEmit` where allowed. Run lint and configured build locally/CI; Lovable agents must obey harness restrictions and report automatic checks separately from commands not run.
- Preserve untouched real-file byte identity: 150/150 via `bun scripts/esspExportFidelity.ts <owner-zip>`. Run `--edit` for actual edited evidence. Currently the script prints failures without enforcing all via nonzero exits: inspect results, not exit status alone. No real ZIP in repo; missing owner ZIP is an explicit blocker, never substitute synthetic results and claim real success.
- Add concrete rule/regression tests, not styling/copy snapshots. Reproduce → diagnose → fix → rerun. Review delegated work and integrate/verify the whole package.
- Update continuation evidence; append HANDOFF and roadmap in the same intervention after prior changes. AGENTS only for stable architecture/rules, not progress. No force push/rebase/amend/history rewrite or touching another assistant's branch.
- One commit per approved implementation prompt is the desired unit. Respect the executing environment's Git restrictions; Lovable commits automatically. Report actual commit/sync status and inability to guarantee a single commit rather than bypass restrictions.

## Required final report

Root cause/evidence; files changed; numbers before/after with dataset/machine/settings; exact tests/commands and results; what is NOT verified and blockers/next step; credits used with attribution/window limits (or unavailable); actual commit status. Write chat in Romanian, docs in English. Never say “complete” when real edited export remains blocked.
