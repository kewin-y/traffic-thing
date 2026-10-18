"""One-request subprocess entry point for isolated SUMO simulations."""

import ctypes
import gzip
import json
import os
import subprocess
import sys
import xml.etree.ElementTree as ET
from collections.abc import Generator
from contextlib import ExitStack, contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from .active_demand import (
    CYCLIST_PREFIX,
    SCOOTER_PREFIX,
    is_active_vehicle,
    walkable_network,
    write_active_demand,
)
from .assets import network_assets, osm_source, verify_network_version
from .models import SimulationRequest


KINDS = ("car", "pedestrian", "bicycle", "scooter")


#: Seconds simulated before the measured window so streets already carry
#: traffic when it starts, instead of filling up from empty.
MAX_WARMUP_SECONDS = 600
#: End of the published demand; warm-up never pushes a run beyond it.
DEMAND_HORIZON_SECONDS = 3600


def warmup_seconds(duration_seconds: int) -> int:
    return max(0, min(MAX_WARMUP_SECONDS, DEMAND_HORIZON_SECONDS - duration_seconds))


def frame_interval_seconds(duration_seconds: int) -> int:
    """Position frames every second, thinned so a run has at most 600 frames."""
    return max(1, -(-duration_seconds // 600))


def _vehicle_kind(vehicle_id: str) -> str:
    if vehicle_id.startswith(SCOOTER_PREFIX):
        return "scooter"
    if vehicle_id.startswith(CYCLIST_PREFIX):
        return "bicycle"
    return "car"


class _TimelineWriter:
    """Stream sampled simulation state into a compressed JSON timeline.

    Frames hold every vehicle and person as flat rows of agent index,
    longitude, latitude, heading and speed; agent IDs and kinds are written
    once at the end. Every sample interval a frame also carries the edges
    with vehicles on them, for congestion.
    """

    def __init__(self, path: Path, sample_interval_seconds: int, frame_interval_seconds: int = 1):
        self.path = path
        self.partial_path = path.with_name(f"{path.name}.partial")
        self._stack = ExitStack()
        self.file = self._stack.enter_context(
            gzip.open(self.partial_path, "wt", encoding="utf-8")  # noqa: SIM115 -- ExitStack keeps it open across steps
        )
        self.first_frame = True
        self.agents: dict[str, int] = {}
        self.agent_rows: list[list[Any]] = []
        self.edges: dict[str, int] = {}
        self.edge_rows: list[list[Any]] = []
        try:
            header = json.dumps({
                "format": "traffic-worker-timeline-v2",
                "coordinate_system": "WGS84 longitude and latitude",
                "sample_interval_seconds": sample_interval_seconds,
                "frame_interval_seconds": frame_interval_seconds,
                "kinds": KINDS,
                "agent_fields": ["agent", "longitude", "latitude", "heading_degrees", "speed_mps"],
                "edge_fields": ["edge", "mean_speed_mps", "vehicle_count"],
            }, separators=(",", ":"))
            self.file.write(f'{header[:-1]},"frames":[')
        except BaseException:
            self._stack.close()
            self.partial_path.unlink(missing_ok=True)
            raise

    def _agent(self, agent_id: str, kind: str) -> int:
        index = self.agents.get(agent_id)
        if index is None:
            index = self.agents[agent_id] = len(self.agent_rows)
            self.agent_rows.append([agent_id, KINDS.index(kind)])
        return index

    def _edge(self, libsumo: Any, edge_id: str) -> int:
        index = self.edges.get(edge_id)
        if index is None:
            index = self.edges[edge_id] = len(self.edge_rows)
            free_flow = max(
                libsumo.lane.getMaxSpeed(f"{edge_id}_{lane}")
                for lane in range(libsumo.edge.getLaneNumber(edge_id))
            )
            self.edge_rows.append([edge_id, round(free_flow, 2)])
        return index

    def write_frame(self, libsumo: Any, time_seconds: int, edges: bool) -> None:
        if not self.first_frame:
            self.file.write(",")
        self.first_frame = False
        rows: list[float | int] = []
        for domain, kind_of in (
            (libsumo.vehicle, _vehicle_kind),
            (libsumo.person, lambda _: "pedestrian"),
        ):
            for agent_id in domain.getIDList():
                x, y = domain.getPosition(agent_id)
                longitude, latitude = libsumo.simulation.convertGeo(x, y)
                rows += [
                    self._agent(agent_id, kind_of(agent_id)),
                    round(longitude, 6),
                    round(latitude, 6),
                    round(domain.getAngle(agent_id)),
                    round(domain.getSpeed(agent_id), 1),
                ]
        frame: dict[str, Any] = {"time_seconds": time_seconds, "agents": rows}
        if edges:
            edge_rows: list[float | int] = []
            for edge_id in libsumo.edge.getIDList():
                if edge_id.startswith(":"):
                    continue
                count = libsumo.edge.getLastStepVehicleNumber(edge_id)
                if count:
                    edge_rows += [
                        self._edge(libsumo, edge_id),
                        round(libsumo.edge.getLastStepMeanSpeed(edge_id), 2),
                        count,
                    ]
            frame["edges"] = edge_rows
        json.dump(frame, self.file, allow_nan=False, separators=(",", ":"))

    def finish(self) -> None:
        self.file.write(
            '],"agents":' + json.dumps(self.agent_rows, separators=(",", ":"))
            + ',"edges":' + json.dumps(self.edge_rows, separators=(",", ":")) + "}"
        )
        self._stack.close()
        os.replace(self.partial_path, self.path)

    def abort(self) -> None:
        if not self.file.closed:
            self._stack.close()
        self.partial_path.unlink(missing_ok=True)


@contextmanager
def _stdout_to_stderr() -> Generator[None, None, None]:
    """Redirect fd 1, including C/C++ output, without losing the JSON channel."""
    libc = ctypes.CDLL(None)
    sys.stdout.flush()
    libc.fflush(None)
    saved_stdout = os.dup(1)
    try:
        os.dup2(2, 1)
        yield
    finally:
        try:
            sys.stdout.flush()
            libc.fflush(None)
        finally:
            os.dup2(saved_stdout, 1)
            os.close(saved_stdout)


def _edited_network(
    request: SimulationRequest, source: Path, scratch: Path
) -> Path:
    import sumolib

    network = sumolib.net.readNet(str(source))
    edges = {edge.getID(): edge for edge in network.getEdges()}
    patches: dict[str, dict[str, str]] = {}
    for edit in request.edits:
        edge = edges.get(edit.edge_id)
        if edge is None or edge.getFunction() == "internal" or edit.edge_id.startswith(":"):
            raise ValueError(f"Edit refers to unknown or internal edge: {edit.edge_id}")
        attributes = patches.setdefault(edit.edge_id, {"id": edit.edge_id})
        if edit.type == "set_speed_limit":
            attributes["speed"] = str(edit.speed_mps)
        elif edit.type == "set_lane_count":
            attributes["numLanes"] = str(edit.lane_count)
        elif edit.type == "close_edge":
            # Keep the edge and all demand references; no vehicle may use it.
            attributes["disallow"] = "all"

    if not patches:
        return source

    patch_path = scratch / "edits.edg.xml"
    root = ET.Element("edges")
    for attributes in patches.values():
        ET.SubElement(root, "edge", attributes)
    ET.ElementTree(root).write(patch_path, encoding="utf-8", xml_declaration=True)
    edited_path = scratch / "network.net.xml"
    completed = subprocess.run(
        [
            sumolib.checkBinary("netconvert"),
            "--sumo-net-file", str(source),
            "--edge-files", str(patch_path),
            "--output-file", str(edited_path),
            "--ignore-errors", "false",
        ],
        stdin=subprocess.DEVNULL,
        stdout=sys.stderr,
        stderr=sys.stderr,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"netconvert failed with exit status {completed.returncode}")
    return edited_path


def _completed_trip_metrics(
    path: Path, expected_completed: int, arrived_ids: set[str] | None = None
) -> dict[str, Any]:
    completed = 0
    duration = waiting = time_loss = 0.0
    for _, element in ET.iterparse(path, events=("end",)):
        # Removed/vaporized and unfinished vehicles must not become arrivals.
        if (
            element.tag == "tripinfo"
            and not is_active_vehicle(element.attrib["id"])
            and float(element.attrib["arrival"]) >= 0
            # Trips finished during warm-up are outside the measured window.
            and (arrived_ids is None or element.attrib["id"] in arrived_ids)
            and not element.get("vaporized")
        ):
            completed += 1
            duration += float(element.attrib["duration"])
            waiting += float(element.attrib["waitingTime"])
            time_loss += float(element.attrib["timeLoss"])
        element.clear()
    if completed != expected_completed:
        raise RuntimeError(
            f"SUMO tripinfo arrival count mismatch: {completed} records for "
            f"{expected_completed} arrivals"
        )
    return {
        "average_trip_duration_seconds": duration / completed if completed else None,
        "average_waiting_time_seconds": waiting / completed if completed else None,
        "average_time_loss_seconds": time_loss / completed if completed else None,
    }


def _simulate(
    request: SimulationRequest,
    network: Path,
    demand: Path,
    scratch: Path,
    timeline_path: Path | None = None,
    active_demand: Path | None = None,
) -> dict[str, Any]:
    import libsumo

    tripinfo = scratch / "tripinfo.xml"
    departed = 0
    arrived_ids: set[str] = set()
    warmup = warmup_seconds(request.duration_seconds)
    end = warmup + request.duration_seconds
    frame_interval = frame_interval_seconds(request.duration_seconds)
    timeline = (
        _TimelineWriter(timeline_path, request.sample_interval_seconds, frame_interval)
        if request.record and timeline_path is not None
        else None
    )
    if request.record and timeline is None:
        raise RuntimeError("Timeline recording requires a timeline output path")
    try:
        libsumo.start([
            "sumo",
            "--net-file", str(network),
            "--route-files", ",".join(str(p) for p in (demand, active_demand) if p),
            "--begin", "0",
            "--end", str(end),
            "--step-length", "1",
            "--seed", str(request.seed),
            # Drivers keep to the posted limit rather than SUMO's default
            # spread of ±10% around it (types that set their own spread keep it).
            "--default.speeddev", "0",
            # Parse every input record up front, including demand beyond the horizon.
            "--route-steps", "0",
            "--ignore-route-errors", "false",
            "--max-depart-delay", "-1",
            # Gridlock remains unfinished rather than teleporting to a completion.
            "--time-to-teleport", "-1",
            "--tripinfo-output", str(tripinfo),
            "--tripinfo-output.write-unfinished", "false",
            "--tripinfo-output.write-undeparted", "false",
            "--precision", "6",
            "--no-step-log", "true",
            "--duration-log.disable", "true",
        ])
        version = libsumo.getVersion()[1]
        for _ in range(end):
            libsumo.simulationStep()
            # Times below are within the measured window, after warm-up.
            current_time = int(libsumo.simulation.getTime()) - warmup
            if current_time <= 0:
                continue
            # Car metrics exclude the generated cyclists and scooter riders.
            departed += sum(
                not is_active_vehicle(v) for v in libsumo.simulation.getDepartedIDList()
            )
            arrived_ids.update(
                v for v in libsumo.simulation.getArrivedIDList() if not is_active_vehicle(v)
            )
            final = current_time == request.duration_seconds
            if timeline and (current_time % frame_interval == 0 or final):
                timeline.write_frame(
                    libsumo,
                    current_time,
                    edges=final or current_time % request.sample_interval_seconds == 0,
                )
        result = {
            "network": request.network,
            "seed": request.seed,
            "sumo_version": version,
            "simulation_time_seconds": libsumo.simulation.getTime() - warmup,
            "warmup_seconds": warmup,
            "completed": len(arrived_ids),
            "departed": departed,
            "running": sum(
                not is_active_vehicle(v) for v in libsumo.vehicle.getIDList()
            ),
            "pending": sum(
                not is_active_vehicle(v)
                for v in libsumo.simulation.getPendingVehicles()
            ),
            "applied_edits": [edit.model_dump(mode="json") for edit in request.edits],
            "metric_semantics": {
                "population": (
                    "cars only; the generated pedestrians, cyclists and e-scooter "
                    "riders share the roads but are excluded"
                ),
                "pending": (
                    "vehicles awaiting insertion whose scheduled departure was before "
                    "the exclusive horizon; future departures and untriggered vehicles "
                    "are excluded"
                ),
                "window": (
                    "counts and averages cover the requested duration after "
                    "warmup_seconds of unmeasured simulation"
                ),
                "averages": "completed, non-vaporized trips only; null if none completed",
                "waiting_time": "SUMO tripinfo waitingTime; excludes departure delay",
            },
        }
    except BaseException:
        if timeline:
            timeline.abort()
        raise
    finally:
        # close() flushes and closes the XML before it is parsed, also after errors.
        if libsumo.isLoaded():
            libsumo.close()
    try:
        result.update(_completed_trip_metrics(tripinfo, len(arrived_ids), arrived_ids))
        if timeline:
            timeline.finish()
        return result
    except BaseException:
        if timeline:
            timeline.abort()
        raise


def run_simulation(
    request: SimulationRequest, timeline_path: Path | None = None
) -> dict[str, Any]:
    """Run trusted mounted demand without rewriting, repairing, or rerouting it.

    Native SUMO behavior explicitly encoded in demand (such as trips needing an
    initial route or equipped rerouting devices) is preserved. Invalid fixed
    routes fail; no routing tool or ignore-errors option repairs them.
    """
    with _stdout_to_stderr():
        root = Path(os.environ.get("NETWORK_ROOT", "/data/networks"))
        source, demand = network_assets(root, request.network)
        osm = osm_source(root, request.network)
        if request.network_version:
            verify_network_version(Path(os.environ.get("NETWORK_ROOT", "/data/networks")), request.network, request.network_version)
        with TemporaryDirectory(prefix="traffic-worker-") as directory:
            scratch = Path(directory)
            # Posted limits and sidewalks first, so road edits apply on top.
            network = _edited_network(
                request, walkable_network(source, scratch, osm), scratch
            )
            active = write_active_demand(
                network,
                scratch,
                request.seed,
                warmup_seconds(request.duration_seconds) + request.duration_seconds,
                demand,
            )
            return _simulate(request, network, demand, scratch, timeline_path, active)


def main() -> int:
    request = SimulationRequest.model_validate_json(sys.stdin.buffer.read())
    timeline_output = os.environ.get("TIMELINE_OUTPUT_PATH") if request.record else None
    result = run_simulation(
        request, Path(timeline_output) if timeline_output else None
    )
    sys.stdout.write(json.dumps(result, allow_nan=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
