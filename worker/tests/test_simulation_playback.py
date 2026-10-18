"""Exercise API prediction -> routeSampler -> SUMO -> uploaded v2 playback."""

import gzip
import json
import subprocess
import xml.etree.ElementTree as ET

import pandas as pd
import pytest
import sumolib
from fastapi.testclient import TestClient
from traffic_worker import api, runner
from traffic_worker.active_demand import car_demand, walkable_network
from traffic_worker.models import SimulationRequest
from traffic_worker.timing import frame_interval_seconds


@pytest.fixture
def network(tmp_path, monkeypatch):
    directory = tmp_path / "demo"
    directory.mkdir()
    nodes = ET.Element("nodes")
    for name, x, y in [("a", 0, 0), ("b", 1, 0), ("c", 1, 1), ("d", 0, 1)]:
        ET.SubElement(
            nodes, "node", id=name, x=str(-79.4 + x * 0.005), y=str(43.65 + y * 0.004)
        )
    ET.ElementTree(nodes).write(directory / "nodes.xml")
    edges = ET.Element("edges")
    for a, b in [("a", "b"), ("b", "c"), ("c", "d"), ("d", "a")]:
        for start, end in [(a, b), (b, a)]:
            ET.SubElement(
                edges,
                "edge",
                {
                    "id": start + end,
                    "from": start,
                    "to": end,
                    "numLanes": "2",
                    "speed": "13.89",
                },
            )
    ET.ElementTree(edges).write(directory / "edges.xml")
    subprocess.run(
        [
            sumolib.checkBinary("netconvert"),
            "-n",
            str(directory / "nodes.xml"),
            "-e",
            str(directory / "edges.xml"),
            "--proj.utm",
            "true",
            "-o",
            str(directory / "network.net.xml"),
        ],
        check=True,
        capture_output=True,
    )
    routes = ET.Element("routes")
    for i, path in enumerate(["ab bc cd da", "ad dc cb ba"]):
        vehicle = ET.SubElement(routes, "vehicle", id=f"candidate-{i}", depart=str(i))
        ET.SubElement(vehicle, "route", edges=path)
    ET.ElementTree(routes).write(directory / "demand.rou.xml")
    monkeypatch.setenv("NETWORK_ROOT", str(tmp_path))
    monkeypatch.setenv("WALKABLE_NETWORK_CACHE", str(tmp_path / "cache"))
    return directory


class TestPredictor:
    __test__ = False

    def __init__(self):
        self.base_pred = pd.DataFrame(
            {
                "edge_id": ["ab", "bc", "cd", "da", "ad", "dc", "cb", "ba"],
                "veh_per_hour": [900.0] * 8,
            }
        )

    def apply_request_edits(self, edits):
        return (
            self.base_pred.copy(),
            [e.edge_id for e in edits if e.type == "close_edge"],
            [],
        )

    def predict_edited(self, edited, closed):
        edited.loc[edited.edge_id.isin(closed), "veh_per_hour"] = 0
        return edited

    def compare(self, volumes):
        return []


@pytest.mark.parametrize(
    "edits",
    [
        [],
        [{"type": "close_edge", "edge_id": "ab"}],
        [{"type": "set_lane_count", "edge_id": "ab", "lane_count": 1}],
    ],
)
def test_model_run_uploads_populated_recording_after_warmup(
    network, tmp_path, monkeypatch, edits
):
    monkeypatch.setenv("WORKER_API_KEY", "test-key")
    monkeypatch.setenv("CONVEX_SITE_URL", "https://test.convex.site")
    monkeypatch.setenv("SIMULATION_POLLING", "false")
    monkeypatch.setenv("MODEL_ROOT", str(tmp_path / "no-model"))
    monkeypatch.setenv("TIMELINE_ROOT", str(tmp_path / "timelines"))
    recordings = []

    def upload(path, *args):
        with gzip.open(path, "rt") as stream:
            recordings.append(json.load(stream))
        return "test-storage-id"

    monkeypatch.setattr(api, "upload_timeline", upload)
    with TestClient(api.app) as client:
        client.app.state.predictor = TestPredictor()
        client.app.state.model_network = "demo"
        response = client.post(
            "/simulate",
            headers={"Authorization": "Bearer test-key"},
            json={
                "network": "demo",
                "duration_seconds": 200,
                "record": True,
                "edits": edits,
            },
        )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["demand_source"] == "model"
    assert result["warmup_seconds"] == 600
    assert result["simulation_time_seconds"] == 200
    assert result["departed"] > 0 and result["completed"] > 0
    assert result["timeline"]["storage_id"] == "test-storage-id"
    (recording,) = recordings
    assert recording["format"] == "traffic-worker-timeline-v2"
    assert recording["demand_source"] == "model" and recording["warmup_seconds"] == 600
    assert recording["frames"][0]["time_seconds"] == 0
    assert recording["frames"][-1]["time_seconds"] == 200
    assert 0 < len(recording["frames"]) <= 600
    assert recording["frames"][0]["agents"], "warm-up should populate the initial frame"
    assert {kind for _, kind in recording["agents"]} == {0, 1, 2, 3}
    for frame in recording["frames"]:
        for i in range(0, len(frame["agents"]), 5):
            _, lng, lat, _, _ = frame["agents"][i : i + 5]
            assert -79.41 < lng < -79.38 and 43.64 < lat < 43.67
    if edits and edits[0]["type"] == "close_edge":
        assert "ab" not in [edge for edge, _ in recording["edges"]]
    assert list((tmp_path / "timelines").iterdir()) == []


