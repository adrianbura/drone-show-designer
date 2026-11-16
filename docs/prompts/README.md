# Reusable continuation prompts

Start with [CONTINUATION](../CONTINUATION.md); it separates verified work from blockers. Every prompt requires reading [_COMMON.md](_COMMON.md) in full. If the recipient cannot read the repo, paste COMMON, relevant continuation evidence and the chosen prompt together; do not assume a filename reference supplies content.

## Index

| Prompt | Purpose | Mode / dependencies |
|---|---|---|
| [P01](P01-export-fidelity.md) | Real edited ESSP export and permanent fidelity regression | Plan the bounded package, then implement on approval; pair with P05 |
| [P02](P02-incremental-analysis.md) | Windowed worker analysis and ≤5 s Apply/Undo target | Plan first; correctness baseline P01/P05 |
| [P03](P03-500-drone-performance.md) | Profile 150/300/500 drones | Baseline first; optimize measured bottlenecks only |
| [P04](P04-owner-aware-signature.md) | Ownership-aware promotion signatures | Plan first; preserve output-sensitive promotion |
| [P05](P05-group-edge-transitions.md) | Safe group-edge re-planning | Immediate blocker; verify/skip only if evidence proves done |
| [P06](P06-browser-verification.md) | Real editor through exported round-trip | Verification first; requires P01/P05 for successful export |
| [P07](P07-maintainability-ci.md) | Concern-based store modules and CI | Plan first; avoid competing refactors |
| [P08](P08-agent-operations.md) | Transitions, library insertion, lighting | Plan first; core export correctness first |
| [P09](P09-import-reconstruction.md) | Roadmap #14 and remaining export-safety gaps | PLAN ONLY initially; P01–P05 accepted first |
| [P10](P10-repo-hygiene.md) | Caches, documentation archive, package metadata | Plan archival references first; no behavior change |

## How to use

Paste into the **Lovable project chat** or Claude Code with repository access. If your orchestration environment explicitly exposes Lovable `send_message`, send the same complete text through that tool; its availability is environment-specific, not a universal Lovable API promised here. Claude Code is planned but not yet verified connected.

Set mode explicitly: `PLAN ONLY — no source edits; wait for approval` or `IMPLEMENT — approved scope`. Plan-first prompts stop after a concise file-level plan with acceptance and blockers; they do not silently proceed. On implementation approval, execute rather than merely describe work. Pick one coherent package, not ten prompts simultaneously. P05 must unblock P01 before performance success matters.

## Standard final report

1. Result: complete / partial / blocked; owner-visible outcome.
2. Root cause with source/runtime evidence.
3. Files changed and why; no hidden scope expansion.
4. Before/after measurements, dataset/hash, machine, rates and units.
5. Exact verification commands, actual results and browser flow/screenshots when applicable.
6. NOT VERIFIED, each open blocker and next actionable step.
7. Credits used with measurement scope; unavailable is acceptable, guessing is not.
8. Actual commit ID/status and sync uncertainty; one commit desired, never rewrite history.

Update `docs/CONTINUATION.md` to current evidence and append to HANDOFF/roadmap after implementation. Never relabel blocked export as verified merely because a script exits 0 or a synthetic fixture passes.
