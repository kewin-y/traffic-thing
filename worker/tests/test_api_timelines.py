import uuid
from pathlib import Path

from fastapi.testclient import TestClient

from traffic_worker.api import app


def test_timeline_download_requires_authentication_and_serves_recording(
    tmp_path: Path, monkeypatch
):
    timeline_id = uuid.uuid4().hex
    timeline = b"compressed timeline data"
    monkeypatch.setenv("WORKER_API_KEY", "test-key")
    monkeypatch.setenv("TIMELINE_ROOT", str(tmp_path))

    with TestClient(app) as client:
        (tmp_path / f"{timeline_id}.json.gz").write_bytes(timeline)

        unauthorized = client.get(f"/timelines/{timeline_id}")
        response = client.get(
            f"/timelines/{timeline_id}",
            headers={"Authorization": "Bearer test-key"},
        )

    assert unauthorized.status_code == 401
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/gzip"
    assert response.content == timeline
