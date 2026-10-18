"""Pedestrian, cyclist and e-scooter demand simulated alongside the car demand.

The published networks are imported for cars only. At run time netconvert
guesses sidewalks and crossings and applies posted speed limits, and walking
and cycling trips are derived from the car demand itself: a fixed number per
car trip, departing when the cars do, starting and ending on streets in
proportion to how many car routes use them. Busier periods and streets in
the simulation therefore carry more people, and nothing is added at random
beyond the run's seed. Unroutable generated trips are dropped by duarouter,
keeping the strict route checks for the operator's car demand.
"""

import hashlib
import math
import os
import random
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from bisect import bisect_left
from collections import Counter
from itertools import accumulate
from pathlib import Path

from .speed_limits import UNPOSTED_KMH, write_speed_patch

# Trips generated per car trip in the demand (1,800 cars/hour downtown gives
# 3,600 walking, 600 cycling and 180 e-scooter trips an hour).
PEDESTRIANS_PER_CAR = 2.0
CYCLISTS_PER_CAR = 1 / 3
SCOOTERS_PER_CAR = 0.1
#: Bump when the derived network changes, so cached copies are rebuilt.
NETWORK_RULES = f"sidewalks-crossings-unposted{UNPOSTED_KMH}-v2"
WALK_METRES = (150.0, 1200.0)
RIDE_METRES = (400.0, 3000.0)

# Generated agents carry these prefixes; car metrics exclude them.
PEDESTRIAN_PREFIX = "ped-"
CYCLIST_PREFIX = "bike-"
SCOOTER_PREFIX = "scooter-"
ACTIVE_VEHICLE_PREFIXES = (CYCLIST_PREFIX, SCOOTER_PREFIX)


def _run(*arguments: str) -> None:
    completed = subprocess.run(
        list(arguments),
        stdin=subprocess.DEVNULL,
        stdout=sys.stderr,
        stderr=sys.stderr,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"{Path(arguments[0]).name} failed with exit status {completed.returncode}")


def _cache_directory() -> Path:
    return Path(
        os.environ.get("WALKABLE_NETWORK_CACHE", Path(tempfile.gettempdir()) / "traffic-worker-walkable")
    )


def walkable_network(source: Path, scratch: Path, osm: Path | None = None) -> Path:
    """The network with posted speed limits, sidewalks and crossings.

    With the OSM source, streets without a posted limit get the city default
    (see speed_limits). Cached by the content of both inputs.
    """
    import sumolib

    digest = hashlib.sha256(NETWORK_RULES.encode())
    for path in (source, osm):
        if path is not None:
            with path.open("rb") as stream:
                digest.update(hashlib.file_digest(stream, "sha256").digest())
    key = digest.hexdigest()
    cache = _cache_directory()
    cached = cache / f"{key}.net.xml"
    if cached.is_file():
        return cached
    output = scratch / "walkable.net.xml"
    patch = scratch / "speed-limits.edg.xml"
    speeds = ["--edge-files", str(patch)] if osm and write_speed_patch(source, osm, patch) else []
    _run(
        sumolib.checkBinary("netconvert"),
        "--sumo-net-file", str(source),
        *speeds,
        "--sidewalks.guess", "true",
        "--crossings.guess", "true",
        "--output-file", str(output),
        "--no-warnings", "true",
        "--ignore-errors", "false",
    )
    try:
        cache.mkdir(parents=True, exist_ok=True)
        partial = cache / f"{key}.{os.getpid()}.partial"
        shutil.copyfile(output, partial)
        os.replace(partial, cached)
    except OSError:
        # A read-only or full cache only costs the next run a rebuild.
        return output
    return cached


