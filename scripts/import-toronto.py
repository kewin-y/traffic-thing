"""Prepare the CN Tower test region inside the Docker importer image."""

import argparse
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

import httpx
import sumo
import sumolib

NAME = "toronto-downtown"
# West, south, east, north in WGS84. CN Tower: approximately -79.3871, 43.6426.
SELECTION = (-79.405, 43.635, -79.370, 43.660)
BUFFER_METRES = 750
SEED = 42
DURATION_SECONDS = 3600
PERIOD_SECONDS = 2
ATTRIBUTION = "© OpenStreetMap contributors"
ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)


def buffered_bounds(bounds, metres):
    west, south, east, north = bounds
    latitude_padding = metres / 111_320
    longitude_padding = latitude_padding / math.cos(math.radians((south + north) / 2))
    return tuple(
        round(value, 7)
        for value in (
            west - longitude_padding,
            south - latitude_padding,
            east + longitude_padding,
            north + latitude_padding,
        )
    )


def osm_query(bounds):
    west, south, east, north = bounds
    bbox = f"{south},{west},{north},{east}"
    # Include turn restrictions and their referenced ways/nodes as well as roads.
    return (
        f'[out:xml][timeout:120];(way["highway"]({bbox});'
        f'rel["type"="restriction"]({bbox}););(._;>>;);out body;'
    )


def validate_osm(path):
    nodes = ways = 0
    for _, element in ET.iterparse(path):
        if element.tag == "remark":
            raise ValueError(f"Overpass reported: {element.text}")
        nodes += element.tag == "node"
        ways += element.tag == "way"
        element.clear()
    if not nodes or not ways:
        raise ValueError("OSM response contains no road network")


def download_osm(path, bounds):
    for endpoint in ENDPOINTS:
        try:
            print(f"Downloading roads from {endpoint}", flush=True)
            with httpx.stream(
                "POST",
                endpoint,
                data={"data": osm_query(bounds)},
                timeout=150,
                headers={"User-Agent": "traffic-thing-toronto-import/1.0"},
            ) as response:
                response.raise_for_status()
                with path.open("wb") as output:
                    size = 0
                    for chunk in response.iter_bytes():
                        size += len(chunk)
                        if size > 64 * 1024 * 1024:
                            raise ValueError(
                                "OSM download exceeds the 64 MiB import limit"
                            )
                        output.write(chunk)
            validate_osm(path)
            return endpoint
        except (httpx.HTTPError, ValueError, ET.ParseError) as error:
            print(f"Download failed: {error}", file=sys.stderr)
            path.unlink(missing_ok=True)
    raise RuntimeError("OSM download failed on both Overpass endpoints; retry later")


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)


def export_edges(network, path):
    features = []
    for edge in sorted(network.getEdges(), key=lambda edge: edge.getID()):
        if not edge.allows("passenger"):
            continue
        lanes = edge.getLanes()
        features.append(
            {
                "type": "Feature",
                "id": edge.getID(),
                "properties": {
                    "edge_id": edge.getID(),
                    "name": edge.getName(),
                    "osm_way_ids": sorted(
                        {
                            osm_id
                            for lane in lanes
                            for osm_id in lane.getParam("origId", "").split()
                            if osm_id
                        }
                    ),
                    "lane_count": edge.getLaneNumber(),
                    "speed_mps": edge.getSpeed(),
                    "length_metres": edge.getLength(),
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        [round(lon, 7), round(lat, 7)]
                        for lon, lat in (
                            network.convertXY2LonLat(x, y)
                            for x, y in edge.getShape(includeJunctions=True)
                        )
                    ],
                },
            }
        )
    if not features:
        raise ValueError("Imported network contains no passenger roads")
    path.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "attribution": ATTRIBUTION,
                "features": features,
            },
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    return len(features)


