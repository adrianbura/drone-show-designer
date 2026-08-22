# Real ESSP archive — operator acceptance checklist

Use this once a REAL customer ESSP archive is available. Record every value; do not
infer anything the Studio does not actually report.

## 1. IMPORT (Advanced → ESSP)

- [ ] file count imported: ____ (expected: ____)
- [ ] source filenames preserved exactly: yes / no
- [ ] reference show hash: ____________
- [ ] clocks (position rate / RGB rate / show start): ____ Hz / ____ Hz / ____
- [ ] drone count reported by import: ____
- [ ] profile status: SOURCE_PROFILE / EXPERIMENTAL_PROFILE
- [ ] import errors shown (verbatim): ____________

## 2. EDIT

- [ ] ownership BEFORE edit (TopBar authority pill): REFERENCE / PLANNER / MIXED
- [ ] edit performed (clip / lighting / geometry): ____________
- [ ] ownership AFTER edit: REFERENCE / PLANNER / MIXED
- [ ] promotion expected for that edit: yes / no

## 3. VALIDATE (Validate & export → Full show validation)

- [ ] production readiness: NOT ANALYZED / STALE / BLOCKED / READY WITH WARNINGS / READY
- [ ] blockers: ____________
- [ ] warnings: ____________
- [ ] worst metrics — min sep ____ m, max v ____ m/s, max a ____ m/s², max jerk ____ m/s³
- [ ] conflicts: ____

## 4. SAVE / REOPEN

- [ ] saved project file name: ____________
- [ ] reopen restores authored content: yes / no
- [ ] reopen restores reference authority: yes / no
- [ ] validation report intentionally absent after reopen: yes / no

## 5. EXPORT

- [ ] generated ESSP output mode: ____________
- [ ] file count: ____
- [ ] clocks in output (position / RGB): ____ Hz / ____ Hz
- [ ] package size: ____ MB
- [ ] source recovery download returned original bytes: yes / no

## 6. EXTERNAL SIMULATOR / VENDOR TOOL

- [ ] tool + version: ____________
- [ ] load result: OK / warning / rejected
- [ ] visible trajectory comparison vs Studio preview: match / deviation ____
- [ ] visible lighting comparison: match / deviation ____
- [ ] vendor/tool error text (verbatim): ____________

## Honesty contract

READY means the show passed the configured Studio validation profile. It does NOT
mean the show is certified safe to fly. The ESSP writer is reverse-engineered and
is not vendor certified.
