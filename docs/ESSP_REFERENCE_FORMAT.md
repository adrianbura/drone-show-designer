# ESSP reference format — observed layout

**EXPERIMENTAL — REVERSE-ENGINEERED REFERENCE FORMAT.**
Nothing in this document is vendor documented or vendor confirmed. Everything
was derived from binary analysis of a supplied reference archive of 150 `.essp`
files (`1.essp` … `150.essp`). Drone Show Studio makes **no** claim of vendor
compatibility, and the ESSP encoder exists only for round-trip verification —
there is no production ESSP flight export.

Confidence labels used below:

- `CONFIRMED BY BINARY STRUCTURE` — follows directly from the byte layout and
  self-consistency checks (lengths, divisibility, file size).
- `HIGH-CONFIDENCE INFERENCE` — consistent across all 150 reference files and
  physically plausible, but not confirmed by a specification.
- `UNKNOWN` — bytes preserved verbatim, no meaning assigned.

## Header — 31 bytes, little-endian

| Offset | Size | Field | Reference value | Confidence |
| --- | --- | --- | --- | --- |
| 0 | 3 | ASCII magic `ESS` | `ESS` | CONFIRMED BY BINARY STRUCTURE |
| 3 | 1 | version | `1` | CONFIRMED BY BINARY STRUCTURE |
| 4 | 13 | `opaqueProfileBytes` | identical across files | UNKNOWN |
| 17 | 2 | position rate | `8000` → 8 Hz (Hz × 1000) | HIGH-CONFIDENCE INFERENCE |
| 19 | 4 | XYZ payload length | `28476` | CONFIRMED BY BINARY STRUCTURE |
| 23 | 2 | unknown uint16 | `2` | UNKNOWN |
| 25 | 2 | RGB rate | `12000` → 12 Hz (Hz × 1000) | HIGH-CONFIDENCE INFERENCE |
| 27 | 4 | RGB payload length | `21360` | CONFIRMED BY BINARY STRUCTURE |

## Payloads

XYZ starts immediately after the header: `int16 LE x, y, z` — 6 bytes per
sample. `28476 / 6 = 4746` samples per drone (CONFIRMED BY BINARY STRUCTURE).

RGB starts immediately after XYZ: `uint8 r, g, b` — 3 bytes per sample.
`21360 / 3 = 7120` samples per drone (CONFIRMED BY BINARY STRUCTURE).

Any trailing bytes beyond `31 + xyzLength + rgbLength` are rejected.

## Working scale hypothesis

`1 ESSP unit = 1 cm`, i.e. `studioMeters = esspValue / 100`
(HIGH-CONFIDENCE INFERENCE, source: `REFERENCE_ARCHIVE_ANALYSIS`). The
conversion lives only in `src/lib/import/essp/coordinates.ts`.

## Axis mapping

The reference launch layout varies in ESSP X and Y with a constant ESSP Z, so Z
is treated as the altitude axis (HIGH-CONFIDENCE INFERENCE):

| Studio axis | ESSP axis |
| --- | --- |
| X (east/right) | ESSP X |
| Y (up/altitude) | ESSP Z |
| Z (north/depth) | ESSP Y |

The mapping is data, not code: `EsspAxisMapping` allows a developer-only
override (axis swap and per-axis inversion) for visual verification. Raw decoded
values are never mutated — `rawEsspPosition` and `studioPosition` are both kept.

## Timing

Position and RGB use **independent clocks**:

- `positionTime = sampleIndex / 8`
- `colorTime = sampleIndex / 12`

Endpoint convention: `duration = (sampleCount − 1) / rate`, i.e. the timestamp
of the last sample. For the reference archive:

- positions: `4745 / 8 = 593.125 s`
- colours: `7119 / 12 = 593.25 s`

The 0.125 s discrepancy is a consequence of the sample-count endpoint semantics
and is reported rather than hidden. Resolved playback duration is the longer of
the two.

## Playback rules

- Positions: deterministic **linear interpolation** between raw samples. At an
  exact 8 Hz timestamp the displayed position equals the decoded sample.