def sha256(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def prepare(source, stage, bounds):
    network_path = stage / "network.net.xml"
    # Clip complete road edges at a buffered boundary; do not cut lane geometry.
    run(
        sumolib.checkBinary("netconvert"),
        "--osm-files",
        source,
        "--output-file",
        network_path,
        "--keep-edges.in-geo-boundary",
        ",".join(map(str, bounds)),
        "--keep-edges.by-vclass",
        "passenger",
        "--keep-edges.components",
        "1",
        "--geometry.remove",
        "true",
        "--output.original-names",
        "true",
        "--output.street-names",
        "true",
        "--osm.turn-lanes",
        "true",
        "--no-turnarounds",
        "true",
    )
    tools = Path(sumo.__file__).parent / "tools"
    run(
        sys.executable,
        tools / "randomTrips.py",
        "--net-file",
        network_path,
        "--output-trip-file",
        stage / "trips.trips.xml",
        "--route-file",
        stage / "demand.rou.xml",
        "--seed",
        SEED,
        "--end",
        DURATION_SECONDS,
        "--period",
        PERIOD_SECONDS,
        "--vehicle-class",
        "passenger",
        "--prefix",
        "downtown-",
        "--fringe-factor",
        "5",
        "--length",
        "--lanes",
        "--min-distance",
        "300",
    )
    vehicles = sum(
        1
        for _, element in ET.iterparse(stage / "demand.rou.xml")
        if element.tag == "vehicle"
    )
    if not vehicles:
        raise ValueError("Routing produced no vehicles")
    network = sumolib.net.readNet(str(network_path))
    edge_count = export_edges(network, stage / "edges.geojson")
    # Fail the import if SUMO cannot load all routes, even beyond this short smoke run.
    run(
        sumolib.checkBinary("sumo"),
        "--net-file",
        network_path,
        "--route-files",
        stage / "demand.rou.xml",
        "--route-steps",
        "0",
        "--end",
        "1",
        "--no-step-log",
        "true",
        "--ignore-route-errors",
        "false",
    )
    return edge_count, vehicles


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", type=Path, default=Path("/output"))
    parser.add_argument(
        "--force",
        action="store_true",
        help="Replace an existing import after successful generation",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Download a new OSM snapshot (requires --force if already imported)",
    )
    args = parser.parse_args()
    root = args.output_root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    target = root / NAME
    if target.is_symlink() or (target.exists() and not args.force):
        parser.error(f"{target} already exists; use --force to regenerate it")
    bounds = buffered_bounds(SELECTION, BUFFER_METRES)
    cache = root / ".cache"
    cache.mkdir(exist_ok=True)
    snapshot = cache / f"{NAME}.osm.xml"
    with TemporaryDirectory(prefix=f".{NAME}-", dir=root) as directory:
        stage = Path(directory) / NAME
        stage.mkdir()
        if args.refresh or not snapshot.exists():
            download = Path(directory) / "download.osm.xml"
            download_osm(download, bounds)
            os.replace(download, snapshot)
        else:
            print(f"Using saved OSM snapshot: {snapshot}", flush=True)
            validate_osm(snapshot)
        source = stage / "source.osm.xml"
        shutil.copyfile(snapshot, source)
        edges, vehicles = prepare(source, stage, bounds)
        checksums = {
            name: sha256(stage / name)
            for name in (
                "source.osm.xml",
                "network.net.xml",
                "demand.rou.xml",
                "edges.geojson",
            )
        }
        with (stage / "network.net.xml").open("rb") as network_file:
            location = next(
                element.attrib
                for _, element in ET.iterparse(network_file)
                if element.tag == "location"
            )
        sumo_version = subprocess.check_output(
            [sumolib.checkBinary("sumo"), "--version"], text=True
        ).splitlines()[0]
        version = hashlib.sha256(
            json.dumps(checksums, sort_keys=True).encode()
        ).hexdigest()[:16]
        (stage / "manifest.json").write_text(
            json.dumps(
                {
                    "network": NAME,
                    "network_version": version,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "selection_bbox_wgs84": SELECTION,
                    "simulation_bbox_wgs84": bounds,
                    "buffer_metres": BUFFER_METRES,
                    "bbox_order": ["west", "south", "east", "north"],
                    "attribution": ATTRIBUTION,
                    "license_url": "https://www.openstreetmap.org/copyright",
                    "source_query": osm_query(bounds),
                    "source_endpoints": ENDPOINTS,
                    "sumo_version": sumo_version,
                    "edge_count": edges,
                    "demand": {
                        "kind": "synthetic",
                        "seed": SEED,
                        "duration_seconds": DURATION_SECONDS,
                        "period_seconds": PERIOD_SECONDS,
                        "routed_vehicle_count": vehicles,
                    },
                    "location": location,
                    "sha256": checksums,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        backup = Path(directory) / "previous"
        if target.exists():
            target.rename(backup)
        try:
            stage.rename(target)
        except BaseException:
            if backup.exists():
                backup.rename(target)
            raise
    print(f"Created {target}: {edges} road edges, {vehicles} synthetic vehicle routes.")
    print(
        f'POST /simulate with {{"network":"{NAME}","duration_seconds":200,"edits":[]}}'
    )


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"Import failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
