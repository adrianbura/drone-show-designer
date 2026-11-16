# Continuation — Drone Show Designer

Obiectiv: show-ul ESSP importat trebuie să poată fi editat și exportat fidel.
Exportul needitat este verificat: 150/150 fișiere identice cu originalul.
Exportul sintetic editat funcționează; arhiva reală editată rămâne blocată la racorduri.
Grupurile, Apply și un Undo au fost verificate în browser; optimizarea rămâne de făcut.
Citește AGENTS.md, acest document, roadmap §23 și ultima secțiune HANDOFF înainte de lucru.

## Goal — owner-approved requirement

“At export, the drones must understand the information”: an imported ESSP show must be **editable AND exportable as a valid ESSP package**. An untouched import must export byte-identical drone files. Format/round-trip validation is not flight authorization or proof of aircraft firmware compatibility.

Snapshot: **2026-11-16**, following implementation commit `abbdb10809263fa165717fa6c703e69ba55d2c28` (05:58:07 UTC). The implementation intervention has ended and committed, but the product goal remains incomplete. This document is a docs-only continuation snapshot, not a new verification run.

## Owner decisions so far — approved, not all acceptance criteria fulfilled

1. Make editable: one clip per displayed scene, no implicit 4-second minimum. Code confirms `DEFAULT_MIN_SCENE_SECONDS = 0` in `native/extract.ts`. Original forensic windows can overlap; native boundaries are canonicalized by the shared projection, not independently copied from raw windows.
2. Consecutive dynamic scenes are grouped **only as a derived view**; clips/bindings stay per forensic segment. Static scenes never merge with dynamic scenes. Real-file measurement: **78 groups = 45 static + 33 dynamic**, covering 119 scene clips (plus takeoff/landing = 121 clips). Verified by the previous real-archive script; `sceneGroups.ts` confirms the rule, including a 0.3 s touch tolerance.
3. Visual-identity-only grouping was measured and rejected: **119 → 118**, not a useful designer reduction. Historical measurement recorded in HANDOFF; not remeasured during this docs task.
4. Imported shows receive a source-derived safety profile **before signature reseeding**; “do not worsen” is intended only for reference-derived edits with before evidence. Never describe it as flight authorization. See the implementation-scope caveat below.
5. Jerk limit stays at the default; measured jerk is labeled unreliable at 8 Hz. Code confirms `DEFAULT_LIMITS.maxJerk` and `jerkReliable: false` in `safetyProfile.ts`.
6. Export fidelity takes precedence over performance and new agent features.
7. Lovable may write code until Claude Code is connected. Claude Code connection is planned, not verified available.

## Current state

### VERIFIED — evidence and its scope

| Date | Result | Evidence |
|---|---|---|
| 2026-11-16 | Untouched real import: 150/150 ESSP drone files byte-identical, 8 Hz XYZ / 12 Hz RGB; 121 clips, 78 groups; forensic report unchanged | Previous `bun scripts/esspExportFidelity.ts <owner-zip> --edit`, untouched portion |
| 2026-11-16 | Synthetic edited export/re-import passes; all XYZ frames within 0.02 m Euclidean quantization tolerance, RGB exact outside edited group, rates/counts/duration preserved | `esspGroupExportFidelity.test.ts`, now ordinary `it`, 5/5 targeted tests |
| 2026-11-16 | Unreplanned 0.4 m jump still blocks export | Same integration test; no gate weakened |
| 2026-11-16 | Full test suite: 180 files, 1568 passed / 1 skipped; no expected failure | Previous `bunx vitest run --maxWorkers=4 --testTimeout=30000` |
| 2026-11-16 | Harness build/type checking succeeded | Previous automatic build log: build OK; standalone tsgo was not run |
| 2026-11-16 | Real import → Make editable → 8 multi-segment group bars → select first group → Agent MOVE +0.03 m preview for 2 clips → Apply MIXED/PLANNER → one Undo REFERENCE | Playwright Chromium 1280×1800; screenshots inspected. Screenshots were temporary, not repository artifacts |
| 2026-11-16 | Original ZIP unchanged | Previous SHA-256 check: `0055f8ce360ac2adebcfdaff866b3715ac18df7bbedb91ef7fac465f11af2c9a` for original and temporary copy |

