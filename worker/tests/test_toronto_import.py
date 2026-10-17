import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

script = Path(__file__).resolve().parents[2] / "scripts" / "import-toronto.py"
spec = importlib.util.spec_from_file_location("toronto_import", script)
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


def test_import_bounds_contain_cn_tower_and_surrounding_buffer():
    west, south, east, north = importer.SELECTION
    assert west < -79.3871 < east
    assert south < 43.6426 < north
    buffered = importer.buffered_bounds(importer.SELECTION, 750)
    assert buffered[0] < west < east < buffered[2]
    assert buffered[1] < south < north < buffered[3]
    # Overpass uses south,west,north,east; the manifest uses west,south,east,north.
    assert f"({south},{west},{north},{east})" in importer.osm_query(importer.SELECTION)
    assert 'rel["type"="restriction"]' in importer.osm_query(buffered)


@pytest.mark.parametrize(
    "body",
    [
        "<osm><remark>query timed out</remark></osm>",
        "<html>not OSM</html>",
        "<osm></osm>",
    ],
)
def test_rejects_incomplete_or_failed_downloads(tmp_path, body):
    path = tmp_path / "source.osm.xml"
    path.write_text(body)
    with pytest.raises(ValueError):
        importer.validate_osm(path)


def test_geojson_uses_sumo_ids_and_geographic_coordinates(tmp_path):
    lane = SimpleNamespace(getParam=lambda name, default: "123")
    edge = SimpleNamespace(
        allows=lambda vehicle: True,
        getID=lambda: "-123#0",
        getLanes=lambda: [lane],
        getName=lambda: "Bremner Boulevard",
        getLaneNumber=lambda: 2,
        getSpeed=lambda: 13.89,
        getLength=lambda: 200,
        getShape=lambda **kwargs: [(10, 20), (30, 40)],
    )
    network = SimpleNamespace(
        getEdges=lambda: [edge],
        convertXY2LonLat=lambda x, y: (-79.4 + x / 10000, 43.64 + y / 10000),
    )
    path = tmp_path / "edges.geojson"
    assert importer.export_edges(network, path) == 1
    feature = json.loads(path.read_text())["features"][0]
    assert feature["id"] == feature["properties"]["edge_id"] == "-123#0"
    assert feature["properties"]["osm_way_ids"] == ["123"]
    assert feature["geometry"]["coordinates"] == [[-79.399, 43.642], [-79.397, 43.644]]


def test_failed_regeneration_preserves_existing_import_and_uses_cached_snapshot(
    tmp_path, monkeypatch
):
    target = tmp_path / importer.NAME
    target.mkdir()
    previous = target / "network.net.xml"
    previous.write_text("previous network")
    cache = tmp_path / ".cache"
    cache.mkdir()
    (cache / f"{importer.NAME}.osm.xml").write_text(
        '<osm><node id="1"/><way id="2"/></osm>'
    )
    monkeypatch.setattr(
        "sys.argv", ["import-toronto.py", "--output-root", str(tmp_path), "--force"]
    )

    def fail(*args):
        raise RuntimeError("conversion failed")

    monkeypatch.setattr(importer, "prepare", fail)
    monkeypatch.setattr(
        importer,
        "download_osm",
        lambda *args: pytest.fail("Must reuse the cached snapshot"),
    )
    with pytest.raises(RuntimeError, match="conversion failed"):
        importer.main()
    assert previous.read_text() == "previous network"
    assert sorted(path.name for path in tmp_path.iterdir()) == [".cache", importer.NAME]


def test_existing_import_requires_force_before_downloading(tmp_path, monkeypatch):
    (tmp_path / importer.NAME).mkdir()
    monkeypatch.setattr(
        "sys.argv", ["import-toronto.py", "--output-root", str(tmp_path)]
    )
    monkeypatch.setattr(
        importer, "download_osm", lambda *args: pytest.fail("Must not download")
    )
    with pytest.raises(SystemExit) as error:
        importer.main()
    assert error.value.code == 2
