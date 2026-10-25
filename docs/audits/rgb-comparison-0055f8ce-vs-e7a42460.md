# Read-only RGB audit comparison

A source: `docs/audits/essp-original-rgb-0055f8ce.json` (JSON sha256 4b2f1d0f5eea35c89c70c6202a80aa34c54840356195b82cf4c8d74e27337007)
B source: `docs/audits/wedding-sorin-e7a42460/rgb-audit.json` (JSON sha256 301977b929d6f2ff4d386014bcece8400173889db0dcaa5f93950b1edbcc0c6d)

Recipe: UNKNOWN for both. Shows are different productions; intervals are compared only by clock time, never as equivalent scenes.

## Full show

| Side | Archive | Archive SHA | Mode | XYZ rate / samples | RGB rate / samples | Duration (s) | Paired/RGB | Dark | Fit R/G/B | Energy fit | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A | ESSP_8_12_mainv4_2f6001-2.zip | 0055f8ce360a… | BENCHMARK (pre-mode field) | 8 Hz / 4746 | 12 Hz / 7120 | 593.25 | 1067700/1068000 (0.9997) | 0.334 | 0.159 / 0.171 / 0.148 | 0.184 | LOW_OR_UNSTABLE_FIT |
| B | wedding-sorin-frg-no-movement.zip | e7a4246016b3… | GENERIC_ARCHIVE | 4 Hz / 2000 | 12 Hz / 6000 | 499.92 | 899700/900000 (0.9997) | 0.208 | 0.129 / 0.104 / 0.096 | 0.088 | LOW_OR_UNSTABLE_FIT |

## 5 s windows

| Metric | A | B |
|---|---|---|
| Window count | 119 | 100 |
| Status counts | LOW_OR_UNSTABLE_FIT 119 | LOW_OR_UNSTABLE_FIT 100 |
| Dark fraction min/q1/median/q3/max | 0.000 / 0.074 / 0.257 / 0.641 / 0.844 | 0.000 / 0.000 / 0.069 / 0.444 / 0.866 |
| Energy fit min/q1/median/q3/max | 0.017 / 0.091 / 0.160 / 0.237 / 0.476 | 0.005 / 0.024 / 0.064 / 0.199 / 0.294 |
| Distinct RGB per window median | 488 | 765 |
| Forensic segments | 138 | 80 |
| Benchmark intervals | 21 | 0 |

## Highest energy-fit windows (descriptive only)

| Side | Window | Time (s) | Status | Energy fit | Dark |
|---|---|---|---|---|---|
| A | window-75 | 370.00–375.00 | LOW_OR_UNSTABLE_FIT | 0.476 | 0.088 |
| A | window-78 | 385.00–390.00 | LOW_OR_UNSTABLE_FIT | 0.474 | 0.084 |
| A | window-74 | 365.00–370.00 | LOW_OR_UNSTABLE_FIT | 0.470 | 0.073 |
| A | window-77 | 380.00–385.00 | LOW_OR_UNSTABLE_FIT | 0.450 | 0.076 |
| A | window-76 | 375.00–380.00 | LOW_OR_UNSTABLE_FIT | 0.440 | 0.080 |
| B | window-44 | 215.00–220.00 | LOW_OR_UNSTABLE_FIT | 0.294 | 0.193 |
| B | window-18 | 85.00–90.00 | LOW_OR_UNSTABLE_FIT | 0.276 | 0.000 |
| B | window-19 | 90.00–95.00 | LOW_OR_UNSTABLE_FIT | 0.276 | 0.000 |
| B | window-20 | 95.00–100.00 | LOW_OR_UNSTABLE_FIT | 0.273 | 0.000 |
| B | window-21 | 100.00–105.00 | LOW_OR_UNSTABLE_FIT | 0.271 | 0.000 |

## Largest dark-fraction differences at the same clock window (first 100 windows)

| Window | Time A / B (s) | Dark A | Dark B | |Δ| | Fit A | Fit B |
|---|---|---|---|---|---|---|
| window-29 | 140.00–145.00 / 140.00–145.00 | 0.715 | 0.000 | 0.715 | 0.046 | 0.064 |
| window-18 | 85.00–90.00 / 85.00–90.00 | 0.713 | 0.000 | 0.713 | 0.202 | 0.276 |
| window-28 | 135.00–140.00 / 135.00–140.00 | 0.707 | 0.000 | 0.707 | 0.053 | 0.054 |
| window-81 | 400.00–405.00 / 400.00–405.00 | 0.707 | 0.000 | 0.707 | 0.080 | 0.152 |
| window-82 | 405.00–410.00 / 405.00–410.00 | 0.717 | 0.026 | 0.691 | 0.089 | 0.033 |
| window-60 | 295.00–300.00 / 295.00–300.00 | 0.690 | 0.041 | 0.649 | 0.192 | 0.117 |
| window-17 | 80.00–85.00 / 80.00–85.00 | 0.707 | 0.068 | 0.638 | 0.209 | 0.255 |
| window-39 | 190.00–195.00 / 190.00–195.00 | 0.693 | 0.056 | 0.637 | 0.214 | 0.200 |

## Limitations
- Same-time windows belong to unrelated choreographies; a difference is not a scene mismatch or error.
- XYZ clocks differ (see table); paired-sample counts reflect each show's own native clocks with interpolated XYZ.
- Fits are in-sample affine fits per tick, not probabilities; low fit is not proof of a specific effect.
- Overlapping intervals are not additive. Forensic segmentation is per-show and not aligned.
- Source audit JSON files are only read; their SHA-256 is listed above.
