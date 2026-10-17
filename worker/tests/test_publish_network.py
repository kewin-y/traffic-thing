import hashlib
import importlib.util
import json
from pathlib import Path

import httpx
import pytest

script = Path(__file__).resolve().parents[2] / "scripts" / "publish-network.py"
spec = importlib.util.spec_from_file_location("publish_network", script)
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


@pytest.fixture
def local_network(tmp_path):
    files = {
        "source.osm.xml": b"source",
        "network.net.xml": b"network",
        "demand.rou.xml": b"demand",
        "edges.geojson": b'{"type":"FeatureCollection","features":[]}',
    }
    for name, content in files.items():
        (tmp_path / name).write_bytes(content)
    checksums = {
        name: hashlib.sha256(content).hexdigest() for name, content in files.items()
    }
    manifest = {
        "network": "toronto-downtown",
        "network_version": hashlib.sha256(
            json.dumps(checksums, sort_keys=True).encode()
        ).hexdigest()[:16],
        "sha256": checksums,
    }
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    return tmp_path, manifest


def test_publishes_original_bytes_and_retries_transient_failure(
    local_network, monkeypatch
):
    directory, manifest = local_network
    attempts = []

    def handle(request):
        attempts.append(request)
        assert str(request.url) == "https://example.convex.site/networks/publish"
        assert request.headers["authorization"] == "Bearer test-key"
        body = request.read()
        assert (directory / "manifest.json").read_bytes() in body
        assert (directory / "edges.geojson").read_bytes() in body
        assert b'name="geojson"' in body
        assert b'name="manifest"' in body
        if len(attempts) == 1:
            return httpx.Response(503)
        return httpx.Response(
            201,
            json={
                "id": "network-id",
                "network": manifest["network"],
                "version": manifest["network_version"],
                "created": True,
            },
        )

    client = httpx.Client
    monkeypatch.setattr(
        publisher.httpx,
        "Client",
        lambda **kwargs: client(transport=httpx.MockTransport(handle), **kwargs),
    )
    assert (
        publisher.publish(directory, "https://example.convex.site/", "test-key")["id"]
        == "network-id"
    )
    assert len(attempts) == 2
    assert publisher.load_assets(directory)[0] == manifest


@pytest.mark.parametrize(
    "filename", ["edges.geojson", "network.net.xml", "demand.rou.xml", "source.osm.xml"]
)
def test_rejects_mismatched_local_assets_before_contacting_convex(
    local_network, monkeypatch, filename
):
    directory, _ = local_network
    (directory / filename).write_text("modified")
    monkeypatch.setattr(
        publisher.httpx,
        "Client",
        lambda **kwargs: pytest.fail("Must validate before upload"),
    )
    with pytest.raises(ValueError, match="checksum"):
        publisher.publish(directory, "https://example.convex.site", "test-key")


def test_bad_credentials_are_not_retried_and_keep_local_assets(
    local_network, monkeypatch
):
    directory, manifest = local_network
    attempts = []

    def handle(request):
        attempts.append(request)
        return httpx.Response(401)

    client = httpx.Client
    monkeypatch.setattr(
        publisher.httpx,
        "Client",
        lambda **kwargs: client(transport=httpx.MockTransport(handle), **kwargs),
    )
    with pytest.raises(RuntimeError, match="HTTP 401"):
        publisher.publish(directory, "https://example.convex.site", "test-key")
    assert len(attempts) == 1
    assert publisher.load_assets(directory)[0] == manifest


@pytest.mark.parametrize(
    "url",
    [
        "",
        "http://example.convex.site",
        "https://example.convex.cloud",
        "https://user:pass@example.com",
        "https://example.com/path",
    ],
)
def test_rejects_invalid_publish_destination(local_network, url):
    with pytest.raises(ValueError):
        publisher.publish(local_network[0], url, "test-key")
