import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from traffic_worker import api


@pytest.fixture
def recording_worker(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("WORKER_API_KEY", "test-key")
    monkeypatch.setenv("CONVEX_SITE_URL", "https://test.convex.site")
    monkeypatch.setenv("TIMELINE_ROOT", str(tmp_path))
    monkeypatch.setattr(api, "network_assets", lambda *args: None)

    class FakeProcess:
        returncode = 0

        def __init__(self, *args, env, **kwargs):
            self.env = env

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def communicate(self, payload, timeout):
            if json.loads(payload).get("record"):
                Path(self.env["TIMELINE_OUTPUT_PATH"]).write_bytes(b"recording")
            return '{"completed": 10}', ""

    monkeypatch.setattr(api.subprocess, "Popen", FakeProcess)
    return tmp_path


def mock_convex(monkeypatch, handler):
    client_class = httpx.Client
    monkeypatch.setattr(
        api.httpx, "Client",
        lambda **kwargs: client_class(transport=httpx.MockTransport(handler), **kwargs),
    )


def simulate(client, **kwargs):
    return client.post(
        "/simulate",
        headers={"Authorization": "Bearer test-key"},
        json={"network": "demo", "record": True, **kwargs},
    )


def test_recording_uploads_to_convex_and_removes_local_copy(recording_worker, monkeypatch):
    requests = []

    def convex(request):
        requests.append(request)
        if request.url.path == "/networks/upload-url":
            assert request.headers["authorization"] == "Bearer test-key"
            return httpx.Response(200, json={"uploadUrl": "https://test.convex.cloud/upload"})
        assert "authorization" not in request.headers
        assert request.headers["content-type"] == "application/gzip"
        assert request.headers["content-length"] == "9"
        assert request.read() == b"recording"
        return httpx.Response(200, json={"storageId": "recording-storage-id"})

    mock_convex(monkeypatch, convex)
    with TestClient(api.app) as client:
        response = simulate(client)
    assert response.status_code == 200
    assert response.json()["timeline"] == {
        "storage_id": "recording-storage-id",
        "format": "application/gzip",
        "filename": "timeline.json.gz",
        "sample_interval_seconds": 5,
    }
    assert [r.method for r in requests] == ["POST", "POST"]
    assert list(recording_worker.iterdir()) == []


@pytest.mark.parametrize("failure", ["credentials", "upload", "invalid_json", "invalid_id", "timeout"])
def test_upload_failure_is_reported_and_cleans_up(recording_worker, monkeypatch, failure):
    def convex(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("timeout", request=request)
        if request.url.path == "/networks/upload-url":
            if failure == "credentials":
                return httpx.Response(401)
            if failure == "invalid_json":
                return httpx.Response(200, text="not json")
            return httpx.Response(200, json={"uploadUrl": "https://test.convex.cloud/upload"})
        if failure == "invalid_id":
            return httpx.Response(200, json={"storageId": None})
        return httpx.Response(500)

    mock_convex(monkeypatch, convex)
    with TestClient(api.app) as client:
        assert simulate(client).status_code == 502
        # Failed uploads must release simulation capacity.
        assert simulate(client, record=False).status_code == 200
    assert list(recording_worker.iterdir()) == []


def test_recording_requires_convex_configuration(recording_worker, monkeypatch):
    monkeypatch.delenv("CONVEX_SITE_URL")
    with TestClient(api.app) as client:
        assert simulate(client).status_code == 503
        response = simulate(client, record=False)
    assert response.status_code == 200
    assert "timeline" not in response.json()


def test_simulation_requires_worker_authentication(recording_worker):
    with TestClient(api.app) as client:
        for headers in ({}, {"Authorization": "Bearer wrong-key"}):
            response = client.post(
                "/simulate", json={"network": "demo", "record": True}, headers=headers,
            )
            assert response.status_code == 401
    assert list(recording_worker.iterdir()) == []