- Colours: **sample-and-hold** on the 12 Hz clock, so a displayed colour is
  always an original byte triplet, never a blend.

## Drone identity

The header is identical across drones, so no drone ID field is assumed. IDs are
derived from the numeric filename: `1.essp → ESSP-001`, `150.essp → ESSP-150`.
Files are ordered numerically, never lexicographically. `sourceFileName` and
`numericSourceId` are preserved.

## Round-trip codec

`encode(parse(bytes))` rebuilds the file from the preserved raw header and
payload regions, so an unmodified reference file round-trips byte for byte
(verified with a byte comparison and SHA-256). This is a codec verification tool
only; it is not exposed as a flight export.

## Fixtures

The reference archive is **not** committed. Tests use deterministic synthetic
ESSP fixtures. The optional golden suite runs only when
`ESSP_REFERENCE_FIXTURE_PATH` points at a local directory containing the 150
files; ordinary CI passes without it.

## Effective trajectory authority (hybrid ESSP + planner)

A project that carries an imported layer has exactly **one** trajectory the
studio judges: the **effective trajectory set**, built by
`src/lib/show/fullshow/effective.ts`.

- Reference-owned intervals contain the **imported samples** — positions
  verbatim, and velocity / acceleration / jerk finite-differenced on the SOURCE
  clock (`h = 1 / positionRateHz`, see `native/derivatives.ts`). Yaw is not part
  of the payload, so reference-owned samples report `yaw = 0, yawRate = 0`
  instead of inventing a heading.
- Planner-owned intervals contain the composed planner output, untouched.
- There is no blending. Ownership per instant comes from
  `resolveReferenceIntervals()`; promoting one clip moves only that clip's
  transition, hold and the following transition to the planner.

**Sample grid.** The effective rate is the smallest multiple of the imported
position rate that is ≥ the requested rate (25 Hz requested + 8 Hz source →
32 Hz), and the grid start is aligned to that rate. Every original position
timestamp therefore lands on the grid — reference-owned samples are exact — while
the grid stays uniform, which the continuity validator requires.

**Splice boundaries.** Where ownership changes, both authorities must agree on
position (≤ 0.05 m) and velocity (≤ 0.75 m/s). A boundary outside tolerance is
reported as a `SPLICE_DISCONTINUITY` **error** and blocks export: otherwise the
show would teleport or snap speed at the handover.

**LEDs.** A reference-owned instant keeps its original RGB byte triplets in
preview and in export; the authored lighting engine owns planner-owned instants.

**Consumers.** Full-show validation (continuity, conflicts, safety, phase and
transition metrics), the simulation package and both exports read this same set.
The analysis revision includes the layer identity (`showHash`, clocks) and every
clip's ownership and signature, so promoting a clip makes an existing report
stale.

## Per-drone ESSP export (experimental)

`src/lib/adapters/esspExport.ts` writes one `<n>.essp` per drone plus
`manifest.json` into a deterministic ZIP (level 0, fixed timestamp). It is an
export of a REVERSE-ENGINEERED format: no vendor certification, and the manifest
carries that warning verbatim.

Two modes, chosen automatically:

- **PRESERVED_PAYLOAD** — the project came from an imported archive, every
  interval is still REFERENCE-owned and the fleet still matches the archive. The
  archived source bytes are written back verbatim, so the round trip is
  byte-exact. This is the only documented exemption from a BLOCKED full-show
  readiness (the studio computed nothing; the findings become warnings). A
  missing or stale analysis still blocks.
- **SAMPLED** — anything else. Positions come from the canonical effective
  trajectory set on the ESSP position clock, LEDs from the canonical lighting on
  the independent RGB clock. Frame counts and clocks follow the source archive
  when one exists, otherwise the observed 8 Hz / 12 Hz profile is used and the
  package is labelled `EXPERIMENTAL_PROFILE`.

Header profile bytes (`opaqueProfileBytes`, version, unknown uint16) are copied
from the source file when available. Positions convert through
`studioToEssp` (half-away-from-zero rounding); a value outside int16 or a
non-byte RGB channel is a hard `EsspRangeError`, never a silent wrap.
