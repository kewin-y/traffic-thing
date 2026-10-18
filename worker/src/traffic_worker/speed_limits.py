"""Posted speed limits for the simulated network.

netconvert gives OpenStreetMap ways without a `maxspeed` tag its generic
typemap speeds (80 km/h on tertiary streets, 100 km/h on secondary and
primary roads, 50 km/h on residential ones). Downtown Toronto streets are
posted at 30–50 km/h, so ways without a tag fall back to the city default
the editor also uses, while tagged ways keep their posted limit.
"""

import xml.etree.ElementTree as ET
from pathlib import Path

#: City default where no limit is posted, matching the editor's scenario model.
UNPOSTED_KMH = 40
#: Classes whose typemap speed is kept: expressways and ramps, and shared
#: living streets (10 km/h).
KEEP_CLASSES = frozenset({"motorway", "motorway_link", "trunk", "trunk_link", "living_street"})


def unposted_ways(osm: Path) -> dict[str, str]:
    """OSM way IDs with a road class but no posted `maxspeed`, by class."""
    ways: dict[str, str] = {}
    for _, element in ET.iterparse(osm, events=("end",)):
        if element.tag == "way":
            tags = {tag.get("k"): tag.get("v") for tag in element.iter("tag")}
            highway = tags.get("highway")
            if highway and not tags.get("maxspeed"):
                ways[element.get("id", "")] = highway
            element.clear()
        elif element.tag == "node":
            element.clear()
    return ways


def way_of(edge_id: str) -> str:
    """The OSM way an imported edge came from (`-123#4` → `123`)."""
    return edge_id.lstrip("-").split("#", 1)[0]


def write_speed_patch(network: Path, osm: Path, output: Path) -> int:
    """Write a netconvert edge patch setting unposted streets to the city default.

    Returns the number of edges patched; no file is written when it is 0.
    """
    unposted = unposted_ways(osm)
    speed = f"{UNPOSTED_KMH / 3.6:.4f}"
    root = ET.Element("edges")
    patched = 0
    for _, element in ET.iterparse(network, events=("end",)):
        if element.tag != "edge":
            continue
        edge_id = element.get("id", "")
        highway = unposted.get(way_of(edge_id))
        if (
            not element.get("function")
            and not edge_id.startswith(":")
            and highway is not None
            and highway not in KEEP_CLASSES
        ):
            ET.SubElement(root, "edge", {"id": edge_id, "speed": speed})
            patched += 1
        element.clear()
    if patched:
        ET.ElementTree(root).write(output, encoding="utf-8", xml_declaration=True)
    return patched
