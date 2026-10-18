"""Prediction wiring in /simulate: when it runs and what reaches the runner."""
import xml.etree.ElementTree as ET
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from traffic_worker import api


class FakePredictor:
    def __init__(self):
        self.calls = []

    def apply_request_edits(self, edits):
        self.calls.append(edits)
        return pd.DataFrame({"edge_id": ["e1"]}), ["closed-edge"], ["unknown-edge"]

    def predict_edited(self, edited, closed):
        return pd.DataFrame({"edge_id": ["e1"], "veh_per_hour": [10.0]})

    def compare(self, volumes):
        return [{"edge_id": "e1", "delta_per_day": 5.0}]


@pytest.fixture
def simulating_worker(tmp_path, monkeypatch):
    monkeypatch.setenv("WORKER_API_KEY", "test-key")
    monkeypatch.setenv("TIMELINE_ROOT", str(tmp_path))
    monkeypatch.setenv("PREDICTED_EDGEDATA_PATH", "/stale/leftover.xml")
    monkeypatch.setattr(api, "network_assets", lambda *args: None)

    processes = []

    class FakeProcess:
        returncode = 0

        def __init__(self, *args, env, **kwargs):
            self.env = dict(env)
            processes.append(self)

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def communicate(self, payload, timeout):
            self.edgedata_existed = False
            self.edgedata_at_run = None
            path = self.env.get("PREDICTED_EDGEDATA_PATH")
            if path:
                self.edgedata_existed = Path(path).is_file()
                self.edgedata_at_run = Path(path).read_text()
            return '{"completed": 1}', ""

    monkeypatch.setattr(api.subprocess, "Popen", FakeProcess)
    return processes


def simulate(client, **kwargs):
    return client.post(
        "/simulate",
        headers={"Authorization": "Bearer test-key"},
        json={"network": "toronto-downtown", **kwargs},
    )


def test_edited_request_predicts_and_passes_fresh_edgedata(simulating_worker):
    predictor = FakePredictor()
    with TestClient(api.app) as client:
        client.app.state.predictor = predictor
        response = simulate(client, edits=[{"type": "close_edge", "edge_id": "e1"}])

    assert response.status_code == 200
    assert len(predictor.calls) == 1
    body = response.json()
    assert body["prediction"]["changes"] == [{"edge_id": "e1", "delta_per_day": 5.0}]
    assert body["prediction"]["unmodelled_edge_ids"] == ["unknown-edge"]

    (process,) = simulating_worker
    assert process.env["PREDICTED_EDGEDATA_PATH"] != "/stale/leftover.xml"
    assert process.edgedata_existed
    edges = {
        e.get("id"): e.get("entered")
        for e in ET.fromstring(process.edgedata_at_run).iter("edge")
    }
    # closed edges are written with 0 even when the volumes omit them
    assert edges == {"e1": "10", "closed-edge": "0"}


def test_no_edits_skips_prediction_and_strips_leaked_env(simulating_worker):
    predictor = FakePredictor()
    with TestClient(api.app) as client:
        client.app.state.predictor = predictor
        response = simulate(client)

    assert response.status_code == 200
    assert predictor.calls == []
    assert response.json()["prediction"] is None
    (process,) = simulating_worker
    assert "PREDICTED_EDGEDATA_PATH" not in process.env


def test_disabled_predictor_strips_leaked_env(simulating_worker):
    with TestClient(api.app) as client:
        client.app.state.predictor = None
        response = simulate(client, edits=[{"type": "close_edge", "edge_id": "e1"}])

    assert response.status_code == 200
    assert response.json()["prediction"] is None
    (process,) = simulating_worker
    assert "PREDICTED_EDGEDATA_PATH" not in process.env
