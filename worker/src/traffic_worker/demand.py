"""
traffic_worker/demand.py

Turn model-predicted edge volumes into SUMO demand.

  api side    : write_edgedata(...)  -> edgedata.xml of target vehicle counts per edge
  runner side : sample_demand(...)   -> routeSampler picks routes from a candidate pool
                                        so that edge counts approximate those targets
"""
import subprocess
import sys
import xml.etree.ElementTree as ET
from collections.abc import Iterable
from pathlib import Path


def write_edgedata(
    volumes: Iterable[tuple[str, float]],
    closed: Iterable[str],
    duration_seconds: int,
    path: Path,
) -> None:
    """volumes: (edge_id, predicted vehicles per hour). Counts are scaled to the sim duration.

    Edges whose count rounds to 0 are left out (unconstrained). A 0 count means
    "no route may use this edge", which would wrongly exclude quiet local streets.
    Only genuinely closed edges are written with 0.
    """
    scale = duration_seconds / 3600
    closed = set(closed)
    root = ET.Element("meandata")
    interval = ET.SubElement(root, "interval", begin="0", end=str(duration_seconds))
    written: set[str] = set()
    for edge_id, veh_per_hour in volumes:
        count = 0 if edge_id in closed else round(veh_per_hour * scale)
        if count >= 1 or edge_id in closed:
            ET.SubElement(interval, "edge", id=edge_id, entered=str(count))
            written.add(edge_id)
    # Closed edges missing from volumes must still be written with 0, otherwise
    # routeSampler treats them as unconstrained and routes through them.
    for edge_id in sorted(closed - written):
        ET.SubElement(interval, "edge", id=edge_id, entered="0")
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)


def sample_demand(
    candidate_routes: Path,
    edgedata: Path,
    duration_seconds: int,
    seed: int,
    output: Path,
) -> None:
    """Run SUMO's routeSampler. candidate_routes must contain explicit <route edges=...> routes."""
    import sumo  # the eclipse-sumo wheel; ships tools/routeSampler.py

    script = Path(sumo.SUMO_HOME) / "tools" / "routeSampler.py"
    completed = subprocess.run(
        [
            sys.executable, str(script),
            "-r", str(candidate_routes),
            "-d", str(edgedata),
            "-o", str(output),
            "--edgedata-attribute", "entered",
            "-b", "0",
            "-e", str(duration_seconds),
            "--seed", str(seed),
        ],
        stdin=subprocess.DEVNULL,
        stdout=sys.stderr,   # keep the runner's JSON channel on stdout clean
        stderr=sys.stderr,
        check=False,
    )
    if completed.returncode != 0 or not output.is_file():
        raise RuntimeError(f"routeSampler failed with exit status {completed.returncode}")