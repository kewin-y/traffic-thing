"""Tests for model-driven demand handling (traffic_worker/demand.py)."""
import xml.etree.ElementTree as ET

from traffic_worker.demand import sample_demand, write_edgedata


def write_candidates(path, through: str = "e1 closed e2", around: str = "e1 e3 e2"):
    routes = ET.Element("routes")
    for i in range(6):
        edges = through if i % 2 == 0 else around
        vehicle = ET.SubElement(routes, "vehicle", id=f"v{i}", depart=f"{i}.00")
        ET.SubElement(vehicle, "route", edges=edges)
    ET.ElementTree(routes).write(path, encoding="utf-8", xml_declaration=True)


def test_write_edgedata_scales_omits_zero_counts_and_keeps_closed(tmp_path):
    path = tmp_path / "edgedata.xml"
    write_edgedata(
        [("busy", 3600.0), ("quiet", 0.5)],
        closed=["shut"],
        duration_seconds=1800,
        path=path,
    )
    edges = {e.get("id"): e.get("entered") for e in ET.parse(path).getroot().iter("edge")}
    # quiet is omitted (unconstrained), shut is written with 0 (prohibited)
    assert edges == {"busy": "1800", "shut": "0"}


def test_sample_demand_never_uses_zero_count_edges(tmp_path):
    """A closed edge has target count 0; sampled routes must avoid it when a
    bypass candidate exists. Verified against the real eclipse-sumo routeSampler."""
    candidates = tmp_path / "candidates.rou.xml"
    edgedata = tmp_path / "edgedata.xml"
    output = tmp_path / "sampled.rou.xml"
    write_candidates(candidates)
    write_edgedata(
        [("e1", 3600.0), ("e2", 3600.0), ("e3", 3600.0)],
        closed=["closed"],
        duration_seconds=3600,
        path=edgedata,
    )

    sample_demand(candidates, edgedata, 3600, seed=42, output=output)

    routes = [r.get("edges") for r in ET.parse(output).getroot().iter("route")]
    assert routes, "routeSampler produced no routes"
    assert all("closed" not in edges.split() for edges in routes)


def test_sample_demand_writes_nothing_when_every_candidate_is_forbidden(tmp_path):
    """If no candidate avoids the closed edge, routeSampler must not silently
    emit routes that violate the 0 target."""
    candidates = tmp_path / "candidates.rou.xml"
    edgedata = tmp_path / "edgedata.xml"
    output = tmp_path / "sampled.rou.xml"
    write_candidates(candidates, through="e1 closed e2", around="e1 closed e2")
    write_edgedata(
        [("e1", 3600.0), ("e2", 3600.0), ("e3", 3600.0)],
        closed=["closed"],
        duration_seconds=3600,
        path=edgedata,
    )

    sample_demand(candidates, edgedata, 3600, seed=42, output=output)

    assert list(ET.parse(output).getroot().iter("route")) == []
