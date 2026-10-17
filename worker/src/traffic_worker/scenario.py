"""Build and run a SUMO network from an intersection-editor scenario.

The editor's "Export scenario.json" button describes a four-arm junction: the
lanes on each arm (kerb side first), the posted speed per arm, how the junction
is controlled, and hourly demand. This module turns that into SUMO plain XML,
builds it with netconvert, generates flows, runs SUMO, and reports per-mode trip
metrics and per-approach conditions.

    uv run python -m traffic_worker.scenario scenario.json [--gui] [--json]

Pedestrians, trees, benches and buildings travel with the scenario but do not
affect the simulation yet.
"""

import argparse
import json
import os
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Arm = Literal["north", "east", "south", "west"]
# Clockwise, so from arm i: i+1 is a left turn, i+2 straight on, i+3 a right turn.
ARMS: list[Arm] = ["north", "east", "south", "west"]
TURN_SHARES = {2: 0.6, 3: 0.25, 1: 0.15}
LANE_CLASSES = {"car_lane": "passenger", "bike_lane": "bicycle", "streetcar_lane": "tram"}
MODES = {"car": "passenger", "bike": "bicycle", "streetcar": "tram"}


class Lane(BaseModel):
    kind: Literal["car_lane", "bike_lane", "streetcar_lane"]
    width: float = Field(gt=0, le=10)


class ArmSpec(BaseModel):
    inbound: list[Lane] = Field(max_length=10)
    outbound: list[Lane] = Field(max_length=10)
    speed_kmh: float = Field(gt=0, le=130)


class DemandSpec(BaseModel):
    cars_per_hour_per_arm: float = Field(ge=0, le=5000)
    bikes_per_hour_per_arm: float = Field(ge=0, le=5000)
    streetcars_per_hour_per_direction: float = Field(ge=0, le=120)
    duration_seconds: int = Field(ge=60, le=4 * 3600)


class Scenario(BaseModel):
    # Scene components (trees, buildings…) ride along but are not used here.
    model_config = ConfigDict(extra="ignore")

    format: Literal["traffic-thing-scenario-v1"]
    arm_length_m: float = Field(gt=20, le=2000)
    control: Literal["traffic_light", "allway_stop", "priority"]
    arms: dict[Arm, ArmSpec]
    demand: DemandSpec


def _binary(name: str) -> str:
    # The eclipse-sumo wheel knows its install location; prefer it over PATH.
    try:
        import sumo

        os.environ.setdefault("SUMO_HOME", sumo.SUMO_HOME)
    except ImportError:
        pass
    from sumolib import checkBinary

    return checkBinary(name)


def _edge_classes(lanes: list[Lane]) -> list[str]:
    """Permitted vehicle classes per lane; cyclists share car lanes if no bike lane."""
    has_bike_lane = any(lane.kind == "bike_lane" for lane in lanes)
    classes = []
    for lane in lanes:
        allowed = LANE_CLASSES[lane.kind]
        if lane.kind == "car_lane" and not has_bike_lane:
            allowed += " bicycle"
        classes.append(allowed)
    return classes


def _write_network(scenario: Scenario, scratch: Path) -> tuple[Path, dict[str, set[str]]]:
    length = scenario.arm_length_m
    position = {"north": (0, length), "east": (length, 0), "south": (0, -length), "west": (-length, 0)}

    nodes = ET.Element("nodes")
    ET.SubElement(nodes, "node", id="C", x="0", y="0", type=scenario.control)
    for arm, (x, y) in position.items():
        ET.SubElement(nodes, "node", id=arm, x=str(x), y=str(y), type="priority")

    edges = ET.Element("edges")
    permitted: dict[str, set[str]] = {}
    for arm in ARMS:
        spec = scenario.arms[arm]
        for direction, lanes in (("in", spec.inbound), ("out", spec.outbound)):
            if not lanes:
                continue
            edge_id = f"{arm}_{direction}"
            start, end = (arm, "C") if direction == "in" else ("C", arm)
            edge = ET.SubElement(
                edges,
                "edge",
                id=edge_id,
                **{"from": start, "to": end},
                numLanes=str(len(lanes)),
                speed=f"{spec.speed_kmh / 3.6:.3f}",
            )
            classes = _edge_classes(lanes)
            # Scenario lanes are kerb side first, which is SUMO lane index 0.
            for index, (lane, allowed) in enumerate(zip(lanes, classes)):
                ET.SubElement(edge, "lane", index=str(index), allow=allowed, width=str(lane.width))
            permitted[edge_id] = {c for allowed in classes for c in allowed.split()}

    if not permitted:
        raise ValueError("The scenario has no lanes to simulate")

    ET.ElementTree(nodes).write(scratch / "junction.nod.xml", encoding="utf-8", xml_declaration=True)
    ET.ElementTree(edges).write(scratch / "junction.edg.xml", encoding="utf-8", xml_declaration=True)
    network = scratch / "junction.net.xml"
    subprocess.run(
        [
            _binary("netconvert"),
            "--node-files", str(scratch / "junction.nod.xml"),
            "--edge-files", str(scratch / "junction.edg.xml"),
            "--output-file", str(network),
            "--no-turnarounds", "true",
            "--junctions.corner-detail", "5",
            "--no-warnings", "true",
        ],
        check=True,
        stdout=sys.stderr,
        stderr=sys.stderr,
    )
    return network, permitted


