import hashlib
import json
import threading
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from traffic_worker import api, consumer
from traffic_worker.assets import verify_network_version
from traffic_worker.receipts import claim_receipt, ReceiptBusy, ReceiptConflict


def test_network_version_checks_actual_inputs(tmp_path, monkeypatch):
    directory = tmp_path / "demo"
    directory.mkdir()
    hashes = {}
    for name in ["network.net.xml", "demand.rou.xml"]:
        (directory / name).write_text("<test/>")
        hashes[name] = hashlib.sha256(b"<test/>").hexdigest()
    version = hashlib.sha256(json.dumps(hashes, sort_keys=True).encode()).hexdigest()[:16]
    (directory / "manifest.json").write_text(json.dumps({"network": "demo", "network_version": version, "sha256": hashes}))
    assert verify_network_version(tmp_path, "demo", version) == version
    from traffic_worker import runner
    from traffic_worker.models import SimulationRequest
    monkeypatch.setenv("NETWORK_ROOT", str(tmp_path))
    monkeypatch.setattr(runner, "_edited_network", lambda request, source, scratch: source)
    monkeypatch.setattr(runner, "_simulate", lambda *args: {"completed": 5})
    assert runner.run_simulation(SimulationRequest(network="demo", network_version=version)) == {
        "completed": 5,
        "demand_source": "mounted",
    }
    with pytest.raises(ValueError):
        verify_network_version(tmp_path, "demo", "0" * 16)
    (directory / "demand.rou.xml").write_text("modified")
    with pytest.raises(ValueError, match="manifest"):
        verify_network_version(tmp_path, "demo", version)


def test_receipts_cache_results_and_lock_duplicate_requests(tmp_path):
    with claim_receipt(tmp_path, "run-1", {"seed": 42}) as receipt:
        with pytest.raises(ReceiptBusy):
            with claim_receipt(tmp_path, "run-1", {"seed": 42}):
                pass
        receipt.store({"completed": 5})
    with claim_receipt(tmp_path, "run-1", {"seed": 42}) as receipt:
        assert receipt.cached == {"fingerprint": receipt.fingerprint, "body": {"completed": 5}, "status": 200}
    with pytest.raises(ReceiptConflict):
        with claim_receipt(tmp_path, "run-1", {"seed": 43}):
            pass


def test_duplicate_api_delivery_executes_once_and_survives_restart(tmp_path, monkeypatch):
    monkeypatch.setenv("WORKER_API_KEY", "test-key")
    monkeypatch.setenv("RUN_ROOT", str(tmp_path / "runs"))
    monkeypatch.setenv("TIMELINE_ROOT", str(tmp_path / "timelines"))
    monkeypatch.setenv("SIMULATION_POLLING", "false")
    executions = []
    def execute(payload, request):
        executions.append(payload)
        return {"completed": 5, "request_id": payload.request_id}
    monkeypatch.setattr(api, "execute_simulation", execute)
    kwargs = {"headers": {"Authorization": "Bearer test-key"}, "json": {"network": "demo", "request_id": "run-1"}}
    with TestClient(api.app) as client:
        assert client.post("/simulate", **kwargs).status_code == 200
        assert client.post("/simulate", **kwargs).json()["completed"] == 5
    with TestClient(api.app) as client:
        assert client.post("/simulate", **kwargs).status_code == 200
        assert client.post("/simulate", **{**kwargs, "json": {**kwargs["json"], "seed": 43}}).status_code == 409
    assert len(executions) == 1


def test_consumer_delivers_local_result_without_public_worker_url(monkeypatch):
    stop = threading.Event()
    requests = []
    def handler(request):
        requests.append(request)
        assert request.headers["authorization"] == "Bearer secret"
        if request.url.path == "/simulations/claim":
            return httpx.Response(200, json={"runId": "run-1", "leaseId": 1, "request": {"network": "demo", "edits": []}})
        if request.url.path == "/simulate":
            assert request.url.host == "127.0.0.1"
            return httpx.Response(200, json={"completed": 5})
        assert request.url.path == "/simulations/complete"
        assert json.loads(request.content)["result"] == {"completed": 5}
        stop.set()
        return httpx.Response(200, json={"accepted": True})
    client_class = httpx.Client
    monkeypatch.setattr(consumer.httpx, "Client", lambda **kw: client_class(transport=httpx.MockTransport(handler), **kw))
    consumer.consume("https://test.convex.site", "secret", stop, "http://127.0.0.1:8000")
    assert len(requests) == 3