def test_lane_count_preserves_sidewalk_and_requested_vehicle_lanes(network, tmp_path):
    walkable = walkable_network(network / "network.net.xml", tmp_path)
    request = SimulationRequest(
        network="demo",
        edits=[
            {
                "type": "set_lane_count",
                "edge_id": "ab",
                "lane_count": 1,
            }
        ],
    )
    edited = runner._edited_network(request, walkable, tmp_path)
    edge = sumolib.net.readNet(str(edited)).getEdge("ab")
    assert sum(lane.allows("passenger") for lane in edge.getLanes()) == 1
    assert any(lane.allows("pedestrian") for lane in edge.getLanes())


def test_lane_reduction_preserves_a_turn_from_the_removed_lane(network, tmp_path):
    # A turn that only exists from the leftmost lane must survive its removal.
    path = network / "network.net.xml"
    tree = ET.parse(path)
    root = tree.getroot()
    for connection in list(root.findall("connection")):
        if connection.get("from") == "ab" and connection.get("to") == "bc":
            root.remove(connection)
    ET.SubElement(
        root,
        "connection",
        {
            "from": "ab",
            "to": "bc",
            "fromLane": "1",
            "toLane": "1",
            "dir": "l",
            "state": "M",
        },
    )
    tree.write(path)
    request = SimulationRequest(
        network="demo",
        edits=[
            {
                "type": "set_lane_count",
                "edge_id": "ab",
                "lane_count": 1,
            }
        ],
    )
    edited = runner._edited_network(request, path, tmp_path)
    net = sumolib.net.readNet(str(edited))
    assert net.getEdge("bc") in net.getEdge("ab").getOutgoing()
    assert all(
        c.getFromLane().getIndex() == 0
        for c in net.getEdge("ab").getOutgoing()[net.getEdge("bc")]
    )


def test_car_demand_reads_named_routes_from_sampler(tmp_path):
    path = tmp_path / "demand.xml"
    path.write_text(
        '<routes><route id="r" edges="a b c"/>'
        '<vehicle id="v" route="r" depart="650"/></routes>'
    )
    departures, volume = car_demand(path, 800)
    assert departures == [650]
    assert volume == {"a": 1, "b": 1, "c": 1}


def test_average_includes_full_trip_only_for_cars_arriving_in_window(tmp_path):
    path = tmp_path / "tripinfo.xml"
    path.write_text(
        "<tripinfos>"
        + "".join(
            f'<tripinfo id="{name}" arrival="{arrival}" duration="{duration}" waitingTime="10" timeLoss="20"/>'
            for name, arrival, duration in [
                ("early", 100, 10),
                ("car", 650, 150),
                ("bike-1", 650, 20),
            ]
        )
        + "</tripinfos>"
    )
    result = runner._completed_trip_metrics(path, 1, {"car"})
    assert result == {
        "average_trip_duration_seconds": 150,
        "average_waiting_time_seconds": 10,
        "average_time_loss_seconds": 20,
    }


def test_frame_budget_includes_initial_and_final_states():
    for duration in range(1, 3601):
        interval = frame_interval_seconds(duration)
        times = {0, duration, *range(interval, duration, interval)}
        assert len(times) <= 600