def _edges(network: Path) -> tuple[list[tuple[str, float, float]], list[tuple[str, float, float]]]:
    """Edges with a sidewalk and edges cyclists may ride, with their midpoints."""
    walkable: list[tuple[str, float, float]] = []
    rideable: list[tuple[str, float, float]] = []
    for _, element in ET.iterparse(network, events=("end",)):
        if element.tag != "edge":
            continue
        edge_id = element.get("id", "")
        if element.get("function") or edge_id.startswith(":"):
            element.clear()
            continue
        walk = ride = False
        middle: tuple[float, float] | None = None
        for lane in element.iter("lane"):
            allow = set(lane.get("allow", "").split())
            disallow = set(lane.get("disallow", "").split())
            if "pedestrian" in allow and len(allow) <= 2:
                walk = True
            elif ("bicycle" in allow) or (not allow and "bicycle" not in disallow):
                ride = True
            if middle is None:
                points = [tuple(map(float, p.split(","))) for p in lane.get("shape", "").split()]
                if points:
                    middle = points[len(points) // 2][:2]  # type: ignore[assignment]
        if middle:
            if walk:
                walkable.append((edge_id, *middle))
            if ride:
                rideable.append((edge_id, *middle))
        element.clear()
    return walkable, rideable


class _Weighted:
    """Edges drawn in proportion to how many car routes use them."""

    def __init__(self, edges: list[tuple[str, float, float]], volume: Counter[str]):
        self.edges = edges
        self.cumulative = list(accumulate(1 + volume[edge] for edge, *_ in edges))

    def draw(self, rng: random.Random):
        return self.edges[bisect_left(self.cumulative, rng.uniform(0, self.cumulative[-1]))]


def _pick(rng: random.Random, edges: _Weighted, bounds: tuple[float, float]):
    """An origin and a destination roughly `bounds` metres apart."""
    for _ in range(40):
        origin = edges.draw(rng)
        destination = edges.draw(rng)
        distance = math.dist(origin[1:], destination[1:])
        if origin[0] != destination[0] and bounds[0] <= distance <= bounds[1]:
            return origin[0], destination[0]
    return None


def car_demand(demand: Path, horizon_seconds: float) -> tuple[list[float], Counter[str]]:
    """Car departures before the horizon, and how many car routes use each edge."""
    departures: list[float] = []
    volume: Counter[str] = Counter()
    for _, element in ET.iterparse(demand, events=("end",)):
        if element.tag in ("vehicle", "trip"):
            depart = element.get("depart", "")
            try:
                time = float(depart)
            except ValueError:
                time = None
            if time is not None and time < horizon_seconds:
                departures.append(time)
                route = element.find("route")
                if route is not None:
                    volume.update(route.get("edges", "").split())
                else:
                    volume.update(e for e in (element.get("from"), element.get("to")) if e)
            element.clear()
    return departures, volume


def write_active_demand(
    network: Path,
    scratch: Path,
    seed: int,
    horizon_seconds: int,
    demand: Path,
) -> Path:
    """Generate and route walking and cycling trips that follow the car demand."""
    import sumolib

    rng = random.Random(seed)
    walkable, rideable = _edges(network)
    departures, volume = car_demand(demand, horizon_seconds)
    root = ET.Element("routes")
    ET.SubElement(root, "vType", {"id": "bike", "vClass": "bicycle"})
    ET.SubElement(root, "vType", {
        "id": "escooter", "vClass": "bicycle", "maxSpeed": "6.94",
        "length": "1.2", "width": "0.6", "speedDev": "0.05",
    })
    trips: list[tuple[float, ET.Element]] = []
    spacing = (horizon_seconds / len(departures)) if departures else 0
    for kind, prefix, per_car, edges, bounds in [
        ("walk", PEDESTRIAN_PREFIX, PEDESTRIANS_PER_CAR, walkable, WALK_METRES),
        ("bike", CYCLIST_PREFIX, CYCLISTS_PER_CAR, rideable, RIDE_METRES),
        ("escooter", SCOOTER_PREFIX, SCOOTERS_PER_CAR, rideable, RIDE_METRES),
    ]:
        if not edges:
            continue
        weighted = _Weighted(edges, volume)
        index = 0
        for car_depart in departures:
            count = int(per_car) + (rng.random() < per_car - int(per_car))
            for _ in range(count):
                depart = min(horizon_seconds - 1, car_depart + rng.uniform(0, spacing))
                pair = _pick(rng, weighted, bounds)
                if pair is None:
                    continue
                trip_id = f"{prefix}{index}"
                index += 1
                if kind == "walk":
                    person = ET.Element("person", {"id": trip_id, "depart": f"{depart:.1f}"})
                    ET.SubElement(person, "personTrip", {"from": pair[0], "to": pair[1]})
                    trips.append((depart, person))
                else:
                    trips.append((depart, ET.Element("trip", {
                        "id": trip_id, "type": kind, "depart": f"{depart:.1f}",
                        "from": pair[0], "to": pair[1],
                    })))
    # SUMO requires route files sorted by departure.
    for _, element in sorted(trips, key=lambda item: item[0]):
        root.append(element)
    trips_path = scratch / "active.trips.xml"
    ET.ElementTree(root).write(trips_path, encoding="utf-8", xml_declaration=True)
    routed = scratch / "active.rou.xml"
    _run(
        sumolib.checkBinary("duarouter"),
        "--net-file", str(network),
        "--route-files", str(trips_path),
        "--output-file", str(routed),
        "--ignore-errors", "true",
        "--no-warnings", "true",
        "--no-step-log", "true",
        "--seed", str(seed),
        "--repair", "false",
    )
    return routed


def is_active_vehicle(vehicle_id: str) -> bool:
    return vehicle_id.startswith(ACTIVE_VEHICLE_PREFIXES)
