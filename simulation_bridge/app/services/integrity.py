"""
Deterministic payload integrity digest — mirror of src/lib/simulation/hash.ts.

If the studio-supplied hash does not match the recomputed one, the package was
modified in transit or after preparation and the run is refused.
"""

from __future__ import annotations

import math
from typing import Iterable, Sequence


def fnv1a32(text: str) -> str:
    h = 0x811C9DC5
    for ch in text:
        h ^= ord(ch) & 0xFFFFFFFF
        h = (h * 0x01000193) & 0xFFFFFFFF
    return format(h, "08x")


def canonical_number(value: float) -> str:
    if not math.isfinite(value):
        return "nan"
    text = f"{value:.3f}"
    return "0.000" if text == "-0.000" else text


def canonical_payload_string(
    *,
    schema_version: int,
    show_package_id: str,
    analysis_revision: str,
    drone_id: str,
    sample_rate: float,
    samples: Sequence[tuple[float, Iterable[float]]],
) -> str:
    head = "|".join(
        [
            f"sv={schema_version}",
            f"spid={show_package_id}",
            f"rev={analysis_revision}",
            f"drone={drone_id}",
            f"sr={canonical_number(sample_rate)}",
            f"n={len(samples)}",
        ]
    )
    body = ";".join(
        f"{canonical_number(t)}:" + ",".join(canonical_number(v) for v in p) for t, p in samples
    )
    return f"{head}#{body}"


def simulation_payload_hash(
    *,
    schema_version: int,
    show_package_id: str,
    analysis_revision: str,
    drone_id: str,
    sample_rate: float,
    samples: Sequence[tuple[float, Iterable[float]]],
) -> str:
    canonical = canonical_payload_string(
        schema_version=schema_version,
        show_package_id=show_package_id,
        analysis_revision=analysis_revision,
        drone_id=drone_id,
        sample_rate=sample_rate,
        samples=samples,
    )
    return f"sph-{fnv1a32(canonical)}-{fnv1a32(canonical[::-1])}"