**Root cause actually isolated:** the synthetic 7382.7 m/s report was the legacy planner arc (23.5 m, 0.01 s, initial derivative π×23.5/0.01), not a cm/m mismatch or stale planner-only validation. At 23.75 s the effective sampler chose the right-hand SHOW transition; report context labeled the left TAKEOFF hold. `schedule.ts` now excludes legacy arcs for imported geometry, retains source drone identity assignment, and avoids inflating extracted 1 ms transitions to 10 ms. `splice.ts` preserves the untouched successor's recorded RGB when its XYZ transition is planner-owned, including the RGB tail. The validator already used the effective set.

**Real edited archive is still BLOCKED:** MOVE +0.03 m on group **7.5–28.75 s**, 2 promotions: incoming splice **0.002197 m / 2.188333 m/s**, outgoing splice **1.217128 m / 2.046265 m/s**; max velocity **5.2261 m/s**, max acceleration **516.1526 m/s²**. Identity correction reduced the observed max velocity from approximately **56.775 m/s**. These are actual mixed-output problems; do not suppress them. The recorded task-2 solution was deliberately not half-implemented.

Source-profile numbers (previous 2026-11-15 measurement, **not remeasured here**): in-air separation ~1.987 m → applied 1.95 m; in-air min altitude ~0.83 m → 0.8 m; max altitude ~88.3 m → 95 m default; x ±49.8 m / z ±20.5 m → default 140×140×100 m area; max v ~4.21 m/s → 12 default; max a ~3.89 m/s² → 5 default; measured jerk ~48.3 m/s³ unreliable → default 10, not the older 48.4 proposal; yaw unknown → default 90. Approximate takeoff/show altitudes: 8.4/42.5 m. Recompute all fields, including landing, before using these as current evidence.

### NOT VERIFIED / incomplete — do not turn into success claims

- Real edited export/re-import: unavailable because the real gate rejects it. No aircraft hardware/firmware flight or package-compatibility test has been performed.
- Group-edge re-planning: absent. Need a group-aware atomic preparation of project + boundary overrides + ownership, source-clock alignment for adjacent dynamic members, endpoint position/velocity constraints and feasibility checks for 1 ms transitions. Existing candidate optimizer handles one clip + successor; Agent commits a project, not that prepared group transaction.
- Full export through browser, browser rotate/scale, numerical equality of the entire restored project after Undo, dedicated extraction Undo acceptance: not verified in the preceding intervention.
- Performance: previous headless Apply/Undo observations ~25–51 s are historical, not a fresh standardized benchmark. Worker use exists for full-show analysis, but the true latency breakdown and ≤5 s target are unverified.
- Standalone `tsgo -b --noEmit` was not executed in the preceding intervention; do not conflate harness success with that command.
- Relative-gate scope is not uniformly enforced at each low-level function: geometry readiness requires reference-derived targeting/promotions; AgentPanel supplies baseline only for bound clips; `validateAgentProject` itself checks profiles + supplied baseline, not the binding; affine separation relaxation checks only `IMPORTED_SHOW`. This is an audit gap, not proof that every native clip is fail-closed in every path.
- Owner-aware signatures, 500-drone performance, CI completeness, and missing agent operations remain future work.
- Main sync of this new docs intervention and exactly one automatic commit are not proven by a local branch name. Do not rewrite history to enforce commit count.

## Open work — priority and dependencies

1. [P01 Export fidelity hardening](prompts/P01-export-fidelity.md): reproduce the real blocker first; blocked until [P05](prompts/P05-group-edge-transitions.md) resolves safe group-edge composition. P01 and P05 are the immediate correctness package.
2. [P05 Group-edge transitions](prompts/P05-group-edge-transitions.md): NOT already done. Deliver atomically and validate real exported trajectories; refuse infeasible edits.
3. [P06 Browser verification](prompts/P06-browser-verification.md): complete the export flow after P01/P05; extend existing MOVE/Undo evidence.
4. [P04 Owner-aware signatures](prompts/P04-owner-aware-signature.md): prevent unrelated global changes from promoting source output.
5. [P02 Incremental re-analysis](prompts/P02-incremental-analysis.md): measured Apply/Undo speedup without compromising full export validation.
6. [P03 500-drone performance](prompts/P03-500-drone-performance.md): optimize only measured bottlenecks.
7. [P07 Maintainability and CI](prompts/P07-maintainability-ci.md): small verifiable refactors after correctness baseline.
8. [P08 Agent operations](prompts/P08-agent-operations.md): validated transitions, library insertion and lighting.
9. [P09 Import reconstruction](prompts/P09-import-reconstruction.md): plan first, only after P01–P05 acceptance is satisfied.
10. [P10 Repo hygiene](prompts/P10-repo-hygiene.md): no behavior change; independent low-risk maintenance when it does not distract from export.

