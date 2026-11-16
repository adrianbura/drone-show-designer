# ESSP import reconstruction and export-safety gaps

Read and obey [_COMMON.md](_COMMON.md) in full before proceeding. Inspect [CONTINUATION](../CONTINUATION.md), actual code and current status; older findings are hypotheses until confirmed. Follow the explicit mode supplied with this prompt; absent mode, plan first and wait for approval.

## Goal
Plan the remaining automatic reconstruction and safety gaps in roadmap #14 after core fidelity/performance acceptance.

## Context (files)
Roadmap #14, §23, HANDOFF, `docs/ESSP_REFERENCE_FORENSICS.md`, `native/{visualScenes,visualIdentity,sceneEvidence,extract,decomposition}.ts`, forensic source samples, remaining export/readiness tests.

## Tasks
MODE: PLAN ONLY initially. Do not edit source or commit implementation.
1. Confirm P01–P05 accepted, including real edited export; if not, stop and report dependencies.
2. Audit reconstruction against measured source XYZ/RGB and saved bindings; list static/dynamic boundaries, absorbed prefixes, unknown semantics, multi-object identity and unsupported export conditions.
3. Distinguish observed colors/motion from unknowable effect recipes or image names. Keep original forensic report/raw reference independent from editable authoring view.
4. Investigate remaining export-safety gaps (clocks, quantization, continuity, participation, header/profile semantics); do not promise drone firmware compatibility without tests/specification.
5. Produce bounded file-level implementation options, recommended option, real-file measurements, acceptance fixtures/tests and risk matrix. Wait for owner approval before implementation.

## Acceptance (measurable)
Plan includes evidence-backed gap inventory, concrete before/after reconstruction checks on owner archive(s), preservation invariants, unknown labeling, exact tests and staged approval boundaries. No unapproved implementation. Later acceptance requires measured source-faithful playback/save/open/export, not just plausible labels.

## Do-not list
No invented semantic names/effect recipes, mixed travel relabeled static to bypass guards, source/report rewrite, experimental path enabled by default without acceptance or hardware-flight claims.

Deliver the standard final report from COMMON/README, including real evidence, unverified work and credits; update continuation/HANDOFF/roadmap only after actual approved work.
