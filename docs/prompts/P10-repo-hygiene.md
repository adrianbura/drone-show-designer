# Repo hygiene

Read and obey [_COMMON.md](_COMMON.md) in full before proceeding. Inspect [CONTINUATION](../CONTINUATION.md), actual code and current status; older findings are hypotheses until confirmed. Follow the explicit mode supplied with this prompt; absent mode, plan first and wait for approval.

## Goal
Remove generated clutter and improve navigation without behavior change.

## Context (files)
`simulation_bridge` tracked Python caches (confirmed in git ls-files); `.gitignore`; `HANDOFF.md`; `docs/audits`; generic `package.json` name `tanstack_start_ts`; continuation links. This prompt is FUTURE work, not permission to delete during the docs-only setup.

## Tasks
1. Inventory tracked __pycache__/.pyc, document/audit sizes and links; distinguish generated artifacts from source/evidence. Produce reviewable list first.
2. Remove tracked caches using the executing environment’s permitted mechanism and add ignore rules; do not delete Python source or hand-written fixtures.
3. For oversized HANDOFF/audits, archive historical material preserving every evidence file and a pointer/index. Prefer additive archival documents; get approval before moving/deleting originals. Keep newest state and canonical handoff references easy to find.
4. Rename generic package metadata to an agreed app-specific package identifier; update lockfile/package references only as required, no dependency churn.
5. Check links, ignored-cache behavior, full suite/type/lint/build and source-fidelity unchanged. Report sizes/counts before/after, not subjective “clean.”

## Acceptance (measurable)
No tracked Python cache files, correct ignore coverage, archived evidence recoverable via links, current continuation/handoff preserved, meaningful package metadata and no runtime/behavior changes. All checks green; no private credentials or user archive accidentally tracked.

## Do-not list
No deleting audit evidence, erasing old HANDOFF entries without archival pointers/approval, rewriting Git history, removing dependencies speculatively, changing app behavior or treating external owner ZIP as repository content.

Deliver the standard final report from COMMON/README, including real evidence, unverified work and credits; update continuation/HANDOFF/roadmap only after actual approved work.