## How to resume

Read **AGENTS.md → docs/CONTINUATION.md → roadmap.md §23 → the last HANDOFF.md section**. AGENTS additionally requires the broader HANDOFF/roadmap inspection at a new conversation; do not treat this entry point as replacing either canonical file. Inspect latest commits, working tree/diff and relevant code before deciding. Identify requested mode (plan-only vs implement), a coherent acceptance package and blockers. Use [prompt instructions](prompts/README.md) and [_COMMON](prompts/_COMMON.md). Append new evidence after existing reports; never overwrite historical evidence with unsupported completion.

## Verification commands — instructions, not claims they ran in this docs task

```sh
bunx vitest run src/lib/show/__tests__/integration/esspGroupExportFidelity.test.ts --maxWorkers=2 --testTimeout=30000
bunx vitest run --maxWorkers=4 --testTimeout=30000
tsgo -b --noEmit
bunx eslint .
bun scripts/esspExportFidelity.ts /absolute/path/ESSP_8_12_mainv4_2f6001-2.zip
bun scripts/esspExportFidelity.ts /absolute/path/ESSP_8_12_mainv4_2f6001-2.zip --edit
```

Use the existing tsgo binary or arrange the project's compatible toolchain before claiming typecheck success. In Lovable, obey harness restrictions on manual builds/typechecks and report the actual available automatic result instead. In a standalone local/CI environment, run the configured build as well. `--edit` currently prints blocked real results, conditionally round-trips only when export succeeds, and does **not** assert every acceptance condition or exit nonzero for every fidelity failure: P01 must harden it. An exit code 0 alone is not export acceptance.

## Rules that bite — verified code caveats + binding requirements

- **Code verified:** `clipOutputSignature` (`native/signature.ts`) includes all limits, takeoff/show/landing altitudes, drone count and assignment strategy. Even non-output-changing global edits can currently promote all REFERENCE clips; P04 must fix this without losing real-output detection.
- **Code verified, corrected wording:** promotion is monotonic inside `promoteReferenceClips` (no PLANNER→REFERENCE operation there). It is **not globally irreversible**: history snapshots include the layer, and `restoreSnapshot` restores ownership; browser Undo restored REFERENCE. Never disable Undo based on the word “irreversible.”
- **Code verified:** splice position tolerance is 0.05 m; velocity tolerance is independently 0.75 m/s. A transform causing a boundary mismatch above either requires proper planned connecting transitions or refusal. An edit parameter >5 cm does not alone prove a gap; inspect actual endpoints. Even a 3 cm edit can fail velocity or source-clock continuity.
- **Required and code partly verified:** recorded RGB remains the imported authority outside edited lighting intervals; geometric XYZ transition promotion must not recolor an untouched successor or drop its RGB tail. No invented effect recipes; unknown stays unknown.
- **Required:** imported trajectories/source bytes/saved forensic report unchanged outside explicitly planner-owned edited/connecting intervals; clips/bindings per segment; no static+dynamic merge; no re-planning the entire imported show.
- **Required:** absolute fail-closed gates for native projects or absent before evidence; intended relative mode only for reference-derived edits. Relative editing never exempts a computed export from full-show gates.
- **Required:** no gate suppression, silent limit widening, skipped takeoff validation, public history rewrite or fabricated verification. Source-profile derivation preserves defaults according to its measured rule; it is not permission to widen export limits to pass a defect.

## Tooling notes — verified / planned / unknown