def _write_demand(
    scenario: Scenario, permitted: dict[str, set[str]], scratch: Path
) -> tuple[Path, list[str]]:
    demand = scenario.demand
    routes = ET.Element("routes")
    ET.SubElement(routes, "vType", id="car", vClass="passenger", color="0.85,0.85,0.9")
    ET.SubElement(routes, "vType", id="bike", vClass="bicycle", color="0.3,0.75,0.4")
    ET.SubElement(
        routes, "vType", id="streetcar", vClass="tram", length="30", maxSpeed="16.7",
        accel="1.2", decel="1.3", color="0.84,0.16,0.12",
    )
    skipped: list[str] = []

    def flow(mode: str, origin: Arm, destination: Arm, per_hour: float) -> None:
        source, sink = f"{origin}_in", f"{destination}_out"
        vclass = MODES[mode]
        if per_hour <= 0:
            return
        if vclass not in permitted.get(source, set()) or vclass not in permitted.get(sink, set()):
            skipped.append(f"{mode} {origin} -> {destination}: no {vclass} lanes")
            return
        ET.SubElement(
            routes, "flow", id=f"{mode}_{origin}_{destination}", type=mode,
            begin="0", end=str(demand.duration_seconds), vehsPerHour=f"{per_hour:.3f}",
            departLane="best", departSpeed="max", **{"from": source, "to": sink},
        )

    for i, origin in enumerate(ARMS):
        for offset, share in TURN_SHARES.items():
            destination = ARMS[(i + offset) % 4]
            flow("car", origin, destination, demand.cars_per_hour_per_arm * share)
            flow("bike", origin, destination, demand.bikes_per_hour_per_arm * share)
        # Streetcars run straight through on both streets.
        flow("streetcar", origin, ARMS[(i + 2) % 4], demand.streetcars_per_hour_per_direction)

    path = scratch / "demand.rou.xml"
    ET.ElementTree(routes).write(path, encoding="utf-8", xml_declaration=True)
    return path, skipped


def _trip_metrics(path: Path, duration: int) -> dict[str, dict]:
    totals: dict[str, dict[str, float]] = {}
    for _, element in ET.iterparse(path, events=("end",)):
        if element.tag != "tripinfo":
            continue
        mode = element.get("vType", "car")
        stats = totals.setdefault(
            mode,
            {"completed": 0, "en_route": 0, "queued": 0, "duration": 0.0, "waiting": 0.0, "time_loss": 0.0},
        )
        if float(element.get("depart", "-1")) < 0:
            stats["queued"] += 1
        elif float(element.get("arrival", "-1")) < 0:
            stats["en_route"] += 1
        else:
            stats["completed"] += 1
            stats["duration"] += float(element.attrib["duration"])
            stats["waiting"] += float(element.attrib["waitingTime"])
            stats["time_loss"] += float(element.attrib["timeLoss"])
        element.clear()

    result = {}
    for mode, stats in sorted(totals.items()):
        done = stats["completed"]
        mean = (lambda total: round(total / done, 1) if done else None)
        result[mode] = {
            "completed_trips": int(done),
            "still_en_route": int(stats["en_route"]),
            # Demand that could not even enter the network: the insertion backlog.
            "queued_at_entry": int(stats["queued"]),
            "throughput_per_hour": round(done * 3600 / duration),
            "average_trip_seconds": mean(stats["duration"]),
            "average_waiting_seconds": mean(stats["waiting"]),
            "average_delay_seconds": mean(stats["time_loss"]),
        }
    return result


