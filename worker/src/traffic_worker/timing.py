"""Shared simulation horizons for prediction, routing, and measurement."""

MAX_WARMUP_SECONDS = 600
DEMAND_HORIZON_SECONDS = 3600


def warmup_seconds(duration_seconds: int) -> int:
    return max(0, min(MAX_WARMUP_SECONDS, DEMAND_HORIZON_SECONDS - duration_seconds))


def simulation_horizon_seconds(duration_seconds: int) -> int:
    return warmup_seconds(duration_seconds) + duration_seconds


def frame_interval_seconds(duration_seconds: int) -> int:
    """At most 600 position frames, including initial and final states."""
    return max(1, -(-duration_seconds // 599))