- **Official-docs verified:** Lovable commits edits and synchronizes two ways with the actively synced GitHub branch, normally default `main`; other branches do not sync unless selected or merged. Sources: [GitHub integration](https://docs.lovable.dev/integrations/github), [Git sync overview](https://docs.lovable.dev/integrations/git-sync-overview).
- **Local evidence:** prior implementation commit exists; docs environment exposes a platform-managed `edit/…` branch rather than literal main. Do not checkout/push/rewrite it in Lovable. Main arrival of this docs change requires platform sync confirmation, not assumption.
- **Owner plan, not verified connected:** Claude Code will connect to this repository later. Claude chat can read these documents when supplied repository access/content; do not assume it has shell or Git tools.
- **Repository verified:** the real ESSP ZIP is not tracked. The owner must supply their local `ESSP_8_12_mainv4_2f6001-2.zip`; sandbox upload paths and temporary scripts/screenshots do not survive new environments.
- **Repository verified:** tracked Python caches exist under `simulation_bridge`; package name is generic (`tanstack_start_ts`). P10 handles them later; this docs task changes neither.
- Exactly one commit per prompt is the desired collaboration unit; Lovable platform commits are automatic, so report actual commit IDs/count and uncertainty rather than forcing history edits.

## Stage 2 live continuation — 2026-11-16

Requested order: P04 → P02 → P06 → P03, without intermediate approvals. Implementation and docs commits were present at entry (`abbdb10`, `5c66f4d`); platform manages new commits, so per-item commit timing/main sync cannot be forced.

**P04 verified:** recorded-owner v2 signatures omit only planner envelope/altitudes/strategy for REFERENCE; all real-output dependencies remain. PLANNER signatures keep these dependencies. Exact unchanged legacy-v1 evidence permits migration; edited legacy state fails closed. Files: native `signature.ts`, `intervals.ts`, `audit.ts`, new `ownerAwareSignature.test.ts`, manual promotion in `store.tsx`. Targeted 17/17; full suite 1574 passed / 1 skipped (181 files). Real untouched CLI: 150/150 identical, report unchanged. Standalone `tsgo -b --noEmit` not executed (harness restriction); automatic checks are reported separately. Real edited export not established.

**P02 fresh baseline:** real owner archive, Chromium/SwiftShader sandbox, 1280×1800, first dynamic group MOVE +0.03 m; click-to-two-animation-frames Apply 72.58765 s, Undo 49.68705 s, n=1 (not median/p95). Both include synchronous render pipeline costs. No speedup or window/full equivalence is claimed yet.

**Open:** P02 incremental worker + full-export coverage, P06 complete rotate/scale/export browser evidence, P03 150/300/500 profiling. Existing P01/P05 real edited-export blocker remains independent of signature/performance work. No source safety limit relaxed.

## Stage 5 — realistic edit magnitudes (2026-11-16, Lovable)

Data/machine: owner archive `ESSP_8_12_mainv4_2f6001.zip` (150 drones, 8 Hz XYZ / 12 Hz RGB), Lovable sandbox, Bun CLI; browser = Playwright Chromium (SwiftShader), 1280×1800.

**Housekeeping first.** The 2 Stage-4 failures were fixed: `SourceScenePanel` crashed when analysis options were absent (optional chaining); the lighting acceptance test asserted that `plannerSet` is pure planner on every frame, which Stage 4's REFERENCE short-circuit intentionally breaks. The test now compares the planner's own sampling before/after promotion and asserts `plannerSet` is pure on planner-owned frames; `FullShowPlan.plannerTrajectorySet` doc updated. No gate touched.

**Decision — adaptive ramp (`RAMP_FRACTIONS = [1/4, 1/3, 0.4, 1/2]` of the usable span).** The shortest ramp whose kinematics fit the derived limits is chosen (longest held pose); 1/2 means no hold (pure smooth bump). Added velocity scales ~1/ramp, acceleration ~1/ramp², so this alone raises the static-scene maximum ~3.8×. Edges stay exact (same quintic + 2-sample guard). Refusals now carry `feasible` (bisection on the same kinematic budget at the longest ramp) shown in RO/EN as "max feasible move ≈ X m"; the full canonical gate still applies afterwards and can be stricter (area/altitude/separation).

**Sweep** (`bun scripts/esspEditMagnitudeSweep.ts <zip>`; each max = largest value passing the FULL gate: `analyzeFullShow` + `buildEsspExportPackage`, derived profile, nothing relaxed; bisection on the kinematic pre-check then confirmed/bisected on the full gate; caps: move 50 m, rotate 180°, scale 0.5–2):

| Target | Duration | Ramp (1/4 → chosen) | Move X / Y / Z max | Rotate Y max | Scale up / down | Limiting |
|---|---|---|---|---|---|---|
| Dynamic 2-scene group 7.5–28.75 s — before | 21.25 s | 5.19 s fixed | 14.2 / 14.4 / 17.1 m | 23.7° | ×1.319 / ×0.562 | acceleration |
| same — after | 21.25 s | 5.19→≤10.38 s | 32.8 (area) / 50 cap / 50 cap | 77.7° (velocity) | ×1.772 (accel) / ×0.5 cap | area / velocity / accel |
| Static scene 31.25 s — before | 2.5 s visual (edit span 4.5 s) | 1.125 s fixed | 0.68 / 0.48 / 0.69 m | 1.04° | ×1.018 / ×0.982 | acceleration |
| same — after | idem | up to 2.25 s | 2.11 / 1.82 / 2.91 m | 4.04° | ×1.046 / ×0.925 | acceleration |
| Shortest group 42.25 s | 1 s | — | refused | refused | refused | INSUFFICIENT_EDIT_TIME (span ≤ 0.25 s after guards) |
| Longest static 453.75 s — before | 43.25 s | 11.6 s | X step-down result invalid (old script) / 36.2 / 50 cap | 82.8° | ×1.342 / ×0.5 cap | full gate (area/altitude), velocity |
| same — after | idem | idem (1/4 fits) | 20.3 (area) / 39.1 (altitude) / 50 cap | 164.9° (velocity) | ×1.387 (area) / ×0.5 cap | area / altitude / velocity |

Realistic designer values (after): dynamic group and longest scene accept all of move 1 m / 5 m, move X 1 m, rotate 5° / 20°, scale 0.9 / 1.2. Static 2.5 s scene accepts move 1 m (Y or X); refuses move 5 m, rotate 5°, scale 0.9 (acceleration) and rotate 20°, scale 1.2 (velocity/acceleration) — a 4.5 s window cannot fly drones out and back that far within 5 m/s². Before: the static scene refused all seven. The 1 s scene is too short for any smooth edit.

**Stacking (tested, `stage5Edits.test.ts`).** Second edit on the identical interval: allowed for same and different op; pivot = centroid of the current effective pose (rotate-after-move turns the moved shape in place); move+move offsets add; full gate re-runs. Partial overlap (group then one of its scenes): refused `OVERLAPPING_EDIT_INTERVAL`. Two adjacent scenes in sequence: both accepted, shared edge kinematics exact, export allowed. Save→open (JSON + `migrateReferenceLayer`)→export: byte-identical to live export.

**CLI acceptance (`bun scripts/esspExportFidelity.ts <zip> --edit`, realistic magnitudes):** untouched 150/150 byte-identical, report unchanged; dynamic group move 1 m / rotate 5° / scale 1.1 and static scene move 1 m / rotate 3° / scale 1.04 → export allowed, splice ok, peak accel 3.89–4.71 m/s² (limit 5), XYZ outside edit 0 diffs, RGB 0 diffs, worst re-import vs effective 4.7–8.4 mm (int16 quantization), timing equal; 200 m move refused.

**Browser (Playwright, real archive, n=3 edits in one session):** import → Make editable → first group bar → agent "move the scene 1 m up" / "rotate the scene 5 degrees" / "scale scene 1.1" → preview 14.0 / 15.9 / 11.5 s → Apply (settled 23.5 / 23.0 / 20.7 s) → Validate & export → Run validation (21.6 / 14.9 / 13.3 s) → Ready with warnings → real download of the ZIP → Undo (settled 20.0 / 28.0 / 24.7 s). The preview did not stall in this run (Stage 4 waited on analysis; no stuck state reproduced, so no fix claimed). `bun scripts/esspCompareDownload.ts src.zip download.zip '<op>'`: all three downloads 150/150 files byte-identical to the CLI pipeline, 150 drones, timing equal, XYZ outside edit 0, RGB 0. Agent refusal "move the scene 100 m up" → "max feasible move ≈ 53.52 m" in 0.4 s. Inspector path: move 1 m preview 11.6 s (explanation shown), Apply 14.9 s, ownership MIXED (4 planner-owned intervals), Undo 13.4 s. Screenshots: `docs/audits/stage5/`.

**Bug fixed:** the agent change preview for imported edits showed "x 0.0 m, y 0.0 m … altitude 0.0–0.0" (placeholder summary). It now shows the real op, interval, ramp and measured peak velocity/acceleration once per group.

**NOT verified:** Timeline/3D visual equality was not pixel-compared (the viewport reads the same effective sampler; exported = effective proven numerically); save/open was tested in unit tests, not via the browser file dialog; Apply/Undo remain 13–28 s (target ≤5 s unmet; windowed worker re-analysis still not implemented); standalone `tsgo -b --noEmit` not run (harness typecheck/build ran: build OK). The first full-suite run under concurrent browser load had 2 transient failures; two subsequent runs were fully green.
