# Export fidelity hardening

Read and obey [_COMMON.md](_COMMON.md) in full before proceeding. Inspect [CONTINUATION](../CONTINUATION.md), actual code and current status; older findings are hypotheses until confirmed. Follow the explicit mode supplied with this prompt; absent mode, plan first and wait for approval.

## Goal
Turn the real edited ESSP flow into a repeatable, fail-closed acceptance gate.

## Context (files)
`scripts/esspExportFidelity.ts`; `src/lib/adapters/esspExport.ts`; `src/lib/show/fullshow/{composer,effective,validator}.ts`; `src/lib/show/__tests__/integration/esspGroupExportFidelity.test.ts`; `src/lib/import/essp/{codec,playback,reference}.ts`. Read P05: the previous task fixed the synthetic blocker, NOT real group-edge export.

## Tasks
1. Baseline untouched and +0.03 m edited real archive; record hash, selected group, promotions, rates, blockers and actual effective kinematics.
2. If real edit blocks, pair the smallest coherent fix with P05; do not call synthetic success completion. Obtain approval for any added implementation scope.
3. Harden the local-only CLI into a permanent regression: assert untouched 150/150 drone-file byte identity; edit a safely feasible dynamic group, export, re-import, compare every drone/frame on its own XYZ/RGB clock, headers/profile bytes, sample counts, durations and identity.
4. Compare exported quantized XYZ against effective output within component-wise 0.005 m rounding (allow documented floating-point epsilon); independently require decoded round-trip agreement and RGB byte identity outside edited lighting intervals including connecting transitions/tail.
5. Assert changes confined to edited/planned connecting intervals, source ZIP/report unchanged; return nonzero on failure. Add synthetic mixed-clock and real-input script coverage without checking in the ZIP. Document exact real results and limitations.

## Acceptance (measurable)
Untouched: 150/150 byte-identical; edited: export ok, spliceOk, no full-show blockers, re-imported count/rates/durations/profile unchanged, all-frame quantization checks pass, RGB exact outside changed lighting intervals. CLI rejects deliberately corrupted output and too-large unreplanned jump. Full suite/type checks pass. Missing ZIP or blocked real export means acceptance NOT met.

## Do-not list
No fake READY reports, gate bypass, source rewrite, asserting only file count, frame decimation masquerading as all-frame coverage, expected-failure tests or firmware-flight claims.

Deliver the standard final report from COMMON/README, including real evidence, unverified work and credits; update continuation/HANDOFF/roadmap only after actual approved work.
