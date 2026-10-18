import gzip
import json
from pathlib import Path
from types import SimpleNamespace

from traffic_worker.active_demand import is_active_vehicle
from traffic_worker.runner import _TimelineWriter, frame_interval_seconds


class FakeAgents:
    def __init__(self, agents: dict[str, tuple[float, float]]):
        self.agents = agents

    def getIDList(self):
        return list(self.agents)

    def getPosition(self, agent_id: str):
        return self.agents[agent_id]

    def getAngle(self, agent_id: str):
        return 90.4

    def getSpeed(self, agent_id: str):
        return 8.46


class FakeEdges:
    def getIDList(self):
        return ["edge-1", "edge-2", ":internal"]

    def getLastStepMeanSpeed(self, edge_id: str):
        return 5.0

    def getLastStepVehicleNumber(self, edge_id: str):
        return 1 if edge_id == "edge-1" else 0

    def getLaneNumber(self, edge_id: str):
        return 1


class FakeLanes:
    def getMaxSpeed(self, lane_id: str):
        return 10.0


class FakeSimulation:
    def convertGeo(self, x: float, y: float):
        return (-79.4 + x / 1e5, 43.65 + y / 1e5)


def test_timeline_is_compact_compressed_json_with_people_and_bikes(tmp_path: Path):
    path = tmp_path / "timeline.json.gz"
    writer = _TimelineWriter(path, sample_interval_seconds=5, frame_interval_seconds=1)
    libsumo = SimpleNamespace(
        vehicle=FakeAgents({"car-1": (12.5, 4.0), "bike-3": (0.0, 0.0), "scooter-1": (1.0, 1.0)}),
        person=FakeAgents({"ped-7": (2.0, 2.0)}),
        edge=FakeEdges(),
        lane=FakeLanes(),
        simulation=FakeSimulation(),
    )

    writer.write_frame(libsumo, time_seconds=4, edges=False)
    writer.write_frame(libsumo, time_seconds=5, edges=True)
    writer.finish()

    with gzip.open(path, "rt", encoding="utf-8") as timeline_file:
        timeline = json.load(timeline_file)
    assert timeline["format"] == "traffic-worker-timeline-v2"
    assert timeline["frame_interval_seconds"] == 1
    assert timeline["kinds"] == ["car", "pedestrian", "bicycle", "scooter"]
    assert timeline["agents"] == [["car-1", 0], ["bike-3", 2], ["scooter-1", 3], ["ped-7", 1]]
    first, second = timeline["frames"]
    assert first["time_seconds"] == 4 and "edges" not in first
    assert first["agents"][:5] == [0, -79.399875, 43.65004, 90, 8.5]
    # Agents keep their index across frames; only busy edges are listed.
    assert second["agents"][15:20] == [3, -79.39998, 43.65002, 90, 8.5]
    assert second["edges"] == [0, 5.0, 1]
    assert timeline["edges"] == [["edge-1", 10.0]]
    assert not path.with_name(f"{path.name}.partial").exists()


def test_frame_interval_caps_frames_per_run():
    assert frame_interval_seconds(200) == 1
    assert frame_interval_seconds(600) == 1
    assert frame_interval_seconds(601) == 2
    assert frame_interval_seconds(3600) == 6


def test_generated_cyclists_are_not_counted_as_cars():
    assert is_active_vehicle("bike-12") and is_active_vehicle("scooter-0")
    assert not is_active_vehicle("downtown-12")
