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
