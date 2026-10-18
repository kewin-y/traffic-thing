"""Extract Toronto traffic controls from an imported OpenStreetMap snapshot.

Reads the snapshot that import-toronto saved (networks/<name>/source.osm.xml)
and writes the signals, signs, traffic calming, turn bans and posted speed
limits the editor shows as a reference layer.

    python scripts/extract-traffic-controls.py
"""

import argparse
import json
import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CAR_ROADS = {
    "motorway", "motorway_link", "trunk", "trunk_link", "primary",
    "primary_link", "secondary", "secondary_link", "tertiary",
    "tertiary_link", "unclassified", "residential", "living_street", "service",
}
TURN_BANS = {"no_left_turn", "no_right_turn", "no_u_turn", "no_straight_on"}
CALMING = {"hump", "bump", "table", "cushion"}
# Signs stand at the kerb, not on the centreline the OSM node sits on.
KERB_OFFSET_M = 5.0
# A turn-ban sign stands on the approach, before the intersection.
TURN_SIGN_SETBACK_M = 12.0
METRES_PER_DEGREE = 111_320.0


def tags(element):
    return {tag.get("k"): tag.get("v") for tag in element.findall("tag")}


def bearing(a, b):
    """Compass bearing in degrees from point a to point b, both (lon, lat)."""
    dx = (b[0] - a[0]) * math.cos(math.radians(a[1]))
    dy = b[1] - a[1]
    return math.degrees(math.atan2(dx, dy)) % 360


def move(point, heading, metres):
    lon, lat = point
    rad = math.radians(heading)
    return (
        lon + metres * math.sin(rad) / (METRES_PER_DEGREE * math.cos(math.radians(lat))),
        lat + metres * math.cos(rad) / METRES_PER_DEGREE,
    )


def kerbside(point, heading):
    """Where a sign facing traffic travelling on `heading` stands (right side)."""
    return move(point, (heading + 90) % 360, KERB_OFFSET_M)


def rounded(point):
    return [round(point[0], 6), round(point[1], 6)]


def load(path):
    nodes, node_tags, ways, relations = {}, {}, {}, []
    for _, element in ET.iterparse(path):
        if element.tag == "node":
            node_id = element.get("id")
            nodes[node_id] = (float(element.get("lon")), float(element.get("lat")))
            found = tags(element)
            if found:
                node_tags[node_id] = found
            element.clear()
        elif element.tag == "way":
            found = tags(element)
            if found.get("highway") in CAR_ROADS:
                ways[element.get("id")] = {
                    "nodes": [nd.get("ref") for nd in element.findall("nd")],
                    "tags": found,
                }
            element.clear()
        elif element.tag == "relation":
            found = tags(element)
            if found.get("type") == "restriction":
                members = [
                    (m.get("type"), m.get("ref"), m.get("role"))
                    for m in element.findall("member")
                ]
                relations.append((element.get("id"), found, members))
            element.clear()
    return nodes, node_tags, ways, relations


def approach(nodes, way, node_id, travel_forward):
    """Heading of traffic passing node_id along way, travelling in node order
    when travel_forward is true, against it otherwise; None if not on the way."""
    refs = way["nodes"]
    if node_id not in refs or len(refs) < 2:
        return None
    i = refs.index(node_id)
    step = 1 if travel_forward else -1
    previous, following = i - step, i + step
    if 0 <= previous < len(refs):
        return bearing(nodes[refs[previous]], nodes[refs[i]])
    return bearing(nodes[refs[i]], nodes[refs[following]])


def point_feature(kind, ref, point, heading=None, **extra):
    properties = {"kind": kind, "ref": ref}
    if heading is not None:
        properties["heading"] = round(heading, 1)
    properties.update(extra)
    return {
        "type": "Feature",
        "properties": properties,
        "geometry": {"type": "Point", "coordinates": rounded(point)},
    }


