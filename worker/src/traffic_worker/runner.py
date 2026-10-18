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

from .assets import network_assets
from .models import SimulationRequest

from .demand import sample_demand

class _TimelineWriter:
    """Stream sampled simulation state into a compressed JSON timeline."""

    def __init__(self, path: Path, sample_interval_seconds: int):
        self.path = path
        self.partial_path = path.with_name(f"{path.name}.partial")
        self._stack = ExitStack()
        self.file = self._stack.enter_context(
            gzip.open(self.partial_path, "wt", encoding="utf-8")  # noqa: SIM115 -- ExitStack keeps it open across steps
        )
        self.first_sample = True
        try:
            header = json.dumps({
                "format": "traffic-worker-timeline-v1",
                "coordinate_system": "SUMO network coordinates",
                "sample_interval_seconds": sample_interval_seconds,
            }, separators=(",", ":"))
            self.file.write(f'{header[:-1]},"samples":[')
        except BaseException:
            self._stack.close()
            self.partial_path.unlink(missing_ok=True)
            raise

    def write_sample(self, libsumo: Any, time_seconds: int) -> None:
        if not self.first_sample:
            self.file.write(",")
        self.first_sample = False
        vehicles = []
        for vehicle_id in libsumo.vehicle.getIDList():
            x, y = libsumo.vehicle.getPosition(vehicle_id)
            vehicles.append({
                "id": vehicle_id,
                "x": x,
                "y": y,
                "speed_mps": libsumo.vehicle.getSpeed(vehicle_id),
                "edge_id": libsumo.vehicle.getRoadID(vehicle_id),
            })
        sample = {
            "time_seconds": time_seconds,
            "vehicles": vehicles,
            "edges": [
                {
                    "id": edge_id,
                    "mean_speed_mps": (
                        libsumo.edge.getLastStepMeanSpeed(edge_id)
                        if libsumo.edge.getLastStepVehicleNumber(edge_id)
                        else libsumo.edge.getMaxSpeed(edge_id)
                    ),
                    "free_flow_speed_mps": libsumo.edge.getMaxSpeed(edge_id),
                    "vehicle_count": libsumo.edge.getLastStepVehicleNumber(edge_id),
                }
                for edge_id in libsumo.edge.getIDList()
                if not edge_id.startswith(":")
            ],
        }
        json.dump(sample, self.file, allow_nan=False, separators=(",", ":"))

    def finish(self) -> None:
        self.file.write("]}")
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


def _completed_trip_metrics(path: Path, expected_completed: int) -> dict[str, Any]:
    completed = 0
    duration = waiting = time_loss = 0.0
    for _, element in ET.iterparse(path, events=("end",)):
        # Removed/vaporized and unfinished vehicles must not become arrivals.
        if (
            element.tag == "tripinfo"
            and float(element.attrib["arrival"]) >= 0
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
) -> dict[str, Any]:
    import libsumo

    tripinfo = scratch / "tripinfo.xml"
    departed = arrived = 0
    timeline = (
        _TimelineWriter(timeline_path, request.sample_interval_seconds)
        if request.record and timeline_path is not None
        else None
    )
    if request.record and timeline is None:
        raise RuntimeError("Timeline recording requires a timeline output path")
    try:
        libsumo.start([
            "sumo",
            "--net-file", str(network),
            "--route-files", str(demand),
            "--begin", "0",
            "--end", str(request.duration_seconds),
            "--step-length", "1",
            "--seed", str(request.seed),
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
        for _ in range(request.duration_seconds):
            libsumo.simulationStep()
            departed += libsumo.simulation.getDepartedNumber()
            arrived += libsumo.simulation.getArrivedNumber()
            current_time = int(libsumo.simulation.getTime())
            if timeline and (
                current_time % request.sample_interval_seconds == 0
                or current_time == request.duration_seconds
            ):
                timeline.write_sample(libsumo, current_time)
        result = {
            "network": request.network,
            "seed": request.seed,
            "sumo_version": version,
            "simulation_time_seconds": libsumo.simulation.getTime(),
            "completed": arrived,
            "departed": departed,
            "running": libsumo.vehicle.getIDCount(),
            "pending": len(libsumo.simulation.getPendingVehicles()),
            "applied_edits": [edit.model_dump(mode="json") for edit in request.edits],
            "metric_semantics": {
                "population": "vehicles only; persons and containers are excluded",
                "pending": (
                    "vehicles awaiting insertion whose scheduled departure was before "
                    "the exclusive horizon; future departures and untriggered vehicles "
                    "are excluded"
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
        result.update(_completed_trip_metrics(tripinfo, arrived))
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
    """Run mounted demand, or model-sampled demand when the API provided targets.

    Without PREDICTED_EDGEDATA_PATH the mounted demand is used as-is: trusted,
    not rewritten, repaired, or rerouted; invalid fixed routes fail; no routing
    tool or ignore-errors option repairs them. With PREDICTED_EDGEDATA_PATH the
    mounted demand is only a candidate route pool: routeSampler re-samples it to
    match the API's predicted per-edge counts.
    """
    with _stdout_to_stderr():
        source, demand = network_assets(
            Path(os.environ.get("NETWORK_ROOT", "/data/networks")), request.network
        )
        with TemporaryDirectory(prefix="traffic-worker-") as directory:
            scratch = Path(directory)
            network = _edited_network(request, source, scratch)
            edgedata = os.environ.get("PREDICTED_EDGEDATA_PATH")
            if edgedata:
                sampled = scratch / "predicted_demand.rou.xml"
                sample_demand(demand, Path(edgedata), request.duration_seconds, request.seed, sampled)
                demand = sampled
            result = _simulate(request, network, demand, scratch, timeline_path)
            result["demand_source"] = "model" if edgedata else "mounted"
            return result

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