def _approach_metrics(path: Path) -> dict[str, dict]:
    approaches = {}
    for _, element in ET.iterparse(path, events=("end",)):
        if element.tag == "edge" and element.get("id", "").endswith("_in"):
            arm = element.attrib["id"].removesuffix("_in")
            speed = element.get("speed")
            approaches[arm] = {
                "mean_speed_kmh": round(float(speed) * 3.6, 1) if speed else None,
                "total_waiting_seconds": round(float(element.get("waitingTime", 0))),
                "mean_occupancy_percent": round(float(element.get("occupancy", 0)), 1),
            }
    return approaches


def run_scenario(scenario: Scenario, seed: int = 42, gui: bool = False, keep: Path | None = None) -> dict:
    with TemporaryDirectory(prefix="traffic-scenario-") as directory:
        scratch = keep or Path(directory)
        scratch.mkdir(parents=True, exist_ok=True)
        network, permitted = _write_network(scenario, scratch)
        demand, skipped = _write_demand(scenario, permitted, scratch)
        duration = scenario.demand.duration_seconds
        additional = scratch / "outputs.add.xml"
        additional.write_text(
            f'<additional><edgeData id="approaches" file="{(scratch / "edgedata.xml").as_posix()}" '
            f'begin="0" end="{duration}" excludeEmpty="false"/></additional>',
            encoding="utf-8",
        )
        tripinfo = scratch / "tripinfo.xml"
        command = [
            _binary("sumo-gui" if gui else "sumo"),
            "--net-file", str(network),
            "--route-files", str(demand),
            "--additional-files", str(additional),
            "--begin", "0",
            "--end", str(duration),
            "--seed", str(seed),
            "--tripinfo-output", str(tripinfo),
            "--tripinfo-output.write-unfinished", "true",
            "--tripinfo-output.write-undeparted", "true",
            # Congestion stays visible as unfinished trips rather than teleporting away,
            # but a vehicle stuck behind a junction deadlock (opposing left turners)
            # may proceed after 10 s, as drivers would in practice.
            "--time-to-teleport", "-1",
            "--ignore-junction-blocker", "10",
            "--no-step-log", "true",
            "--duration-log.disable", "true",
        ]
        if gui:
            command += ["--start", "true", "--delay", "40"]
        subprocess.run(command, check=True, stdout=sys.stderr, stderr=sys.stderr)
        return {
            "seed": seed,
            "duration_seconds": duration,
            "control": scenario.control,
            "modes": _trip_metrics(tripinfo, duration),
            "approaches": _approach_metrics(scratch / "edgedata.xml"),
            "skipped_flows": skipped,
        }


def _print_report(result: dict) -> None:
    minutes = result["duration_seconds"] // 60
    print(f"Simulated {minutes} min, {result['control'].replace('_', ' ')} junction, seed {result['seed']}\n")
    print(f"{'Mode':<10}{'Trips':>7}{'Per h':>7}{'En route':>9}{'Queued':>8}{'Trip s':>8}{'Wait s':>8}{'Delay s':>9}")
    for mode, m in result["modes"].items():
        cells = [m["average_trip_seconds"], m["average_waiting_seconds"], m["average_delay_seconds"]]
        trip, wait, delay = ("-" if v is None else f"{v:.1f}" for v in cells)
        print(
            f"{mode:<10}{m['completed_trips']:>7}{m['throughput_per_hour']:>7}"
            f"{m['still_en_route']:>9}{m['queued_at_entry']:>8}{trip:>8}{wait:>8}{delay:>9}"
        )
    print(f"\n{'Approach':<10}{'km/h':>7}{'Wait s':>9}{'Occ. %':>8}")
    for arm, a in result["approaches"].items():
        speed = "-" if a["mean_speed_kmh"] is None else f"{a['mean_speed_kmh']:.1f}"
        print(f"{arm:<10}{speed:>7}{a['total_waiting_seconds']:>9}{a['mean_occupancy_percent']:>8.1f}")
    if result["skipped_flows"]:
        print("\nSkipped demand (no lanes for that mode):")
        for line in result["skipped_flows"]:
            print(f"  {line}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("scenario", type=Path, help="scenario.json exported from the editor")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--gui", action="store_true", help="watch the run in sumo-gui")
    parser.add_argument("--json", action="store_true", help="print machine-readable results")
    parser.add_argument("--keep", type=Path, help="write the SUMO network and outputs here")
    args = parser.parse_args()

    scenario = Scenario.model_validate_json(args.scenario.read_bytes())
    result = run_scenario(scenario, seed=args.seed, gui=args.gui, keep=args.keep)
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        _print_report(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
