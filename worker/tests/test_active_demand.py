from pathlib import Path

from traffic_worker import active_demand
from traffic_worker.runner import warmup_seconds
from traffic_worker.speed_limits import write_speed_patch

NETWORK = """<net>
  <edge id=":j0_0" function="internal"><lane id=":j0_0_0" shape="0,0 1,1"/></edge>
  <edge id="a"><lane id="a_0" allow="pedestrian" shape="0,0 100,0"/><lane id="a_1" disallow="pedestrian" shape="0,3 100,3"/></edge>
  <edge id="b"><lane id="b_0" allow="pedestrian" shape="600,0 700,0"/><lane id="b_1" disallow="pedestrian" shape="600,3 700,3"/></edge>
  <edge id="c"><lane id="c_0" allow="pedestrian" shape="0,600 100,600"/><lane id="c_1" disallow="pedestrian" shape="0,603 100,603"/></edge>
  <edge id="d"><lane id="d_0" allow="passenger" shape="0,900 100,900"/></edge>
</net>"""

# Cars run on a and b only, so people should mostly use those streets.
DEMAND = """<routes>
  <vehicle id="car-0" depart="0.00"><route edges="a b"/></vehicle>
  <vehicle id="car-1" depart="2.00"><route edges="a b"/></vehicle>
  <vehicle id="car-2" depart="4.00"><route edges="b a"/></vehicle>
  <vehicle id="car-3" depart="90.00"><route edges="a b"/></vehicle>
  <vehicle id="late" depart="500.00"><route edges="a b"/></vehicle>
</routes>"""


def files(tmp_path: Path) -> tuple[Path, Path]:
    network = tmp_path / "net.xml"
    network.write_text(NETWORK)
    demand = tmp_path / "demand.rou.xml"
    demand.write_text(DEMAND)
    return network, demand


def test_edges_split_sidewalks_from_rideable_roads(tmp_path: Path):
    network, _ = files(tmp_path)
    walkable, rideable = active_demand._edges(network)
    assert [edge for edge, *_ in walkable] == ["a", "b", "c"]
    assert [edge for edge, *_ in rideable] == ["a", "b", "c"]


def test_car_demand_counts_departures_and_route_volume(tmp_path: Path):
    _, demand = files(tmp_path)
    departures, volume = active_demand.car_demand(demand, horizon_seconds=120)
    assert departures == [0.0, 2.0, 4.0, 90.0]
    assert volume == {"a": 4, "b": 4}


def test_closed_edges_are_not_active_trip_endpoints(tmp_path: Path):
    network = tmp_path / "closed.net.xml"
    network.write_text('<net><edge id="closed"><lane disallow="all" shape="0,0 100,0"/></edge></net>')
    assert active_demand._edges(network) == ([], [])


def test_active_demand_follows_the_car_demand(tmp_path: Path, monkeypatch):
    network, demand = files(tmp_path)
    monkeypatch.setattr(active_demand, "_run", lambda *args: None)

    def trips(seed: int) -> str:
        active_demand.write_active_demand(network, tmp_path, seed, 120, demand)
        return (tmp_path / "active.trips.xml").read_text()

    first = trips(7)
    assert first == trips(7)
    assert first != trips(8)
    # Two pedestrians per car trip inside the horizon.
    assert first.count("<person ") == 8
    departures = [float(part.split('"')[1]) for part in first.split("depart=")[1:]]
    assert departures == sorted(departures)
    # People leave within one car spacing (120 s / 4 cars) of a car.
    assert not any(34 < d < 90 for d in departures)
    # Streets the cars use are five times likelier ends than the quiet one.
    ends = [part.split('"')[1] for part in first.replace("to=", "from=").split("from=")[1:]]
    assert ends.count("c") < (ends.count("a") + ends.count("b")) / 2


OSM = """<osm>
  <node id="1" lat="0" lon="0"/>
  <way id="10"><tag k="highway" v="secondary"/></way>
  <way id="11"><tag k="highway" v="residential"/><tag k="maxspeed" v="30"/></way>
  <way id="12"><tag k="highway" v="motorway"/></way>
</osm>"""


def test_unposted_streets_get_the_city_default(tmp_path: Path):
    network = tmp_path / "net.xml"
    network.write_text("""<net>
      <edge id="-10#0"/><edge id="10#1"/><edge id="11#0"/><edge id="12"/>
      <edge id=":j" function="internal"/>
    </net>""")
    osm = tmp_path / "source.osm.xml"
    osm.write_text(OSM)
    patch = tmp_path / "speeds.edg.xml"
    assert write_speed_patch(network, osm, patch) == 2
    text = patch.read_text()
    assert 'id="-10#0" speed="11.1111"' in text and 'id="10#1"' in text
    assert 'id="11#0"' not in text and 'id="12"' not in text


def test_warmup_fills_streets_without_passing_the_demand():
    assert warmup_seconds(200) == 600
    assert warmup_seconds(3200) == 400
    assert warmup_seconds(3600) == 0
