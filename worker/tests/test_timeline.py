import gzip
import json
from pathlib import Path
from types import SimpleNamespace

from traffic_worker.runner import _TimelineWriter


class FakeVehicles:
    def getIDList(self):
        return ["car-1"]

    def getPosition(self, vehicle_id: str):
        return (12.5, 4.0)

    def getSpeed(self, vehicle_id: str):
        return 8.5

    def getRoadID(self, vehicle_id: str):
        return "edge-1"


class FakeEdges:
    def getIDList(self):
        return ["edge-1", ":internal"]

    def getLastStepMeanSpeed(self, edge_id: str):
        return 5.0

    def getLastStepVehicleNumber(self, edge_id: str):
        return 1

    def getLaneNumber(self, edge_id: str):
        return 1


class FakeLanes:
    def getMaxSpeed(self, lane_id: str):
        return 10.0


def test_timeline_is_valid_compressed_json_and_excludes_internal_edges(tmp_path: Path):
    path = tmp_path / "timeline.json.gz"
    writer = _TimelineWriter(path, sample_interval_seconds=5)
    libsumo = SimpleNamespace(vehicle=FakeVehicles(), edge=FakeEdges(), lane=FakeLanes())

    writer.write_sample(libsumo, time_seconds=5)
    writer.finish()

    with gzip.open(path, "rt", encoding="utf-8") as timeline_file:
        timeline = json.load(timeline_file)
    assert timeline["format"] == "traffic-worker-timeline-v1"
    assert timeline["sample_interval_seconds"] == 5
    assert timeline["samples"] == [{
        "time_seconds": 5,
        "vehicles": [{
            "id": "car-1",
            "x": 12.5,
            "y": 4.0,
            "speed_mps": 8.5,
            "edge_id": "edge-1",
        }],
        "edges": [{
            "id": "edge-1",
            "mean_speed_mps": 5.0,
            "free_flow_speed_mps": 10.0,
            "vehicle_count": 1,
        }],
    }]
    assert not path.with_name(f"{path.name}.partial").exists()