def extract(path):
    nodes, node_tags, ways, relations = load(path)
    ways_by_node = {}
    for way_id, way in ways.items():
        for ref in way["nodes"]:
            ways_by_node.setdefault(ref, []).append(way_id)

    features = []
    for node_id, found in node_tags.items():
        highway = found.get("highway")
        calming = found.get("traffic_calming")
        if highway == "traffic_signals":
            kind = "traffic_light"
        elif highway == "stop":
            kind = "stop_sign"
        elif highway == "give_way":
            kind = "yield_sign"
        elif calming in CALMING:
            kind = "speed_hump"
        else:
            continue
        on_ways = ways_by_node.get(node_id)
        if not on_ways:
            continue  # not on a road the network keeps
        direction = found.get("direction") or found.get("traffic_signals:direction")
        heading = None
        if direction in ("forward", "backward"):
            heading = approach(nodes, ways[on_ways[0]], node_id, direction == "forward")
        elif kind in ("speed_hump",) and len(on_ways) == 1:
            heading = approach(nodes, ways[on_ways[0]], node_id, True)
        point = nodes[node_id]
        if heading is not None and kind in ("stop_sign", "yield_sign"):
            point = kerbside(point, heading)
        extra = {}
        if kind == "stop_sign" and found.get("stop") == "all":
            extra["allWay"] = True
        features.append(point_feature(kind, f"node/{node_id}", point, heading, **extra))

    for relation_id, found, members in relations:
        restriction = found.get("restriction")
        hours = None
        if not restriction:
            conditional = found.get("restriction:conditional", "")
            match = re.match(r"\s*(\w+)\s*@\s*\(?(.*?)\)?\s*$", conditional)
            if match:
                restriction, hours = match.group(1), match.group(2).strip()
        if restriction not in TURN_BANS:
            continue
        via = [ref for kind, ref, role in members if role == "via" and kind == "node"]
        source = [ref for kind, ref, role in members if role == "from" and kind == "way"]
        if len(via) != 1 or len(source) != 1 or source[0] not in ways or via[0] not in nodes:
            continue
        way = ways[source[0]]
        refs = way["nodes"]
        if via[0] not in refs:
            continue
        # Traffic on the "from" way travels towards the via node.
        forward = refs.index(via[0]) != 0
        heading = approach(nodes, way, via[0], forward)
        if heading is None:
            continue
        point = kerbside(move(nodes[via[0]], (heading + 180) % 360, TURN_SIGN_SETBACK_M), heading)
        extra = {"hours": hours} if hours else {}
        features.append(
            point_feature(restriction, f"relation/{relation_id}", point, heading, **extra)
        )

    for way_id, way in ways.items():
        match = re.match(r"\s*(\d+)\s*$", way["tags"].get("maxspeed", ""))
        coordinates = [rounded(nodes[ref]) for ref in way["nodes"] if ref in nodes]
        if not match or len(coordinates) < 2:
            continue
        features.append({
            "type": "Feature",
            "properties": {
                "kind": "speed_limit",
                "ref": f"way/{way_id}",
                "speedKmh": int(match.group(1)),
            },
            "geometry": {"type": "LineString", "coordinates": coordinates},
        })
    return features


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--network", default="toronto-downtown")
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "app/public/data/toronto-traffic-controls.geojson",
    )
    args = parser.parse_args()
    folder = ROOT / "networks" / args.network
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    features = sorted(
        extract(folder / "source.osm.xml"),
        key=lambda f: (f["properties"]["kind"], f["properties"]["ref"]),
    )
    collection = {
        "type": "FeatureCollection",
        "metadata": {
            "network": manifest["network"],
            "network_version": manifest["network_version"],
            "bbox_wgs84": manifest["simulation_bbox_wgs84"],
            "attribution": "© OpenStreetMap contributors",
            "license_url": "https://www.openstreetmap.org/copyright",
        },
        "features": features,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(collection, separators=(",", ":"), ensure_ascii=False),
        encoding="utf-8",
    )
    counts = {}
    for feature in features:
        kind = feature["properties"]["kind"]
        counts[kind] = counts.get(kind, 0) + 1
    print(f"Wrote {len(features)} features to {args.output}: {counts}")


if __name__ == "__main__":
    main()
