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
