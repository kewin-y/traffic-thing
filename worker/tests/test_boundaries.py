from pathlib import Path

import pytest
from pydantic import ValidationError

from traffic_worker.assets import network_assets
from traffic_worker.models import SimulationRequest


def test_asset_symlinks_cannot_escape_network_root(tmp_path: Path):
    root = tmp_path / "networks"
    scenario = root / "demo"
    scenario.mkdir(parents=True)
    outside = tmp_path / "private.xml"
    outside.write_text("private")
    (scenario / "network.net.xml").symlink_to(outside)
    (scenario / "demand.rou.xml").write_text("<routes/>")
    with pytest.raises(ValueError, match="within NETWORK_ROOT"):
        network_assets(root, "demo")


@pytest.mark.parametrize("edits", [
    [
        {"type": "set_lane_count", "edge_id": "e", "lane_count": 2},
        {"type": "set_lane_count", "edge_id": "e", "lane_count": 3},
    ],
    [
        {"type": "close_edge", "edge_id": "e"},
        {"type": "set_speed_limit", "edge_id": "e", "speed_mps": 10.0},
    ],
    [
        {"type": "set_speed_limit", "edge_id": "e", "speed_mps": 10.0},
        {"type": "close_edge", "edge_id": "e"},
    ],
])
def test_conflicting_edits_are_rejected(edits: list[dict]):
    with pytest.raises(ValidationError):
        SimulationRequest.model_validate({"network": "demo", "edits": edits})


@pytest.mark.parametrize("payload", [
    {"network": "../private"},
    {"network": "/private"},
    {"network": "demo", "duration_seconds": True},
    {"network": "demo", "edits": [
        {"type": "set_lane_count", "edge_id": "e", "lane_count": True},
    ]},
    {"network": "demo", "edits": [
        {"type": "set_speed_limit", "edge_id": "e", "speed_mps": float("nan")},
    ]},
    {"network": "demo", "edits": [
        {"type": "set_speed_limit", "edge_id": "e", "speed_mps": float("inf")},
    ]},
])
def test_invalid_request_boundaries_are_rejected(payload: dict):
    with pytest.raises(ValidationError):
        SimulationRequest.model_validate(payload)


@pytest.mark.parametrize("interval", [0, 61, True])
def test_invalid_timeline_sample_interval_is_rejected(interval: int | bool):
    with pytest.raises(ValidationError):
        SimulationRequest.model_validate({
            "network": "demo",
            "record": True,
            "sample_interval_seconds": interval,
        })
