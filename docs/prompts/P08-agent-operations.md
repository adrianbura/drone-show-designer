# Agent operations

Read and obey [_COMMON.md](_COMMON.md) in full before proceeding. Inspect [CONTINUATION](../CONTINUATION.md), actual code and current status; older findings are hypotheses until confirmed. Follow the explicit mode supplied with this prompt; absent mode, plan first and wait for approval.

## Goal
Deliver validated, undoable EDIT_TRANSITION, INSERT_LIBRARY_SCENE and EDIT_LIGHTING.

## Context (files)
`src/lib/agent/{capabilities,parser,operations,validate,planSafetyGate}.ts` and model schemas/functions; `AgentPanel.tsx`; canonical transition/library/lighting APIs and store transactions. Resolve actual paths before edits; export correctness comes first.

## Tasks
1. Plan each operation through canonical editor authority and declare unsupported cases honestly. Define typed local RO/EN parser, model schema, capability contract and precise refusal reasons.
2. EDIT_TRANSITION: boundary-aware duration/strategy changes, constrained splice feasibility and timing consequences; no source interval drift without deliberate promotion.
3. INSERT_LIBRARY_SCENE: preserve asset geometry/RGB/time/provenance, validate fleet participation/capacity, deterministic insertion and assignment, explicit timeline/ripple handling.
4. EDIT_LIGHTING: recorded RGB remains source outside explicitly edited lighting intervals, unknown imported recipes remain unknown; preserve geometric trajectories.
5. Preview then atomic Apply with one Undo; group-aware targeting where meaningful, no accidental expansion. Revalidate relative scope on imported/reference-derived targets; native/missing baseline fail closed.
6. Add typed-plan security/atomicity, parser, operation, safety/export and browser tests for each operation; report partial capabilities separately.

## Acceptance (measurable)
Each shipped operation reachable through real UI/local/model paths, produces correct preview, applies via canonical transaction, undoes once and passes full export tests. Unsupported cases refused. RO/EN concrete commands and malicious/invalid plans tested; library/lighting edits preserve untouched RGB/XYZ.

## Do-not list
No raw untrusted model execution, invented effect recipes, silent library fleet remapping, unsafe duration ripple, partial multi-step commits, registry promises before behavior exists or unvalidated export.

Deliver the standard final report from COMMON/README, including real evidence, unverified work and credits; update continuation/HANDOFF/roadmap only after actual approved work.
